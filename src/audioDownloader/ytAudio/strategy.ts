import { AudioDownloadType } from "@vot.js/core/types/yandex";
import { config } from "@vot.js/shared";

import type { GetAudioFromAPIOptions } from "../../types/audioDownloader";
import { GM_fetch } from "../../utils/gm";
import { makeFileId } from "../strategies/fileId";
import {
  type AudioChunkStreamResult,
  type AudioStreamRequest,
  AudioDownloader as YtAudioDownloader,
  YtWatchContextForbiddenError,
} from "./index";
import { pickAdaptiveAudioFormat } from "./src/internal/format-selection";

const DEFAULT_YT_AUDIO_QUALITY = "bestefficiency";
const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

type YtAudioDownloaderLike = {
  downloadAudioToUint8Array: (
    request: AudioStreamRequest,
  ) => Promise<{ bytes: Uint8Array }>;
  downloadAudioToChunkStream: (
    request: AudioStreamRequest,
    options: { chunkSize: number },
  ) => Promise<AudioChunkStreamResult>;
};

type YtAudioStrategyDeps = {
  chunkSize?: number;
  fetchTimeoutMs?: number;
  createDownloader?: (
    fetchImplementation: typeof fetch,
  ) => YtAudioDownloaderLike;
};

type ActiveYouTubeAudioFormat = {
  itag?: number;
  url?: string;
  mimeType?: string;
  bitrate?: number;
  contentLength?: string;
  audioQuality?: string;
  qualityLabel?: string;
};

type ActiveYouTubePlayerResponse = {
  videoDetails?: {
    videoId?: string;
  };
  streamingData?: {
    formats?: ActiveYouTubeAudioFormat[];
    adaptiveFormats?: ActiveYouTubeAudioFormat[];
    serverAbrStreamingUrl?: string;
  };
};

type CapturableVideoElement = HTMLVideoElement & {
  captureStream?: () => MediaStream;
  mozCaptureStream?: () => MediaStream;
};

const MEDIA_RECORDER_TIMESLICE_MS = 1000;
const CAPTURE_COMPLETION_CHECK_MS = 500;
const CAPTURE_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/aac",
] as const;

function assertValidChunkSize(chunkSize: number): void {
  if (chunkSize <= 0) {
    throw new RangeError("Audio downloader. ytAudio. chunkSize must be > 0");
  }
}

function createYtAudioFetch({
  signal,
  timeoutMs,
}: {
  signal: AbortSignal;
  timeoutMs: number;
}): typeof fetch {
  return async (input, init = {}) =>
    await GM_fetch(input, {
      ...init,
      signal: init.signal ?? signal,
      forceGmXhr: true,
      timeout: timeoutMs,
    });
}

function getActiveYouTubeStreamingState(videoId: string): {
  directAudioFormats: ActiveYouTubeAudioFormat[];
  directProgressiveFormats: ActiveYouTubeAudioFormat[];
  hasDirectAudioUrl: boolean;
  hasSabrUrl: boolean;
} | null {
  const responses = getActiveYouTubePlayerResponses(videoId);
  if (!responses.length) {
    return null;
  }

  const directAudioFormats: ActiveYouTubeAudioFormat[] = [];
  const directProgressiveFormats: ActiveYouTubeAudioFormat[] = [];
  let hasSabrUrl = false;

  for (const { response } of responses) {
    const streamingData = response.streamingData;
    const adaptiveFormats = streamingData?.adaptiveFormats ?? [];
    const formats = streamingData?.formats ?? [];

    directAudioFormats.push(
      ...adaptiveFormats.filter(
        (format) =>
          isDirectPlayableFormat(format) &&
          typeof format.mimeType === "string" &&
          format.mimeType.toLowerCase().startsWith("audio/"),
      ),
    );
    directProgressiveFormats.push(
      ...formats.filter(isDirectProgressiveMp4WithAudio),
    );
    hasSabrUrl =
      hasSabrUrl ||
      (typeof streamingData?.serverAbrStreamingUrl === "string" &&
        streamingData.serverAbrStreamingUrl.length > 0);
  }

  const dedupedAudioFormats = dedupeFormatsByUrl(directAudioFormats);
  const dedupedProgressiveFormats = dedupeFormatsByUrl(
    directProgressiveFormats,
  );

  console.warn("[VOT] ytAudio: active YouTube streaming state", {
    videoId,
    responseSources: responses.map((item) => item.source),
    directAudioFormats: dedupedAudioFormats.length,
    directProgressiveFormats: dedupedProgressiveFormats.length,
    hasSabrUrl,
  });

  return {
    directAudioFormats: dedupedAudioFormats,
    directProgressiveFormats: dedupedProgressiveFormats,
    hasDirectAudioUrl: dedupedAudioFormats.length > 0,
    hasSabrUrl,
  };
}

function getActiveYouTubePlayerResponses(
  videoId: string,
): Array<{ source: string; response: ActiveYouTubePlayerResponse }> {
  const responses: Array<{
    source: string;
    response: ActiveYouTubePlayerResponse;
  }> = [];
  const seen = new Set<ActiveYouTubePlayerResponse>();

  const addResponse = (source: string, value: unknown) => {
    if (!value || typeof value !== "object") {
      return;
    }

    const response = value as ActiveYouTubePlayerResponse;
    if (response.videoDetails?.videoId !== videoId) {
      return;
    }

    if (!response.streamingData) {
      return;
    }

    if (seen.has(response)) {
      return;
    }

    seen.add(response);
    responses.push({ source, response });
  };

  try {
    const player =
      document.querySelector("#movie_player") ??
      document.querySelector("#shorts-player");
    const getPlayerResponse = (player as any)?.getPlayerResponse;
    if (typeof getPlayerResponse === "function") {
      try {
        addResponse(
          "player.getPlayerResponse(this)",
          getPlayerResponse.call(player),
        );
      } catch {
        addResponse(
          "player.getPlayerResponse(undefined)",
          getPlayerResponse.call(undefined),
        );
      }
    }
  } catch {
    // Ignore page/player access errors and try other page response sources.
  }

  for (const [source, pageGlobal] of getPageGlobalCandidates()) {
    try {
      addResponse(
        `${source}.ytInitialPlayerResponse`,
        (pageGlobal as any).ytInitialPlayerResponse,
      );
    } catch {
      // Ignore inaccessible globals in isolated userscript contexts.
    }
  }

  return responses;
}

function getPageGlobalCandidates(): Array<[string, unknown]> {
  const candidates: Array<[string, unknown]> = [["globalThis", globalThis]];
  try {
    const unsafeWindowCandidate = (globalThis as { unsafeWindow?: unknown })
      .unsafeWindow;
    if (unsafeWindowCandidate && unsafeWindowCandidate !== globalThis) {
      candidates.push(["unsafeWindow", unsafeWindowCandidate]);
    }
  } catch {
    // Ignore managers where unsafeWindow probing is blocked.
  }

  return candidates;
}

function isDirectPlayableFormat(format: ActiveYouTubeAudioFormat): boolean {
  return typeof format.url === "string" && format.url.length > 0;
}

function isDirectProgressiveMp4WithAudio(
  format: ActiveYouTubeAudioFormat,
): boolean {
  const mimeType = format.mimeType?.toLowerCase() ?? "";
  if (!isDirectPlayableFormat(format)) {
    return false;
  }

  if (!mimeType.includes("video/mp4")) {
    return false;
  }

  return Boolean(
    format.audioQuality ||
      format.url?.includes("mime=video/mp4") ||
      format.itag === 18 ||
      format.itag === 22,
  );
}

function dedupeFormatsByUrl(
  formats: ActiveYouTubeAudioFormat[],
): ActiveYouTubeAudioFormat[] {
  const seen = new Set<string>();
  const result: ActiveYouTubeAudioFormat[] = [];

  for (const format of formats) {
    const url = format.url;
    if (!url || seen.has(url)) {
      continue;
    }

    seen.add(url);
    result.push(format);
  }

  return result;
}

function pickProgressiveMp4Format(
  formats: readonly ActiveYouTubeAudioFormat[],
): ActiveYouTubeAudioFormat {
  const preferred = formats.find((format) => format.itag === 18);
  if (preferred) {
    return preferred;
  }

  let selected: ActiveYouTubeAudioFormat | undefined;
  let selectedBitrate = Infinity;

  for (const format of formats) {
    const bitrate = format.bitrate ?? Infinity;
    if (bitrate < selectedBitrate) {
      selected = format;
      selectedBitrate = bitrate;
    }
  }

  if (!selected) {
    throw new Error("No progressive YouTube MP4 formats were found");
  }

  return selected;
}

function parsePositiveInteger(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function parseContentLengthFromContentRange(
  contentRange: string | null,
): number | null {
  if (!contentRange) {
    return null;
  }

  return parsePositiveInteger(/\/(\d+)\s*$/i.exec(contentRange)?.[1]);
}

async function resolveActiveAudioSize({
  contentLength,
  fetchImplementation,
  signal,
  url,
}: {
  contentLength?: string;
  fetchImplementation: typeof fetch;
  signal?: AbortSignal;
  url: string;
}): Promise<number> {
  const hintedLength = parsePositiveInteger(contentLength);

  try {
    const response = await fetchImplementation(url, {
      headers: { range: "bytes=0-0" },
      signal,
    });

    if (response.ok) {
      return (
        parseContentLengthFromContentRange(
          response.headers.get("content-range"),
        ) ??
        parsePositiveInteger(
          response.headers.get("x-goog-stored-content-length"),
        ) ??
        hintedLength ??
        parsePositiveInteger(response.headers.get("content-length")) ??
        (() => {
          throw new Error("Failed to resolve active YouTube audio size");
        })()
      );
    }
  } catch (error) {
    if (!hintedLength) {
      throw error;
    }
  }

  if (hintedLength) {
    return hintedLength;
  }

  throw new Error("Failed to resolve active YouTube audio size");
}

async function buildActiveAudioChunkStream({
  chunkSize,
  downloadType = AudioDownloadType.WEB_API_STEAL_SIG_AND_N,
  fetchImplementation,
  format,
  signal,
}: {
  chunkSize: number;
  downloadType?: AudioDownloadType;
  fetchImplementation: typeof fetch;
  format: ActiveYouTubeAudioFormat;
  signal?: AbortSignal;
}) {
  const streamUrl = format.url;
  if (!streamUrl) {
    throw new Error("Audio downloader. ytAudio. Active audio URL is empty");
  }

  const fileSize = await resolveActiveAudioSize({
    contentLength: format.contentLength,
    fetchImplementation,
    signal,
    url: streamUrl,
  });
  const mediaPartsLength = Math.max(1, Math.ceil(fileSize / chunkSize));
  const firstChunkEnd = Math.min(fileSize - 1, chunkSize - 1);
  const firstChunkResponse = await fetchImplementation(streamUrl, {
    headers: { range: `bytes=0-${firstChunkEnd}` },
    signal,
  });

  if (!firstChunkResponse.ok) {
    throw new Error(
      `Audio downloader. ytAudio. Active audio chunk request failed: ${firstChunkResponse.status}`,
    );
  }

  const firstChunk = new Uint8Array(await firstChunkResponse.arrayBuffer());
  if (!firstChunk.byteLength) {
    throw new Error("Audio downloader. ytAudio. Empty active audio chunk");
  }

  const expectedFirstChunkLength = firstChunkEnd + 1;
  if (firstChunk.byteLength > expectedFirstChunkLength) {
    throw new Error(
      `Audio downloader. ytAudio. Active audio range ignored: expected <= ${expectedFirstChunkLength}, got ${firstChunk.byteLength}`,
    );
  }

  return {
    fileId: makeFileId(
      downloadType,
      format.itag ?? 0,
      String(fileSize),
      chunkSize,
    ),
    mediaPartsLength,
    async *getMediaBuffers(): AsyncGenerator<Uint8Array> {
      yield firstChunk;

      for (let index = 1; index < mediaPartsLength; index += 1) {
        const start = index * chunkSize;
        const end = Math.min(fileSize - 1, start + chunkSize - 1);
        const response = await fetchImplementation(streamUrl, {
          headers: { range: `bytes=${start}-${end}` },
          signal,
        });

        if (!response.ok) {
          throw new Error(
            `Audio downloader. ytAudio. Active audio chunk request failed: ${response.status}`,
          );
        }

        const bytes = new Uint8Array(await response.arrayBuffer());
        if (!bytes.byteLength) {
          throw new Error(
            "Audio downloader. ytAudio. Empty active audio chunk",
          );
        }

        const expectedLength = end - start + 1;
        if (bytes.byteLength > expectedLength) {
          throw new Error(
            `Audio downloader. ytAudio. Active audio range ignored: expected <= ${expectedLength}, got ${bytes.byteLength}`,
          );
        }

        yield bytes;
      }
    },
  };
}

function selectCaptureMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") {
    return undefined;
  }

  if (typeof MediaRecorder.isTypeSupported !== "function") {
    return undefined;
  }

  return CAPTURE_MIME_TYPES.find((mimeType) =>
    MediaRecorder.isTypeSupported(mimeType),
  );
}

function getCaptureStream(video: HTMLVideoElement): MediaStream {
  const capturable = video as CapturableVideoElement;
  const captureStream = capturable.captureStream ?? capturable.mozCaptureStream;

  if (typeof captureStream !== "function") {
    throw new Error("Audio downloader. ytAudio. captureStream is unavailable");
  }

  const sourceStream = captureStream.call(video);
  const audioTracks = sourceStream.getAudioTracks();
  if (!audioTracks.length) {
    for (const track of sourceStream.getTracks()) {
      track.stop();
    }

    throw new Error(
      "Audio downloader. ytAudio. captureStream has no audio tracks",
    );
  }

  return new MediaStream(audioTracks);
}

function stopMediaStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      // ignore cleanup errors
    }
  }
}

function assertCanCaptureCurrentYoutubeAudio(video: HTMLVideoElement): void {
  if (video.ended) {
    throw new Error("Audio downloader. ytAudio. video already ended");
  }

  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    throw new Error(
      "Audio downloader. ytAudio. video is not ready for captureStream",
    );
  }
}

function waitForPlaybackBeforeCapture(
  video: HTMLVideoElement,
  signal: AbortSignal,
): Promise<void> {
  if (!video.paused) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      signal.removeEventListener("abort", onAbort);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("playing", onPlay);
    };

    const onAbort = () => {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };

    const onPlay = () => {
      cleanup();
      resolve();
    };

    signal.addEventListener("abort", onAbort, { once: true });
    video.addEventListener("play", onPlay, { once: true });
    video.addEventListener("playing", onPlay, { once: true });

    if (signal.aborted) {
      onAbort();
    } else if (!video.paused) {
      onPlay();
    }
  });
}

async function recordCurrentYoutubeAudio({
  chunkSize,
  signal,
  video,
}: {
  chunkSize: number;
  signal: AbortSignal;
  video: HTMLVideoElement;
}) {
  if (typeof MediaRecorder === "undefined") {
    throw new Error("Audio downloader. ytAudio. MediaRecorder is unavailable");
  }

  assertCanCaptureCurrentYoutubeAudio(video);

  if (video.paused) {
    console.warn("[VOT] ytAudio: captureStream waiting for active playback", {
      currentTime: video.currentTime,
      duration: video.duration,
    });
    await waitForPlaybackBeforeCapture(video, signal);
  }

  const stream = getCaptureStream(video);
  const mimeType = selectCaptureMimeType();
  const chunks: Blob[] = [];
  let completionCheckId: ReturnType<typeof setInterval> | undefined;

  console.warn("[VOT] ytAudio: captureStream fallback start", {
    currentTime: video.currentTime,
    duration: video.duration,
    mimeType: mimeType ?? "browser-default",
    audioTracks: stream.getAudioTracks().length,
  });

  try {
    const recorder = new MediaRecorder(
      stream,
      mimeType ? { mimeType } : undefined,
    );

    const bytes = await new Promise<Uint8Array>((resolve, reject) => {
      let settled = false;

      const cleanup = () => {
        if (completionCheckId) {
          clearInterval(completionCheckId);
          completionCheckId = undefined;
        }
        signal.removeEventListener("abort", onAbort);
        video.removeEventListener("ended", onEnded);
        video.removeEventListener("pause", onPause);
        video.removeEventListener("play", onPlay);
        video.removeEventListener("playing", onPlay);
        stopMediaStream(stream);
      };

      const rejectOnce = (error: Error) => {
        if (settled) return;

        settled = true;
        try {
          if (recorder.state !== "inactive") {
            recorder.stop();
          }
        } catch {
          // ignore stop errors after recorder failure
        }
        cleanup();
        reject(error);
      };

      const stopRecorder = () => {
        if (settled || recorder.state === "inactive") return;

        try {
          recorder.stop();
        } catch (error) {
          rejectOnce(error instanceof Error ? error : new Error(String(error)));
        }
      };

      const onAbort = () => {
        rejectOnce(new DOMException("Aborted", "AbortError"));
      };

      const onEnded = () => {
        stopRecorder();
      };

      const onPause = () => {
        try {
          if (recorder.state === "recording") {
            recorder.pause();
          }
        } catch {
          // keep recording fallback best-effort
        }
      };

      const onPlay = () => {
        try {
          if (recorder.state === "paused") {
            recorder.resume();
          }
        } catch {
          // keep recording fallback best-effort
        }
      };

      recorder.addEventListener("dataavailable", (event) => {
        if (event.data?.size) {
          chunks.push(event.data);
        }
      });

      recorder.addEventListener("error", (event) => {
        const error = (event as unknown as { error?: unknown }).error;
        rejectOnce(
          error instanceof Error
            ? error
            : new Error("Audio downloader. ytAudio. MediaRecorder failed"),
        );
      });

      recorder.addEventListener("stop", () => {
        if (settled) return;

        settled = true;
        const blob = new Blob(chunks, {
          type: recorder.mimeType || mimeType || undefined,
        });

        blob
          .arrayBuffer()
          .then((buffer) => {
            cleanup();
            resolve(new Uint8Array(buffer));
          })
          .catch((error) => {
            cleanup();
            reject(error instanceof Error ? error : new Error(String(error)));
          });
      });

      signal.addEventListener("abort", onAbort, { once: true });
      video.addEventListener("ended", onEnded, { once: true });
      video.addEventListener("pause", onPause);
      video.addEventListener("play", onPlay);
      video.addEventListener("playing", onPlay);

      if (signal.aborted) {
        onAbort();
        return;
      }

      recorder.start(MEDIA_RECORDER_TIMESLICE_MS);

      completionCheckId = setInterval(() => {
        if (
          video.ended ||
          (Number.isFinite(video.duration) &&
            video.duration > 0 &&
            video.currentTime >= video.duration - 0.25)
        ) {
          stopRecorder();
        }
      }, CAPTURE_COMPLETION_CHECK_MS);
    });

    if (!bytes.byteLength) {
      throw new Error("Audio downloader. ytAudio. Empty captured audio");
    }

    const mediaPartsLength = Math.max(
      1,
      Math.ceil(bytes.byteLength / chunkSize),
    );
    const fileId = makeFileId(
      AudioDownloadType.WEB_API_SLOW,
      0,
      String(bytes.byteLength),
      chunkSize,
    );

    console.warn("[VOT] ytAudio: captureStream fallback done", {
      size: bytes.byteLength,
      mediaPartsLength,
      fileId,
    });

    return {
      fileId,
      mediaPartsLength,
      async *getMediaBuffers(): AsyncGenerator<Uint8Array> {
        for (let start = 0; start < bytes.byteLength; start += chunkSize) {
          const end = Math.min(start + chunkSize, bytes.byteLength);
          yield bytes.subarray(start, end);
        }
      },
    };
  } catch (error) {
    stopMediaStream(stream);
    throw error;
  }
}

function isWatchContextForbiddenError(error: unknown): boolean {
  if (error instanceof YtWatchContextForbiddenError) {
    return true;
  }

  return (
    error instanceof Error &&
    /failed to load watch page:\s*403/i.test(error.message)
  );
}

export async function getAudioFromYtAudio(
  { videoId, signal, preferredVideo }: GetAudioFromAPIOptions,
  deps: YtAudioStrategyDeps = {},
) {
  const chunkSize = deps.chunkSize ?? config.minChunkSize;
  assertValidChunkSize(chunkSize);

  const fetchImplementation = createYtAudioFetch({
    signal,
    timeoutMs: deps.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS,
  });
  const downloader =
    deps.createDownloader?.(fetchImplementation) ??
    new YtAudioDownloader({ fetchImplementation });

  const pageStreamingState = getActiveYouTubeStreamingState(videoId);
  if (pageStreamingState?.hasDirectAudioUrl) {
    const activeFormat = pickAdaptiveAudioFormat(
      pageStreamingState.directAudioFormats,
      DEFAULT_YT_AUDIO_QUALITY,
    );
    try {
      return await buildActiveAudioChunkStream({
        chunkSize,
        fetchImplementation,
        format: activeFormat,
        signal,
      });
    } catch (error) {
      console.warn(
        "[VOT] ytAudio: active YouTube audio URL failed; trying page progressive MP4 fallback",
        error,
      );
    }
  }

  if (pageStreamingState?.directProgressiveFormats.length) {
    const progressiveFormat = pickProgressiveMp4Format(
      pageStreamingState.directProgressiveFormats,
    );
    try {
      console.warn("[VOT] ytAudio: using page progressive MP4 fallback", {
        itag: progressiveFormat.itag,
        mimeType: progressiveFormat.mimeType,
        qualityLabel: progressiveFormat.qualityLabel,
        hasAudioQuality: Boolean(progressiveFormat.audioQuality),
      });

      return await buildActiveAudioChunkStream({
        chunkSize,
        downloadType: AudioDownloadType.WEB_API_VIDEO_SRC,
        fetchImplementation,
        format: progressiveFormat,
        signal,
      });
    } catch (error) {
      console.warn(
        "[VOT] ytAudio: page progressive MP4 fallback failed; trying captureStream fallback if available",
        error,
      );
    }
  }

  if (pageStreamingState?.hasSabrUrl && !pageStreamingState.hasDirectAudioUrl) {
    console.warn(
      "[VOT] ytAudio: active YouTube player is SABR-only; trying captureStream fallback before legacy direct audio",
    );
    if (preferredVideo instanceof HTMLVideoElement) {
      try {
        return await recordCurrentYoutubeAudio({
          chunkSize,
          signal,
          video: preferredVideo,
        });
      } catch (error) {
        console.warn(
          "[VOT] ytAudio: captureStream fallback failed for SABR-only player",
          error,
        );
        throw error instanceof Error ? error : new Error(String(error));
      }
    } else {
      console.warn(
        "[VOT] ytAudio: captureStream fallback skipped; preferred video is unavailable",
      );
      throw new Error(
        "Audio downloader. ytAudio. SABR-only player requires current video capture",
      );
    }
  }

  try {
    const streamResult = await downloader.downloadAudioToChunkStream(
      {
        videoId,
        videoQuality: DEFAULT_YT_AUDIO_QUALITY,
        signal,
      },
      { chunkSize },
    );

    return {
      fileId: makeFileId(
        AudioDownloadType.WEB_API_STEAL_SIG_AND_N,
        streamResult.itag,
        String(streamResult.fileSize),
        chunkSize,
      ),
      mediaPartsLength: streamResult.mediaPartsLength,
      getMediaBuffers: streamResult.getMediaBuffers,
    };
  } catch (error) {
    if (isWatchContextForbiddenError(error)) {
      // 403 on watch-page key fetch is not recoverable in current context.
      // Skip buffered fallback so upper layer reports a clean audio failure
      // instead of spending time on redundant retries.
      throw error;
    }

    console.warn(
      "[VOT] ytAudio streaming mode failed, falling back to buffered mode",
      error,
    );
  }

  const result = await downloader.downloadAudioToUint8Array({
    videoId,
    videoQuality: DEFAULT_YT_AUDIO_QUALITY,
    signal,
  });

  const bytes = result.bytes;
  if (!bytes || bytes.byteLength === 0) {
    throw new Error("Audio downloader. ytAudio. Empty audio");
  }
  const mediaPartsLength = Math.max(1, Math.ceil(bytes.byteLength / chunkSize));

  const fileId = makeFileId(
    AudioDownloadType.WEB_API_STEAL_SIG_AND_N,
    0,
    String(bytes.byteLength),
    chunkSize,
  );

  return {
    fileId,
    mediaPartsLength,
    async *getMediaBuffers(): AsyncGenerator<Uint8Array> {
      for (let start = 0; start < bytes.byteLength; start += chunkSize) {
        const end = Math.min(start + chunkSize, bytes.byteLength);
        yield bytes.subarray(start, end);
      }
    },
  };
}
