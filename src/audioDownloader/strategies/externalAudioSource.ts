import { AudioDownloadType } from "@vot.js/core/types/yandex";
import { config } from "@vot.js/shared";
import type { GetAudioFromAPIOptions } from "../../types/audioDownloader";
import { makeFileId } from "./fileId";

export const EXTERNAL_AUDIO_SOURCE_STRATEGY =
  "youtube_external_source" as const;

export type ExternalAudioSourceProvider = {
  getAudioStream(input: {
    videoId: string;
    signal: AbortSignal;
  }): Promise<ReadableStream<Uint8Array>>;
};

declare global {
  var VOT_AUDIO_SOURCE_PROVIDER: ExternalAudioSourceProvider | undefined;
}

export async function getAudioFromExternalProvider({
  videoId,
  signal,
}: GetAudioFromAPIOptions) {
  const provider = globalThis.VOT_AUDIO_SOURCE_PROVIDER;
  if (!provider?.getAudioStream) {
    throw new Error("External AudioSourceProvider is not installed");
  }
  const stream = await provider.getAudioStream({ videoId, signal });
  if (!(stream instanceof ReadableStream)) {
    throw new Error("External AudioSourceProvider returned no ReadableStream");
  }

  return {
    sourceMethod: "external-provider" as const,
    fileId: makeFileId(
      AudioDownloadType.WEB_API_SLOW,
      0,
      "0",
      config.minChunkSize,
    ),
    mediaPartsLength: null,
    async *getMediaBuffers() {
      const reader = stream.getReader();
      let pending: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (!value?.byteLength) continue;
          pending.push(value);
          size += value.byteLength;
          if (size >= config.minChunkSize) {
            yield { buffer: concat(pending), isLastChunk: false };
            pending = [];
            size = 0;
          }
        }
        if (!pending.length) throw new Error("External audio stream was empty");
        yield { buffer: concat(pending), isLastChunk: true };
      } finally {
        reader.releaseLock();
      }
    },
  };
}

function concat(parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(
    parts.reduce((sum, part) => sum + part.byteLength, 0),
  );
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}
