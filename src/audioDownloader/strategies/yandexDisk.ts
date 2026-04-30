import type { GetAudioFromAPIOptions } from "../../types/audioDownloader";
import debug from "../../utils/debug";

function makeSimpleFileId(size: number, chunkSize: number): string {
  return `yadisk_${size}_${chunkSize}_${Date.now()}`;
}

export async function getAudioFromYandexDisk({
  videoId,
  signal,
}: GetAudioFromAPIOptions) {
  const video = document.querySelector("video");

  if (!(video instanceof HTMLVideoElement)) {
    throw new Error("[VOT] Yandex Disk: video element not found");
  }

  const src = video.currentSrc || video.src;
  debug.log("[VOT] Yandex Disk strategy video src:", src);

  if (!src) {
    throw new Error("[VOT] Yandex Disk: empty video src");
  }

  const response = await fetch(src, { signal });

  if (!response.ok) {
    throw new Error(
      `[VOT] Yandex Disk: failed to fetch media source: ${response.status}`,
    );
  }
  debug.log("[VOT] Yandex Disk strategy videoId:", videoId);
  debug.log("[VOT] Yandex Disk strategy currentSrc:", video.currentSrc);
  debug.log("[VOT] Yandex Disk strategy src:", video.src);
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  if (!bytes.byteLength) {
    throw new Error("[VOT] Yandex Disk: empty audio/video bytes");
  }

  const chunkSize = 256 * 1024;
  const mediaPartsLength = Math.max(1, Math.ceil(bytes.byteLength / chunkSize));
  const fileId = makeSimpleFileId(bytes.byteLength, chunkSize);

  debug.log("[VOT] Yandex Disk strategy bytes:", bytes.byteLength);
  debug.log("[VOT] Yandex Disk strategy mediaPartsLength:", mediaPartsLength);

  return {
    fileId,
    mediaPartsLength,
    async *getMediaBuffers(): AsyncGenerator<Uint8Array> {
      for (let start = 0; start < bytes.byteLength; start += chunkSize) {
        const end = Math.min(start + chunkSize, bytes.byteLength);
        yield bytes.subarray(start, end);
      }
    },
  };
}
