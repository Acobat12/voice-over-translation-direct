import { EventImpl } from "../core/eventImpl";
import type {
  AudioDownloadRequestOptions,
  DownloadedAudioData,
  DownloadedPartialAudioData,
} from "../types/audioDownloader";
import debug from "../utils/debug";
import { isAbortError } from "../utils/errors";

import {
  type AvailableAudioDownloadType,
  strategies,
  WEB_ABR_STRATEGY,
  WEB_MSE_PROXY_STRATEGY,
} from "./strategies";
export const LOCAL_FILE_STRATEGY = "localFile";
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
}: AudioDownloadRequestOptions & {
  attemptedStrategy?: AvailableAudioDownloadType;
  webAbrTransportStartIndex?: number;
}) {
  const audioData = await strategies[attemptedStrategy]({
    videoId,
    signal,
    preferredVideo,
    webAbrTransportStartIndex,
  } as any);
  if (!audioData) {
    throw new Error("Audio downloader. Can not get audio data");
  }

  debug.log("Audio downloader. Url found", {
    audioDownloadType: attemptedStrategy,
  });

  const { getMediaBuffers, mediaPartsLength, fileId } = audioData;
  assertValidMediaPartsLength(mediaPartsLength);

  if (mediaPartsLength === null) {
    let index = 0;
    let receivedLastChunk = false;

    for await (const rawChunk of getMediaBuffers() as AsyncIterable<
      Uint8Array | { buffer: Uint8Array; isLastChunk: boolean }
    >) {
      const wrapped =
        rawChunk instanceof Uint8Array
          ? { buffer: rawChunk, isLastChunk: false }
          : rawChunk;
      const chunk =
        wrapped.isLastChunk && index > 0
          ? wrapped.buffer
          : assertHasAudioChunk(wrapped.buffer);

      await audioDownloader.onDownloadedPartialAudio.dispatchAsync(
        translationId,
        {
          videoId,
          fileId,
          audioData: chunk,
          version: 1,
          index,
          amount: wrapped.isLastChunk ? index + 1 : 0,
        },
      );

      receivedLastChunk ||= wrapped.isLastChunk;
      index += 1;
    }

    if (!receivedLastChunk) {
      throw new Error("Audio downloader. Stream ended without a last chunk");
    }
    return;
  }

  if (mediaPartsLength < 2) {
    const iterator = getMediaBuffers();
    const { value } = (await iterator.next()) as { value: Uint8Array };
    const singleChunk = assertHasAudioChunk(value);

    await audioDownloader.onDownloadedAudio.dispatchAsync(translationId, {
      videoId,
      fileId,
      audioData: singleChunk,
    });
    return;
  }

  let index = 0;
  for await (const audioChunk of getMediaBuffers()) {
    const chunk = assertHasAudioChunk(audioChunk as Uint8Array);

    await audioDownloader.onDownloadedPartialAudio.dispatchAsync(
      translationId,
      {
        videoId,
        fileId,
        audioData: chunk,
        version: 1,
        index,
        amount: mediaPartsLength,
      },
    );

    index++;
  }

  if (index !== mediaPartsLength) {
    throw new Error(
      `Audio downloader. Expected ${mediaPartsLength} chunks, got ${index}`,
    );
  }
}

export class AudioDownloader {
  onDownloadedAudio = new EventImpl<[string, DownloadedAudioData]>();
  onDownloadedPartialAudio = new EventImpl<
    [string, DownloadedPartialAudioData]
  >();
  onDownloadAudioError = new EventImpl<[string, string]>();

  strategy: AvailableAudioDownloadType;

  constructor(strategy: AvailableAudioDownloadType = WEB_ABR_STRATEGY) {
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
  ) {
    const attempts: AvailableAudioDownloadType[] =
      this.strategy === WEB_ABR_STRATEGY
        ? [WEB_ABR_STRATEGY, WEB_MSE_PROXY_STRATEGY]
        : [this.strategy];

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
        });

        debug.log("Audio downloader. Audio download finished", {
          videoId,
          audioDownloadType: attemptedStrategy,
        });
        return;
      } catch (err) {
        if (signal.aborted || isAbortError(err)) {
          debug.log("Audio downloader. Audio download aborted", {
            videoId,
            audioDownloadType: attemptedStrategy,
          });
          return;
        }

        debug.error("Audio downloader. Strategy failed", {
          videoId,
          audioDownloadType: attemptedStrategy,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    debug.error("Audio downloader. All audio download strategies failed", {
      videoId,
    });
    this.onDownloadAudioError.dispatch(translationId, videoId);
  }

  addEventListener(
    type: "downloadedAudio",
    listener: (translationId: string, data: DownloadedAudioData) => void,
  ): this;
  addEventListener(
    type: "downloadedPartialAudio",
    listener: (translationId: string, data: DownloadedPartialAudioData) => void,
  ): this;
  addEventListener(
    type: "downloadAudioError",
    listener: (translationId: string, videoId: string) => void,
  ): this;
  addEventListener(
    type: "downloadedAudio" | "downloadedPartialAudio" | "downloadAudioError",
    listener: (...data: any[]) => void,
  ): this {
    switch (type) {
      case "downloadedAudio":
        this.onDownloadedAudio.addListener(listener);
        break;
      case "downloadedPartialAudio":
        this.onDownloadedPartialAudio.addListener(listener);
        break;
      case "downloadAudioError":
        this.onDownloadAudioError.addListener(listener);
        break;
    }

    return this;
  }

  removeEventListener(
    type: "downloadedAudio",
    listener: (translationId: string, data: DownloadedAudioData) => void,
  ): this;
  removeEventListener(
    type: "downloadedPartialAudio",
    listener: (translationId: string, data: DownloadedPartialAudioData) => void,
  ): this;
  removeEventListener(
    type: "downloadAudioError",
    listener: (translationId: string, videoId: string) => void,
  ): this;
  removeEventListener(
    type: "downloadedAudio" | "downloadedPartialAudio" | "downloadAudioError",
    listener: (...data: any[]) => void,
  ): this {
    switch (type) {
      case "downloadedAudio":
        this.onDownloadedAudio.removeListener(listener);
        break;
      case "downloadedPartialAudio":
        this.onDownloadedPartialAudio.removeListener(listener);
        break;
      case "downloadAudioError":
        this.onDownloadAudioError.removeListener(listener);
        break;
    }

    return this;
  }
}
