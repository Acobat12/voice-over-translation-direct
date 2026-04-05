import { GM_fetch } from "../../utils/gm";

function makeSimpleFileId(size: number, chunkSize: number): string {
  return `local_${size}_${chunkSize}_${Date.now()}`;
}

async function fetchLocalMedia(
  src: string,
  signal: AbortSignal,
): Promise<Response> {
  if (!src) {
    throw new Error("[VOT] Local file: empty media src");
  }

  // blob: лучше читать обычным fetch
  if (src.startsWith("blob:")) {
    const res = await fetch(src, { signal });
    if (!res.ok) {
      throw new Error(
        `[VOT] Local file: failed to fetch blob media: ${res.status}`,
      );
    }
    return res;
  }

  // Сначала пробуем обычный fetch — для localhost / same-origin это часто ок.
  try {
    const res = await fetch(src, { signal });
    if (res.ok) {
      return res;
    }
  } catch {
    // fallback ниже
  }

  // Потом fallback через GM_fetch — часто спасает localhost / CORS.
  const gmRes = await GM_fetch(src, { signal, timeout: 0 });
  if (!gmRes.ok) {
    throw new Error(
      `[VOT] Local file: failed to fetch media source: ${gmRes.status}`,
    );
  }

  return gmRes;
}

export async function getAudioFromLocalFile({
  signal,
}: {
  signal: AbortSignal;
}) {
  const video = document.querySelector("video");

  if (!(video instanceof HTMLVideoElement)) {
    throw new Error("[VOT] Local file: video element not found");
  }

  const sourceEl = video.querySelector("source");
  const src =
    video.currentSrc ||
    video.src ||
    sourceEl?.src ||
    sourceEl?.getAttribute("src") ||
    "";

  if (!src) {
    throw new Error("[VOT] Local file: empty video src");
  }

  const response = await fetchLocalMedia(src, signal);
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  if (!bytes.byteLength) {
    throw new Error("[VOT] Local file: empty media bytes");
  }

  const chunkSize = 256 * 1024;
  const mediaPartsLength = Math.max(1, Math.ceil(bytes.byteLength / chunkSize));
  const fileId = makeSimpleFileId(bytes.byteLength, chunkSize);

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