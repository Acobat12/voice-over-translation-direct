import {
  type TranslatedVideoTranslationResponse,
  type TranslationHelp,
  type VideoTranslationResponse,
  VideoTranslationStatus,
} from "@vot.js/core/types/yandex";
import type { RequestLang, ResponseLang } from "@vot.js/shared/types/data";

import type { VideoData, VideoHandler } from "..";
import { AudioDownloader } from "../audioDownloader";
import {
  DOUYIN_AUDIO_STRATEGY,
  VK_AUDIO_STRATEGY,
  WEB_ABR_STRATEGY,
  WEB_MSE_PROXY_STRATEGY,
  YT_AUDIO_STRATEGY,
} from "../audioDownloader/strategies";
import { localizationProvider } from "../localization/localizationProvider";
import type {
  DownloadedAudioData,
  DownloadedPartialAudioData,
} from "../types/audioDownloader";
import { NEVER_ABORTED_SIGNAL, throwIfAborted } from "../utils/abort";
import debug from "../utils/debug";
import { getErrorMessage, isAbortError, makeAbortError } from "../utils/errors";
import {
  adjustTranslationEtaForDisplay,
  formatTranslationEta,
} from "../utils/timeFormatting";
import VOTLocalizedError from "../utils/VOTLocalizedError";
import { notifyTranslationFailureIfNeeded } from "../videoHandler/modules/translationShared";

type VotClientErrorShape = {
  name?: unknown;
  message?: unknown;
  data?: {
    message?: unknown;
  };
};

function asVotClientErrorShape(value: unknown): VotClientErrorShape | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as {
    name?: unknown;
    message?: unknown;
    data?: unknown;
  };
  const data =
    candidate.data && typeof candidate.data === "object"
      ? (candidate.data as { message?: unknown })
      : undefined;

  return {
    name: candidate.name,
    message: candidate.message,
    data,
  };
}

function getServerErrorMessage(value: unknown): string | undefined {
  const err = asVotClientErrorShape(value);
  const message = err?.data?.message;
  return typeof message === "string" && message.length > 0
    ? message
    : undefined;
}

export function isCompletedTranslationResponse(
  response: Pick<
    VideoTranslationResponse,
    "translated" | "status" | "url" | "remainingTime"
  >,
): response is TranslatedVideoTranslationResponse {
  return Boolean(
    response.translated &&
      (response.status === VideoTranslationStatus.FINISHED ||
        response.status === VideoTranslationStatus.PART_CONTENT) &&
      typeof response.url === "string" &&
      response.url.length > 0,
  );
}

/**
 * Historically we used `patch-package` to make `@vot.js/core` throw
 * `VOTLocalizedError` for a few common failure cases.
 *
 * We now keep the dependency unpatched and instead map known error messages
 * coming from the VOT client to the corresponding localized UI errors.
 */
function mapVotClientErrorForUi(error: unknown, siteHost?: string): unknown {
  const err = asVotClientErrorShape(error);
  if (!err) {
    return error;
  }
  if (err.name !== "VOTJSError") {
    return error;
  }

  const message = typeof err.message === "string" ? err.message : "";
  const serverMessage =
    typeof err.data?.message === "string" ? err.data.message : "";

  console.log("[FORK][mapVotClientErrorForUi]", {
    siteHost,
    originalMessage: message,
    serverMessage,
    rawError: error,
  });

  if (
    message === "Audio link wasn't received" ||
    message === "Audio link wasn't received from VOT response"
  ) {
    return new VOTLocalizedError("audioNotReceived");
  }

  if (siteHost === "yandexdisk") {
    if (serverMessage) {
      return new Error(serverMessage);
    }
    return error;
  }
  if (serverMessage) {
    return new Error(serverMessage);
  }

  if (message === "Failed to request video translation") {
    return new VOTLocalizedError("requestTranslationFailed");
  }

  if (message === "Yandex couldn't translate video") {
    return new VOTLocalizedError("requestTranslationFailed");
  }

  return error;
}

type DownloadWaiter = {
  resolve: () => void;
  reject: (error: Error) => void;
};

type YandexDiskResolvedTarget = {
  url: string;
  videoId: string;
  host?: VideoData["host"];
  title?: string;
};

type CachedAudioUpload =
  | {
      key: string;
      kind: "full";
      translationId: string;
      videoId: string;
      videoUrl: string;
      fileId: string;
      audioData: Uint8Array;
    }
  | {
      key: string;
      kind: "partial";
      translationId: string;
      videoId: string;
      videoUrl: string;
      fileId: string;
      chunks: Array<{
        audioData: Uint8Array;
        index: number;
        amount: number;
        version: number;
      }>;
    };

const POST_AUDIO_TRANSLATE_RETRY_DELAY_MS = 5000;
const MAX_POST_AUDIO_TRANSLATE_RETRIES = 12;
const _YOUTUBE_SERVER_POLL_MAX_INITIAL_WAIT_SEC = 180;
const _YOUTUBE_SERVER_POLL_LONG_WAIT_MS = 120000;
const YOUTUBE_AUDIO_STREAM_TIMEOUT_MS = 30 * 60 * 1000;
const YOUTUBE_SERVER_POLL_RETRY_INTERVAL_MS = 30000;
const MAX_YOUTUBE_SERVER_POLL_ERROR_RETRIES = 60;

export class VOTTranslationHandler {
  readonly videoHandler: VideoHandler;
  readonly audioDownloader: AudioDownloader;
  downloading: boolean;
  private readonly downloadWaiters = new Set<DownloadWaiter>();
  private downloadFailureError?: Error;
  // A downloader error must not overtake an in-flight Yandex chunk upload.
  private activeAudioUploadRequests = 0;
  private audioChunksStarted = false;
  private audioUploadQueue: Promise<void> = Promise.resolve();
  private audioUploadGeneration = 0;
  // One bounded full-sequence replay per audio download session.
  private fullSequenceRecoveryUsed = false;
  private confirmedAudioUpload?: {
    translationId: string;
    fileId: string;
    generation: number;
  };

  private activeTranslationUrl?: string;
  private activeAudioUploadUrl?: string;
  private translationRequestStateUrl?: string;
  private translationRequestStateLangKey?: string;
  private translationRequestStarted = false;
  private activeTranslationVoiceMode?: boolean;
  private handledAudioRequestKey?: string;
  private currentAudioRequestKey?: string;
  private cachedAudioUpload?: CachedAudioUpload;
  private repeatedAudioRequestCount = 0;
  private samePayloadReplayDone = false;
  private alternateTransportRetryDone = false;
  private webAbrTransportStartIndex = 0;
  private postAudioTranslateRetryCount = 0;
  private youtubeServerPollActive = false;
  private youtubeServerPollErrorCount = 0;
  private youtubeServerPollLastStatus?: number;
  private youtubeServerPollLastRemainingTime?: number;
  private youtubeServerPollLastTranslationId?: string;
  private youtubeServerPollRetryAttempt = 0;
  private youtubeFailedAudioSignalUrl?: string;
  private activeYandexDiskResolvedVideoData?: VideoData;
  private reprocessYouTubeVideoId?: string;
  private reprocessYouTubePhase?: "kick" | "after-audio-request";
  private reprocessYouTubeStrategyIndex = 0;

  private static readonly YOUTUBE_REPROCESS_STRATEGIES = [
    // Index 0 is intentionally the exact legacy restore request shape.
    {
      name: "original +300 / stream",
      durationOffset: 300,
      wasStream: true,
      bypassCache: false,
      forceSourceLang: false,
    },
    {
      name: "baseline",
      durationOffset: 0,
      wasStream: false,
      bypassCache: false,
      forceSourceLang: false,
    },
    {
      name: "forceSourceLang=true",
      durationOffset: 0,
      wasStream: false,
      bypassCache: false,
      forceSourceLang: true,
    },
    {
      name: "bypassCache=true",
      durationOffset: 0,
      wasStream: false,
      bypassCache: true,
      forceSourceLang: false,
    },
    {
      name: "wasStream=true",
      durationOffset: 0,
      wasStream: true,
      bypassCache: false,
      forceSourceLang: false,
    },
    {
      name: "duration=0",
      durationAbsolute: 0,
      durationOffset: 0,
      wasStream: false,
      bypassCache: false,
      forceSourceLang: false,
    },
    {
      name: "duration=1",
      durationAbsolute: 1,
      durationOffset: 0,
      wasStream: false,
      bypassCache: false,
      forceSourceLang: false,
    },
    {
      name: "duration=30",
      durationAbsolute: 30,
      durationOffset: 0,
      wasStream: false,
      bypassCache: false,
      forceSourceLang: false,
    },
    {
      name: "duration=310",
      durationAbsolute: 310,
      durationOffset: 0,
      wasStream: false,
      bypassCache: false,
      forceSourceLang: false,
    },
    {
      name: "duration=3600",
      durationAbsolute: 3600,
      durationOffset: 0,
      wasStream: false,
      bypassCache: false,
      forceSourceLang: false,
    },
    {
      name: "url:youtube:short",
      durationOffset: 0,
      wasStream: false,
      bypassCache: false,
      forceSourceLang: false,
      urlVariant: "short",
    },
    {
      name: "url:youtube:embed",
      durationOffset: 0,
      wasStream: false,
      bypassCache: false,
      forceSourceLang: false,
      urlVariant: "embed",
    },
    {
      name: "url:feature=shared",
      durationOffset: 0,
      wasStream: false,
      bypassCache: false,
      forceSourceLang: false,
      urlVariant: "feature-shared",
    },
    {
      name: "url:app=desktop",
      durationOffset: 0,
      wasStream: false,
      bypassCache: false,
      forceSourceLang: false,
      urlVariant: "app-desktop",
    },
    {
      name: "matrix: stream+bypass",
      durationOffset: 0,
      wasStream: true,
      bypassCache: true,
      forceSourceLang: false,
    },
    {
      name: "matrix: force+stream",
      durationOffset: 0,
      wasStream: true,
      bypassCache: false,
      forceSourceLang: true,
    },
    {
      name: "matrix: force+bypass",
      durationOffset: 0,
      wasStream: false,
      bypassCache: true,
      forceSourceLang: true,
    },
    {
      name: "matrix: force+stream+bypass",
      durationOffset: 0,
      wasStream: true,
      bypassCache: true,
      forceSourceLang: true,
    },
  ] as const;

  private getYouTubeReprocessStrategy() {
    return VOTTranslationHandler.YOUTUBE_REPROCESS_STRATEGIES[
      Math.min(
        this.reprocessYouTubeStrategyIndex,
        VOTTranslationHandler.YOUTUBE_REPROCESS_STRATEGIES.length - 1,
      )
    ];
  }

  enableYouTubeReprocessOnce(videoId: string, strategyIndex = 0): void {
    this.reprocessYouTubeVideoId = videoId;
    this.reprocessYouTubePhase = "kick";
    this.reprocessYouTubeStrategyIndex = Math.max(
      0,
      Math.min(
        strategyIndex,
        VOTTranslationHandler.YOUTUBE_REPROCESS_STRATEGIES.length - 1,
      ),
    );
    debug.log("[FORK][restore-translation] enabled", {
      videoId,
      phase: this.reprocessYouTubePhase,
    });
  }

  isYouTubeReprocessActive(videoId?: string): boolean {
    return Boolean(videoId && this.reprocessYouTubeVideoId === videoId);
  }

  cancelYouTubeReprocess(reason = "cancelled"): void {
    this.finishYouTubeReprocess(reason);
  }

  private finishYouTubeReprocess(reason: string): void {
    if (!this.reprocessYouTubeVideoId) return;
    debug.log("[FORK][restore-translation] disabled", {
      videoId: this.reprocessYouTubeVideoId,
      reason,
    });
    this.reprocessYouTubeVideoId = undefined;
    this.reprocessYouTubePhase = undefined;
    this.reprocessYouTubeStrategyIndex = 0;
  }

  constructor(videoHandler: VideoHandler) {
    this.videoHandler = videoHandler;

    const strategy =
      this.videoHandler.site.host === "vk"
        ? VK_AUDIO_STRATEGY
        : this.videoHandler.site.host === "youtube"
          ? WEB_ABR_STRATEGY
          : this.videoHandler.site.host === "yandexdisk"
            ? "localFile"
            : this.videoHandler.site.host === "douyin"
              ? DOUYIN_AUDIO_STRATEGY
              : this.videoHandler.site.host === "custom"
                ? "localFile"
                : YT_AUDIO_STRATEGY;

    this.audioDownloader = new AudioDownloader(strategy as any);
    this.downloading = false;

    this.audioDownloader
      .addEventListener("downloadedAudio", this.onDownloadedAudio)
      .addEventListener("downloadedPartialAudio", this.onDownloadedPartialAudio)
      .addEventListener("downloadAudioError", this.onDownloadAudioError);
  }

  isSourceAudioUploadInProgress(): boolean {
    return this.downloading;
  }

  resetTranslationRequestState(reason?: unknown): void {
    debug.log("[FORK][translate] reset request state", { reason });
    this.translationRequestStateUrl = undefined;
    this.translationRequestStateLangKey = undefined;
    this.activeAudioUploadUrl = undefined;
    this.translationRequestStarted = false;
    this.activeTranslationVoiceMode = undefined;
    this.handledAudioRequestKey = undefined;
    this.currentAudioRequestKey = undefined;
    this.cachedAudioUpload = undefined;
    this.repeatedAudioRequestCount = 0;
    this.samePayloadReplayDone = false;
    this.alternateTransportRetryDone = false;
    this.webAbrTransportStartIndex = 0;
    this.postAudioTranslateRetryCount = 0;
    this.youtubeServerPollActive = false;
    this.youtubeServerPollErrorCount = 0;
    this.youtubeServerPollLastStatus = undefined;
    this.youtubeServerPollLastRemainingTime = undefined;
    this.youtubeServerPollLastTranslationId = undefined;
    this.youtubeServerPollRetryAttempt = 0;
    this.youtubeFailedAudioSignalUrl = undefined;
    this.activeAudioUploadRequests = 0;
    this.audioChunksStarted = false;
    this.fullSequenceRecoveryUsed = false;
    this.confirmedAudioUpload = undefined;
  }

  private async prepareSourceAudioUpload(signal: AbortSignal): Promise<void> {
    if (
      this.videoHandler.site.host !== "youtube" ||
      this.audioDownloader.strategy !== WEB_MSE_PROXY_STRATEGY
    ) {
      return;
    }

    const handlerVideo = this.videoHandler.video;
    if (!handlerVideo?.paused) {
      return;
    }

    const activeYouTubeVideo = Array.from(
      document.querySelectorAll<HTMLVideoElement>(
        "video.html5-main-video, .html5-video-container video, video",
      ),
    )
      .filter((candidate) => {
        if (candidate.paused || candidate.ended) return false;
        if (candidate.readyState < HTMLMediaElement.HAVE_CURRENT_DATA)
          return false;
        const rect = candidate.getBoundingClientRect();
        return (
          rect.width > 80 &&
          rect.height > 80 &&
          rect.bottom > 0 &&
          rect.top < globalThis.innerHeight
        );
      })
      .sort((a, b) => {
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        return br.width * br.height - ar.width * ar.height;
      })[0];

    if (activeYouTubeVideo) {
      console.log(
        "[FORK][source-audio-upload] handler video is stale/paused; active YouTube video is playing",
        {
          videoId: this.videoHandler.videoData?.videoId,
          handlerCurrentTime: Number(handlerVideo.currentTime.toFixed(3)),
          activeCurrentTime: Number(activeYouTubeVideo.currentTime.toFixed(3)),
          activeReadyState: activeYouTubeVideo.readyState,
        },
      );
      return;
    }

    // Only ask the user to start playback when no currently-playing YouTube
    // media element can be found at all.
    console.log("[FORK][source-audio-upload] waiting for YouTube playback", {
      videoId: this.videoHandler.videoData?.videoId,
      currentTime: Number(handlerVideo.currentTime.toFixed(3)),
      readyState: handlerVideo.readyState,
    });

    await this.videoHandler.updateTranslationErrorMsg(
      new VOTLocalizedError("VOTStartVideoForTranslation"),
      signal,
    );
  }

  private shouldRetryPostAudioTranslateError(error: unknown): boolean {
    if (!this.handledAudioRequestKey) {
      return false;
    }

    if (
      this.videoHandler.site.host !== "youtube" &&
      this.videoHandler.videoData?.host !== "youtube"
    ) {
      return false;
    }

    if (this.postAudioTranslateRetryCount >= MAX_POST_AUDIO_TRANSLATE_RETRIES) {
      return false;
    }

    return getErrorMessage(error) === "Failed to request video translation";
  }

  private shouldRetryYouTubeProcessingError(error: unknown): boolean {
    const message = getErrorMessage(error);
    const serverMessage = getServerErrorMessage(error) ?? "";
    const _combinedMessage = `${message} ${serverMessage}`.toLowerCase();

    // Only retry a transport/request failure here.
    // A server-side translation failure is terminal: stop the current task
    // instead of polling the same dead translationId again.
    return message === "Failed to request video translation";
  }

  private isYouTubeTranslationRequest(videoData?: VideoData): boolean {
    const siteHost = String(this.videoHandler.site.host || "").toLowerCase();
    const dataHost = String(videoData?.host || "").toLowerCase();
    const requestUrl = String(videoData?.url || "");

    if (siteHost === "youtube" || dataHost === "youtube") {
      return true;
    }

    if (/^https:\/\/youtu\.be\//i.test(requestUrl)) {
      return true;
    }

    if (/^https:\/\/(?:www\.|m\.|music\.)?youtube\.com\//i.test(requestUrl)) {
      return true;
    }

    const pageHost = String(globalThis.location?.hostname || "").toLowerCase();
    return (
      /(^|\.)youtube\.com$/i.test(pageHost) &&
      siteHost !== "googledrive" &&
      dataHost !== "googledrive"
    );
  }

  private rememberYouTubeServerPollState(
    response: VideoTranslationResponse,
    requestVideoData?: VideoData,
  ): void {
    if (!this.isYouTubeTranslationRequest(requestVideoData)) {
      return;
    }

    if (
      response.status !== VideoTranslationStatus.WAITING &&
      response.status !== VideoTranslationStatus.LONG_WAITING
    ) {
      return;
    }

    this.youtubeServerPollActive = true;
    this.youtubeServerPollErrorCount = 0;
    this.youtubeServerPollLastStatus = response.status;
    this.youtubeServerPollLastRemainingTime =
      typeof response.remainingTime === "number"
        ? response.remainingTime
        : undefined;
    this.youtubeServerPollLastTranslationId =
      response.translationId === undefined || response.translationId === null
        ? undefined
        : String(response.translationId);
  }

  private getYouTubeServerPollDelayMs(
    remainingTimeSeconds: number | null | undefined,
  ): number {
    // Poll YouTube translation tasks at a fixed interval. The server ETA is
    // still used for the UI text, but it no longer delays readiness checks.
    void remainingTimeSeconds;
    return YOUTUBE_SERVER_POLL_RETRY_INTERVAL_MS;
  }

  private normalizeUrlForRequest(raw: string): string {
    try {
      return new URL(raw, globalThis.location.href).toString();
    } catch {
      return String(raw || "");
    }
  }

  private normalizeOdyseeDirectUrl(url: string): string {
    try {
      if (!url) {
        return url;
      }

      const m = url.match(
        /^https:\/\/player\.odycdn\.com\/api\/v3\/streams\/free\/[^/]+\/([a-f0-9]+)\/([^/?#]+\.mp4)(?:[?#].*)?$/i,
      );

      if (m) {
        const claimId = m[1];
        const fileName = m[2];
        return `https://player.odycdn.com/v6/streams/${claimId}/${fileName}`;
      }
    } catch {
      // ignore
    }

    return url;
  }

  private getCurrentMediaRequestUrl(videoData?: VideoData): string {
    return this.normalizeUrlForRequest(
      String(
        videoData?.url ||
          this.videoHandler.video?.currentSrc ||
          this.videoHandler.video?.src ||
          globalThis.location.href,
      ),
    );
  }
  private isHlsManifestUrl(url: string): boolean {
    return /\.m3u8(?:[?#]|$)/i.test(String(url || ""));
  }

  private isCustomLinkUrl(url: string): boolean {
    if (!url) {
      return false;
    }

    try {
      return this.videoHandler.votClient.isCustomLink(url);
    } catch {
      return (
        /\.(m3u8|m4(?:a|v)|mpd)(?:[?#]|$)/i.test(url) ||
        /^https:\/\/cdn\.qstv\.on\.epicgames\.com/i.test(url)
      );
    }
  }

  private shouldUseCustomLinkWorkflow(videoData?: VideoData): boolean {
    if (!videoData) {
      return false;
    }

    if (
      this.videoHandler.site.host !== "custom" &&
      videoData.host !== "custom"
    ) {
      return false;
    }

    return this.isCustomLinkUrl(this.getCurrentMediaRequestUrl(videoData));
  }

  private getM3u8ProxyEndpointUrl(): URL | null {
    const rawHost = String(this.videoHandler.data?.m3u8ProxyHost || "").trim();

    if (!rawHost) {
      return null;
    }

    const withScheme = /^[a-z][a-z\d+.-]*:/i.test(rawHost)
      ? rawHost
      : `https://${rawHost}`;

    try {
      const parsed = new URL(withScheme);
      const normalizedPath =
        parsed.pathname && parsed.pathname !== "/"
          ? parsed.pathname.replace(/\/+$/g, "")
          : "/v1/proxy/m3u8";

      return new URL(`${parsed.origin}${normalizedPath}`);
    } catch (error) {
      console.log("[FORK][upload] invalid m3u8 proxy host", {
        rawHost,
        error,
      });
      return null;
    }
  }

  private buildProxiedHlsUrl(rawUrl: string): string {
    const normalizedTargetUrl = this.normalizeUrlForRequest(rawUrl);
    const proxyEndpoint = this.getM3u8ProxyEndpointUrl();

    if (!proxyEndpoint) {
      return normalizedTargetUrl;
    }

    try {
      const target = new URL(normalizedTargetUrl, globalThis.location.href);
      const proxyUrl = new URL(proxyEndpoint.toString());
      proxyUrl.searchParams.set("format", "base64");
      proxyUrl.searchParams.set("force", "true");
      proxyUrl.searchParams.set("all", "1");
      proxyUrl.searchParams.set("url", btoa(target.toString()));

      if (target.origin && target.origin !== "null") {
        proxyUrl.searchParams.set("origin", target.origin);
        proxyUrl.searchParams.set("referer", target.origin);
      }

      // Keep the `.m3u8` marker in the URL so `@vot.js/core` routes it through
      // the VOT custom-link flow instead of the regular Yandex site flow.
      proxyUrl.hash = "playlist.m3u8";
      return proxyUrl.toString();
    } catch (error) {
      console.log("[FORK][upload] failed to build proxied hls url", {
        rawUrl,
        error,
      });
      return normalizedTargetUrl;
    }
  }

  private buildCustomLinkWorkflowVideoData(videoData: VideoData): VideoData {
    const currentUrl = this.getCurrentMediaRequestUrl(videoData);
    const requestUrl = this.isHlsManifestUrl(currentUrl)
      ? this.buildProxiedHlsUrl(currentUrl)
      : currentUrl;
    const videoId =
      typeof videoData.videoId === "string" &&
      videoData.videoId.trim().length > 0
        ? videoData.videoId
        : currentUrl;

    console.log("[FORK][upload] custom-link workflow input", {
      originalUrl: currentUrl,
      requestUrl,
      host: videoData.host,
      proxied: requestUrl !== currentUrl,
      proxyHost: this.videoHandler.data?.m3u8ProxyHost,
    });

    return {
      ...videoData,
      url: requestUrl,
      videoId,
    };
  }

  private isDirectMediaUrlCandidate(url: string): boolean {
    if (!url) {
      return false;
    }

    if (this.isHlsManifestUrl(url)) {
      return false;
    }

    try {
      return this.videoHandler.votClient.isDirectMediaUrl(url);
    } catch {
      return false;
    }
  }

  private isCrossOriginMediaUrl(url: string): boolean {
    try {
      const parsed = new URL(url, globalThis.location.href);
      return parsed.hostname !== globalThis.location.hostname;
    } catch {
      return false;
    }
  }

  private shouldUseLocalFileWorkflow(videoData?: VideoData): boolean {
    if (!videoData) {
      return false;
    }

    const url = this.getCurrentMediaRequestUrl(videoData);
    if (!this.isDirectMediaUrlCandidate(url)) {
      return false;
    }
    if (
      this.videoHandler.site.host === "douyin" ||
      videoData.host === "douyin"
    ) {
      return false;
    }

    if (
      this.videoHandler.site.host === "custom" ||
      videoData.host === "custom"
    ) {
      return true;
    }

    return this.isCrossOriginMediaUrl(url);
  }

  private buildLocalFileWorkflowVideoData(videoData: VideoData): VideoData {
    let url = this.getCurrentMediaRequestUrl(videoData);

    if (
      this.videoHandler.site.host === "odysee" ||
      videoData.host === "odysee"
    ) {
      url = this.normalizeUrlForRequest(this.normalizeOdyseeDirectUrl(url));
    }

    const videoId =
      typeof videoData.videoId === "string" &&
      videoData.videoId.trim().length > 0
        ? videoData.videoId
        : url;

    return {
      ...videoData,
      host: "custom",
      url,
      videoId,
    };
  }

  private updateAudioDownloaderStrategy(videoData?: VideoData): void {
    const url = videoData ? this.getCurrentMediaRequestUrl(videoData) : "";

    const isLocalFileCompatibleCustom =
      (this.videoHandler.site.host === "custom" ||
        videoData?.host === "custom") &&
      !this.isHlsManifestUrl(url) &&
      this.isDirectMediaUrlCandidate(url);

    const useLocalFileWorkflow =
      isLocalFileCompatibleCustom || this.shouldUseLocalFileWorkflow(videoData);

    const isVkCdnContext =
      this.videoHandler.site.host === "vk" ||
      this.videoHandler.site.host === "okru" ||
      /^player\.cdnvideohub\.com$/i.test(globalThis.location.hostname) ||
      /(?:^|\.)okcdn\.ru$/i.test(globalThis.location.hostname) ||
      /(?:^|\.)okcdn\.ru/i.test(url);

    const nextStrategy = useLocalFileWorkflow
      ? "localFile"
      : isVkCdnContext
        ? VK_AUDIO_STRATEGY
        : this.videoHandler.site.host === "yandexdisk"
          ? "localFile"
          : this.videoHandler.site.host === "douyin"
            ? DOUYIN_AUDIO_STRATEGY
            : this.videoHandler.site.host === "youtube"
              ? WEB_ABR_STRATEGY
              : YT_AUDIO_STRATEGY;

    if (this.audioDownloader.strategy === nextStrategy) {
      return;
    }

    this.audioDownloader.strategy = nextStrategy;
    console.log("[FORK][audio] switched downloader strategy", {
      siteHost: this.videoHandler.site.host,
      videoHost: videoData?.host,
      strategy: nextStrategy,
      url: videoData?.url,
    });
  }

  private isDirectResolvedUploadVideoData(
    data: VideoData | undefined,
  ): data is VideoData {
    if (!data) {
      return false;
    }

    const rawUrl = String(data.url || "");
    if (!rawUrl.length || this.isYandexDiskDownloadUrl(rawUrl)) {
      return false;
    }

    if (data.host === "yandexdisk") {
      return true;
    }

    if (data.host === "custom") {
      try {
        return this.videoHandler.votClient.isDirectMediaUrl(rawUrl);
      } catch {
        return false;
      }
    }

    return false;
  }

  private parseYandexDiskUrl(rawUrl: string): {
    mode: "file" | "folderRoot" | "folderFile" | "unknown";
    origin: string;
    pathname: string;
    fileId?: string;
    folderId?: string;
  } {
    const fallback = String(rawUrl || globalThis.location.href || "");

    try {
      const parsed = new URL(fallback, globalThis.location.href);
      const pathname = parsed.pathname || "/";

      const fileMatch = pathname.match(/^\/i\/([^/]+)$/i);
      if (fileMatch) {
        return {
          mode: "file",
          origin: parsed.origin,
          pathname,
          fileId: fileMatch[1],
        };
      }

      const folderRootMatch = pathname.match(/^\/d\/([^/]+)\/?$/i);
      if (folderRootMatch) {
        return {
          mode: "folderRoot",
          origin: parsed.origin,
          pathname,
          folderId: folderRootMatch[1],
        };
      }

      const folderFileMatch = pathname.match(/^\/d\/([^/]+)\/.+$/i);
      if (folderFileMatch) {
        return {
          mode: "folderFile",
          origin: parsed.origin,
          pathname,
          folderId: folderFileMatch[1],
        };
      }

      return {
        mode: "unknown",
        origin: parsed.origin,
        pathname,
      };
    } catch {
      return {
        mode: "unknown",
        origin: globalThis.location.origin,
        pathname: fallback.split("?")[0].split("#")[0],
      };
    }
  }

  private normalizeYandexDiskPublicUrl(rawUrl: string): string {
    const parsed = this.parseYandexDiskUrl(rawUrl);

    if (parsed.mode === "file" && parsed.fileId) {
      return `${parsed.origin}/i/${parsed.fileId}`;
    }

    if (parsed.mode === "folderRoot" || parsed.mode === "folderFile") {
      return `${parsed.origin}${parsed.pathname}`;
    }

    return String(rawUrl || globalThis.location.href || "")
      .split("?")[0]
      .split("#")[0];
  }

  private extractYandexDiskPublicTarget(
    value: string,
  ): YandexDiskResolvedTarget | null {
    try {
      const parsed = new URL(value, globalThis.location.href);
      const pathname = parsed.pathname || "/";
      const origin = "https://disk.yandex.com";

      const inlineMatch = pathname.match(/^\/i\/([^/?#]+)$/i);
      if (inlineMatch) {
        return {
          url: `${origin}/i/${inlineMatch[1]}`,
          videoId: `/i/${inlineMatch[1]}`,
        };
      }

      const publicFileMatch = pathname.match(/^\/d\/([^/?#]+)\/?$/i);
      if (publicFileMatch) {
        return {
          url: `${origin}/d/${publicFileMatch[1]}`,
          videoId: `/d/${publicFileMatch[1]}`,
        };
      }

      return null;
    } catch {
      return null;
    }
  }

  private extractYandexDiskPublicTargetFromMedia(): YandexDiskResolvedTarget | null {
    const tryValue = (value: string): YandexDiskResolvedTarget | null =>
      this.extractYandexDiskPublicTarget(String(value || ""));

    const href = String(globalThis.location.href || "");
    const locationParsed = this.parseYandexDiskUrl(href);

    if (locationParsed.mode === "file" && locationParsed.fileId) {
      return {
        url: `${locationParsed.origin}/i/${locationParsed.fileId}`,
        videoId: locationParsed.fileId,
      };
    }

    const videos = Array.from(document.querySelectorAll("video"));
    for (const video of videos) {
      const htmlVideo = video as HTMLVideoElement;
      const candidates = [
        htmlVideo.currentSrc || "",
        htmlVideo.src || "",
        htmlVideo.getAttribute("src") || "",
      ];

      for (const candidate of candidates) {
        const target = tryValue(candidate);
        if (target) {
          return target;
        }
      }

      const sources = Array.from(video.querySelectorAll("source"));
      for (const source of sources) {
        const target = tryValue(source.getAttribute("src") || "");
        if (target) {
          return target;
        }
      }
    }

    return null;
  }

  private isYandexDiskFolderRootTarget(
    target: YandexDiskResolvedTarget,
    parsed: ReturnType<VOTTranslationHandler["parseYandexDiskUrl"]>,
  ): boolean {
    if (!parsed.folderId) {
      return false;
    }

    const folderRootUrl = `${parsed.origin}/d/${parsed.folderId}`;
    return target.videoId === parsed.folderId || target.url === folderRootUrl;
  }

  private async gmGetJson(url: string): Promise<any> {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url,
        headers: {
          Accept: "application/json",
        },
        onload: (res) => {
          try {
            console.log("[FORK][yandexdisk] GM response", {
              url,
              status: res.status,
              responseText: String(res.responseText || "").slice(0, 1000),
            });

            resolve(JSON.parse(res.responseText || "null"));
          } catch (error) {
            reject(error);
          }
        },
        onerror: (error) => reject(error),
        ontimeout: () => reject(new Error("Yandex Disk public API timeout")),
      });
    });
  }

  private getYandexDiskServiceVideoId(
    url: string,
    fallbackPath?: string,
  ): string {
    try {
      const parsed = new URL(url, globalThis.location.href);
      const pathname = parsed.pathname || "";

      if (/^\/i\/[^/]+$/i.test(pathname)) {
        return pathname;
      }

      if (/^\/d\/.+$/i.test(pathname)) {
        return pathname;
      }
    } catch {
      // ignore
    }

    return fallbackPath || String(url || "");
  }

  private extractBridgeDirectMediaTarget(): YandexDiskResolvedTarget | null {
    try {
      const raw =
        (globalThis as Record<string, unknown>).__VOT_DIRECT_SOURCES__ ||
        JSON.parse(
          document?.documentElement?.dataset?.votDirectSources || "null",
        );

      if (!raw || typeof raw !== "object") {
        return null;
      }

      const bridgeData = raw as {
        hlsUrl?: string;
        dashUrl?: string;
        mpegLowUrl?: string;
        url?: string;
        unitedVideoId?: string;
        title?: string;
      };

      const candidates = [
        bridgeData.hlsUrl,
        bridgeData.dashUrl,
        bridgeData.mpegLowUrl,
        bridgeData.url,
      ].filter((value): value is string => Boolean(value));

      for (const candidate of candidates) {
        const normalized = this.normalizeUrlForRequest(candidate);
        if (!normalized) {
          continue;
        }

        try {
          if (this.videoHandler.votClient.isDirectMediaUrl(normalized)) {
            return {
              url: normalized,
              videoId: String(bridgeData.unitedVideoId || normalized),
              host: "custom",
              title: bridgeData.title || "",
            };
          }
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }

    return null;
  }

  private extractDirectMediaTargetFromVideo(): YandexDiskResolvedTarget | null {
    const video = document.querySelector("video");

    if (!(video instanceof HTMLVideoElement)) {
      return null;
    }

    const candidates = [
      video.currentSrc || "",
      video.src || "",
      video.getAttribute("src") || "",
    ];

    for (const candidate of candidates) {
      const normalized = this.normalizeUrlForRequest(candidate);
      if (!normalized) {
        continue;
      }

      try {
        if (this.videoHandler.votClient.isDirectMediaUrl(normalized)) {
          return {
            url: normalized,
            videoId: normalized,
            host: "custom",
          };
        }
      } catch {
        // ignore
      }
    }

    return null;
  }

  private extractOdyseeMetaMediaTarget(): YandexDiskResolvedTarget | null {
    try {
      if (!/odysee\.com$/i.test(location.hostname)) {
        return null;
      }

      const ldJsonNodes = Array.from(
        document.querySelectorAll('script[type="application/ld+json"]'),
      );

      for (const node of ldJsonNodes) {
        const text = node.textContent || "";
        if (!text.includes('"contentUrl"')) {
          continue;
        }

        const data = JSON.parse(text) as {
          contentUrl?: string;
          name?: string;
        };
        const contentUrl = data?.contentUrl;

        if (typeof contentUrl === "string" && contentUrl) {
          const normalized = this.normalizeUrlForRequest(contentUrl);
          return {
            url: normalized,
            videoId: normalized,
            host: "custom",
            title: data?.name || document.title || "",
          };
        }
      }
    } catch {
      // ignore
    }

    return null;
  }

  private async resolveYandexDiskFolderFileTargetViaApi(
    parsed: ReturnType<VOTTranslationHandler["parseYandexDiskUrl"]>,
  ): Promise<YandexDiskResolvedTarget | null> {
    if (parsed.mode !== "folderFile" || !parsed.folderId) {
      return null;
    }

    const relativePathRaw = parsed.pathname.replace(/^\/d\/[^/]+/, "") || "/";

    let relativePath = relativePathRaw;
    try {
      relativePath = decodeURIComponent(relativePathRaw);
    } catch {
      relativePath = relativePathRaw;
    }

    const publicKey = `${parsed.origin}/d/${parsed.folderId}`;
    const apiUrl = new URL(
      "https://cloud-api.yandex.com/v1/disk/public/resources",
    );

    apiUrl.searchParams.set("public_key", publicKey);
    apiUrl.searchParams.set("path", relativePath);

    try {
      const payload = await this.gmGetJson(apiUrl.toString());

      console.log("[FORK][yandexdisk] public API payload", {
        relativePathRaw,
        relativePath,
        publicKey,
        type: payload?.type,
        path: payload?.path,
        name: payload?.name,
        public_url: payload?.public_url,
        short_url: payload?.short_url,
        file: payload?.file,
      });

      if (!payload || typeof payload !== "object") {
        return null;
      }

      if ("error" in payload && payload.error) {
        console.log("[FORK][yandexdisk] public API returned error", {
          error: payload.error,
          message: payload.message,
          description: payload.description,
        });
        return null;
      }

      const candidates = [payload.public_url, payload.short_url].filter(
        (value): value is string =>
          typeof value === "string" && value.length > 0,
      );

      for (const candidate of candidates) {
        const target = this.extractYandexDiskPublicTarget(candidate);
        if (!target) {
          continue;
        }

        if (this.isYandexDiskFolderRootTarget(target, parsed)) {
          console.log("[FORK][yandexdisk] skip folder-root target from API", {
            target,
            relativePath,
          });
          continue;
        }

        const serviceVideoId = this.getYandexDiskServiceVideoId(
          target.url,
          parsed.pathname,
        );

        console.log("[FORK][yandexdisk] public target from API", {
          target,
          candidate,
          relativePath,
          serviceVideoId,
        });

        return {
          url: target.url,
          videoId: serviceVideoId,
        };
      }

      if (
        payload.type === "file" &&
        typeof payload.file === "string" &&
        payload.file
      ) {
        const directUrl = this.normalizeUrlForRequest(payload.file);

        console.log("[FORK][yandexdisk] use direct file url from API", {
          directUrl,
          relativePath,
        });

        return {
          url: directUrl,
          videoId: directUrl,
          host: "custom",
        };
      }

      if (payload.type === "file") {
        console.log(
          "[FORK][yandexdisk] API did not return usable public target, continue fallback chain",
          {
            public_url: payload.public_url,
            short_url: payload.short_url,
            file: payload.file,
            relativePath,
          },
        );

        return null;
      }
    } catch (error) {
      console.log(
        "[FORK][yandexdisk] failed to resolve public target via API",
        {
          relativePathRaw,
          relativePath,
          publicKey,
          error,
        },
      );
    }

    return null;
  }

  private isYandexDiskDownloadUrl(url: string): boolean {
    try {
      return (
        new URL(url, globalThis.location.href).hostname ===
        "downloader.disk.yandex.ru"
      );
    } catch {
      return false;
    }
  }

  private isYandexDiskStreamUrl(url: string): boolean {
    return /^https:\/\/streaming\.disk\.yandex\.net\/.+\.m3u8(?:[?#].*)?$/i.test(
      String(url || ""),
    );
  }

  private extractYandexDiskStreamTargetFromPlayerState(): YandexDiskResolvedTarget | null {
    const pick = (value: unknown): string | null => {
      if (typeof value !== "string") {
        return null;
      }

      const normalized = this.normalizeUrlForRequest(value);
      return this.isYandexDiskStreamUrl(normalized) ? normalized : null;
    };

    const visited = new WeakSet<object>();

    const scan = (value: unknown, depth: number): string | null => {
      if (depth < 0) {
        return null;
      }

      const direct = pick(value);
      if (direct) {
        return direct;
      }

      if (!value || typeof value !== "object") {
        return null;
      }

      const obj = value as Record<string, unknown>;

      if (visited.has(obj)) {
        return null;
      }
      visited.add(obj);

      const preferredKeys = [
        "streamUrl",
        "url",
        "stream",
        "streams",
        "source",
        "sources",
        "controller",
        "state",
        "playerState",
        "playerApiState",
        "internalInitialConfig",
        "config",
        "store",
        "redux",
      ];

      for (const key of preferredKeys) {
        if (!(key in obj)) {
          continue;
        }

        const found = scan(obj[key], depth - 1);
        if (found) {
          return found;
        }
      }

      const values = Array.isArray(obj)
        ? obj
        : Object.keys(obj)
            .slice(0, 50)
            .map((key) => obj[key]);

      for (const item of values) {
        const found = scan(item, depth - 1);
        if (found) {
          return found;
        }
      }

      return null;
    };

    const w = globalThis as Record<string, unknown>;

    for (const key of Object.keys(w)) {
      if (!/player|state|store|redux|disk|video|ya|vh/i.test(key)) {
        continue;
      }

      const found = scan(w[key], 6);
      if (found) {
        console.log(
          "[FORK][yandexdisk] use stream url from deep player state",
          {
            key,
            url: found,
          },
        );

        return {
          url: found,
          videoId: found,
          host: "yandexdisk",
        };
      }
    }

    return null;
  }

  private extractYandexDiskStreamTargetFromPerformance(): YandexDiskResolvedTarget | null {
    try {
      const entries = performance.getEntriesByType("resource");

      console.log("[FORK][yandexdisk] inspect performance resources", {
        count: entries.length,
      });

      for (let i = entries.length - 1; i >= 0; i -= 1) {
        const entry = entries[i];
        const raw = String((entry as PerformanceResourceTiming)?.name || "");
        const normalized = this.normalizeUrlForRequest(raw);

        if (!this.isYandexDiskStreamUrl(normalized)) {
          continue;
        }

        console.log("[FORK][yandexdisk] use stream url from performance", {
          url: normalized,
        });

        return {
          url: normalized,
          videoId: normalized,
          host: "yandexdisk",
        };
      }
    } catch (error) {
      console.log(
        "[FORK][yandexdisk] failed to inspect performance resources",
        {
          error,
        },
      );
    }

    return null;
  }

  private async buildYandexDiskVideoData(
    videoData: VideoData,
  ): Promise<VideoData> {
    const bridgeTarget = this.extractBridgeDirectMediaTarget();
    if (bridgeTarget) {
      return {
        ...videoData,
        ...bridgeTarget,
        host: "custom",
      };
    }

    const odyseeTarget = this.extractOdyseeMetaMediaTarget();
    if (odyseeTarget) {
      return {
        ...videoData,
        ...odyseeTarget,
        host: "custom",
      };
    }

    const sourceUrl = this.getYandexDiskSourceUrl(videoData);
    const parsed = this.parseYandexDiskUrl(sourceUrl);

    console.log("[FORK][yandexdisk] build source", {
      pageUrl: globalThis.location.href,
      videoDataUrl: videoData.url,
      sourceUrl,
      parsedMode: parsed.mode,
      videoId: videoData.videoId,
    });

    if (parsed.mode === "file" && parsed.fileId) {
      const url = `${parsed.origin}/i/${parsed.fileId}`;
      return {
        ...videoData,
        url,
        videoId: this.getYandexDiskServiceVideoId(url, parsed.pathname),
        host: "yandexdisk" as VideoData["host"],
      };
    }

    if (parsed.mode === "folderFile") {
      const target = await this.resolveYandexDiskFolderFileTargetViaApi(parsed);

      if (target) {
        const normalizedUrl = this.normalizeUrlForRequest(target.url);
        const serviceVideoId =
          target.host === "custom"
            ? normalizedUrl
            : this.getYandexDiskServiceVideoId(normalizedUrl, parsed.pathname);

        console.log("[FORK][yandexdisk] resolved folder file target", {
          sourceUrl,
          resolvedUrl: normalizedUrl,
          videoId: serviceVideoId,
          host: target.host ?? "yandexdisk",
        });

        return {
          ...videoData,
          url: normalizedUrl,
          videoId: serviceVideoId,
          host: target.host ?? ("yandexdisk" as VideoData["host"]),
        };
      }

      const streamTarget = this.extractYandexDiskStreamTargetFromPlayerState();
      if (streamTarget) {
        return {
          ...videoData,
          url: streamTarget.url,
          videoId: streamTarget.videoId,
          host: "yandexdisk" as VideoData["host"],
        };
      }

      const performanceStreamTarget =
        this.extractYandexDiskStreamTargetFromPerformance();

      if (performanceStreamTarget) {
        return {
          ...videoData,
          url: performanceStreamTarget.url,
          videoId: performanceStreamTarget.videoId,
          host: "yandexdisk" as VideoData["host"],
        };
      }
    }

    const directTarget = this.extractYandexDiskPublicTarget(sourceUrl);
    if (directTarget) {
      return {
        ...videoData,
        url: directTarget.url,
        videoId: this.getYandexDiskServiceVideoId(
          directTarget.url,
          parsed.pathname,
        ),
        host: "yandexdisk" as VideoData["host"],
      };
    }

    const mediaTarget = this.extractYandexDiskPublicTargetFromMedia();
    if (mediaTarget) {
      return {
        ...videoData,
        url: mediaTarget.url,
        videoId: this.getYandexDiskServiceVideoId(
          mediaTarget.url,
          parsed.pathname,
        ),
        host: "yandexdisk" as VideoData["host"],
      };
    }

    const directMediaTarget = this.extractDirectMediaTargetFromVideo();
    if (directMediaTarget) {
      return {
        ...videoData,
        url: directMediaTarget.url,
        videoId: directMediaTarget.videoId,
        host: "custom",
      };
    }

    throw new Error("Failed to build Yandex Disk translation target");
  }

  private resetRepeatedAudioRequestRecovery(audioRequestKey: string): void {
    this.currentAudioRequestKey = audioRequestKey;
    this.cachedAudioUpload = undefined;
    this.repeatedAudioRequestCount = 0;
    this.samePayloadReplayDone = false;
    this.alternateTransportRetryDone = false;
    this.webAbrTransportStartIndex = 0;
  }

  private async replayCachedAudioUpload(
    audioRequestKey: string,
    signal: AbortSignal,
  ): Promise<boolean> {
    const cached = this.cachedAudioUpload;
    if (!cached || cached.key !== audioRequestKey) {
      console.warn(
        "[FORK][source-audio-upload] no cached payload available for replay",
        {
          audioRequestKey,
        },
      );
      return false;
    }

    signal.throwIfAborted();
    console.warn(
      "[FORK][source-audio-upload] replaying the same audio payload",
      {
        translationId: cached.translationId,
        videoId: cached.videoId,
        kind: cached.kind,
        chunks: cached.kind === "partial" ? cached.chunks.length : 1,
      },
    );

    if (cached.kind === "full") {
      await this.retryAudioUpload(
        () =>
          this.videoHandler.votClient.requestVtransAudio(
            cached.videoUrl,
            cached.translationId,
            {
              audioFile: cached.audioData,
              fileId: cached.fileId,
            },
          ),
        signal,
      );
      return true;
    }

    for (const chunk of cached.chunks) {
      signal.throwIfAborted();
      await this.retryAudioUpload(
        () =>
          this.videoHandler.votClient.requestVtransAudio(
            cached.videoUrl,
            cached.translationId,
            {
              audioFile: chunk.audioData,
              chunkId: chunk.index,
            },
            {
              audioPartsLength: chunk.amount,
              fileId: cached.fileId,
              version: chunk.version,
            },
          ),
        signal,
      );
    }

    return true;
  }

  // Retries belong to the upload layer, never to the GM transport.
  private static readonly AUDIO_UPLOAD_MAX_RETRIES = 4;
  private static readonly AUDIO_UPLOAD_RETRY_DELAY_MS = 1500;

  private isRetryableAudioUploadError(error: unknown): boolean {
    if (isAbortError(error)) return false;
    const candidate = error as {
      status?: unknown;
      data?: { status?: unknown; code?: unknown; httpStatus?: unknown };
    } | null;
    const rawStatus =
      candidate?.status ??
      candidate?.data?.httpStatus ??
      candidate?.data?.status;
    const status =
      typeof rawStatus === "number" ? rawStatus : Number(rawStatus);
    // Client errors are normally permanent; 408/429 are exceptions.
    if (Number.isInteger(status) && status >= 400 && status < 500) {
      return status === 408 || status === 429;
    }
    return true; // Includes lost responses, timeouts, and server 5xx.
  }

  private async retryAudioUpload<T>(
    fn: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const maxRetries = VOTTranslationHandler.AUDIO_UPLOAD_MAX_RETRIES;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      signal?.throwIfAborted();
      try {
        return await fn();
      } catch (error) {
        if (
          attempt === maxRetries ||
          !this.isRetryableAudioUploadError(error) ||
          signal?.aborted
        ) {
          throw error;
        }
        const base = VOTTranslationHandler.AUDIO_UPLOAD_RETRY_DELAY_MS;
        const delayMs = Math.min(15000, base * 2 ** attempt);
        debug.warn("[AudioUpload] retrying unconfirmed upload", {
          attempt: attempt + 1,
          maxRetries,
          delayMs,
          message: getErrorMessage(error),
          serverMessage: getServerErrorMessage(error),
        });
        await new Promise<void>((resolve, reject) => {
          let timer: ReturnType<typeof setTimeout>;
          const onAbort = () => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", onAbort);
            reject(makeAbortError());
          };
          timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
          }, delayMs);
          signal?.addEventListener("abort", onAbort, { once: true });
          if (signal?.aborted) onAbort();
        });
      }
    }
    throw new Error("Audio upload retry loop exited unexpectedly");
  }

  private readonly onDownloadedAudio = async (
    translationId: string,
    data: DownloadedAudioData,
  ) => {
    debug.log("downloadedAudio", data);
    if (!this.downloading) {
      debug.log("skip downloadedAudio");
      return;
    }

    const { videoId, fileId, audioData } = data;
    const videoUrl = this.activeAudioUploadUrl || this.getCanonicalUrl(videoId);

    try {
      console.log("[FORK] Uploading full audio", {
        translationId,
        videoId,
        fileId,
        size: audioData.byteLength,
        videoUrl,
      });

      const uploadResponse = await this.retryAudioUpload(() =>
        this.videoHandler.votClient.requestVtransAudio(
          videoUrl,
          translationId,
          {
            audioFile: audioData,
            fileId,
          },
        ),
      );
      console.log("[FORK] Upload full audio response", {
        translationId,
        videoId,
        fileId,
        videoUrl,
        status: uploadResponse?.status,
        remainingChunks: uploadResponse?.remainingChunks,
      });
      if (this.currentAudioRequestKey) {
        this.cachedAudioUpload = {
          key: this.currentAudioRequestKey,
          kind: "full",
          translationId,
          videoId,
          videoUrl,
          fileId,
          audioData: audioData.slice(),
        };
      }
    } catch (error) {
      debug.error("Failed to upload downloaded audio", error);
      console.log("[FORK] Upload full audio failed", {
        message: getErrorMessage(error),
        serverMessage: getServerErrorMessage(error),
        error: asVotClientErrorShape(error),
      });
      this.finishDownloadFailure(
        new Error("Audio downloader failed while uploading full audio"),
      );
      return;
    }

    this.finishDownloadSuccess();
  };

  private readonly onDownloadedPartialAudio = (
    translationId: string,
    data: DownloadedPartialAudioData,
  ): Promise<void> => {
    // Serialize the entire upload (including retries). The downloader may
    // dispatch the next chunk before the previous HTTP request has settled.
    const generation = this.audioUploadGeneration;
    const upload = this.audioUploadQueue.then(async () => {
      if (generation !== this.audioUploadGeneration || !this.downloading)
        return;
      await this.uploadPartialAudioSequentially(translationId, data);
    });
    // A failed upload is already reported by uploadPartialAudioSequentially;
    // don't poison the queue for subsequent sessions.
    this.audioUploadQueue = upload.catch((error) => {
      debug.error("[AudioUpload] sequential queue failed", error);
      if (generation === this.audioUploadGeneration && this.downloading) {
        this.finishDownloadFailure(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    });
    return upload;
  };

  private isAudioUploadConfirmed(
    translationId: string,
    fileId: string,
  ): boolean {
    const confirmed = this.confirmedAudioUpload;
    return Boolean(
      confirmed &&
        confirmed.translationId === translationId &&
        confirmed.fileId === fileId &&
        confirmed.generation === this.audioUploadGeneration,
    );
  }

  private confirmAudioUploadResponse(
    response:
      | { status?: number; remainingChunks?: number[] }
      | null
      | undefined,
    translationId: string,
    fileId: string,
    index: number,
    amount: number,
  ): boolean {
    // /audio status 2 + no remaining chunks means Yandex has the complete file.
    // /translate status 2 is a different state and is deliberately not used here.
    if (
      response?.status !== 2 ||
      !Array.isArray(response.remainingChunks) ||
      response.remainingChunks.length !== 0
    )
      return false;
    this.confirmedAudioUpload = {
      translationId,
      fileId,
      generation: this.audioUploadGeneration,
    };
    console.log("[FORK][AudioUpload] all chunks confirmed by Yandex", {
      translationId,
      fileId,
      index,
      amount,
    });
    return true;
  }

  private readonly uploadPartialAudioSequentially = async (
    translationId: string,
    data: DownloadedPartialAudioData,
  ) => {
    debug.log("downloadedPartialAudio", data);
    if (!this.downloading) {
      debug.log("skip downloadedPartialAudio");
      return;
    }

    const { audioData, fileId, videoId, amount, version, index } = data;
    const videoUrl = this.activeAudioUploadUrl || this.getCanonicalUrl(videoId);
    if (this.isAudioUploadConfirmed(translationId, fileId)) {
      debug.log("[AudioUpload] skip chunk: upload already confirmed", {
        index,
        amount,
      });
      return;
    }
    this.audioChunksStarted = true;
    this.activeAudioUploadRequests++;

    try {
      console.log("[FORK] Uploading audio chunk", {
        translationId,
        videoId,
        fileId,
        index,
        amount,
        size: audioData.byteLength,
        videoUrl,
      });

      // Cache the chunk BEFORE attempting PUT, including the chunk that fails.
      // A full replay must include every received chunk, not just confirmed ones.
      if (this.currentAudioRequestKey) {
        if (
          !this.cachedAudioUpload ||
          this.cachedAudioUpload.key !== this.currentAudioRequestKey ||
          this.cachedAudioUpload.kind !== "partial" ||
          this.cachedAudioUpload.fileId !== fileId
        ) {
          this.cachedAudioUpload = {
            key: this.currentAudioRequestKey,
            kind: "partial",
            translationId,
            videoId,
            videoUrl,
            fileId,
            chunks: [],
          };
        }
        const cached = this.cachedAudioUpload;
        const existing = cached.chunks.findIndex(
          (chunk) => chunk.index === index,
        );
        const entry = { audioData: audioData.slice(), index, amount, version };
        if (existing >= 0) cached.chunks[existing] = entry;
        else cached.chunks.push(entry);
      }

      const uploadResponse = await this.retryAudioUpload(() => {
        if (this.isAudioUploadConfirmed(translationId, fileId)) {
          return Promise.resolve({ status: 2, remainingChunks: [] });
        }
        return this.videoHandler.votClient.requestVtransAudio(
          videoUrl,
          translationId,
          { audioFile: audioData, chunkId: index },
          { audioPartsLength: amount, fileId, version },
        );
      });
      console.log("[FORK] Upload audio chunk response", {
        translationId,
        videoId,
        fileId,
        index,
        amount,
        videoUrl,
        status: uploadResponse?.status,
        remainingChunks: uploadResponse?.remainingChunks,
      });
      this.confirmAudioUploadResponse(
        uploadResponse,
        translationId,
        fileId,
        index,
        amount,
      );
    } catch (error) {
      if (this.isAudioUploadConfirmed(translationId, fileId)) {
        debug.warn(
          "[AudioUpload] ignoring error after Yandex confirmed all chunks",
        );
        this.finishDownloadSuccess();
        return;
      }
      debug.error("Failed to upload downloaded audio chunk", error);
      console.log("[FORK] Upload audio chunk failed", {
        message: getErrorMessage(error),
        serverMessage: getServerErrorMessage(error),
        error: asVotClientErrorShape(error),
        index,
        amount,
        size: audioData.byteLength,
      });
      // Only replay after the regular five attempts have failed. Replay uses
      // the same translationId/fileId and sends NO empty completion chunk.
      const cached = this.cachedAudioUpload;
      const expected = amount > 0 ? amount : undefined;
      const replayChunks =
        cached?.kind === "partial"
          ? [...cached.chunks].sort((a, b) => a.index - b.index)
          : [];
      const complete =
        expected !== undefined &&
        replayChunks.length === expected &&
        replayChunks.every(
          (chunk, i) => chunk.index === i && chunk.audioData.byteLength > 0,
        );
      if (
        !this.fullSequenceRecoveryUsed &&
        !this.isAudioUploadConfirmed(translationId, fileId) &&
        this.downloading &&
        this.currentAudioRequestKey &&
        cached?.kind === "partial" &&
        cached.translationId === translationId &&
        cached.fileId === fileId &&
        complete &&
        this.isRetryableAudioUploadError(error)
      ) {
        this.fullSequenceRecoveryUsed = true;
        console.warn("[FORK][AudioUpload] full-sequence recovery starting", {
          translationId,
          fileId,
          chunks: replayChunks.length,
          failedIndex: index,
        });
        try {
          for (const chunk of replayChunks) {
            if (this.isAudioUploadConfirmed(translationId, fileId)) break;
            const result = await this.retryAudioUpload(() => {
              if (this.isAudioUploadConfirmed(translationId, fileId)) {
                return Promise.resolve({ status: 2, remainingChunks: [] });
              }
              return this.videoHandler.votClient.requestVtransAudio(
                videoUrl,
                translationId,
                { audioFile: chunk.audioData, chunkId: chunk.index },
                {
                  audioPartsLength: chunk.amount,
                  fileId,
                  version: chunk.version,
                },
              );
            });
            this.confirmAudioUploadResponse(
              result,
              translationId,
              fileId,
              chunk.index,
              chunk.amount,
            );
            console.log("[FORK][AudioUpload] recovery chunk response", {
              index: chunk.index,
              status: result?.status,
              remainingChunks: result?.remainingChunks,
            });
          }
          if (!this.isAudioUploadConfirmed(translationId, fileId)) {
            throw new Error(
              "Full replay ended without Yandex confirming all chunks",
            );
          }
          console.warn("[FORK][AudioUpload] full-sequence recovery confirmed");
          this.finishDownloadSuccess();
          return;
        } catch (recoveryError) {
          console.error(
            "[FORK][AudioUpload] full-sequence recovery failed",
            recoveryError,
          );
          error = recoveryError;
        }
      } else {
        console.warn("[FORK][AudioUpload] full replay unavailable", {
          expected,
          cachedChunks: replayChunks.length,
          alreadyUsed: this.fullSequenceRecoveryUsed,
        });
      }
      this.finishDownloadFailure(
        new Error(
          `Audio chunk ${index}/${amount} upload failed: ${getErrorMessage(error)}`,
        ),
      );
      return;
    } finally {
      this.activeAudioUploadRequests = Math.max(
        0,
        this.activeAudioUploadRequests - 1,
      );
    }

    if (this.isAudioUploadConfirmed(translationId, fileId)) {
      this.finishDownloadSuccess();
    } else if (index === amount - 1) {
      this.finishDownloadFailure(
        new Error(
          "Last audio chunk sent but Yandex did not confirm complete upload",
        ),
      );
    }
  };

  private readonly onDownloadAudioError = async (
    translationId: string,
    videoId: string,
    signInSuggested = false,
  ) => {
    if (!this.downloading) {
      debug.log("skip downloadAudioError");
      return;
    }

    // Some downloader strategies emit a late error while the final chunk is
    // already being PUT to Yandex. That is not an upload failure. The upload
    // handler owns success/failure and its own retry budget.
    if (this.activeAudioUploadRequests > 0) {
      debug.warn(
        "[AudioUpload] ignoring downloader error during active upload",
        {
          videoId,
          activeUploads: this.activeAudioUploadRequests,
        },
      );
      return;
    }
    // Once real chunks have started, never poison the translation task with
    // fail-audio-js or a zero-byte replacement. Surface a real failure instead.
    if (this.audioChunksStarted) {
      debug.warn("[AudioUpload] downloader error after chunk upload started", {
        videoId,
      });
      // Wait for the last chunk confirmation or the outer stream timeout.
      // The downloader cannot know whether the pending Yandex upload succeeded.
      return;
    }

    debug.log(`Failed to download audio ${videoId}`);

    const videoUrl = this.getCanonicalUrl(videoId);

    // Preserve original VOT's YouTube sign-in UX. This is a YouTube account
    // state, not VOT/Yandex authorization. Do not send fail-audio-js or an
    // empty audio payload when signing in to YouTube is the actionable fix.
    if (signInSuggested) {
      this.finishDownloadFailure(
        new VOTLocalizedError("VOTYouTubeSignInSuggested"),
      );
      return;
    }

    const canUseYouTubeFallback =
      this.videoHandler.site.host === "youtube" &&
      this.audioDownloader.strategy !== WEB_ABR_STRATEGY &&
      Boolean(this.videoHandler.data?.useAudioDownload);

    if (!canUseYouTubeFallback) {
      this.finishDownloadFailure(
        new VOTLocalizedError("VOTFailedDownloadAudio"),
      );
      return;
    }

    try {
      if (this.youtubeFailedAudioSignalUrl === videoUrl) {
        debug.log("fail-audio-js request already sent for this video");
      } else {
        debug.log("Sending fail-audio-js request");
        await this.videoHandler.votClient.requestVtransFailAudio(videoUrl);
        await this.videoHandler.votClient.requestVtransAudio(
          videoUrl,
          translationId,
          {
            audioFile: new Uint8Array(0),
            fileId: `fallback-empty-audio:video-translation:${videoId}`,
          },
        );
        this.youtubeFailedAudioSignalUrl = videoUrl;
      }

      this.finishDownloadSuccess();
    } catch (error) {
      debug.error("fail-audio-js request failed", error);
      this.finishDownloadFailure(
        new VOTLocalizedError("VOTFailedDownloadAudio"),
      );
    }
  };

  private finishDownloadSuccess() {
    this.downloading = false;
    this.downloadFailureError = undefined;
    this.resolveDownloadWaiters();
  }

  private finishDownloadFailure(error: Error) {
    if (!this.downloading) {
      debug.warn("[AudioUpload] ignoring late download failure", {
        message: error.message,
      });
      return;
    }
    this.downloading = false;
    this.downloadFailureError = error;
    this.rejectDownloadWaiters(error);
  }

  private getCanonicalUrl(videoId: string) {
    if (this.shouldUseLocalFileWorkflow(this.videoHandler.videoData)) {
      return (
        this.activeTranslationUrl ||
        this.getCurrentMediaRequestUrl(this.videoHandler.videoData)
      );
    }

    if (this.videoHandler.site.host === "youtube") {
      return (
        this.activeTranslationUrl ||
        this.videoHandler.videoData?.url ||
        `https://youtu.be/${videoId}`
      );
    }

    if (this.videoHandler.site.host === "yandexdisk") {
      return (
        this.activeTranslationUrl ||
        this.normalizeYandexDiskPublicUrl(
          this.videoHandler.videoData?.url || globalThis.location.href,
        )
      );
    }

    if (this.videoHandler.site.host === "custom") {
      return (
        this.activeTranslationUrl ||
        this.normalizeUrlForRequest(
          String(this.videoHandler.videoData?.url || globalThis.location.href),
        )
      );
    }

    return this.videoHandler.videoData?.url || globalThis.location.href;
  }

  private isLivelyVoiceUnavailableError(value: unknown): boolean {
    const msg = getErrorMessage(value);
    return !!msg && msg.toLowerCase().includes("обычная озвучка");
  }

  private scheduleRetry<T>(
    fn: () => Promise<T>,
    delayMs: number,
    signal: AbortSignal,
  ): Promise<T> {
    console.log("[FORK][translate-retry] scheduled", {
      delayMs,
      host: this.videoHandler.site.host,
      videoId: this.videoHandler.videoData?.videoId,
      activeTranslationUrl: this.activeTranslationUrl,
      signalAborted: signal.aborted,
    });

    return new Promise<T>((resolve, reject) => {
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
        }
        signal.removeEventListener("abort", onAbort);
      };

      const onAbort = () => {
        console.warn("[FORK][translate-retry] aborted", {
          delayMs,
          host: this.videoHandler.site.host,
          videoId: this.videoHandler.videoData?.videoId,
          activeTranslationUrl: this.activeTranslationUrl,
        });
        cleanup();
        reject(makeAbortError());
      };

      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) {
        onAbort();
        return;
      }

      timeoutId = setTimeout(async () => {
        if (signal.aborted) {
          onAbort();
          return;
        }

        cleanup();

        try {
          console.log("[FORK][translate-retry] fired", {
            delayMs,
            host: this.videoHandler.site.host,
            videoId: this.videoHandler.videoData?.videoId,
            activeTranslationUrl: this.activeTranslationUrl,
          });
          const result = await fn();
          resolve(result);
        } catch (error) {
          console.warn("[FORK][translate-retry] failed", {
            delayMs,
            host: this.videoHandler.site.host,
            videoId: this.videoHandler.videoData?.videoId,
            activeTranslationUrl: this.activeTranslationUrl,
            error: getErrorMessage(error),
          });
          reject(error);
        }
      }, delayMs);

      if (timeoutId !== null) {
        this.videoHandler.autoRetry = timeoutId;
      }
    });
  }

  async translateVideoYDImpl(
    videoData: VideoData,
    requestLang: RequestLang,
    responseLang: ResponseLang,
    translationHelp: TranslationHelp[] | null = null,
    signal = NEVER_ABORTED_SIGNAL,
    disableLivelyVoice = false,
  ): Promise<
    (TranslatedVideoTranslationResponse & { usedLivelyVoice: boolean }) | null
  > {
    let normalizedVideoData: VideoData;
    this.updateAudioDownloaderStrategy(videoData);

    // ok.ru / m.ok.ru: Yandex can't access okcdn.ru videos from its servers
    // (IP-signed URLs). Force the upload workflow by treating it as a custom
    // host so Yandex returns AUDIO_REQUESTED and we upload via vkAudio strategy.
    if (
      (this.videoHandler.site.host === "okru" || videoData.host === "okru") &&
      videoData.host !== "custom"
    ) {
      videoData = {
        ...videoData,
        host: "custom" as VideoData["host"],
      };
    }

    const currentUrl = this.getCurrentMediaRequestUrl(videoData);
    const canUseLocalFileWorkflow =
      !this.isHlsManifestUrl(currentUrl) &&
      (this.videoHandler.site.host === "custom" ||
        videoData.host === "custom" ||
        this.shouldUseLocalFileWorkflow(videoData));
    const canUseCustomLinkWorkflow =
      !canUseLocalFileWorkflow && this.shouldUseCustomLinkWorkflow(videoData);

    if (canUseLocalFileWorkflow) {
      normalizedVideoData = this.buildLocalFileWorkflowVideoData(videoData);
    } else if (canUseCustomLinkWorkflow) {
      normalizedVideoData = this.buildCustomLinkWorkflowVideoData(videoData);
    } else {
      const cachedVideoData =
        this.activeYandexDiskResolvedVideoData &&
        this.isDirectResolvedUploadVideoData(
          this.activeYandexDiskResolvedVideoData,
        )
          ? this.activeYandexDiskResolvedVideoData
          : undefined;

      const currentVideoData = this.isDirectResolvedUploadVideoData(videoData)
        ? videoData
        : undefined;

      const resolvedVideoData =
        cachedVideoData ||
        currentVideoData ||
        (await this.buildYandexDiskVideoData(videoData));

      normalizedVideoData = {
        ...resolvedVideoData,
        url: this.normalizeUrlForRequest(String(resolvedVideoData.url || "")),
      };
    }

    if (
      normalizedVideoData.host === "odysee" &&
      typeof normalizedVideoData.url === "string"
    ) {
      const rewrittenUrl = this.normalizeOdyseeDirectUrl(
        normalizedVideoData.url,
      );

      normalizedVideoData =
        rewrittenUrl !== normalizedVideoData.url
          ? {
              ...normalizedVideoData,
              url: rewrittenUrl,
              host: "custom" as VideoData["host"],
            }
          : {
              ...normalizedVideoData,
              url: this.normalizeUrlForRequest(normalizedVideoData.url),
            };
    }

    if (
      normalizedVideoData &&
      typeof normalizedVideoData.url === "string" &&
      normalizedVideoData.url &&
      !/\/frame\/?$/i.test(normalizedVideoData.url) &&
      !/blob:/i.test(normalizedVideoData.url)
    ) {
      this.activeYandexDiskResolvedVideoData = normalizedVideoData;
    }

    this.activeTranslationUrl = normalizedVideoData.url;

    console.log("[FORK][upload] translateVideoYDImpl input", {
      host: normalizedVideoData.host,
      url: normalizedVideoData.url,
      videoId: normalizedVideoData.videoId,
    });

    try {
      throwIfAborted(signal);

      const useLivelyVoice =
        !disableLivelyVoice &&
        this.videoHandler.isLivelyVoiceAllowed(requestLang, responseLang) &&
        Boolean(this.videoHandler.data?.useLivelyVoice);

      const res = await this.videoHandler.votClient.translateVideo({
        videoData: normalizedVideoData,
        requestLang,
        responseLang,
        translationHelp,
        extraOpts: {
          useLivelyVoice,
          videoTitle: this.videoHandler.videoData?.title,
        },
        shouldSendFailedAudio: true,
      });

      if (!res) {
        throw new Error("Failed to get translation response");
      }

      console.log("[FORK][upload] translate response", {
        translated: res.translated,
        status: res.status,
        remainingTime: res.remainingTime,
        message: res.message,
      });

      if (isCompletedTranslationResponse(res)) {
        return { ...res, usedLivelyVoice: useLivelyVoice };
      }

      const message =
        res.message ?? localizationProvider.get("translationTakeFewMinutes");

      const displayRemainingTime = adjustTranslationEtaForDisplay(
        res.remainingTime,
        {
          optimisticLocalUpload: canUseLocalFileWorkflow,
        },
      );

      await this.videoHandler.updateTranslationErrorMsg(
        displayRemainingTime > 0
          ? formatTranslationEta(displayRemainingTime, (key) =>
              localizationProvider.get(key),
            )
          : message,
        signal,
      );

      if (
        res.status === VideoTranslationStatus.AUDIO_REQUESTED &&
        this.videoHandler.canUploadAudioForCurrentSite()
      ) {
        this.videoHandler.hadAsyncWait = true;
        this.downloadFailureError = undefined;
        this.activeAudioUploadRequests = 0;
        this.audioChunksStarted = false;
        this.audioUploadGeneration++;
        this.audioUploadQueue = Promise.resolve();
        this.fullSequenceRecoveryUsed = false;
        this.confirmedAudioUpload = undefined;
        this.downloading = true;

        await this.audioDownloader.runAudioDownload(
          normalizedVideoData.videoId,
          res.translationId,
          signal,
          this.videoHandler.video,
        );

        await this.waitForAudioDownloadCompletion(signal, 120000);

        return await this.translateVideoYDImpl(
          normalizedVideoData,
          requestLang,
          responseLang,
          translationHelp,
          signal,
          disableLivelyVoice || !useLivelyVoice,
        );
      }

      if (
        res.status === VideoTranslationStatus.WAITING ||
        res.status === VideoTranslationStatus.LONG_WAITING
      ) {
        this.videoHandler.hadAsyncWait = true;

        const retryDelay = normalizedVideoData.host === "custom" ? 15000 : 5000;

        return this.scheduleRetry(
          () =>
            this.translateVideoYDImpl(
              normalizedVideoData,
              requestLang,
              responseLang,
              translationHelp,
              signal,
              disableLivelyVoice || !useLivelyVoice,
            ),
          retryDelay,
          signal,
        );
      }

      throw new Error(
        typeof res.message === "string" && res.message
          ? res.message
          : "Yandex couldn't translate video",
      );
    } catch (err) {
      if (isAbortError(err)) {
        return null;
      }

      const uiError = mapVotClientErrorForUi(err, this.videoHandler.site.host);

      await this.videoHandler.updateTranslationErrorMsg(
        getServerErrorMessage(uiError) ?? uiError,
        signal,
      );

      this.videoHandler.hadAsyncWait = notifyTranslationFailureIfNeeded({
        aborted: Boolean(
          this.videoHandler.actionsAbortController?.signal?.aborted,
        ),
        translateApiErrorsEnabled: Boolean(
          this.videoHandler.data?.translateAPIErrors,
        ),
        hadAsyncWait: this.videoHandler.hadAsyncWait,
        videoId: normalizedVideoData.videoId,
        error: err,
        notify: (params) =>
          this.videoHandler.notifier.translationFailed(params),
      });

      console.error("[FORK][upload]", err);
      this.resetTranslationRequestState("translateVideoYDImpl error");
      return null;
    }
  }

  async translateVideoImpl(
    videoData: VideoData,
    requestLang: RequestLang,
    responseLang: ResponseLang,
    translationHelp: TranslationHelp[] | null = null,
    shouldSendFailedAudio = false,
    signal = NEVER_ABORTED_SIGNAL,
    disableLivelyVoice = false,
  ): Promise<
    (TranslatedVideoTranslationResponse & { usedLivelyVoice: boolean }) | null
  > {
    clearTimeout(this.videoHandler.autoRetry);
    this.finishDownloadSuccess();

    // Экспериментальный тест повторного перевода: для YouTube явно принудительно
    // задаём выбранный исходный язык через `forceSourceLang`, чтобы проверить,
    // создаст ли Яндекс перевод для другой языковой пары.
    //
    // В тестах выяснилось, что для `en` Яндекс Браузер повторный перевод
    // таким способом не создаёт, поэтому `en` исключён.
    //
    // Для других исходных языков используется `forceSourceLang: true`,
    // чтобы Яндекс обрабатывал фактически выбранную языковую пару.
    // На данный момент повторный перевод удалось подтвердить только для
    // `de → ru` и `fr → ru`.

    const forceSameYouTubeSourceLang = false;

    const requestLangForApi = this.videoHandler.getRequestLangForTranslation(
      requestLang,
      responseLang,
    );

    debug.log(
      videoData,
      `Translate video (requestLang: ${requestLang}, requestLangForApi: ${requestLangForApi}, responseLang: ${responseLang})`,
    );

    let livelyDisabled = disableLivelyVoice;
    const useLocalFileWorkflow = this.shouldUseLocalFileWorkflow(videoData);
    this.updateAudioDownloaderStrategy(videoData);

    if (
      this.videoHandler.site.host !== "douyin" &&
      (this.videoHandler.site.host === "yandexdisk" ||
        this.videoHandler.site.host === "custom" ||
        videoData.host === "custom" ||
        useLocalFileWorkflow)
    ) {
      return await this.translateVideoYDImpl(
        videoData,
        requestLangForApi,
        responseLang,
        translationHelp,
        signal,
      );
    }

    let requestVideoData = videoData;
    if (this.videoHandler.site.host === "douyin") {
      const fresh = await this.videoHandler.site.getVideoData?.();

      if (fresh?.host === "douyin") {
        requestVideoData = fresh;
      } else if (requestVideoData.host !== "douyin") {
        return null;
      }
    }

    if (
      this.videoHandler.site.host === "odysee" &&
      typeof videoData.url === "string"
    ) {
      const normalizedUrl = this.normalizeUrlForRequest(videoData.url);
      const rewrittenUrl = this.normalizeOdyseeDirectUrl(normalizedUrl);

      requestVideoData =
        rewrittenUrl !== normalizedUrl
          ? {
              ...videoData,
              url: rewrittenUrl,
              host: "custom" as VideoData["host"],
            }
          : {
              ...videoData,
              url: normalizedUrl,
            };
    }

    // Keep the custom-link rewrite scoped to actual custom-host workflows.
    // Some normal sites (for example bilibili) expose direct media URLs, and
    // forcing them through the custom-link path breaks otherwise valid requests.
    if (this.shouldUseCustomLinkWorkflow(requestVideoData)) {
      requestVideoData =
        this.buildCustomLinkWorkflowVideoData(requestVideoData);
    }

    const reprocessCurrentYouTube =
      this.isYouTubeTranslationRequest(requestVideoData) &&
      this.isYouTubeReprocessActive(requestVideoData.videoId);
    const reprocessStrategy = reprocessCurrentYouTube
      ? this.getYouTubeReprocessStrategy()
      : undefined;
    if (reprocessStrategy) {
      let strategyUrl = requestVideoData.url;
      if (reprocessStrategy.urlVariant && requestVideoData.videoId) {
        const id = encodeURIComponent(requestVideoData.videoId);
        const watch = `https://www.youtube.com/watch?v=${id}`;
        if (reprocessStrategy.urlVariant === "short")
          strategyUrl = `https://youtu.be/${id}`;
        else if (reprocessStrategy.urlVariant === "embed")
          strategyUrl = `https://www.youtube.com/embed/${id}`;
        else if (reprocessStrategy.urlVariant === "feature-shared")
          strategyUrl = `${watch}&feature=shared`;
        else if (reprocessStrategy.urlVariant === "app-desktop")
          strategyUrl = `${watch}&app=desktop`;
      }
      requestVideoData = {
        ...requestVideoData,
        url: strategyUrl,
        duration:
          "durationAbsolute" in reprocessStrategy
            ? reprocessStrategy.durationAbsolute
            : requestVideoData.duration + reprocessStrategy.durationOffset,
      };
    }

    this.activeTranslationUrl =
      this.videoHandler.site.host === "odysee" ||
      this.isYouTubeTranslationRequest(requestVideoData)
        ? requestVideoData.url
        : this.getCanonicalUrl(videoData.videoId);

    if (this.translationRequestStateUrl !== this.activeTranslationUrl) {
      this.resetTranslationRequestState("translation url changed");
      this.translationRequestStateUrl = this.activeTranslationUrl;
    }

    const translationLangKey = `${requestLangForApi}:${responseLang}:${
      forceSameYouTubeSourceLang ? "forced-same-lang" : "normal"
    }`;
    if (
      this.translationRequestStateLangKey !== undefined &&
      this.translationRequestStateLangKey !== translationLangKey
    ) {
      this.resetTranslationRequestState("translation language changed");
      this.translationRequestStateUrl = this.activeTranslationUrl;
    }
    this.translationRequestStateLangKey = translationLangKey;
    this.activeAudioUploadUrl = this.normalizeUrlForRequest(
      String(requestVideoData.url || this.activeTranslationUrl || ""),
    );

    try {
      throwIfAborted(signal);

      const livelyVoiceAllowed = this.videoHandler.isLivelyVoiceAllowed(
        requestLangForApi,
        responseLang,
      );

      if (
        !this.translationRequestStarted ||
        this.activeTranslationVoiceMode === undefined
      ) {
        this.activeTranslationVoiceMode =
          !livelyDisabled &&
          livelyVoiceAllowed &&
          Boolean(this.videoHandler.data?.useLivelyVoice);
      }

      let useLivelyVoice =
        !livelyDisabled &&
        livelyVoiceAllowed &&
        Boolean(this.activeTranslationVoiceMode);

      let res: VideoTranslationResponse | undefined;

      const _isYouTubeTranslateRequest =
        this.isYouTubeTranslationRequest(requestVideoData);

      // Match the known-working userscript: no video_lang/cache preflight
      // in the main YouTube translation path.
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const _isYouTubeRequestForCall =
            this.isYouTubeTranslationRequest(requestVideoData);
          const youtubeFailedAudioSignalUrl = String(
            requestVideoData.url || this.activeTranslationUrl || "",
          );
          const youtubeFailedAudioSignalAlreadySent =
            this.youtubeFailedAudioSignalUrl === youtubeFailedAudioSignalUrl;
          const allowFailedAudioSignal = shouldSendFailedAudio;
          // Keep the exact same full request shape on YouTube polling.
          // Only the firstRequest bit changes after the initial accepted request.
          const useMinimalYouTubePollingPayload = false;
          const extraOpts = {
            useLivelyVoice,
            ...(reprocessStrategy
              ? {
                  wasStream: reprocessStrategy.wasStream,
                  bypassCache: reprocessStrategy.bypassCache,
                  forceSourceLang: reprocessStrategy.forceSourceLang,
                }
              : {}),
            ...(forceSameYouTubeSourceLang ? { forceSourceLang: true } : {}),
            videoTitle:
              requestVideoData.title ??
              this.videoHandler.videoData?.title ??
              "",
          };

          console.log("[FORK][youtube/request-snapshot]", {
            host: requestVideoData.host,
            url: requestVideoData.url,
            videoId: requestVideoData.videoId,
            duration: requestVideoData.duration,
            requestLang: requestLangForApi,
            responseLang,
            forceSameYouTubeSourceLang,
            forceSourceLang: forceSameYouTubeSourceLang,
            wasStream: reprocessStrategy?.wasStream ?? false,
            bypassCache: reprocessStrategy?.bypassCache ?? false,
            reprocessStrategy: reprocessStrategy?.name,
            reprocessCurrentYouTube,
            translationHelpCount: translationHelp?.length ?? 0,
            useLivelyVoice,
            allowFailedAudioSignal,
            youtubeFailedAudioSignalAlreadySent,
            useMinimalYouTubePollingPayload,
            videoTitle:
              requestVideoData.title ??
              this.videoHandler.videoData?.title ??
              "",
          });

          res = await this.videoHandler.votClient.translateVideo({
            videoData: requestVideoData,
            requestLang: requestLangForApi,
            responseLang,
            translationHelp,
            extraOpts,
            shouldSendFailedAudio: allowFailedAudioSignal,
          });
          this.translationRequestStarted = true;
          this.postAudioTranslateRetryCount = 0;

          console.log("[FORK][translate] translate response", {
            translated: res.translated,
            status: res.status,
            remainingTime: res.remainingTime,
            message: res.message,
            requestHost: requestVideoData.host,
            requestUrl: requestVideoData.url,
          });
        } catch (err) {
          if (useLivelyVoice && this.isLivelyVoiceUnavailableError(err)) {
            debug.log(
              "[translateVideoImpl] Lively voices are unavailable. Falling back to standard translation.",
              err,
            );
            livelyDisabled = true;
            useLivelyVoice = false;
            this.activeTranslationVoiceMode = false;
            continue;
          }
          throw err;
        }

        if (useLivelyVoice && this.isLivelyVoiceUnavailableError(res)) {
          debug.log(
            "[translateVideoImpl] Server responded that lively voices are unavailable. Falling back to standard translation.",
            res,
          );
          livelyDisabled = true;
          useLivelyVoice = false;
          this.activeTranslationVoiceMode = false;
          res = undefined;
          continue;
        }

        break;
      }

      if (!res) {
        throw new Error("Failed to get translation response");
      }

      debug.log("Translate video result", res);
      console.log("[FORK] host:", this.videoHandler.site.host);
      console.log("[FORK] status:", res.status);
      console.log("[FORK] translated:", res.translated);
      console.log("[FORK] remainingTime:", res.remainingTime);
      console.log("[FORK] translationId:", res.translationId);
      console.log(
        "[FORK] canUploadAudio:",
        this.videoHandler.canUploadAudioForCurrentSite(),
      );
      console.log("[FORK] downloader strategy:", this.audioDownloader.strategy);

      if (
        this.videoHandler.site.host === "vk" &&
        !res.translated &&
        res.status === VideoTranslationStatus.AUDIO_REQUESTED &&
        this.videoHandler.canUploadAudioForCurrentSite() &&
        res.translationId &&
        videoData.videoId
      ) {
        debug.log("[FORK][VK subtitles] force audio upload", {
          videoId: videoData.videoId,
          translationId: res.translationId,
          strategy: this.audioDownloader.strategy,
        });
        try {
          this.downloadFailureError = undefined;
          this.downloading = true;

          void this.audioDownloader.runAudioDownload(
            videoData.videoId,
            String(res.translationId),
            signal,
            this.videoHandler.video,
          );
          await this.waitForAudioDownloadCompletion(signal, 20000);
        } catch (error) {
          debug.log(
            "[FORK][VK subtitles] force audio upload failed after successful translation",
            {
              videoId: videoData.videoId,
              translationId: res.translationId,
              message: getErrorMessage(error),
              serverMessage: getServerErrorMessage(error),
              error: asVotClientErrorShape(error),
            },
          );
        }
      }

      throwIfAborted(signal);

      if (isCompletedTranslationResponse(res)) {
        if (reprocessCurrentYouTube) {
          // Do not silently turn "Restore translation" into ordinary playback. If the
          // reprocess kick itself is answered with a completed cached translation,
          // stop here instead of returning the old MP3 to the player.
          this.finishYouTubeReprocess(
            "server returned cached FINISHED during explicit reprocess",
          );
          console.warn(
            "[FORK][restore-translation] server returned FINISHED instead of AUDIO_REQUESTED; cached audio will not be played",
            {
              videoId: requestVideoData.videoId,
              translationId: res.translationId,
            },
          );
          this.resetTranslationRequestState(
            "explicit reprocess did not enter AUDIO_REQUESTED",
          );
          return null;
        }
        debug.log("Video translation finished with this data: ", res);
        this.resetTranslationRequestState("translation completed");
        return { ...res, usedLivelyVoice: useLivelyVoice };
      }

      const isYouTubeRequest =
        this.isYouTubeTranslationRequest(requestVideoData);
      const isYouTubeIntermediateStatus =
        isYouTubeRequest &&
        (res.status === VideoTranslationStatus.AUDIO_REQUESTED ||
          res.status === VideoTranslationStatus.WAITING ||
          res.status === VideoTranslationStatus.LONG_WAITING);
      if (isYouTubeIntermediateStatus) {
        this.rememberYouTubeServerPollState(res, requestVideoData);
      }
      const message = isYouTubeIntermediateStatus
        ? localizationProvider.get("translationTakeFewMinutes")
        : (res.message ??
          localizationProvider.get("translationTakeFewMinutes"));
      const processingMessage =
        res.remainingTime > 0
          ? formatTranslationEta(res.remainingTime, (key) =>
              localizationProvider.get(key),
            )
          : message;
      const updateProcessingUi = () => {
        void this.videoHandler
          .updateTranslationErrorMsg(processingMessage, signal)
          .catch((error) => {
            debug.log("[translateVideoImpl] updateTranslationErrorMsg failed", {
              message: getErrorMessage(error),
            });
          });
      };

      // Keep the explicit YouTube reprocess active through AUDIO_REQUESTED so
      // the recursive request after source-audio upload repeats realDuration+300 and
      // wasStream=true. Finish the one-shot only after the server advances to
      // WAITING/LONG_WAITING; subsequent polling then uses the real duration
      // with wasStream omitted.
      const reprocessEnteredWaiting =
        reprocessCurrentYouTube &&
        (res.status === VideoTranslationStatus.WAITING ||
          res.status === VideoTranslationStatus.LONG_WAITING);
      if (reprocessEnteredWaiting) {
        this.finishYouTubeReprocess(
          `server entered waiting after explicit reprocess (status ${res.status})`,
        );
      }

      if (
        res.status === VideoTranslationStatus.WAITING ||
        res.status === VideoTranslationStatus.LONG_WAITING
      ) {
        this.videoHandler.hadAsyncWait = true;
        updateProcessingUi();

        let retryDelayMs = 5000;

        if (isYouTubeRequest) {
          retryDelayMs = this.getYouTubeServerPollDelayMs(res.remainingTime);

          console.log(
            "[FORK][youtube/server-poll] accepted task; scheduling VOT-parity poll",
            {
              translationId: res.translationId,
              status: res.status,
              remainingTime: res.remainingTime,
              requestUrl: requestVideoData.url,
              retryAttempt: this.youtubeServerPollRetryAttempt,
              retryDelayMs,
            },
          );

          this.youtubeServerPollRetryAttempt += 1;
        }

        return this.scheduleRetry(
          () =>
            this.translateVideoImpl(
              videoData,
              requestLang,
              responseLang,
              translationHelp,
              shouldSendFailedAudio,
              signal,
              livelyDisabled,
            ),
          retryDelayMs,
          signal,
        );
      }

      // AUDIO_REQUESTED must not wait for the UI message update before starting
      // the source-audio workflow. On some overlay states that promise can stay
      // pending, which previously stopped the chain before Start audio download.
      // AUDIO_REQUESTED is also the normal server path for a YouTube video that
      // has never been translated. Therefore ordinary Standard/Lively translation
      // must be allowed to upload the requested source audio. The explicit restore
      // action remains separate: only it changes duration to realDuration+300 and
      // uses wasStream=true to force recovery of an existing broken translation.
      const canUploadRequestedAudio =
        res.status === VideoTranslationStatus.AUDIO_REQUESTED &&
        this.videoHandler.canUploadAudioForCurrentSite();

      if (
        reprocessCurrentYouTube &&
        res.status === VideoTranslationStatus.AUDIO_REQUESTED
      ) {
        this.reprocessYouTubePhase = "after-audio-request";
        debug.log(
          "[FORK][restore-translation] AUDIO_REQUESTED reached; keeping realDuration+300",
          {
            videoId: requestVideoData.videoId,
            translationId: res.translationId,
          },
        );
      }

      if (canUploadRequestedAudio) {
        updateProcessingUi();
      } else {
        await this.videoHandler.updateTranslationErrorMsg(
          processingMessage,
          signal,
        );
      }

      if (canUploadRequestedAudio) {
        const translationId = String(res.translationId || "");
        const audioRequestKey = `${this.activeTranslationUrl ?? ""}:${translationId}`;

        if (!translationId) {
          throw new Error("Yandex requested audio without translationId");
        }

        if (this.handledAudioRequestKey === audioRequestKey) {
          this.repeatedAudioRequestCount += 1;
          console.warn("[FORK][source-audio-upload] repeated AUDIO_REQUESTED", {
            translationId,
            videoId: videoData.videoId,
            repeatedCount: this.repeatedAudioRequestCount,
            samePayloadReplayDone: this.samePayloadReplayDone,
            alternateTransportRetryDone: this.alternateTransportRetryDone,
          });

          this.videoHandler.hadAsyncWait = true;

          // The first repeated status can simply be a backend state propagation race.
          // Give Yandex one extra poll before sending the audio again.
          if (this.repeatedAudioRequestCount === 1) {
            return this.scheduleRetry(
              () =>
                this.translateVideoImpl(
                  videoData,
                  requestLang,
                  responseLang,
                  translationHelp,
                  false,
                  signal,
                  livelyDisabled,
                ),
              5000,
              signal,
            );
          }

          if (!this.samePayloadReplayDone) {
            this.samePayloadReplayDone = true;
            this.repeatedAudioRequestCount = 0;
            const replayed = await this.replayCachedAudioUpload(
              audioRequestKey,
              signal,
            );
            if (replayed) {
              return this.translateVideoImpl(
                videoData,
                requestLang,
                responseLang,
                translationHelp,
                false,
                signal,
                livelyDisabled,
              );
            }
          }

          // Do not redownload the same YouTube source audio after a successful
          // upload/replay. WEB_ABR already performs its own transport fallback,
          // and starting another download here only downloads the same media again.

          // After the initial upload and one exact replay, keep polling Yandex.
          // Do not start another WEB_ABR download for the same AUDIO_REQUESTED state.
          return this.scheduleRetry(
            () =>
              this.translateVideoImpl(
                videoData,
                requestLang,
                responseLang,
                translationHelp,
                false,
                signal,
                livelyDisabled,
              ),
            5000,
            signal,
          );
        }

        this.resetRepeatedAudioRequestRecovery(audioRequestKey);
        this.videoHandler.hadAsyncWait = true;

        debug.log("Start audio download");
        this.downloadFailureError = undefined;
        this.activeAudioUploadRequests = 0;
        this.audioChunksStarted = false;
        this.audioUploadGeneration++;
        this.audioUploadQueue = Promise.resolve();
        this.fullSequenceRecoveryUsed = false;
        this.confirmedAudioUpload = undefined;
        this.downloading = true;

        await this.prepareSourceAudioUpload(signal);

        debug.log("[Translation] waiting for audio download completion", {
          videoId: videoData.videoId,
          translationId: res.translationId,
          timeoutMs: YOUTUBE_AUDIO_STREAM_TIMEOUT_MS,
        });

        // Keep the upload completion promise authoritative. A late SABR/bridge
        // rejection must not cancel a Yandex PUT already in flight.
        const uploadCompletion = this.waitForAudioDownloadCompletion(
          signal,
          YOUTUBE_AUDIO_STREAM_TIMEOUT_MS,
        );
        void uploadCompletion.catch(() => {});
        const downloaderResult = this.audioDownloader
          .runAudioDownload(
            videoData.videoId,
            res.translationId,
            signal,
            this.videoHandler.video,
            this.webAbrTransportStartIndex,
            requestLang,
          )
          .then(
            () => ({ ok: true as const }),
            (error: unknown) => ({ ok: false as const, error }),
          );
        const downloaderOutcome = await downloaderResult;
        if (!downloaderOutcome.ok) {
          if (!this.audioChunksStarted) {
            // Consume the already-created waiter rejection as well.
            void uploadCompletion.catch(() => {});
            throw downloaderOutcome.error;
          }
          debug.warn(
            "[AudioUpload] downloader rejected after chunks started; waiting for Yandex",
            {
              videoId: videoData.videoId,
              activeUploads: this.activeAudioUploadRequests,
              error: getErrorMessage(downloaderOutcome.error),
            },
          );
          // Do not wait 30 minutes for a missing final chunk. This grace period
          // allows the active PUT/retries to finish, but never fabricates success.
          await Promise.race([
            uploadCompletion,
            new Promise<never>((_resolve, reject) => {
              const timer = setTimeout(
                () =>
                  reject(
                    new Error(
                      "SABR failed after partial audio; final chunk was not confirmed within 150 seconds",
                    ),
                  ),
                150000,
              );
              void uploadCompletion
                .finally(() => clearTimeout(timer))
                .catch(() => {});
            }),
          ]);
        } else {
          await uploadCompletion;
        }

        this.handledAudioRequestKey = audioRequestKey;
        this.postAudioTranslateRetryCount = 0;

        // Real source audio has already been downloaded and uploaded successfully.
        // Do not enable the legacy failed-audio signal here: doing so can trigger
        // fail-audio-js / empty-audio handling after a valid web_abr upload.
        return await this.translateVideoImpl(
          videoData,
          requestLang,
          responseLang,
          translationHelp,
          false,
          signal,
          livelyDisabled,
        );
      }
    } catch (err) {
      if (isAbortError(err)) {
        debug.log("aborted video translation");
        return null;
      }

      if (
        this.youtubeServerPollActive &&
        this.isYouTubeTranslationRequest(videoData) &&
        this.shouldRetryYouTubeProcessingError(err) &&
        this.youtubeServerPollErrorCount < MAX_YOUTUBE_SERVER_POLL_ERROR_RETRIES
      ) {
        this.youtubeServerPollErrorCount += 1;
        this.videoHandler.hadAsyncWait = true;

        console.warn(
          "[FORK][youtube/server-poll] transient poll failure; retrying without resetting translation state",
          {
            attempt: this.youtubeServerPollErrorCount,
            maxAttempts: MAX_YOUTUBE_SERVER_POLL_ERROR_RETRIES,
            retryDelayMs: YOUTUBE_SERVER_POLL_RETRY_INTERVAL_MS,
            videoId: videoData.videoId,
            activeTranslationUrl: this.activeTranslationUrl,
            lastStatus: this.youtubeServerPollLastStatus,
            lastRemainingTime: this.youtubeServerPollLastRemainingTime,
            lastTranslationId: this.youtubeServerPollLastTranslationId,
            error: getErrorMessage(err),
          },
        );

        await this.videoHandler.updateTranslationErrorMsg(
          typeof this.youtubeServerPollLastRemainingTime === "number" &&
            this.youtubeServerPollLastRemainingTime > 0
            ? formatTranslationEta(
                this.youtubeServerPollLastRemainingTime,
                (key) => localizationProvider.get(key),
              )
            : localizationProvider.get("translationTakeFewMinutes"),
          signal,
        );

        return this.scheduleRetry(
          () =>
            this.translateVideoImpl(
              videoData,
              requestLang,
              responseLang,
              translationHelp,
              false,
              signal,
              livelyDisabled,
            ),
          YOUTUBE_SERVER_POLL_RETRY_INTERVAL_MS,
          signal,
        );
      }

      if (this.shouldRetryPostAudioTranslateError(err)) {
        this.postAudioTranslateRetryCount += 1;
        this.videoHandler.hadAsyncWait = true;

        console.warn(
          "[FORK][source-audio-upload] post-audio translate failed; retrying",
          {
            attempt: this.postAudioTranslateRetryCount,
            maxAttempts: MAX_POST_AUDIO_TRANSLATE_RETRIES,
            retryDelayMs: POST_AUDIO_TRANSLATE_RETRY_DELAY_MS,
            videoId: videoData.videoId,
            activeTranslationUrl: this.activeTranslationUrl,
            error: getErrorMessage(err),
          },
        );

        await this.videoHandler.updateTranslationErrorMsg(
          localizationProvider.get("translationTakeFewMinutes"),
          signal,
        );

        return this.scheduleRetry(
          () =>
            this.translateVideoImpl(
              videoData,
              requestLang,
              responseLang,
              translationHelp,
              false,
              signal,
              livelyDisabled,
            ),
          POST_AUDIO_TRANSLATE_RETRY_DELAY_MS,
          signal,
        );
      }

      const uiError = mapVotClientErrorForUi(err, this.videoHandler.site.host);

      await this.videoHandler.updateTranslationErrorMsg(
        getServerErrorMessage(uiError) ?? uiError,
        signal,
      );

      this.videoHandler.hadAsyncWait = notifyTranslationFailureIfNeeded({
        aborted: Boolean(
          this.videoHandler.actionsAbortController?.signal?.aborted,
        ),
        translateApiErrorsEnabled: Boolean(
          this.videoHandler.data?.translateAPIErrors,
        ),
        hadAsyncWait: this.videoHandler.hadAsyncWait,
        videoId: videoData.videoId,
        error: err,
        notify: (params) =>
          this.videoHandler.notifier.translationFailed(params),
      });

      console.error("[FORK]", err);
      this.resetTranslationRequestState("translateVideoImpl error");
      return null;
    }

    this.videoHandler.hadAsyncWait = true;

    return this.scheduleRetry(
      () =>
        this.translateVideoImpl(
          videoData,
          requestLang,
          responseLang,
          translationHelp,
          shouldSendFailedAudio,
          signal,
          livelyDisabled,
        ),
      20000,
      signal,
    );
  }

  private getYandexDiskSourceUrl(videoData: VideoData): string {
    const currentUrl = String(videoData.url || "");

    if (currentUrl) {
      if (this.isYandexDiskStreamUrl(currentUrl)) {
        return currentUrl;
      }

      if (!this.isYandexDiskDownloadUrl(currentUrl)) {
        const parsedVideo = this.parseYandexDiskUrl(currentUrl);
        if (parsedVideo.mode !== "unknown") {
          return currentUrl;
        }
      }
    }

    const pageUrl = String(globalThis.location.href || "");
    const parsedPage = this.parseYandexDiskUrl(pageUrl);

    if (parsedPage.mode !== "unknown") {
      return pageUrl;
    }

    return currentUrl || pageUrl;
  }

  private waitForAudioDownloadCompletion(
    signal: AbortSignal,
    timeoutMs: number,
  ): Promise<void> {
    if (!this.downloading) {
      if (this.downloadFailureError) {
        const error = this.downloadFailureError;
        this.downloadFailureError = undefined;
        return Promise.reject(error);
      }

      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      let entry!: DownloadWaiter;

      const onAbort = () => {
        cleanup();
        reject(makeAbortError());
      };

      const timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error("Audio download wait timeout"));
      }, timeoutMs);

      const cleanup = () => {
        clearTimeout(timeoutId);
        signal.removeEventListener("abort", onAbort);
        this.downloadWaiters.delete(entry);
      };

      entry = {
        resolve: () => {
          cleanup();
          resolve();
        },
        reject: (error: Error) => {
          cleanup();
          reject(error);
        },
      };

      this.downloadWaiters.add(entry);

      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) {
        onAbort();
      }
    });
  }

  private resolveDownloadWaiters() {
    this.forEachDownloadWaiter((waiter) => waiter.resolve());
  }

  private rejectDownloadWaiters(error: Error) {
    this.forEachDownloadWaiter((waiter) => waiter.reject(error));
  }

  private forEachDownloadWaiter(handler: (waiter: DownloadWaiter) => void) {
    if (!this.downloadWaiters.size) {
      return;
    }

    const waiters = Array.from(this.downloadWaiters);
    this.downloadWaiters.clear();

    for (const waiter of waiters) {
      handler(waiter);
    }
  }
}
