import { config } from "@vot.js/shared";
import type { GetAudioFromAPIOptions } from "../../types/audioDownloader";
import { GM_fetch } from "../../utils/gm";

export const YOUTUBE_EXTERNAL_PROVIDER_STRATEGY =
  "youtube_external_provider" as const;

type ProviderChunk =
  | Uint8Array
  | ArrayBuffer
  | { buffer: Uint8Array | ArrayBuffer; isLastChunk?: boolean };
export type YoutubeExternalAudioSource = {
  url?: string;
  fileId?: string;
  stream?: AsyncIterable<ProviderChunk>;
  getMediaBuffers?: () => AsyncIterable<ProviderChunk>;
};
export interface YoutubeAudioSourceProvider {
  getAudioSource(input: {
    videoId: string;
    signal: AbortSignal;
  }): Promise<YoutubeExternalAudioSource | null>;
}

type ProviderGlobal = typeof globalThis & {
  __VOT_YOUTUBE_AUDIO_SOURCE_PROVIDER__?: YoutubeAudioSourceProvider;
  unsafeWindow?: {
    __VOT_YOUTUBE_AUDIO_SOURCE_PROVIDER__?: YoutubeAudioSourceProvider;
  };
};

function provider(): YoutubeAudioSourceProvider | undefined {
  const root = globalThis as ProviderGlobal;
  if (root.__VOT_YOUTUBE_AUDIO_SOURCE_PROVIDER__?.getAudioSource)
    return root.__VOT_YOUTUBE_AUDIO_SOURCE_PROVIDER__;
  try {
    if (
      root.unsafeWindow?.__VOT_YOUTUBE_AUDIO_SOURCE_PROVIDER__?.getAudioSource
    )
      return root.unsafeWindow.__VOT_YOUTUBE_AUDIO_SOURCE_PROVIDER__;
  } catch {
    /* isolated world */
  }
  return undefined;
}

function normalizeChunk(value: ProviderChunk): {
  buffer: Uint8Array;
  isLastChunk?: boolean;
} {
  if (value instanceof Uint8Array) return { buffer: value };
  if (value instanceof ArrayBuffer) return { buffer: new Uint8Array(value) };
  return {
    buffer:
      value.buffer instanceof Uint8Array
        ? value.buffer
        : new Uint8Array(value.buffer),
    isLastChunk: value.isLastChunk,
  };
}

async function* streamFromProvider(
  source: YoutubeExternalAudioSource,
): AsyncGenerator<{ buffer: Uint8Array; isLastChunk: boolean }> {
  const iterable = source.getMediaBuffers?.() ?? source.stream;
  if (!iterable)
    throw new Error("External provider returned neither URL nor stream");
  let previous: { buffer: Uint8Array; isLastChunk?: boolean } | undefined;
  for await (const raw of iterable) {
    const current = normalizeChunk(raw);
    if (previous) yield { buffer: previous.buffer, isLastChunk: false };
    previous = current;
  }
  if (!previous) throw new Error("External provider stream was empty");
  yield { buffer: previous.buffer, isLastChunk: true };
}

async function* streamUrl(
  url: string,
  signal: AbortSignal,
): AsyncGenerator<{ buffer: Uint8Array; isLastChunk: boolean }> {
  const response = await GM_fetch(url, {
    signal,
    forceGmXhr: true,
    timeout: 30_000,
  });
  if (!response.ok)
    throw new Error(`External provider URL failed: ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.byteLength)
    throw new Error("External provider URL returned empty body");
  const size = config.minChunkSize;
  for (let offset = 0; offset < bytes.byteLength; offset += size) {
    const end = Math.min(bytes.byteLength, offset + size);
    yield {
      buffer: bytes.subarray(offset, end),
      isLastChunk: end >= bytes.byteLength,
    };
  }
}

export async function getAudioFromExternalProvider({
  videoId,
  signal,
}: GetAudioFromAPIOptions) {
  const active = provider();
  if (!active) throw new Error("External audio provider is not installed");
  const source = await active.getAudioSource({ videoId, signal });
  if (!source) throw new Error("External audio provider returned no source");
  console.log("[VOT][external-audio-provider] selected", {
    videoId,
    hasUrl: Boolean(source.url),
    hasStream: Boolean(source.stream || source.getMediaBuffers),
  });
  return {
    fileId:
      source.fileId ||
      `random-${YOUTUBE_EXTERNAL_PROVIDER_STRATEGY}-${crypto.randomUUID()}`,
    mediaPartsLength: null,
    getMediaBuffers: () =>
      source.url ? streamUrl(source.url, signal) : streamFromProvider(source),
  };
}
