import type { GetAudioFromAPIOptions } from "../../types/audioDownloader";
import debug from "../../utils/debug";
import { GM_fetch } from "../../utils/gm";
import { getLastManifestUrl } from "../../utils/manifestSniffer";

const VK_PLAYER_SELECTOR = ".videoplayer_media, vk-video-player";

function makeSimpleFileId(size: number, chunkSize: number): string {
  return `vk_${size}_${chunkSize}_${Date.now()}`;
}

function isM3u8(url: string): boolean {
  return /\.m3u8(?:$|[?#])/i.test(url);
}

function resolveUrl(url: string, baseUrl: string): string {
  return new URL(url, baseUrl).toString();
}

function getVideoSrc(video: HTMLVideoElement): string {
  const sourceEl = video.querySelector("source");
  return String(
    video.currentSrc ||
      video.src ||
      sourceEl?.src ||
      sourceEl?.getAttribute("src") ||
      "",
  ).trim();
}

function isVisibleVideo(video: HTMLVideoElement): boolean {
  const rect = video.getBoundingClientRect();
  return rect.width > 64 && rect.height > 64;
}

function collectVideoCandidates(
  preferredVideo?: HTMLVideoElement | null,
): HTMLVideoElement[] {
  const seen = new Set<HTMLVideoElement>();
  const result: HTMLVideoElement[] = [];

  const push = (video: HTMLVideoElement | null | undefined) => {
    if (!(video instanceof HTMLVideoElement) || seen.has(video)) {
      return;
    }
    seen.add(video);
    result.push(video);
  };

  push(preferredVideo);

  for (const video of Array.from(document.querySelectorAll("video"))) {
    push(video);
  }

  return result;
}

function scoreVideoCandidate(
  video: HTMLVideoElement,
  preferredVideo?: HTMLVideoElement | null,
): number {
  let score = 0;
  const src = getVideoSrc(video);

  if (video === preferredVideo) score += 100;
  if (video.isConnected) score += 10;
  if (isVisibleVideo(video)) score += 25;
  if (video.closest(VK_PLAYER_SELECTOR)) score += 20;
  if (!video.paused) score += 8;
  if (video.readyState > 0) score += 8;
  if (src) score += 4;
  if (src && !src.startsWith("blob:")) score += 6;

  return score;
}

function normalizeCandidateUrl(url: string): string {
  try {
    return new URL(url, globalThis.location.href).toString();
  } catch {
    return String(url || "").trim();
  }
}

function scoreVkMediaUrl(url: string): number {
  const normalized = normalizeCandidateUrl(url);
  if (!normalized) {
    return Number.NEGATIVE_INFINITY;
  }

  const lower = normalized.toLowerCase();
  let score = 0;

  if (lower.startsWith("blob:")) score -= 100;
  if (/\.mp4(?:$|[?#])/i.test(normalized)) score += 50;
  if (/\.m3u8(?:$|[?#])/i.test(normalized)) score += 45;
  if (/master\.m3u8/i.test(normalized)) score += 35;
  if (/\.mpd(?:$|[?#])/i.test(normalized)) score += 30;
  if (/manifest/i.test(normalized)) score += 15;
  if (/dashplaylist/i.test(normalized)) score += 15;
  if (/vkvd\d+\.okcdn\.ru|\.okcdn\.ru|vkvideo\.ru/i.test(normalized))
    score += 10;
  if (/[?&]bytes=\d+-\d+/i.test(normalized)) score -= 60;
  if (/[?&]subid=/i.test(lower)) score -= 80;
  if (/[?&]type=2(?:[&#]|$)/i.test(normalized)) score -= 80;

  return score;
}

function pickBestVkMediaUrl(
  candidates: Array<string | null | undefined>,
): string {
  let best = "";
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const candidate of candidates) {
    const normalized = normalizeCandidateUrl(String(candidate || "").trim());
    const score = scoreVkMediaUrl(normalized);
    if (score > bestScore) {
      best = normalized;
      bestScore = score;
    }
  }

  return best;
}

function getPerformanceMediaUrl(): string {
  try {
    const entries = performance.getEntriesByType("resource");
    const candidates = entries
      .map((entry) =>
        String((entry as PerformanceResourceTiming)?.name || "").trim(),
      )
      .filter((candidate) =>
        /vkvd\d+\.okcdn\.ru|\.okcdn\.ru|vkvideo\.ru|vk\.(?:com|ru)/i.test(
          candidate,
        ),
      )
      .filter(Boolean);

    return pickBestVkMediaUrl(candidates);
  } catch {
    return "";
  }
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
  preferredVideo,
}: GetAudioFromAPIOptions) {
  const videos = collectVideoCandidates(preferredVideo).sort(
    (left, right) =>
      scoreVideoCandidate(right, preferredVideo) -
      scoreVideoCandidate(left, preferredVideo),
  );
  const video = videos[0];

  if (!(video instanceof HTMLVideoElement)) {
    throw new Error("[VOT] VK: video element not found");
  }

  const sniffedManifestUrl = getLastManifestUrl();
  const performanceMediaUrl = getPerformanceMediaUrl();
  const selectedVideoSrc = getVideoSrc(video);
  const directVideoUrls = videos
    .map((candidate) => getVideoSrc(candidate))
    .filter((candidate) => candidate && !candidate.startsWith("blob:"));
  const src = pickBestVkMediaUrl([
    sniffedManifestUrl,
    performanceMediaUrl,
    ...directVideoUrls,
    selectedVideoSrc,
  ]);

  debug.log("[VOT] VK strategy videoId:", videoId);
  debug.log("[VOT] VK strategy manifest:", sniffedManifestUrl);
  debug.log("[VOT] VK strategy performance media:", performanceMediaUrl);
  debug.log("[VOT] VK strategy currentSrc:", video.currentSrc);
  debug.log("[VOT] VK strategy src:", video.src);
  debug.log("[VOT] VK strategy selected video src:", selectedVideoSrc);
  debug.log(
    "[VOT] VK strategy candidate videos:",
    videos.map((candidate) => ({
      src: getVideoSrc(candidate),
      visible: isVisibleVideo(candidate),
      paused: candidate.paused,
      readyState: candidate.readyState,
      score: scoreVideoCandidate(candidate, preferredVideo),
    })),
  );
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
