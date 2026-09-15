import type { GetAudioFromAPIOptions } from "../../types/audioDownloader";
import debug from "../../utils/debug";
import { getAudioFromYtAudio } from "../ytAudio/strategy";
import { getAudioFromWebMseProxy } from "./webMseProxy";

export const YOUTUBE_SMART_STRATEGY = "youtubeSmart" as const;

type StreamChunk = Uint8Array | { buffer: Uint8Array; isLastChunk: boolean };

/**
 * YouTube source-audio strategy.
 *
 * Modern YouTube commonly exposes only player-managed/SABR media, so a direct
 * googlevideo URL is not guaranteed to exist.  The first choice is therefore
 * the MSE capture bridge running in a muted YouTube embed.  If the bridge
 * cannot start before producing any bytes, fall back to the legacy ytAudio
 * resolver (direct player URL / progressive MP4 / captureStream where usable).
 *
 * Keeping the fallback inside the generator is important: MSE failures happen
 * while the stream is being consumed, not while getAudioFromWebMseProxy()
 * creates its descriptor.
 */
export async function getAudioFromYoutubeSmart(
  options: GetAudioFromAPIOptions,
) {
  const mse = await getAudioFromWebMseProxy(options);

  return {
    fileId: `random-${YOUTUBE_SMART_STRATEGY}-${crypto.randomUUID()}`,
    mediaPartsLength: null,
    async *getMediaBuffers(): AsyncGenerator<StreamChunk> {
      let mseProducedBytes = false;

      try {
        for await (const raw of mse.getMediaBuffers() as AsyncIterable<StreamChunk>) {
          const bytes = raw instanceof Uint8Array ? raw : raw.buffer;
          if (bytes.byteLength > 0) mseProducedBytes = true;
          yield raw;
        }
        return;
      } catch (error) {
        if (mseProducedBytes) {
          // We cannot safely switch sources after upload has already started:
          // the backend would receive two different media streams under one id.
          throw error;
        }

        debug.log(
          "Audio downloader. YouTube MSE bridge unavailable; trying ytAudio fallback",
          {
            videoId: options.videoId,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }

      const fallback = await getAudioFromYtAudio(options);
      let index = 0;
      const knownParts = fallback.mediaPartsLength;

      for await (const raw of fallback.getMediaBuffers() as AsyncIterable<StreamChunk>) {
        if (!(raw instanceof Uint8Array)) {
          yield raw;
          if (raw.isLastChunk) return;
          index += 1;
          continue;
        }

        const isLastChunk =
          knownParts !== null && knownParts !== undefined
            ? index >= knownParts - 1
            : false;
        yield { buffer: raw, isLastChunk };
        index += 1;
      }

      // Unknown-length fallbacks are expected to mark their own final chunk.
      // Known-length fallbacks are marked above. If a malformed implementation
      // yielded no explicit end marker, fail rather than silently hanging the
      // translation request.
      if (knownParts === null || knownParts === undefined) {
        throw new Error(
          "Audio downloader. YouTube fallback ended without a last chunk",
        );
      }
    },
  };
}
