import { config } from "@vot.js/shared";
import type { GetAudioFromAPIOptions } from "../../types/audioDownloader";
import debug from "../../utils/debug";
import { isAbortError, makeAbortError } from "../../utils/errors";
import { type AudioChunk as BridgeChunk, concatBuffers } from "./audioChunks";
import { getWebAbrAudioChunks } from "./webAbr";
import { getSabrAudioChunks } from "./youtubeSabrStrategy";

export const WEB_ABR_STRATEGY = "web_abr" as const;
export const SABR_STRATEGY = "sabr" as const;
export const WEB_MSE_PROXY_STRATEGY = "web_mse_proxy" as const;

const MESSAGE_TYPE = "get-audio-chunks-by-mse-in-main-world";
const READY_MESSAGE_TYPE = "vot-mse-proxy-ready";
const IFRAME_HASH = "ya_iframe";
const BOOT_KEY = "__VOT_MSE_PROXY_HANDLER__";
const STORE_KEY = "__VOT_MSE_CAPTURE_STORE__";

const STREAM_TIMEOUT_MS = 30 * 60 * 1000;
const MESSAGE_TIMEOUT_MS = 5 * 60 * 1000;

function getBridgeWindow(): Window & typeof globalThis {
  try {
    const unsafe = (
      globalThis as typeof globalThis & {
        unsafeWindow?: Window & typeof globalThis;
      }
    ).unsafeWindow;
    if (unsafe?.document && unsafe.location?.hostname.endsWith("youtube.com")) {
      return unsafe;
    }
  } catch {}

  try {
    const wrapped = (
      globalThis as typeof globalThis & {
        wrappedJSObject?: Window & typeof globalThis;
      }
    ).wrappedJSObject;
    if (
      wrapped?.document &&
      wrapped.location?.hostname.endsWith("youtube.com")
    ) {
      return wrapped;
    }
  } catch {}

  return globalThis as Window & typeof globalThis;
}

type BridgeMessage = {
  messageId?: string;
  messageType?: string;
  messageDirection?: "request" | "response";
  payload?: unknown;
  isProgress?: boolean;
  isStreamFinished?: boolean;
  isAborted?: boolean;
  error?: unknown;
};

type CaptureEvent =
  | { type: "append"; buffer: Uint8Array; sourceBuffer: SourceBuffer }
  | { type: "end" }
  | { type: "close" };

type CaptureListener = (event: CaptureEvent) => void;

function parseAudioBridgeChunk(payload: unknown): BridgeChunk {
  if (!payload || typeof payload !== "object" || !("buffer" in payload)) {
    throw new Error("Audio downloader. Invalid audio bridge chunk");
  }

  const raw = (payload as { buffer: unknown; isLastChunk?: unknown }).buffer;
  const isLastChunk = (payload as { isLastChunk?: unknown }).isLastChunk;
  const bytes =
    raw instanceof Uint8Array
      ? raw
      : raw instanceof ArrayBuffer
        ? new Uint8Array(raw)
        : ArrayBuffer.isView(raw)
          ? new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
          : null;

  if (!bytes || typeof isLastChunk !== "boolean") {
    throw new Error("Audio downloader. Invalid audio bridge chunk");
  }

  return { buffer: bytes, isLastChunk };
}

async function* getAudioBridgeChunks(
  videoId: string,
  signal: AbortSignal,
  audioDownloadType:
    | typeof WEB_ABR_STRATEGY
    | typeof SABR_STRATEGY
    | typeof WEB_MSE_PROXY_STRATEGY,
  webAbrTransportStartIndex = 0,
  sourceLanguage?: string,
): AsyncGenerator<BridgeChunk> {
  const bridgeWindow = getBridgeWindow();

  if (signal.aborted) {
    throw makeAbortError();
  }

  const messageId = `stream-message-id-${performance.now()}-${Math.random()}`;
  const chunks: BridgeChunk[] = [];
  let wake: (() => void) | undefined;
  let streamFinished = false;
  let failure: Error | undefined;
  let receivedChunks = 0;
  let messageTimeout: ReturnType<typeof setTimeout> | undefined;

  const notify = () => {
    wake?.();
    wake = undefined;
  };

  const finish = (error?: Error) => {
    if (error) {
      if (failure || streamFinished) return;
      failure = error;
      if (messageTimeout) clearTimeout(messageTimeout);
      debug.error("Audio downloader. Audio bridge failed", {
        videoId,
        messageId,
        audioDownloadType,
        receivedChunks,
        error: error.message,
      });
    } else {
      if (streamFinished) return;
      streamFinished = true;
      if (messageTimeout) clearTimeout(messageTimeout);
      debug.log("Audio downloader. Audio bridge stream finished", {
        videoId,
        messageId,
        audioDownloadType,
        receivedChunks,
      });
    }
    notify();
  };

  const resetMessageTimeout = () => {
    if (messageTimeout) clearTimeout(messageTimeout);
    messageTimeout = setTimeout(
      () => finish(new Error("Audio bridge message timed out")),
      MESSAGE_TIMEOUT_MS,
    );
  };

  const throwIfFailed = () => {
    if (!failure) return;
    if (!bridgeWindow.location.href.includes(videoId)) {
      throw makeAbortError("URL changed during audio download");
    }
    throw failure;
  };

  const postAbort = () => {
    bridgeWindow.postMessage(
      {
        messageId,
        messageType: MESSAGE_TYPE,
        messageDirection: "request",
        isStreamFinished: true,
        isAborted: true,
      } satisfies BridgeMessage,
      "*",
    );
  };

  const onMessage = (event: MessageEvent) => {
    const message = event.data as BridgeMessage;
    const iframe = bridgeWindow.document.getElementById(
      `vot-mse-proxy-${messageId}`,
    ) as HTMLIFrameElement | null;

    if (
      !message ||
      (event.source !== (bridgeWindow as unknown as MessageEventSource) &&
        event.source !== iframe?.contentWindow) ||
      message.messageId !== messageId ||
      message.messageType !== MESSAGE_TYPE ||
      message.messageDirection !== "response"
    ) {
      return;
    }

    resetMessageTimeout();

    if (message.isAborted) {
      finish(makeAbortError(String(message.error || "Audio bridge aborted")));
      return;
    }
    if (message.error) {
      finish(
        new Error(
          typeof message.error === "string"
            ? message.error
            : "Audio bridge failed",
        ),
      );
      return;
    }
    if (message.isStreamFinished) {
      finish();
      return;
    }
    if (message.isProgress) {
      return;
    }

    try {
      const chunk = parseAudioBridgeChunk(message.payload);
      chunks.push(chunk);
      receivedChunks += 1;

      // The media protocol already carries an authoritative end marker on the
      // final chunk. Do not require a second control message to unblock the
      // consumer: that message can race with bridge cleanup or be lost.
      if (chunk.isLastChunk) {
        finish();
      } else {
        notify();
      }
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  };

  const onAbort = () => finish(makeAbortError());
  const streamTimeout = setTimeout(
    () => finish(new Error("Audio bridge stream timed out")),
    STREAM_TIMEOUT_MS,
  );
  const navigationInterval = setInterval(() => {
    if (!bridgeWindow.location.href.includes(videoId)) {
      finish(makeAbortError("URL changed during audio download"));
    }
  }, 100);

  bridgeWindow.addEventListener("message", onMessage);
  signal.addEventListener("abort", onAbort, { once: true });
  resetMessageTimeout();

  debug.log("Audio downloader. Audio bridge request started", {
    videoId,
    messageId,
    audioDownloadType,
    bridgeHost: bridgeWindow.location.hostname,
    mainWorldBridge: bridgeWindow !== globalThis,
  });

  try {
    bridgeWindow.postMessage(
      {
        messageId,
        messageType: MESSAGE_TYPE,
        messageDirection: "request",
        payload: {
          pureVideoId: videoId,
          audioDownloadType,
          webAbrTransportStartIndex,
          sourceLanguage,
        },
      } satisfies BridgeMessage,
      "*",
    );

    while (!streamFinished || chunks.length > 0) {
      throwIfFailed();
      const chunk = chunks.shift();
      if (chunk) {
        yield chunk;
        continue;
      }

      // Register the waiter first, then re-check state. A message may arrive
      // between the initial empty-queue check and waiter installation.
      await new Promise<void>((resolve) => {
        wake = resolve;
        if (failure || streamFinished || chunks.length > 0) {
          notify();
        }
      });
    }
    throwIfFailed();
  } finally {
    if (messageTimeout) clearTimeout(messageTimeout);
    clearTimeout(streamTimeout);
    clearInterval(navigationInterval);
    bridgeWindow.removeEventListener("message", onMessage);
    signal.removeEventListener("abort", onAbort);
    if (!streamFinished || failure) {
      postAbort();
    }
  }
}

async function getAudioFromBridge(
  { videoId, signal }: GetAudioFromAPIOptions,
  audioDownloadType:
    | typeof WEB_ABR_STRATEGY
    | typeof SABR_STRATEGY
    | typeof WEB_MSE_PROXY_STRATEGY,
  webAbrTransportStartIndex = 0,
  sourceLanguage?: string,
) {
  return {
    fileId: `random-${audioDownloadType}-${crypto.randomUUID()}`,
    mediaPartsLength: null,
    getMediaBuffers: () =>
      getAudioBridgeChunks(
        videoId,
        signal,
        audioDownloadType,
        webAbrTransportStartIndex,
        sourceLanguage,
      ),
  };
}

export async function getAudioFromWebAbr(options: GetAudioFromAPIOptions) {
  const extendedOptions = options as GetAudioFromAPIOptions & {
    webAbrTransportStartIndex?: number;
    sourceLanguage?: string;
  };
  const webAbrTransportStartIndex = Number(
    extendedOptions.webAbrTransportStartIndex ?? 0,
  );
  return getAudioFromBridge(
    options,
    WEB_ABR_STRATEGY,
    Number.isInteger(webAbrTransportStartIndex) &&
      webAbrTransportStartIndex >= 0
      ? webAbrTransportStartIndex
      : 0,
    extendedOptions.sourceLanguage,
  );
}

export async function getAudioFromSabr(options: GetAudioFromAPIOptions) {
  const extended = options as GetAudioFromAPIOptions & {
    webAbrTransportStartIndex?: number;
    sourceLanguage?: string;
  };
  return getAudioFromBridge(
    options,
    SABR_STRATEGY,
    extended.webAbrTransportStartIndex ?? 0,
    extended.sourceLanguage,
  );
}

export async function getAudioFromWebMseProxy(options: GetAudioFromAPIOptions) {
  return getAudioFromBridge(options, WEB_MSE_PROXY_STRATEGY);
}

function getVideoId(message: BridgeMessage): string | undefined {
  if (!message.payload || typeof message.payload !== "object") return undefined;
  const videoId = (message.payload as { pureVideoId?: unknown }).pureVideoId;
  return typeof videoId === "string" ? videoId : undefined;
}

function getAudioDownloadType(
  message: BridgeMessage,
):
  | typeof WEB_ABR_STRATEGY
  | typeof SABR_STRATEGY
  | typeof WEB_MSE_PROXY_STRATEGY
  | undefined {
  if (!message.payload || typeof message.payload !== "object") return undefined;
  const audioDownloadType = (message.payload as { audioDownloadType?: unknown })
    .audioDownloadType;
  return audioDownloadType === WEB_ABR_STRATEGY ||
    audioDownloadType === SABR_STRATEGY ||
    audioDownloadType === WEB_MSE_PROXY_STRATEGY
    ? audioDownloadType
    : undefined;
}

function getWebAbrTransportStartIndex(message: BridgeMessage): number {
  if (!message.payload || typeof message.payload !== "object") return 0;
  const value = (message.payload as { webAbrTransportStartIndex?: unknown })
    .webAbrTransportStartIndex;
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : 0;
}

function getSourceLanguage(message: BridgeMessage): string | undefined {
  if (!message.payload || typeof message.payload !== "object") return undefined;
  const value = (message.payload as { sourceLanguage?: unknown })
    .sourceLanguage;
  return typeof value === "string" && value ? value : undefined;
}

function waitFor<T>(
  getValue: () => T | null | undefined,
  timeoutMs: number,
  label: string,
  signal: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearInterval(interval);
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(makeAbortError());
    };
    const interval = setInterval(() => {
      try {
        const value = getValue();
        if (value) {
          cleanup();
          resolve(value);
        }
      } catch (error) {
        cleanup();
        reject(error);
      }
    }, 100);
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Audio downloader. ${label} timed out`));
    }, timeoutMs);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

class CapturedMediaSource {
  readonly mediaSource: MediaSource;
  readonly createdAt = performance.now();
  readonly queuedEvents: CaptureEvent[] = [];
  readonly listeners = new Set<CaptureListener>();

  constructor(mediaSource: MediaSource) {
    this.mediaSource = mediaSource;

    const addSourceBuffer = mediaSource.addSourceBuffer;
    mediaSource.addSourceBuffer = new Proxy(addSourceBuffer, {
      apply: (target, thisArg, args: [string]) => {
        const sourceBuffer = Reflect.apply(target, thisArg, args);
        // Match the working VOT MSE fallback: capture the audio/webm SourceBuffer only.
        if (typeof args[0] === "string" && args[0].includes("audio/webm")) {
          this.capture(sourceBuffer);
        }
        return sourceBuffer;
      },
    });

    const endOfStream = mediaSource.endOfStream;
    mediaSource.endOfStream = new Proxy(endOfStream, {
      apply: (target, thisArg, args) => {
        const result = Reflect.apply(target, thisArg, args);
        this.emit({ type: "end" });
        return result;
      },
    });

    mediaSource.addEventListener("sourceclose", () =>
      this.emit({ type: "close" }),
    );
  }

  get isReady(): boolean {
    return this.mediaSource.readyState === "open";
  }

  listen(listener: CaptureListener): () => void {
    this.listeners.add(listener);
    try {
      for (const event of this.queuedEvents.splice(0)) {
        listener(event);
      }
    } catch (error) {
      this.listeners.delete(listener);
      throw error;
    }
    return () => this.listeners.delete(listener);
  }

  private capture(sourceBuffer: SourceBuffer): void {
    const appendBuffer = sourceBuffer.appendBuffer;
    sourceBuffer.appendBuffer = new Proxy(appendBuffer, {
      apply: (target, thisArg, args: [BufferSource]) => {
        const input = args[0];
        const view = ArrayBuffer.isView(input)
          ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
          : new Uint8Array(input as ArrayBuffer);
        const copy = new Uint8Array(view);
        const result = Reflect.apply(target, thisArg, args);
        this.emit({
          type: "append",
          buffer: copy,
          sourceBuffer,
        });
        return result;
      },
    });
  }

  private emit(event: CaptureEvent): void {
    if (this.listeners.size === 0) {
      this.queuedEvents.push(event);
    }
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

class MseCaptureStore {
  readonly captures: CapturedMediaSource[] = [];
  readonly listeners = new Set<(capture: CapturedMediaSource) => void>();

  add(mediaSource: MediaSource): void {
    const capture = new CapturedMediaSource(mediaSource);
    this.captures.push(capture);
    for (const listener of this.listeners) {
      listener(capture);
    }
  }

  async pick(signal: AbortSignal): Promise<CapturedMediaSource> {
    try {
      return await waitFor(
        () => {
          const capture = this.captures.at(-1);
          return capture?.isReady &&
            performance.now() - capture.createdAt >= 4000
            ? capture
            : null;
        },
        10000,
        "MSE capture wait",
        signal,
      );
    } catch (error) {
      signal.throwIfAborted();
      if (isAbortError(error)) throw error;
      const newest = this.captures.at(-1);
      throw new Error(
        `Audio downloader. MSE capture wait timed out (captures: ${this.captures.length}, newestReady: ${newest?.isReady ?? "none"})`,
        { cause: error },
      );
    }
  }

  onCapture(listener: (capture: CapturedMediaSource) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

function installMediaSourceProxy(
  targetWindow: Window & typeof globalThis,
): MseCaptureStore {
  const anyWindow = targetWindow as any;
  if (anyWindow[STORE_KEY]) {
    return anyWindow[STORE_KEY] as MseCaptureStore;
  }

  const store = new MseCaptureStore();
  const key = anyWindow.ManagedMediaSource
    ? "ManagedMediaSource"
    : "MediaSource";
  const MediaSourceConstructor = anyWindow[key] as
    | typeof MediaSource
    | undefined;
  if (!MediaSourceConstructor) {
    throw new Error("MediaSource is not available");
  }

  class ProxiedMediaSource extends MediaSourceConstructor {
    constructor() {
      super();
      store.add(this);
    }
  }

  anyWindow[key] = ProxiedMediaSource;
  anyWindow[STORE_KEY] = store;
  return store;
}

async function getPlayer(
  targetWindow: Window & typeof globalThis,
  signal: AbortSignal,
): Promise<any> {
  return await waitFor(
    () => {
      const player = targetWindow.document.querySelector(
        "#movie_player",
      ) as any;
      return player &&
        typeof player.playVideo === "function" &&
        typeof player.mute === "function" &&
        typeof player.seekTo === "function"
        ? player
        : null;
    },
    30000,
    "MSE player wait",
    signal,
  );
}

function createAudioChunkStream(
  targetWindow: Window & typeof globalThis,
  videoId: string,
  signal: AbortSignal,
  onProgress?: () => void,
): ReadableStream<BridgeChunk> {
  let cleanup = () => {};
  let finished = false;
  const cancellation = new AbortController();
  signal = AbortSignal.any([signal, cancellation.signal]);

  return new ReadableStream<BridgeChunk>({
    async start(controller) {
      let stopMse = () => {};

      const fail = (error: unknown) => {
        if (finished) return;
        finished = true;
        cleanup();
        controller.error(error);
      };
      const onAbort = () => fail(makeAbortError());
      cleanup = () => {
        stopMse();
        signal.removeEventListener("abort", onAbort);
      };
      signal.addEventListener("abort", onAbort, { once: true });

      const onMseError = (error: unknown) => {
        if (finished) return;
        stopMse();
        fail(signal.aborted ? makeAbortError() : error);
      };

      try {
        signal.throwIfAborted();
        debug.log("Audio downloader. MSE iframe stream started", { videoId });

        const player = await getPlayer(targetWindow, signal);
        signal.throwIfAborted();
        debug.log("Audio downloader. MSE player found", { videoId });

        try {
          player.loadVideoById?.(videoId);
        } catch {}

        player.mute();
        player.playVideo();

        const getPlayerState = () => {
          try {
            return player.getPlayerState?.() ?? null;
          } catch {
            return null;
          }
        };

        const listVideos = () => [
          ...targetWindow.document.querySelectorAll<HTMLVideoElement>("video"),
        ];

        const readyVideo = await waitFor(
          () => {
            const videos = listVideos();
            const state = getPlayerState();

            if (
              videos.length > 0 &&
              (state === 5 || state === 2 || state === -1)
            ) {
              try {
                if (state === -1) player.loadVideoById?.(videoId);
                player.playVideo();
              } catch {}
              try {
                videos[0].muted = true;
                void videos[0].play().catch(() => {});
              } catch {}
            }

            return (
              videos.find((video) => video.readyState >= 3) ??
              (state === 1 && videos.length > 0 ? videos[0] : null)
            );
          },
          15000,
          "MSE media wait",
          signal,
        );

        signal.throwIfAborted();

        debug.log("Audio downloader. MSE media ready", {
          videoId,
          readyState: readyVideo.readyState,
          playerState: getPlayerState(),
        });

        try {
          readyVideo.playbackRate = 2;
        } catch {}

        const store = installMediaSourceProxy(targetWindow);
        let capture = await store.pick(signal);
        signal.throwIfAborted();

        debug.log("Audio downloader. MSE capture picked", {
          videoId,
          captures: store.captures.length,
          readyState: capture.mediaSource.readyState,
        });

        let removeCaptureListener = () => {};
        let pending: Uint8Array[] = [];
        let pendingSize = 0;
        let totalSize = 0;
        let seekTimeout: ReturnType<typeof setTimeout> | undefined;
        let lastProgressAt = 0;

        const enqueuePendingChunk = (isLastChunk: boolean) => {
          if (pendingSize === 0 && !isLastChunk) return;
          controller.enqueue({
            buffer: concatBuffers(pending),
            isLastChunk,
          });
          pending = [];
          pendingSize = 0;
        };

        const close = () => {
          if (finished) return;
          if (totalSize === 0) {
            onMseError(new Error("Audio downloader. Empty MSE stream"));
            return;
          }
          enqueuePendingChunk(true);
          finished = true;
          controller.close();
          cleanup();
        };

        let lastBufferedEnd = 0;
        let awaitingReplacementCapture = false;

        const getDuration = () => {
          try {
            const value = Number(
              player.getDuration?.() ?? readyVideo.duration ?? 0,
            );
            return Number.isFinite(value) && value > 0 ? value : 0;
          } catch {
            const value = Number(readyVideo.duration || 0);
            return Number.isFinite(value) && value > 0 ? value : 0;
          }
        };

        const getCurrentTime = () => {
          try {
            const value = Number(
              player.getCurrentTime?.() ?? readyVideo.currentTime ?? 0,
            );
            return Number.isFinite(value) && value >= 0 ? value : 0;
          } catch {
            const value = Number(readyVideo.currentTime || 0);
            return Number.isFinite(value) && value >= 0 ? value : 0;
          }
        };

        const isNearRealVideoEnd = () => {
          const duration = getDuration();
          if (duration <= 0) return true;
          const progress = Math.max(getCurrentTime(), lastBufferedEnd);
          // Never finalize a multi-hour source merely because one MediaSource
          // instance ended. Allow a small end margin for YouTube rounding.
          return duration - progress <= Math.max(30, duration * 0.005);
        };

        const requestReplacementCapture = () => {
          const duration = getDuration();
          const currentTime = getCurrentTime();
          const progress = Math.max(currentTime, lastBufferedEnd);
          const nextTime =
            duration > 0
              ? Math.min(
                  Math.max(0, duration - 1),
                  Math.max(progress + 1, currentTime + 1),
                )
              : Math.max(progress + 1, currentTime + 1);

          awaitingReplacementCapture = true;
          debug.log(
            "Audio downloader. Premature MSE end; waiting for next capture",
            {
              videoId,
              duration,
              currentTime,
              bufferedEnd: lastBufferedEnd,
              nextTime,
              totalSize,
            },
          );
          onProgress?.();

          try {
            player.seekTo(nextTime, true);
            player.playVideo();
          } catch (error) {
            onMseError(error);
          }
        };

        const onCapturedEvent = (event: CaptureEvent) => {
          if (finished) return;
          try {
            if (event.type === "end") {
              if (isNearRealVideoEnd()) {
                debug.log("Audio downloader. MSE reached real video end", {
                  videoId,
                  duration: getDuration(),
                  currentTime: getCurrentTime(),
                  bufferedEnd: lastBufferedEnd,
                  totalSize,
                });
                close();
              } else {
                requestReplacementCapture();
              }
              return;
            }
            if (event.type === "close") {
              if (awaitingReplacementCapture) {
                debug.log(
                  "Audio downloader. Old MSE source closed while replacement is expected",
                  {
                    videoId,
                    duration: getDuration(),
                    currentTime: getCurrentTime(),
                    bufferedEnd: lastBufferedEnd,
                    totalSize,
                  },
                );
                return;
              }
              onMseError(new Error("Audio downloader. MSE source closed"));
              return;
            }

            pending.push(event.buffer);
            pendingSize += event.buffer.byteLength;
            totalSize += event.buffer.byteLength;

            if (pendingSize >= config.minChunkSize) {
              enqueuePendingChunk(false);
            } else if (
              pendingSize >= config.minChunkSize / 2 &&
              performance.now() - lastProgressAt >= 30000
            ) {
              lastProgressAt = performance.now();
              onProgress?.();
            }

            const { buffered } = event.sourceBuffer;
            const bufferedEnd =
              buffered.length > 0
                ? Math.floor(buffered.end(buffered.length - 1))
                : 0;
            lastBufferedEnd = Math.max(lastBufferedEnd, bufferedEnd);
            if (seekTimeout) clearTimeout(seekTimeout);
            if (bufferedEnd > 0) {
              seekTimeout = setTimeout(() => {
                try {
                  player.seekTo(bufferedEnd, true);
                } catch (error) {
                  onMseError(error);
                }
              }, 1000);
            }
          } catch (error) {
            onMseError(error);
          }
        };

        let stopCapture = () => {};
        stopMse = () => {
          if (seekTimeout) clearTimeout(seekTimeout);
          stopCapture();
          removeCaptureListener();
        };

        stopCapture = capture.listen(onCapturedEvent);
        removeCaptureListener = store.onCapture((nextCapture) => {
          if (finished) return;
          stopCapture();
          capture = nextCapture;
          awaitingReplacementCapture = false;
          debug.log("Audio downloader. Replacement MSE capture selected", {
            videoId,
            captures: store.captures.length,
            duration: getDuration(),
            currentTime: getCurrentTime(),
            bufferedEnd: lastBufferedEnd,
          });
          stopCapture = capture.listen(onCapturedEvent);
        });
      } catch (error) {
        debug.error("Audio downloader. MSE iframe stream failed", {
          videoId,
          error: error instanceof Error ? error.message : String(error),
        });
        onMseError(error);
      }
    },
    cancel(reason) {
      finished = true;
      cancellation.abort(reason);
      cleanup();
    },
  });
}

/**
 * Passive capture from the active Shorts player. Unlike the legacy iframe
 * streamer this never seeks, mutes, loads another video, or changes playback.
 * Fail closed: upload nothing until one audio SourceBuffer has a complete,
 * contiguous time range and the collected bytes begin with a WebM header.
 */
function createActivePlayerAudioStream(
  targetWindow: Window & typeof globalThis,
  videoId: string,
  signal: AbortSignal,
  onProgress?: () => void,
): ReadableStream<BridgeChunk> {
  const store = installMediaSourceProxy(targetWindow);
  const MAX_AUDIO_BYTES = 48 * 1024 * 1024;
  const MAX_WAIT_MS = 90_000;
  let stop = () => {};
  return new ReadableStream<BridgeChunk>({
    async start(controller) {
      let finished = false;
      let selected: CapturedMediaSource | undefined;
      let parts: Uint8Array[] = [];
      let bytes = 0;
      let audioBuffer: SourceBuffer | undefined;
      let lastProgress = 0;
      const started = performance.now();
      const currentId = () => {
        const path = targetWindow.location.pathname;
        const pathId = path.match(/\/(?:shorts|watch)\/([^/?]+)/)?.[1];
        if (pathId) return pathId;
        const urlId = new URL(targetWindow.location.href).searchParams.get("v");
        return urlId || undefined;
      };
      const matchesVideo = () => {
        const player = targetWindow.document.querySelector("#movie_player") as
          | (HTMLElement & { getVideoData?: () => { video_id?: string } })
          | null;
        const playerId = player?.getVideoData?.()?.video_id;
        return currentId() === videoId && (!playerId || playerId === videoId);
      };
      const cleanup = () => {
        clearInterval(interval);
        signal.removeEventListener("abort", onAbort);
        unlisten();
        removeNewCapture();
      };
      const fail = (error: Error) => {
        if (finished) return;
        finished = true;
        cleanup();
        controller.error(error);
      };
      const onAbort = () => fail(makeAbortError());
      let unlisten = () => {};
      let removeNewCapture = () => {};
      const select = (capture: CapturedMediaSource) => {
        if (finished || selected === capture) return;
        // Never concatenate separate MediaSource instances: their init segments
        // and timestamps may be incompatible or belong to different Shorts.
        if (selected && bytes > 0) {
          fail(
            new Error("Audio downloader. MSE source replaced during capture"),
          );
          return;
        }
        unlisten();
        selected = capture;
        parts = [];
        bytes = 0;
        audioBuffer = undefined;
        unlisten = capture.listen((event) => {
          if (finished) return;
          if (!matchesVideo()) {
            fail(
              new Error("Audio downloader. Shorts changed during MSE capture"),
            );
            return;
          }
          if (event.type === "close") {
            fail(
              new Error(
                "Audio downloader. MSE source closed before complete audio",
              ),
            );
            return;
          }
          if (event.type !== "append") return;
          if (audioBuffer && event.sourceBuffer !== audioBuffer) {
            fail(new Error("Audio downloader. Multiple MSE audio buffers"));
            return;
          }
          audioBuffer = event.sourceBuffer;
          if (bytes + event.buffer.byteLength > MAX_AUDIO_BYTES) {
            fail(
              new Error("Audio downloader. MSE audio exceeds capture limit"),
            );
            return;
          }
          parts.push(event.buffer);
          bytes += event.buffer.byteLength;
        });
      };
      const interval = setInterval(() => {
        if (finished) return;
        if (signal.aborted) return onAbort();
        if (!matchesVideo()) {
          fail(
            new Error(
              "Audio downloader. Active Shorts does not match requested video",
            ),
          );
          return;
        }
        if (performance.now() - started > MAX_WAIT_MS) {
          fail(
            new Error(
              "Audio downloader. MSE audio not complete within 90 seconds; use web_abr",
            ),
          );
          return;
        }
        if (!audioBuffer || bytes === 0 || audioBuffer.updating) return;
        const video = [...targetWindow.document.querySelectorAll("video")].find(
          (v) =>
            v.currentSrc.startsWith("blob:") &&
            Number.isFinite(v.duration) &&
            v.duration > 0,
        );
        if (!video) return;
        const ranges = audioBuffer.buffered;
        if (ranges.length !== 1) return;
        const start = ranges.start(0);
        const end = ranges.end(0);
        if (start > 0.25 || end < video.duration - 0.75) return;
        // EBML header: without it a mid-stream MSE fragment is not a file.
        const first = parts[0];
        if (
          !first ||
          first.length < 4 ||
          first[0] !== 0x1a ||
          first[1] !== 0x45 ||
          first[2] !== 0xdf ||
          first[3] !== 0xa3
        ) {
          fail(
            new Error(
              "Audio downloader. MSE audio lacks initial WebM header; use web_abr",
            ),
          );
          return;
        }
        const result = concatBuffers(parts);
        finished = true;
        cleanup();
        debug.log("Audio downloader. Active Shorts MSE audio complete", {
          videoId,
          bytes: result.byteLength,
          bufferedStart: start,
          bufferedEnd: end,
          duration: video.duration,
        });
        controller.enqueue({ buffer: result, isLastChunk: true });
        controller.close();
      }, 250);
      stop = () => fail(makeAbortError());
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) return onAbort();
      if (!matchesVideo()) {
        fail(
          new Error(
            "Audio downloader. Active Shorts does not match requested video",
          ),
        );
        return;
      }
      // Prefer a capture with an audio buffer. A capture made before the
      // request retains its events until a listener subscribes.
      const existing =
        [...store.captures]
          .reverse()
          .find((c) => c.queuedEvents.some((e) => e.type === "append")) ??
        store.captures.at(-1);
      if (existing) select(existing);
      removeNewCapture = store.onCapture(select);
      if (performance.now() - lastProgress > 0) {
        lastProgress = performance.now();
        onProgress?.();
      }
    },
    cancel() {
      stop();
    },
  });
}

function postResponse(
  target: MessageEventSource,
  targetOrigin: string,
  message: BridgeMessage,
): void {
  (target as WindowProxy).postMessage(message, targetOrigin || "*");
}

async function handleAudioStreamRequest(
  event: MessageEvent,
  targetWindow: Window & typeof globalThis,
  context: "iframe" | "direct",
): Promise<void> {
  const message = event.data as BridgeMessage;
  const source = event.source;
  if (!source) return;

  const controller = new AbortController();
  const abort = (abortEvent: MessageEvent) => {
    const data = abortEvent.data as BridgeMessage;
    if (
      abortEvent.source === source &&
      abortEvent.origin === event.origin &&
      data?.messageId === message.messageId &&
      data.messageType === MESSAGE_TYPE &&
      data.messageDirection === "request" &&
      data.isAborted
    ) {
      controller.abort(data.payload);
    }
  };

  targetWindow.addEventListener("message", abort);
  let settled = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const videoId = getVideoId(message);
  const logDetails = {
    videoId,
    messageId: message.messageId,
    host: targetWindow.location.hostname,
  };

  try {
    if (!videoId) {
      throw new Error("Audio downloader. Missing video id");
    }
    const audioDownloadType = getAudioDownloadType(message);
    if (!audioDownloadType) {
      throw new Error("Audio downloader. Unsupported audio download type");
    }

    debug.log(
      context === "direct"
        ? "Audio downloader. direct SABR request started"
        : "Audio downloader. iframe request started",
      { ...logDetails, audioDownloadType },
    );

    const postProgress = () => {
      if (settled) return;
      postResponse(source, event.origin, {
        ...message,
        messageDirection: "response",
        payload: undefined,
        isProgress: true,
      });
    };

    const usesNativeTransport =
      audioDownloadType === WEB_ABR_STRATEGY ||
      audioDownloadType === SABR_STRATEGY;
    const chunks = usesNativeTransport
      ? (audioDownloadType === SABR_STRATEGY
          ? getSabrAudioChunks
          : getWebAbrAudioChunks)(
          targetWindow,
          videoId,
          controller.signal,
          getWebAbrTransportStartIndex(message),
          getSourceLanguage(message),
        )
      : context === "iframe"
        ? createAudioChunkStream(
            targetWindow,
            videoId,
            controller.signal,
            postProgress,
          )
        : createActivePlayerAudioStream(
            targetWindow,
            videoId,
            controller.signal,
            postProgress,
          );

    if (usesNativeTransport) {
      postProgress();
      heartbeat = setInterval(postProgress, 30_000);
    }

    for await (const chunk of chunks) {
      postResponse(source, event.origin, {
        ...message,
        messageDirection: "response",
        payload: chunk,
      });
    }

    settled = true;
    if (context === "direct") {
      debug.log(
        "Audio downloader. direct SABR stream finished sent",
        logDetails,
      );
    }
    postResponse(source, event.origin, {
      ...message,
      messageDirection: "response",
      payload: undefined,
      isStreamFinished: true,
    });
  } catch (error) {
    settled = true;
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (context === "direct") {
      debug.error("Audio downloader. direct SABR request failed", {
        ...logDetails,
        error: errorMessage,
      });
    }
    postResponse(source, event.origin, {
      ...message,
      messageDirection: "response",
      payload: undefined,
      error: errorMessage,
      isAborted: controller.signal.aborted || isAbortError(error),
    });
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    targetWindow.removeEventListener("message", abort);
  }
}

async function handleTopRequest(
  event: MessageEvent,
  targetWindow: Window & typeof globalThis,
): Promise<void> {
  const message = event.data as BridgeMessage;
  const source = event.source;
  if (!source || !message.messageId) return;

  const videoId = getVideoId(message);
  const audioDownloadType = getAudioDownloadType(message);
  if (!videoId || !audioDownloadType) {
    postResponse(source, event.origin, {
      ...message,
      messageDirection: "response",
      error: videoId
        ? "Audio downloader. Unsupported audio download type"
        : "Audio downloader. Missing video id",
    });
    return;
  }

  // WEB_ABR/SABR must run in the real current YouTube page realm.
  // This preserves the native WEB context on www.youtube.com and the native
  // MWEB context on m.youtube.com instead of forcing both through /embed.
  if (
    audioDownloadType === WEB_ABR_STRATEGY ||
    audioDownloadType === SABR_STRATEGY ||
    audioDownloadType === WEB_MSE_PROXY_STRATEGY
  ) {
    await handleAudioStreamRequest(event, targetWindow, "direct");
    return;
  }

  postResponse(source, event.origin, {
    ...message,
    messageDirection: "response",
    error: "Audio downloader. Unsupported audio download type",
  });
}

export function initMseProxyHandler(
  pageWindow: Window & typeof globalThis = globalThis as Window &
    typeof globalThis,
): void {
  const anyWindow = pageWindow as any;

  if (
    anyWindow[BOOT_KEY] ||
    !pageWindow.location ||
    pageWindow.navigator.userAgent.includes("YaBrowser/")
  ) {
    return;
  }
  anyWindow[BOOT_KEY] = true;

  const isServiceIframe =
    pageWindow.self !== pageWindow.top &&
    /(?:youtube(?:-nocookie)?\.com|youtubekids\.com)$/.test(
      pageWindow.location.hostname,
    ) &&
    pageWindow.location.hash.includes(IFRAME_HASH);

  // Install before the active Shorts player creates its MediaSource. If the
  // userscript starts late, passive capture fails safely instead of uploading
  // an incomplete fragment. Keep other YouTube transports unchanged.
  if (
    isServiceIframe ||
    /(?:^|\.)youtube\.com$/.test(pageWindow.location.hostname)
  ) {
    try {
      installMediaSourceProxy(pageWindow);
    } catch (error) {
      debug.error("Audio downloader. MSE capture install failed", error);
    }
  }

  pageWindow.addEventListener("message", (event) => {
    const message = event.data as BridgeMessage;
    if (
      message?.messageType !== MESSAGE_TYPE ||
      message.messageDirection !== "request"
    ) {
      return;
    }

    if (!isServiceIframe && event.origin !== pageWindow.location.origin) {
      return;
    }

    // The active stream handles cancellation; it must not start another request.
    if (message.isAborted) return;

    if (isServiceIframe) {
      void handleAudioStreamRequest(event, pageWindow, "iframe");
    } else {
      void handleTopRequest(event, pageWindow);
    }
  });

  if (isServiceIframe) {
    pageWindow.parent.postMessage(
      {
        messageType: READY_MESSAGE_TYPE,
        messageDirection: "response",
      } satisfies BridgeMessage,
      "*",
    );
  }
}

// Side effect: the userscript also runs inside the hidden YouTube embed iframe.
initMseProxyHandler();
