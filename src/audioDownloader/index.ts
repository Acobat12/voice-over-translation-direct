import { EventImpl } from "../core/eventImpl";
import type {
  AudioDownloadRequestOptions,
  DownloadedAudioData,
  DownloadedPartialAudioData,
} from "../types/audioDownloader";
import debug from "../utils/debug";

import {
  type AvailableAudioDownloadType,
  SABR_STRATEGY,
  strategies,
  WEB_ABR_STRATEGY,
  WEB_MSE_PROXY_STRATEGY,
} from "./strategies";
import type { AudioChunk } from "./strategies/audioChunks";
export const LOCAL_FILE_STRATEGY = "localFile";

type AudioDownloadEvents = {
  downloadedAudio: [translationId: string, data: DownloadedAudioData];
  downloadedPartialAudio: [
    translationId: string,
    data: DownloadedPartialAudioData,
  ];
  downloadAudioError: [
    translationId: string,
    videoId: string,
    signInSuggested: boolean,
  ];
};

const FALLBACK_STRATEGIES: Partial<
  Record<AvailableAudioDownloadType, readonly AvailableAudioDownloadType[]>
> = {
  [SABR_STRATEGY]: [
    SABR_STRATEGY,
    WEB_ABR_STRATEGY,
    WEB_MSE_PROXY_STRATEGY,
    "ytAudio",
  ],
  [WEB_ABR_STRATEGY]: [
    WEB_ABR_STRATEGY,
    SABR_STRATEGY,
    WEB_MSE_PROXY_STRATEGY,
    "ytAudio",
  ],
  [WEB_MSE_PROXY_STRATEGY]: [WEB_MSE_PROXY_STRATEGY, "ytAudio"],
};

function assertValidMediaPartsLength(mediaPartsLength: number | null): void {
  if (mediaPartsLength === null) return;
  if (!Number.isInteger(mediaPartsLength) || mediaPartsLength < 1) {
    throw new Error("Audio downloader. Invalid media parts length");
  }
}

function assertHasAudioChunk(chunk: Uint8Array | undefined): Uint8Array {
  if (!chunk || chunk.byteLength === 0) {
    throw new Error("Audio downloader. Empty audio");
  }
  return chunk;
}

async function handleCommonAudioDownloadRequest({
  audioDownloader,
  attemptedStrategy = audioDownloader.strategy,
  translationId,
  videoId,
  signal,
  preferredVideo,
  webAbrTransportStartIndex = 0,
  sourceLanguage,
  onChunkCommitted,
}: AudioDownloadRequestOptions & {
  attemptedStrategy?: AvailableAudioDownloadType;
  webAbrTransportStartIndex?: number;
  sourceLanguage?: string;
  onChunkCommitted?: () => void;
}) {
  const audioData = await strategies[attemptedStrategy]({
    videoId,
    signal,
    preferredVideo,
    webAbrTransportStartIndex,
    sourceLanguage,
  } as any);
  if (!audioData) {
    throw new Error("Audio downloader. Can not get audio data");
  }

  debug.log("Audio downloader. Url found", {
    audioDownloadType: attemptedStrategy,
  });

  const { getMediaBuffers, mediaPartsLength, fileId } = audioData;
  assertValidMediaPartsLength(mediaPartsLength);

  if (mediaPartsLength === 1) {
    const iterator = getMediaBuffers();
    try {
      const { value } = (await iterator.next()) as { value: Uint8Array };
      const singleChunk = assertHasAudioChunk(value);
      onChunkCommitted?.();
      await audioDownloader.onDownloadedAudio.dispatchAsync(translationId, {
        videoId,
        fileId,
        audioData: singleChunk,
      });
    } finally {
      await iterator.return?.(undefined);
    }
    return;
  }

  let index = 0;
  let receivedLastChunk = false;
  for await (const rawChunk of getMediaBuffers() as AsyncIterable<
    Uint8Array | AudioChunk
  >) {
    const wrapped =
      rawChunk instanceof Uint8Array
        ? { buffer: rawChunk, isLastChunk: false }
        : rawChunk;
    const chunk =
      mediaPartsLength === null && wrapped.isLastChunk && index > 0
        ? wrapped.buffer
        : assertHasAudioChunk(wrapped.buffer);

    onChunkCommitted?.();
    await audioDownloader.onDownloadedPartialAudio.dispatchAsync(
      translationId,
      {
        videoId,
        fileId,
        audioData: chunk,
        version: 1,
        index,
        amount: mediaPartsLength ?? (wrapped.isLastChunk ? index + 1 : 0),
      },
    );

    receivedLastChunk ||= wrapped.isLastChunk;
    index += 1;
  }

  if (mediaPartsLength === null && !receivedLastChunk) {
    throw new Error("Audio downloader. Stream ended without a last chunk");
  }
  if (mediaPartsLength !== null && index !== mediaPartsLength) {
    throw new Error(
      `Audio downloader. Expected ${mediaPartsLength} chunks, got ${index}`,
    );
  }
}

export class AudioDownloader {
  onDownloadedAudio = new EventImpl<AudioDownloadEvents["downloadedAudio"]>();
  onDownloadedPartialAudio = new EventImpl<
    AudioDownloadEvents["downloadedPartialAudio"]
  >();
  onDownloadAudioError = new EventImpl<
    AudioDownloadEvents["downloadAudioError"]
  >();

  strategy: AvailableAudioDownloadType;

  constructor(strategy: AvailableAudioDownloadType = SABR_STRATEGY) {
    this.strategy = strategy;
    debug.log("Audio downloader created", {
      strategy,
    });
  }

  async runAudioDownload(
    videoId: string,
    translationId: string,
    signal: AbortSignal,
    preferredVideo?: HTMLVideoElement | null,
    webAbrTransportStartIndex = 0,
    sourceLanguage?: string,
  ) {
    // Never start a new strategy after streaming has reached the translation API:
    // mixing chunks from different audio sources corrupts the upload.
    const attempts = FALLBACK_STRATEGIES[this.strategy] ?? [this.strategy];
    let chunksCommitted = false;

    for (const attemptedStrategy of attempts) {
      try {
        await handleCommonAudioDownloadRequest({
          audioDownloader: this,
          attemptedStrategy,
          translationId,
          videoId,
          signal,
          preferredVideo,
          webAbrTransportStartIndex,
          sourceLanguage,
          onChunkCommitted: () => {
            chunksCommitted = true;
          },
        });

        debug.log("Audio downloader. Audio download finished", {
          videoId,
          audioDownloadType: attemptedStrategy,
        });
        return;
      } catch (err) {
        // Only stop the whole download when OUR translation signal was actually
        // cancelled. A strategy/bridge may throw an AbortError for its own
        // internal request (for example when WEB_ABR switches/restarts a
        // transport). Treating every AbortError as cancellation leaves the
        // translation handler waiting forever with `downloading === true`.
        if (signal.aborted) {
          debug.log("Audio downloader. Audio download aborted", {
            videoId,
            audioDownloadType: attemptedStrategy,
            reason: "translation-signal-aborted",
          });
          return;
        }

        // Match original VOT UX: when WEB_ABR explicitly determines that the
        // current YouTube session must be signed in, surface that state on the
        // translation button instead of reporting a generic audio failure or
        // sending fail-audio-js.
        if (
          (attemptedStrategy === WEB_ABR_STRATEGY ||
            attemptedStrategy === SABR_STRATEGY) &&
          err instanceof Error &&
          err.message.includes("YOUTUBE_SIGN_IN_SUGGESTED")
        ) {
          this.onDownloadAudioError.dispatch(translationId, videoId, true);
          return;
        }

        debug.error("Audio downloader. Strategy failed", {
          videoId,
          audioDownloadType: attemptedStrategy,
          error: err instanceof Error ? err.message : String(err),
        });
        if (chunksCommitted) {
          debug.error(
            "Audio downloader. Cannot safely fall back after audio chunks were emitted",
            { videoId },
          );
          break;
        }
      }
    }

    debug.error("Audio downloader. All audio download strategies failed", {
      videoId,
    });
    this.onDownloadAudioError.dispatch(translationId, videoId, false);
  }

  private getEvent<Type extends keyof AudioDownloadEvents>(type: Type) {
    const events: {
      [Key in keyof AudioDownloadEvents]: EventImpl<AudioDownloadEvents[Key]>;
    } = {
      downloadedAudio: this.onDownloadedAudio,
      downloadedPartialAudio: this.onDownloadedPartialAudio,
      downloadAudioError: this.onDownloadAudioError,
    };
    return events[type];
  }

  addEventListener<Type extends keyof AudioDownloadEvents>(
    type: Type,
    listener: (...data: AudioDownloadEvents[Type]) => void,
  ): this {
    this.getEvent(type)?.addListener(listener);
    return this;
  }

  removeEventListener<Type extends keyof AudioDownloadEvents>(
    type: Type,
    listener: (...data: AudioDownloadEvents[Type]) => void,
  ): this {
    this.getEvent(type)?.removeListener(listener);
    return this;
  }
}
