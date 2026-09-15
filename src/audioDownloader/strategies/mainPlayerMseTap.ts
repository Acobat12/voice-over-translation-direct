import { config } from "@vot.js/shared";
import type { GetAudioFromAPIOptions } from "../../types/audioDownloader";

export const MAIN_PLAYER_MSE_TAP_STRATEGY = "main_player_mse_tap" as const;

const HISTORY_LIMIT_BYTES = 96 * 1024 * 1024;
const COMPLETE_GRACE_SEC = 2;
const CAPTURE_TIMEOUT_MS = 45_000;
const STORE_KEY = "__VOT_MAIN_PLAYER_MSE_TAP_STORE__";

type TapChunk = { videoId: string; bytes: Uint8Array; at: number };
type TapStore = {
  installed: boolean;
  chunks: TapChunk[];
  bytes: number;
  listeners: Set<() => void>;
};

type GlobalWithTap = typeof globalThis & { [STORE_KEY]?: TapStore };

function currentYoutubeVideoId(): string | null {
  try {
    const url = new URL(globalThis.location.href);
    const candidate =
      url.searchParams.get("v") ||
      (/^\/(?:shorts|live|embed)\/([^/?#]+)/.exec(url.pathname)?.[1] ?? null);
    return candidate && /^[A-Za-z0-9_-]{11}$/.test(candidate)
      ? candidate
      : null;
  } catch {
    return null;
  }
}

function getStore(): TapStore {
  const root = globalThis as GlobalWithTap;
  root[STORE_KEY] ??= {
    installed: false,
    chunks: [],
    bytes: 0,
    listeners: new Set(),
  };
  return root[STORE_KEY];
}

function toBytes(input: BufferSource): Uint8Array {
  if (input instanceof ArrayBuffer) return new Uint8Array(input.slice(0));
  return new Uint8Array(
    input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength),
  );
}

function pushChunk(bytes: Uint8Array): void {
  const videoId = currentYoutubeVideoId();
  if (!videoId || !bytes.byteLength) return;
  const store = getStore();
  store.chunks.push({ videoId, bytes, at: Date.now() });
  store.bytes += bytes.byteLength;
  while (store.bytes > HISTORY_LIMIT_BYTES && store.chunks.length > 1) {
    const removed = store.chunks.shift();
    if (removed) store.bytes -= removed.bytes.byteLength;
  }
  for (const listener of store.listeners) listener();
}

function installTap(): void {
  const store = getStore();
  if (store.installed || typeof MediaSource === "undefined") return;
  store.installed = true;
  try {
    const original = MediaSource.prototype.addSourceBuffer;
    MediaSource.prototype.addSourceBuffer = function (
      type: string,
    ): SourceBuffer {
      const sourceBuffer = original.call(this, type);
      if (!String(type).toLowerCase().startsWith("audio/")) return sourceBuffer;
      const append = sourceBuffer.appendBuffer.bind(sourceBuffer);
      sourceBuffer.appendBuffer = ((data: BufferSource) => {
        try {
          pushChunk(toBytes(data));
        } catch {
          /* capture must never break playback */
        }
        return append(data);
      }) as typeof sourceBuffer.appendBuffer;
      return sourceBuffer;
    };
    console.debug("[VOT][main-player-mse-tap] installed");
  } catch (error) {
    console.warn("[VOT][main-player-mse-tap] install failed", error);
  }
}

installTap();

function activeVideo(videoId: string): HTMLVideoElement | null {
  const videos = Array.from(
    document.querySelectorAll<HTMLVideoElement>(
      "video.html5-main-video, .html5-video-container video, video",
    ),
  );
  return (
    videos.find((video) => {
      if (!Number.isFinite(video.duration) || video.duration <= 0) return false;
      const rect = video.getBoundingClientRect();
      return (
        rect.width > 80 &&
        rect.height > 80 &&
        globalThis.location.href.includes(videoId)
      );
    }) ?? null
  );
}

function isFullyBuffered(video: HTMLVideoElement | null): boolean {
  if (!video || !Number.isFinite(video.duration) || video.buffered.length === 0)
    return false;
  try {
    return (
      video.buffered.end(video.buffered.length - 1) >=
      video.duration - COMPLETE_GRACE_SEC
    );
  } catch {
    return false;
  }
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

async function collectCompleteTappedAudio(
  videoId: string,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const store = getStore();
  const startedAt = Date.now();
  let wake: (() => void) | undefined;
  const onChange = () => {
    wake?.();
    wake = undefined;
  };
  store.listeners.add(onChange);
  try {
    while (Date.now() - startedAt < CAPTURE_TIMEOUT_MS) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      const relevant = store.chunks.filter(
        (chunk) => chunk.videoId === videoId,
      );
      const bytes = relevant.reduce(
        (sum, chunk) => sum + chunk.bytes.byteLength,
        0,
      );
      const video = activeVideo(videoId);
      console.debug("[VOT][main-player-mse-tap] progress", {
        videoId,
        capturedBytes: bytes,
        bufferedEnd: video?.buffered.length
          ? video.buffered.end(video.buffered.length - 1)
          : 0,
        duration: video?.duration,
      });
      if (bytes > 0 && isFullyBuffered(video))
        return concat(relevant.map((chunk) => chunk.bytes));
      await Promise.race([
        new Promise<void>((resolve) => {
          wake = resolve;
        }),
        new Promise<void>((resolve) => setTimeout(resolve, 1500)),
      ]);
    }
    throw new Error(
      "Player/MSE tap did not observe a fully buffered audio stream within 45s",
    );
  } finally {
    store.listeners.delete(onChange);
  }
}

export async function getAudioFromMainPlayerMseTap({
  videoId,
  signal,
}: GetAudioFromAPIOptions) {
  const bytes = await collectCompleteTappedAudio(videoId, signal);
  const chunkSize = config.minChunkSize;
  const count = Math.ceil(bytes.byteLength / chunkSize);
  console.log("[VOT][main-player-mse-tap] complete", {
    videoId,
    bytes: bytes.byteLength,
    chunks: count,
  });
  return {
    fileId: `random-${MAIN_PLAYER_MSE_TAP_STRATEGY}-${crypto.randomUUID()}`,
    mediaPartsLength: count,
    async *getMediaBuffers(): AsyncGenerator<Uint8Array> {
      for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
        yield bytes.subarray(
          offset,
          Math.min(bytes.byteLength, offset + chunkSize),
        );
      }
    },
  };
}
