import { createAbortableDelay } from "../../utils/abort";
import debug from "../../utils/debug";
import type { AudioChunk } from "./audioChunks";
import { getWebCreatorAudioChunks } from "./webCreator";
import { getTopPageWindow, type WebAbrWindow } from "./youtubePlayer";
import { trySabrAudioChunks } from "./youtubeSabr";
import { assertYouTubeAudioIsUsefulForVot } from "./youtubeSabrSupport";

type YouTubeAudioStrategy = "auto" | "sabr" | "web_creator";

const YOUTUBE_AUDIO_STRATEGY: YouTubeAudioStrategy = "auto";

export type { WebAbrWindow } from "./youtubePlayer";
export {
  getWebAbrResolvedAudioLanguage,
  type WebAbrResolvedAudioLanguage,
} from "./youtubeSabrSupport";

const WEB_ABR_DOWNLOAD_QUEUE = new Map<string, Promise<void>>();

/**
 * Serialize concurrent web_abr downloads for the same video.
 *
 * If VOT accidentally calls web_abr twice for one video, the second call waits
 * until the first generator is completely finished before it starts resolving
 * clients/media URLs or issuing media requests. Calls for different videos can
 * still run independently.
 */
const PURE_SABR_COLD_RETRY_DELAY_MS = 750;
const PURE_SABR_MAX_ATTEMPTS = 2;
const PURE_SABR_RELOAD_KEY_PREFIX = "vot:pure-sabr-recovery-reload:";

function isDeterministicPureSabrError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("SABR could not resolve requested audio language") ||
    message.includes("SABR found no VOT-supported audio track") ||
    (message.includes("SABR audio language") &&
      message.includes("is ambiguous")) ||
    message.includes("refusing array[0] fallback")
  );
}

function pureSabrReloadStorage(
  targetWindow: WebAbrWindow,
): Storage | undefined {
  try {
    return getTopPageWindow(targetWindow).sessionStorage;
  } catch {
    try {
      return targetWindow.sessionStorage;
    } catch {
      return undefined;
    }
  }
}

function clearPureSabrReloadGuard(
  targetWindow: WebAbrWindow,
  videoId: string,
): void {
  try {
    pureSabrReloadStorage(targetWindow)?.removeItem(
      `${PURE_SABR_RELOAD_KEY_PREFIX}${videoId}`,
    );
  } catch {}
}

function reloadPageOnceForPureSabr(
  targetWindow: WebAbrWindow,
  videoId: string,
  error: unknown,
): boolean {
  const storage = pureSabrReloadStorage(targetWindow);
  const key = `${PURE_SABR_RELOAD_KEY_PREFIX}${videoId}`;
  if (!storage) return false;
  try {
    if (storage.getItem(key)) return false;
    storage.setItem(key, String(Date.now()));
    debug.log(
      "[FORK][SABR][PURE_ONLY] cold retry exhausted; reloading page once",
      {
        videoId,
        error: error instanceof Error ? error.message : String(error),
      },
    );
    getTopPageWindow(targetWindow).location.reload();
    return true;
  } catch {
    return false;
  }
}

export async function* getWebAbrAudioChunks(
  targetWindow: WebAbrWindow,
  videoId: string,
  signal: AbortSignal,
  transportStartIndex = 0,
  sourceLanguage?: string,
): AsyncGenerator<AudioChunk> {
  void transportStartIndex;

  // Preflight against the track the native player is actually playing. This is
  // intentionally outside all SABR/WEB_CREATOR fallback catches: a proven
  // unsupported or mismatched language must not fall through to another
  // downloader and upload the same wrong audio.
  assertYouTubeAudioIsUsefulForVot(targetWindow, videoId, sourceLanguage);

  const queueKey = String(videoId);
  const previous = WEB_ABR_DOWNLOAD_QUEUE.get(queueKey) ?? Promise.resolve();

  let releaseCurrent: (() => void) | undefined;
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  WEB_ABR_DOWNLOAD_QUEUE.set(queueKey, current);

  try {
    await previous;
    signal.throwIfAborted();

    let lastPureError: unknown;

    if (YOUTUBE_AUDIO_STRATEGY !== "web_creator") {
      for (let attempt = 1; attempt <= PURE_SABR_MAX_ATTEMPTS; attempt++) {
        // Transactional attempt: do not expose any bytes to the uploader until
        // SabrStream reaches EOF and trySabrAudioChunks validates the complete
        // representation. This is essential for recovery from a late premature
        // EOF: an incomplete attempt can now be discarded and cold-retried from
        // byte zero without duplicating already-uploaded audio.
        const attemptChunks: AudioChunk[] = [];
        let attemptBytes = 0;
        try {
          for await (const chunk of trySabrAudioChunks(
            targetWindow,
            videoId,
            signal,
            sourceLanguage,
          )) {
            const copy = new Uint8Array(chunk.buffer.byteLength);
            copy.set(chunk.buffer);
            attemptChunks.push({
              buffer: copy,
              isLastChunk: chunk.isLastChunk,
            });
            attemptBytes += copy.byteLength;
          }

          if (attemptChunks.length > 0) {
            debug.log(
              "[FORK][SABR][PURE_ONLY] validated complete SABR attempt",
              {
                videoId,
                attempt,
                chunks: attemptChunks.length,
                bytes: attemptBytes,
              },
            );
            clearPureSabrReloadGuard(targetWindow, videoId);
            for (const chunk of attemptChunks) yield chunk;
            return;
          }
          lastPureError = new Error(
            "Audio downloader. PURE SABR completed without audio chunks",
          );
        } catch (error) {
          signal.throwIfAborted();
          lastPureError = error;
          debug.log(
            "[FORK][SABR][PURE_ONLY] discarding incomplete SABR attempt",
            {
              videoId,
              attempt,
              bufferedChunks: attemptChunks.length,
              bufferedBytes: attemptBytes,
              error: error instanceof Error ? error.message : String(error),
            },
          );
        }

        const deterministic = isDeterministicPureSabrError(lastPureError);
        if (attempt < PURE_SABR_MAX_ATTEMPTS && !deterministic) {
          debug.log(
            "[FORK][SABR][PURE_ONLY] transient failure before first chunk; cold retrying",
            {
              videoId,
              attempt,
              nextAttempt: attempt + 1,
              delayMs: PURE_SABR_COLD_RETRY_DELAY_MS,
              error:
                lastPureError instanceof Error
                  ? lastPureError.message
                  : String(lastPureError),
            },
          );
          await createAbortableDelay(PURE_SABR_COLD_RETRY_DELAY_MS, signal);
          continue;
        }

        if (
          !deterministic &&
          reloadPageOnceForPureSabr(targetWindow, videoId, lastPureError)
        ) {
          // Navigation will tear this execution context down. Do not start the
          // non-SABR fallback in parallel with the page reload.
          return;
        }
        break;
      }

      if (YOUTUBE_AUDIO_STRATEGY === "sabr") {
        throw lastPureError instanceof Error
          ? lastPureError
          : new Error("Audio downloader. SABR failed");
      }

      debug.log(
        "[FORK][SABR][PURE_ONLY] recovery exhausted; falling back to non-SABR WEB_CREATOR",
        {
          videoId,
          error:
            lastPureError instanceof Error
              ? lastPureError.message
              : String(lastPureError),
        },
      );
    } else {
      debug.log("[FORK][WEB_CREATOR] SABR disabled by strategy switch", {
        videoId,
      });
    }

    yield* getWebCreatorAudioChunks(
      targetWindow,
      videoId,
      signal,
      sourceLanguage,
    );
  } finally {
    releaseCurrent?.();
    if (WEB_ABR_DOWNLOAD_QUEUE.get(queueKey) === current) {
      WEB_ABR_DOWNLOAD_QUEUE.delete(queueKey);
    }
  }
}
