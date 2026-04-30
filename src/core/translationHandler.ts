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
  VK_AUDIO_STRATEGY,
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
import { formatTranslationEta } from "../utils/timeFormatting";
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

  console.log("[VOT][mapVotClientErrorForUi]", {
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

export class VOTTranslationHandler {
  readonly videoHandler: VideoHandler;
  readonly audioDownloader: AudioDownloader;
  downloading: boolean;
  private readonly downloadWaiters = new Set<DownloadWaiter>();

  private readonly requestedFailAudio = new Set<string>();
  private activeTranslationUrl?: string;
  private activeYandexDiskResolvedVideoData?: VideoData;

  constructor(videoHandler: VideoHandler) {
    this.videoHandler = videoHandler;

    const strategy =
      this.videoHandler.site.host === "vk"
        ? VK_AUDIO_STRATEGY
        : this.videoHandler.site.host === "youtube"
          ? YT_AUDIO_STRATEGY
          : this.videoHandler.site.host === "yandexdisk"
            ? "yandexDisk"
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

    const nextStrategy = useLocalFileWorkflow
      ? "localFile"
      : this.videoHandler.site.host === "vk"
        ? VK_AUDIO_STRATEGY
        : this.videoHandler.site.host === "yandexdisk"
          ? "yandexDisk"
          : YT_AUDIO_STRATEGY;

    if (this.audioDownloader.strategy === nextStrategy) {
      return;
    }

    this.audioDownloader.strategy = nextStrategy;
    console.log("[VOT][audio] switched downloader strategy", {
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
            console.log("[VOT][yandexdisk] GM response", {
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

      console.log("[VOT][yandexdisk] public API payload", {
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
        console.log("[VOT][yandexdisk] public API returned error", {
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
          console.log("[VOT][yandexdisk] skip folder-root target from API", {
            target,
            relativePath,
          });
          continue;
        }

        const serviceVideoId = this.getYandexDiskServiceVideoId(
          target.url,
          parsed.pathname,
        );

        console.log("[VOT][yandexdisk] public target from API", {
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

        console.log("[VOT][yandexdisk] use direct file url from API", {
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
          "[VOT][yandexdisk] API did not return usable public target, continue fallback chain",
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
      console.log("[VOT][yandexdisk] failed to resolve public target via API", {
        relativePathRaw,
        relativePath,
        publicKey,
        error,
      });
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
        console.log("[VOT][yandexdisk] use stream url from deep player state", {
          key,
          url: found,
        });

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

      console.log("[VOT][yandexdisk] inspect performance resources", {
        count: entries.length,
      });

      for (let i = entries.length - 1; i >= 0; i -= 1) {
        const entry = entries[i];
        const raw = String((entry as PerformanceResourceTiming)?.name || "");
        const normalized = this.normalizeUrlForRequest(raw);

        if (!this.isYandexDiskStreamUrl(normalized)) {
          continue;
        }

        console.log("[VOT][yandexdisk] use stream url from performance", {
          url: normalized,
        });

        return {
          url: normalized,
          videoId: normalized,
          host: "yandexdisk",
        };
      }
    } catch (error) {
      console.log("[VOT][yandexdisk] failed to inspect performance resources", {
        error,
      });
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

    console.log("[VOT][yandexdisk] build source", {
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

        console.log("[VOT][yandexdisk] resolved folder file target", {
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
    const videoUrl = this.getCanonicalUrl(videoId);

    try {
      console.log("[VOT] Uploading full audio", {
        translationId,
        videoId,
        fileId,
        size: audioData.byteLength,
        videoUrl,
      });

      await this.videoHandler.votClient.requestVtransAudio(
        videoUrl,
        translationId,
        {
          audioFile: audioData,
          fileId,
        },
      );
    } catch (error) {
      debug.error("Failed to upload downloaded audio", error);
      this.finishDownloadFailure(
        new Error("Audio downloader failed while uploading full audio"),
      );
      return;
    }

    this.finishDownloadSuccess();
  };

  private readonly onDownloadedPartialAudio = async (
    translationId: string,
    data: DownloadedPartialAudioData,
  ) => {
    debug.log("downloadedPartialAudio", data);
    if (!this.downloading) {
      debug.log("skip downloadedPartialAudio");
      return;
    }

    const { audioData, fileId, videoId, amount, version, index } = data;
    const videoUrl = this.getCanonicalUrl(videoId);

    try {
      console.log("[VOT] Uploading audio chunk", {
        translationId,
        videoId,
        fileId,
        index,
        amount,
        size: audioData.byteLength,
        videoUrl,
      });

      await this.videoHandler.votClient.requestVtransAudio(
        videoUrl,
        translationId,
        {
          audioFile: audioData,
          chunkId: index,
        },
        {
          audioPartsLength: amount,
          fileId,
          version,
        },
      );
    } catch (error) {
      debug.error("Failed to upload downloaded audio chunk", error);
      this.finishDownloadFailure(
        new Error("Audio downloader failed while uploading chunk"),
      );
      return;
    }

    if (index === amount - 1) {
      this.finishDownloadSuccess();
    }
  };

  private readonly onDownloadAudioError = async (videoId: string) => {
    if (!this.downloading) {
      debug.log("skip downloadAudioError");
      return;
    }

    debug.log(`Failed to download audio ${videoId}`);
    const videoUrl = this.getCanonicalUrl(videoId);

    const shouldUseFallback =
      this.videoHandler.site.host === "youtube" &&
      Boolean(this.videoHandler.data?.useAudioDownload);

    console.log("[VOT] downloadAudioError host:", this.videoHandler.site.host);
    console.log(
      "[VOT] downloadAudioError strategy:",
      this.audioDownloader.strategy,
    );

    if (!shouldUseFallback) {
      this.finishDownloadFailure(
        new VOTLocalizedError("VOTFailedDownloadAudio"),
      );
      return;
    }

    try {
      if (this.requestedFailAudio.has(videoUrl)) {
        debug.log("fail-audio-js request already sent for this video");
      } else {
        debug.log("Sending fail-audio-js request");
        await this.videoHandler.votClient.requestVtransFailAudio(videoUrl);
        this.requestedFailAudio.add(videoUrl);
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
    this.resolveDownloadWaiters();
  }

  private finishDownloadFailure(error: Error) {
    this.downloading = false;
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
      return `https://youtu.be/${videoId}`;
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
    return new Promise<T>((resolve, reject) => {
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
        }
        signal.removeEventListener("abort", onAbort);
      };

      const onAbort = () => {
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
          const result = await fn();
          resolve(result);
        } catch (error) {
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

    const currentUrl = this.getCurrentMediaRequestUrl(videoData);
    const canUseLocalFileWorkflow =
      !this.isHlsManifestUrl(currentUrl) &&
      (this.videoHandler.site.host === "custom" ||
        videoData.host === "custom" ||
        this.shouldUseLocalFileWorkflow(videoData));

    if (canUseLocalFileWorkflow) {
      normalizedVideoData = this.buildLocalFileWorkflowVideoData(videoData);
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

    console.log("[VOT][upload] translateVideoYDImpl input", {
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

      console.log("[VOT][upload] translate response", {
        translated: res.translated,
        status: res.status,
        remainingTime: res.remainingTime,
        message: res.message,
      });

      if (
        res.translated &&
        (res.status === VideoTranslationStatus.FINISHED ||
          res.status === VideoTranslationStatus.PART_CONTENT) &&
        typeof res.url === "string" &&
        res.url.length > 0
      ) {
        return { ...res, usedLivelyVoice: useLivelyVoice };
      }

      const message =
        res.message ?? localizationProvider.get("translationTakeFewMinutes");

      await this.videoHandler.updateTranslationErrorMsg(
        res.remainingTime > 0
          ? formatTranslationEta(res.remainingTime, (key) =>
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
        this.downloading = true;

        await this.audioDownloader.runAudioDownload(
          normalizedVideoData.videoId,
          res.translationId,
          signal,
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

      console.error("[VOT][upload]", err);
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
      this.videoHandler.site.host === "yandexdisk" ||
      this.videoHandler.site.host === "custom" ||
      videoData.host === "custom" ||
      useLocalFileWorkflow
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

    this.activeTranslationUrl =
      this.videoHandler.site.host === "odysee"
        ? requestVideoData.url
        : this.getCanonicalUrl(videoData.videoId);

    try {
      throwIfAborted(signal);

      const livelyVoiceAllowed = this.videoHandler.isLivelyVoiceAllowed(
        requestLangForApi,
        responseLang,
      );

      let useLivelyVoice =
        !livelyDisabled &&
        livelyVoiceAllowed &&
        Boolean(this.videoHandler.data?.useLivelyVoice);

      let res: VideoTranslationResponse | undefined;

      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          res = await this.videoHandler.votClient.translateVideo({
            videoData: requestVideoData,
            requestLang: requestLangForApi,
            responseLang,
            translationHelp,
            extraOpts: {
              useLivelyVoice,
              videoTitle: this.videoHandler.videoData?.title,
            },
            shouldSendFailedAudio,
          });

          console.log("[VOT][translate] translate response", {
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
          res = undefined;
          continue;
        }

        break;
      }

      if (!res) {
        throw new Error("Failed to get translation response");
      }

      debug.log("Translate video result", res);
      console.log("[VOT] host:", this.videoHandler.site.host);
      console.log("[VOT] status:", res.status);
      console.log("[VOT] translated:", res.translated);
      console.log("[VOT] remainingTime:", res.remainingTime);
      console.log("[VOT] translationId:", res.translationId);
      console.log(
        "[VOT] canUploadAudio:",
        this.videoHandler.canUploadAudioForCurrentSite(),
      );
      console.log("[VOT] downloader strategy:", this.audioDownloader.strategy);

      if (
        this.videoHandler.site.host === "vk" &&
        this.videoHandler.canUploadAudioForCurrentSite() &&
        res.translationId &&
        videoData.videoId
      ) {
        debug.log("[VOT][VK subtitles] force audio upload", {
          videoId: videoData.videoId,
          translationId: res.translationId,
          strategy: this.audioDownloader.strategy,
        });
        this.downloading = true;

        void this.audioDownloader.runAudioDownload(
          videoData.videoId,
          String(res.translationId),
          signal,
        );
        await this.waitForAudioDownloadCompletion(signal, 120000);
      }

      throwIfAborted(signal);

      if (res.translated && res.remainingTime < 1) {
        debug.log("Video translation finished with this data: ", res);
        return { ...res, usedLivelyVoice: useLivelyVoice };
      }

      const message =
        res.message ?? localizationProvider.get("translationTakeFewMinutes");

      await this.videoHandler.updateTranslationErrorMsg(
        res.remainingTime > 0
          ? formatTranslationEta(res.remainingTime, (key) =>
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

        debug.log("Start audio download");
        this.downloading = true;

        await this.audioDownloader.runAudioDownload(
          videoData.videoId,
          res.translationId,
          signal,
        );

        debug.log("waiting downloading finish");
        await this.waitForAudioDownloadCompletion(
          signal,
          this.audioDownloader.strategy === "yandexDisk" ? 120000 : 15000,
        );

        return await this.translateVideoImpl(
          videoData,
          requestLang,
          responseLang,
          translationHelp,
          true,
          signal,
          livelyDisabled,
        );
      }
    } catch (err) {
      if (isAbortError(err)) {
        debug.log("aborted video translation");
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
        videoId: videoData.videoId,
        error: err,
        notify: (params) =>
          this.videoHandler.notifier.translationFailed(params),
      });

      console.error("[VOT]", err);
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
