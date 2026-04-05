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

  if (src.startsWith("blob:")) {
    const res = await fetch(src, { signal });
    if (!res.ok) {
      throw new Error(
        `[VOT] Local file: failed to fetch blob media: ${res.status}`,
      );
    }
    return res;
  }

  try {
    const res = await fetch(src, { signal });
    if (res.ok) {
      return res;
    }
  } catch {
    // fallback ниже
  }

  const gmRes = await GM_fetch(src, { signal, timeout: 0 });
  if (!gmRes.ok) {
    throw new Error(
      `[VOT] Local file: failed to fetch media source: ${gmRes.status}`,
    );
  }

  return gmRes;
}

function getContentLength(response: Response): number | null {
  const raw =
    response.headers.get("content-length") ||
    response.headers.get("Content-Length");

  if (!raw) return null;

  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : null;
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

  const chunkSize = 256 * 1024;
  const contentLength = getContentLength(response);

  if (response.body && contentLength) {
    const mediaPartsLength = Math.max(
      1,
      Math.ceil(contentLength / chunkSize),
    );
    const fileId = makeSimpleFileId(contentLength, chunkSize);

    return {
      fileId,
      mediaPartsLength,
      async *getMediaBuffers(): AsyncGenerator<Uint8Array> {
        const reader = response.body!.getReader();
        let pending = new Uint8Array(0);

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!value || !value.byteLength) continue;

            let merged: Uint8Array;
            if (pending.byteLength === 0) {
              merged = value;
            } else {
              merged = new Uint8Array(pending.byteLength + value.byteLength);
              merged.set(pending, 0);
              merged.set(value, pending.byteLength);
            }

            let offset = 0;
            while (merged.byteLength - offset >= chunkSize) {
              yield merged.subarray(offset, offset + chunkSize);
              offset += chunkSize;
            }

            pending =
              offset < merged.byteLength
                ? merged.slice(offset)
                : new Uint8Array(0);
          }

          if (pending.byteLength) {
            yield pending;
          }
        } finally {
          reader.releaseLock();
        }
      },
    };
  }

  // fallback, если stream недоступен или нет content-length
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  if (!bytes.byteLength) {
    throw new Error("[VOT] Local file: empty media bytes");
  }

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