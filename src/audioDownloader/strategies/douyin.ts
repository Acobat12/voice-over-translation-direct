import type { GetAudioFromAPIOptions } from "../../types/audioDownloader";
import debug from "../../utils/debug";
import { GM_fetch } from "../../utils/gm";

function makeDouyinFileId(videoId: string, size: number, chunkSize: number) {
  return `douyin_${videoId}_${size}_${chunkSize}`;
}

async function fetchDouyinMedia(src: string, signal: AbortSignal) {
  try {
    const res = await fetch(src, { signal });
    if (res.ok) return res;
  } catch {}

  const gmRes = await GM_fetch(src, {
    signal,
    timeout: 0,
    forceGmXhr: true,
  });

  if (!gmRes.ok) {
    throw new Error(`[VOT] Douyin: failed to fetch media: ${gmRes.status}`);
  }

  return gmRes;
}

export async function getAudioFromDouyin({
  videoId,
  signal,
  preferredVideo,
}: GetAudioFromAPIOptions) {
  const video =
    preferredVideo instanceof HTMLVideoElement
      ? preferredVideo
      : document.querySelector("video");

  if (!(video instanceof HTMLVideoElement)) {
    throw new Error("[VOT] Douyin: video element not found");
  }

  const src = video.currentSrc || video.src;

  debug.log("[VOT] Douyin strategy src:", src);
  debug.log("[VOT] Douyin strategy videoId:", videoId);

  if (!src) {
    throw new Error("[VOT] Douyin: empty video src");
  }

  const response = await fetchDouyinMedia(src, signal);
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  if (!bytes.byteLength) {
    throw new Error("[VOT] Douyin: empty media bytes");
  }

  const chunkSize = 256 * 1024;
  const mediaPartsLength = Math.max(1, Math.ceil(bytes.byteLength / chunkSize));
  const fileId = makeDouyinFileId(videoId, bytes.byteLength, chunkSize);

  return {
    fileId,
    mediaPartsLength,
    async *getMediaBuffers(): AsyncGenerator<Uint8Array> {
      for (let start = 0; start < bytes.byteLength; start += chunkSize) {
        yield bytes.subarray(
          start,
          Math.min(start + chunkSize, bytes.byteLength),
        );
      }
    },
  };
}
