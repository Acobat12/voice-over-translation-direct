import {
  type TranslatedVideoTranslationResponse,
  type TranslationHelp,
  type VideoTranslationResponse,
  VideoTranslationStatus,
} from "@vot.js/core/types/yandex";
import type { RequestLang, ResponseLang } from "@vot.js/shared/types/data";

import type { VideoData, VideoHandler } from "..";
import { AudioDownloader } from "../audioDownloader";
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
function mapVotClientErrorForUi(
  error: unknown,
  siteHost?: string,
): unknown {
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
};

export class VOTTranslationHandler {
  readonly videoHandler: VideoHandler;
  readonly audioDownloader: AudioDownloader;
  downloading: boolean;
  private readonly downloadWaiters = new Set<DownloadWaiter>();

  // Avoid spamming the fail-audio-js fallback for the same video URL.
  // In normal operation we should upload audio from the direct ytAudio path.
  private readonly requestedFailAudio = new Set<string>();

  private activeTranslationUrl?: string;

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

  private makeStableShortHash(value: string): string {
    let hash = 2166136261;

    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }

    return (hash >>> 0).toString(36);
  }

  private extractYandexDiskPublicId(url: string): string {
    try {
      const parsed = new URL(url, globalThis.location.href);

      const fileMatch = parsed.pathname.match(/^\/i\/([^/]+)$/i);
      if (fileMatch) {
        return fileMatch[1];
      }

      const publicMatch = parsed.pathname.match(/^\/d\/([^/]+)(\/.*)?$/i);
      if (publicMatch) {
        const suffix = publicMatch[2] || "";
        if (!suffix || suffix === "/") {
          return publicMatch[1];
        }
        return `ydisk-${publicMatch[1]}-${this.makeStableShortHash(parsed.pathname)}`;
      }

      return `yandexdisk-${this.makeStableShortHash(parsed.pathname)}`;
    } catch {
      return `yandexdisk-${this.makeStableShortHash(String(url || "yandexdisk-public"))}`;
    }
  }

  private extractYandexDiskPublicTarget(
    value: string,
  ): YandexDiskResolvedTarget | null {
    try {
      const parsed = new URL(value, globalThis.location.href);
      const pathname = parsed.pathname || "/";

      const inlineMatch = pathname.match(/^\/i\/([^/?#]+)$/i);
      if (inlineMatch) {
        return {
          url: `${parsed.origin}/i/${inlineMatch[1]}`,
          videoId: inlineMatch[1],
        };
      }

      const publicFileMatch = pathname.match(/^\/d\/([^/?#]+)\/?$/i);
      if (publicFileMatch) {
        return {
          url: `${parsed.origin}/d/${publicFileMatch[1]}`,
          videoId: publicFileMatch[1],
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

  // Только /i/... можно безопасно брать из location.
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
  return (
    target.videoId === parsed.folderId ||
    target.url === folderRootUrl
  );
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
            responseText: String(res.responseText || "").slice(0, 2000),
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


private async resolveYandexDiskFolderFileTargetViaApi(
  parsed: ReturnType<VOTTranslationHandler["parseYandexDiskUrl"]>,
): Promise<YandexDiskResolvedTarget | null> {
  if (parsed.mode !== "folderFile" || !parsed.folderId) {
    return null;
  }

  const relativePathRaw = parsed.pathname.replace(/^\/d\/[^/]+/, "") || "/";
  const relativePath = decodeURIComponent(relativePathRaw);
  const publicKey = `${parsed.origin}/d/${parsed.folderId}`;
  const apiUrl = new URL("https://cloud-api.yandex.net/v1/disk/public/resources");

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
      file: payload?.file,
      public_url: payload?.public_url,
      short_url: payload?.short_url,
    });

    if (!payload || typeof payload !== "object") {
      return null;
    }

    if (payload.error || payload.message) {
      console.log("[VOT][yandexdisk] public API returned error", {
        error: payload.error,
        message: payload.message,
        description: payload.description,
      });
      return null;
    }

    // 1. Самый важный путь: direct downloadable file URL
if (payload.type === "file" && typeof payload.file === "string" && payload.file.length > 0) {
  const publicUrl = `${parsed.origin}${parsed.pathname}`;
  const serviceVideoId = parsed.pathname;

  console.log("[VOT][yandexdisk] using public page URL as canonical video URL", {
    publicUrl,
    directUrl: payload.file,
    serviceVideoId,
  });

  return {
    url: publicUrl,
    videoId: serviceVideoId,
  };
}

    // 2. Если когда-нибудь Яндекс всё же вернёт public_url/short_url
    const candidates = [
      payload.public_url,
      payload.short_url,
    ].filter((value): value is string => typeof value === "string" && value.length > 0);

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

    // 3. Последний запасной вариант
    if (payload.type === "file") {
      const fallbackUrl = `${parsed.origin}${parsed.pathname}`;
      const fallbackVideoId = parsed.pathname;

      console.log("[VOT][yandexdisk] fallback to page file URL", {
        fallbackUrl,
        fallbackVideoId,
      });

      return {
        url: fallbackUrl,
        videoId: fallbackVideoId,
      };
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

private isResolvedYandexDiskVideoData(videoData: VideoData): boolean {
  if (videoData.host !== "yandexdisk") {
    return false;
  }

  const rawUrl = String(videoData.url || "");
  const parsed = this.parseYandexDiskUrl(rawUrl);

  return parsed.mode !== "unknown";
}

private async buildYandexDiskVideoData(videoData: VideoData): Promise<VideoData> {
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
      videoId: `/i/${parsed.fileId}`,
      host: "yandexdisk" as VideoData["host"],
    };
  }

  if (parsed.mode === "folderFile") {
    const target =
      (await this.resolveYandexDiskFolderFileTargetViaApi(parsed)) ||
      this.extractYandexDiskPublicTargetFromMedia() || {
        url: `${parsed.origin}${parsed.pathname}`,
        videoId: parsed.pathname,
      };

    if (!target || this.isYandexDiskFolderRootTarget(target, parsed)) {
      throw new Error(
        "Failed to resolve exact Yandex Disk public file URL for /d/.../file path.",
      );
    }

    const serviceVideoId = this.getYandexDiskServiceVideoId(
      target.url,
      parsed.pathname,
    );

    console.log("[VOT][yandexdisk] resolved folder file target", {
      sourceUrl,
      resolvedUrl: target.url,
      videoId: serviceVideoId,
    });

    return {
      ...videoData,
      url: target.url,
      videoId: serviceVideoId,
      host: "yandexdisk" as VideoData["host"],
    };
  }

  if (parsed.mode === "folderRoot" && parsed.folderId) {
    return {
      ...videoData,
      url: `${parsed.origin}${parsed.pathname}`,
      videoId: parsed.pathname,
      host: "yandexdisk" as VideoData["host"],
    };
  }

  const directTarget = this.extractYandexDiskPublicTarget(sourceUrl);
  if (directTarget) {
    return {
      ...videoData,
      url: directTarget.url,
      videoId: this.getYandexDiskServiceVideoId(directTarget.url, parsed.pathname),
      host: "yandexdisk" as VideoData["host"],
    };
  }

  const mediaTarget = this.extractYandexDiskPublicTargetFromMedia();
  if (mediaTarget) {
    return {
      ...videoData,
      url: mediaTarget.url,
      videoId: this.getYandexDiskServiceVideoId(mediaTarget.url, parsed.pathname),
      host: "yandexdisk" as VideoData["host"],
    };
  }

  throw new Error("Failed to build Yandex Disk translation target");
}
  constructor(videoHandler: VideoHandler) {
    this.videoHandler = videoHandler;
    
    const strategy =
      this.videoHandler.site.host === "youtube"
        ? "ytAudio"
        : this.videoHandler.site.host === "yandexdisk"
          ? "yandexDisk"
          : "ytAudio";

    this.audioDownloader = new AudioDownloader(strategy as any);
    this.downloading = false;

    this.audioDownloader
      .addEventListener("downloadedAudio", this.onDownloadedAudio)
      .addEventListener("downloadedPartialAudio", this.onDownloadedPartialAudio)
      .addEventListener("downloadAudioError", this.onDownloadAudioError);
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

    // The fail-audio-js endpoint is a rare fallback. Keep its usage minimal and
    // only call it for YouTube when the audio downloader is enabled.
    const shouldUseFallback =
      this.videoHandler.site.host === "youtube" &&
      Boolean(this.videoHandler.data?.useAudioDownload);
console.log("[VOT] downloadAudioError host:", this.videoHandler.site.host);
console.log("[VOT] downloadAudioError strategy:", this.audioDownloader.strategy);
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
    if (this.videoHandler.site.host === "youtube") {
      return `https://youtu.be/${videoId}`;
    }
    if (this.videoHandler.site.host === "yandexdisk") {
      return this.activeTranslationUrl || this.normalizeYandexDiskPublicUrl(
        this.videoHandler.videoData?.url || globalThis.location.href,
      );
    }
    return this.videoHandler.videoData?.url || globalThis.location.href;
  }

  // Cancellation helpers live in utils/abort.ts.

  /**
   * Detector for cases when server rejects the request because
   * "Lively/Live voices" are unavailable (unsupported language pair).
   */
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
      // Avoid a micro-race where the signal gets aborted between checking
      // `signal.aborted` and attaching the abort listener.
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

      // Attach the listener first, then check `aborted` to close the race.
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

      // Keep old behavior: allow caller to clear retries via the host.
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
): Promise<
  (TranslatedVideoTranslationResponse & { usedLivelyVoice: boolean }) | null
> {
  const yandexDiskVideoData = this.isResolvedYandexDiskVideoData(videoData)
    ? videoData
    : await this.buildYandexDiskVideoData(videoData);

  this.activeTranslationUrl = String(yandexDiskVideoData.url || "");

  try {
    throwIfAborted(signal);

    const res = await this.videoHandler.votClient.translateVideo({
      videoData: yandexDiskVideoData,
      requestLang,
      responseLang,
      translationHelp,
      extraOpts: {
        useLivelyVoice: false,
        videoTitle: this.videoHandler.videoData?.title,
      },
      shouldSendFailedAudio: true,
    });

    if (!res) {
      throw new Error("Failed to get translation response");
    }

    console.log("[VOT][yandexdisk] translate response", {
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
  return { ...res, usedLivelyVoice: false };
}

    const message =
      res.message ?? localizationProvider.get("translationTakeFewMinutes");

    await this.videoHandler.updateTranslationErrorMsg(
      res.remainingTime > 0
        ? formatTranslationEta(
            res.remainingTime,
            (key) => localizationProvider.get(key),
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
        yandexDiskVideoData.videoId,
        res.translationId,
        signal,
      );

      await this.waitForAudioDownloadCompletion(signal, 120000);

      return await this.translateVideoYDImpl(
        yandexDiskVideoData,
        requestLang,
        responseLang,
        translationHelp,
        signal,
      );
    }

    if (
      res.status === VideoTranslationStatus.WAITING ||
      res.status === VideoTranslationStatus.LONG_WAITING
    ) {
      this.videoHandler.hadAsyncWait = true;

      return this.scheduleRetry(
        () =>
          this.translateVideoYDImpl(
            yandexDiskVideoData,
            requestLang,
            responseLang,
            translationHelp,
            signal,
          ),
        20000,
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
      videoId: yandexDiskVideoData.videoId,
      error: err,
      notify: (params) =>
        this.videoHandler.notifier.translationFailed(params),
    });

    console.error("[VOT][yandexdisk]", err);
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

    if (this.videoHandler.site.host === "yandexdisk") {
      return await this.translateVideoYDImpl(
        videoData,
        requestLangForApi,
        responseLang,
        translationHelp,
        signal,
      );
    }

    this.activeTranslationUrl = this.getCanonicalUrl(videoData.videoId);

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

      // If server says lively voices are unavailable, immediately retry once
      // without lively voices and keep that choice for subsequent retries.
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          res = await this.videoHandler.votClient.translateVideo({
            videoData,
            requestLang: requestLangForApi,
            responseLang,
            translationHelp,
            extraOpts: {
              useLivelyVoice,
              videoTitle: this.videoHandler.videoData?.title,
            },
            shouldSendFailedAudio,
          });
console.log("[VOT][yandexdisk] translate response", {
  translated: res.translated,
  status: res.status,
  remainingTime: res.remainingTime,
  message: res.message,
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
      throwIfAborted(signal);

      if (res.translated && res.remainingTime < 1) {
        debug.log("Video translation finished with this data: ", res);
        return { ...res, usedLivelyVoice: useLivelyVoice };
      }

      const message =
        res.message ?? localizationProvider.get("translationTakeFewMinutes");
      await this.videoHandler.updateTranslationErrorMsg(
        res.remainingTime > 0
          ? formatTranslationEta(
              res.remainingTime,
              // The formatter expects a small set of keys; those keys exist in our phrase set.
              (key) => localizationProvider.get(key),
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

        // for get instant result on download end
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

      // Most translation errors are handled inside the translation handler and
      // returned as `null` to the caller. This means higher-level try/catch
      // blocks won't see a rejected promise. Send the failure notification here
      // so users still get a desktop alert (respecting user settings).
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
  const pageUrl = String(globalThis.location.href || "");
  const parsedPage = this.parseYandexDiskUrl(pageUrl);

  // Если текущая страница сама является публичной ссылкой Яндекс.Диска,
  // именно её надо использовать как источник истины.
  if (parsedPage.mode !== "unknown") {
    return pageUrl;
  }

  return String(videoData.url || pageUrl || "");
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
