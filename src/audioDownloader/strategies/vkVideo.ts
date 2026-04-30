import type { GetAudioFromAPIOptions } from "../../types/audioDownloader";
import debug from "../../utils/debug";
import { GM_fetch } from "../../utils/gm";
import { getLastManifestUrl } from "../../utils/manifestSniffer";

function makeSimpleFileId(size: number, chunkSize: number): string {
  return `vk_${size}_${chunkSize}_${Date.now()}`;
}

function isM3u8(url: string): boolean {
  return /\.m3u8(?:$|[?#])/i.test(url);
}

function resolveUrl(url: string, baseUrl: string): string {
  return new URL(url, baseUrl).toString();
}

async function fetchVkMedia(
  src: string,
  signal: AbortSignal,
): Promise<Response> {
  try {
    const res = await fetch(src, {
      signal,
      credentials: "include",
    });

    if (res.ok) return res;
  } catch {
    // fallback below
  }

  const gmRes = await GM_fetch(src, {
    signal,
    timeout: 0,
  });

  if (!gmRes.ok) {
    throw new Error(`[VOT] VK: failed to fetch media source: ${gmRes.status}`);
  }

  return gmRes;
}

async function fetchText(src: string, signal: AbortSignal): Promise<string> {
  const res = await fetchVkMedia(src, signal);
  return await res.text();
}

async function fetchBytes(
  src: string,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const res = await fetchVkMedia(src, signal);
  const buffer = await res.arrayBuffer();
  return new Uint8Array(buffer);
}

function parseM3u8Urls(text: string, baseUrl: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => resolveUrl(line, baseUrl));
}

async function resolveM3u8Segments(
  manifestUrl: string,
  signal: AbortSignal,
): Promise<string[]> {
  const manifestText = await fetchText(manifestUrl, signal);
  const urls = parseM3u8Urls(manifestText, manifestUrl);

  const nestedManifest = urls.find((url) => isM3u8(url));

  if (nestedManifest) {
    const nestedText = await fetchText(nestedManifest, signal);
    return parseM3u8Urls(nestedText, nestedManifest).filter(
      (url) => !isM3u8(url),
    );
  }

  return urls.filter((url) => !isM3u8(url));
}

export async function getAudioFromVkVideo({
  videoId,
  signal,
}: GetAudioFromAPIOptions) {
  const video = document.querySelector("video");

  if (!(video instanceof HTMLVideoElement)) {
    throw new Error("[VOT] VK: video element not found");
  }

  const sourceEl = video.querySelector("source");
  const sniffedManifestUrl = getLastManifestUrl();

  const src =
    sniffedManifestUrl ||
    video.currentSrc ||
    video.src ||
    sourceEl?.src ||
    sourceEl?.getAttribute("src") ||
    "";

  debug.log("[VOT] VK strategy videoId:", videoId);
  debug.log("[VOT] VK strategy manifest:", sniffedManifestUrl);
  debug.log("[VOT] VK strategy currentSrc:", video.currentSrc);
  debug.log("[VOT] VK strategy src:", video.src);
  debug.log("[VOT] VK strategy selected src:", src);

  if (!src) {
    throw new Error("[VOT] VK: empty video src");
  }

  if (src.startsWith("blob:")) {
    throw new Error(
      "[VOT] VK: blob source detected; need direct mp4/m3u8 URL from VK player/network",
    );
  }

  const chunkSize = 256 * 1024;

  if (isM3u8(src)) {
    const segmentUrls = await resolveM3u8Segments(src, signal);

    if (!segmentUrls.length) {
      throw new Error("[VOT] VK: empty m3u8 segment list");
    }

    const fileId = `vk_hls_${Date.now()}`;

    debug.log("[VOT] VK strategy m3u8 segments:", segmentUrls.length);

    return {
      fileId,
      mediaPartsLength: segmentUrls.length,
      async *getMediaBuffers(): AsyncGenerator<Uint8Array> {
        for (const segmentUrl of segmentUrls) {
          const bytes = await fetchBytes(segmentUrl, signal);

          if (!bytes.byteLength) {
            throw new Error("[VOT] VK: empty m3u8 segment");
          }

          yield bytes;
        }
      },
    };
  }

  const bytes = await fetchBytes(src, signal);

  if (!bytes.byteLength) {
    throw new Error("[VOT] VK: empty media bytes");
  }

  const mediaPartsLength = Math.max(1, Math.ceil(bytes.byteLength / chunkSize));
  const fileId = makeSimpleFileId(bytes.byteLength, chunkSize);

  debug.log("[VOT] VK strategy bytes:", bytes.byteLength);
  debug.log("[VOT] VK strategy mediaPartsLength:", mediaPartsLength);

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
