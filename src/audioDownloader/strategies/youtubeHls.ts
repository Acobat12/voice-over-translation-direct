import { AudioDownloadType } from "@vot.js/core/types/yandex";
import { config } from "@vot.js/shared";

import type { GetAudioFromAPIOptions } from "../../types/audioDownloader";
import { GM_fetch } from "../../utils/gm";
import { makeFileId } from "./fileId";

export const YOUTUBE_HLS_STRATEGY = "youtube_hls" as const;

function findManifest(videoId: string): string | null {
  const candidates: unknown[] = [];
  try {
    candidates.push((globalThis as any).ytInitialPlayerResponse);
    const player = document.querySelector("#movie_player") as any;
    candidates.push(player?.getPlayerResponse?.());
  } catch {}
  for (const value of candidates) {
    const response = value as any;
    if (
      response?.videoDetails?.videoId === videoId &&
      typeof response?.streamingData?.hlsManifestUrl === "string"
    )
      return response.streamingData.hlsManifestUrl;
  }
  return null;
}

function resolveLines(text: string, base: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => new URL(line, base).href);
}

async function fetchText(url: string, signal: AbortSignal): Promise<string> {
  const response = await GM_fetch(url, { signal, forceGmXhr: true });
  if (!response.ok)
    throw new Error(`YouTube HLS request failed: ${response.status}`);
  return await response.text();
}

export async function getAudioFromYouTubeHls({
  videoId,
  signal,
}: GetAudioFromAPIOptions) {
  const manifestUrl = findManifest(videoId);
  if (!manifestUrl)
    throw new Error("Active YouTube player exposes no HLS manifest");
  let mediaUrl = manifestUrl;
  let playlist = await fetchText(mediaUrl, signal);
  if (playlist.includes("#EXT-X-STREAM-INF")) {
    const variants = resolveLines(playlist, mediaUrl);
    if (!variants.length)
      throw new Error("YouTube HLS master playlist has no variants");
    mediaUrl = variants[0] as string;
    playlist = await fetchText(mediaUrl, signal);
  }
  if (/^#EXT-X-KEY:(?!.*METHOD=NONE)/m.test(playlist)) {
    throw new Error("Encrypted YouTube HLS is not supported by this strategy");
  }
  const segments = resolveLines(playlist, mediaUrl);
  if (!segments.length)
    throw new Error("YouTube HLS playlist has no media segments");

  return {
    sourceMethod: "youtube-hls" as const,
    fileId: makeFileId(
      AudioDownloadType.WEB_API_SLOW,
      0,
      "0",
      config.minChunkSize,
    ),
    mediaPartsLength: null,
    async *getMediaBuffers() {
      let pending: Uint8Array[] = [];
      let size = 0;
      for (const segmentUrl of segments) {
        const response = await GM_fetch(segmentUrl, {
          signal,
          forceGmXhr: true,
        });
        if (!response.ok)
          throw new Error(`YouTube HLS segment failed: ${response.status}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (!bytes.byteLength) continue;
        pending.push(bytes);
        size += bytes.byteLength;
        if (size >= config.minChunkSize) {
          yield { buffer: concat(pending), isLastChunk: false };
          pending = [];
          size = 0;
        }
      }
      if (!pending.length) throw new Error("YouTube HLS stream was empty");
      yield { buffer: concat(pending), isLastChunk: true };
    },
  };
}

function concat(parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(
    parts.reduce((sum, part) => sum + part.byteLength, 0),
  );
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}
