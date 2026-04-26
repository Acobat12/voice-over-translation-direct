import { getStructuredVideoData } from "./customResolvers/structuredVideo";
import { getTunnelPlayerContext } from "./tunnelPlayer";

export type CustomResolvedVideo = {
  url: string;
  videoId?: string;
  title?: string;
};

function toStableVideoId(candidate: unknown, fallback: string): string {
  const value = String(candidate || "").trim();
  if (!value) {
    return fallback;
  }

  try {
    const parsed = new URL(value, globalThis.location.href);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return value;
  }
}

function pickBestResourceUrl(names: string[]): string | null {
  const clean = names
    .filter(Boolean)
    .map((x) => String(x).trim())
    .filter(Boolean);

  const reject = (url: string) => {
    const lower = url.toLowerCase();
    return (
      lower.includes("thumbnails.") ||
      lower.includes("/speech/") ||
      lower.endsWith(".jpg") ||
      lower.endsWith(".jpeg") ||
      lower.endsWith(".png") ||
      lower.endsWith(".webp") ||
      lower.includes("okcdn.ru/?") ||
      /[?&]bytes=\d+-\d+/i.test(lower) ||
      /[?&]type=\d+/i.test(lower)
    );
  };

  const candidates = clean.filter((url) => !reject(url));

  return (
    candidates.find((u) => /\.m3u8([?#]|$)/i.test(u)) ||
    candidates.find((u) => /\.mpd([?#]|$)/i.test(u)) ||
    candidates.find((u) => /\.mp4([?#]|$)/i.test(u)) ||
    candidates.find((u) => /\/streams\//i.test(u)) ||
    null
  );
}

function pickBestDirectSource(direct: any): string {
  const candidates = [
    String(direct?.hlsUrl || "").trim(),
    String(direct?.dashUrl || "").trim(),
    String(direct?.mpegLowUrl || "").trim(),
    String(direct?.url || "").trim(),
  ].filter(Boolean);

  return (
    candidates.find((u) => /\.m3u8([?#]|$)/i.test(u)) ||
    candidates.find((u) => /\.mpd([?#]|$)/i.test(u)) ||
    candidates.find((u) => /\.mp4([?#]|$)/i.test(u)) ||
    candidates[0] ||
    ""
  );
}

function isBadDirectVideoUrl(url: string): boolean {
  const lower = String(url || "").toLowerCase();

  return (
    !lower ||
    lower.startsWith("blob:") ||
    lower.includes("thumbnails.") ||
    lower.includes("/speech/") ||
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    lower.endsWith(".png") ||
    lower.endsWith(".webp") ||
    lower.includes("okcdn.ru/?") ||
    /[?&]bytes=\d+-\d+/i.test(lower) ||
    /[?&]type=\d+/i.test(lower)
  );
}

export async function resolveCustomSiteVideo(
  hostname: string,
  href: string,
): Promise<CustomResolvedVideo | null> {
  const tunnelPlayer = getTunnelPlayerContext(href);
  if (tunnelPlayer) {
    const entries = performance.getEntriesByType("resource");
    const names = entries
      .map((e) => (typeof e.name === "string" ? e.name : ""))
      .filter(Boolean);
    const resourceUrl = pickBestResourceUrl(names);
    const video = document.querySelector("video") as HTMLVideoElement | null;
    const currentSrc = String(video?.currentSrc || video?.src || "").trim();
const resolvedUrl =
  (!isBadDirectVideoUrl(tunnelPlayer.sourceUrl || "")
    ? String(tunnelPlayer.sourceUrl)
    : "") ||
  (!isBadDirectVideoUrl(currentSrc)
    ? currentSrc
    : "") ||
  tunnelPlayer.playerUrl;

    console.log("[VOT][custom][tunnel] resolved tunnel player source", {
      playerUrl: tunnelPlayer.playerUrl,
      sourceUrl: tunnelPlayer.sourceUrl,
      playlistUrl: tunnelPlayer.playlistUrl,
      currentSrc,
      resourceUrl,
      resolvedUrl,
    });

    return {
      url: resolvedUrl,
      videoId: toStableVideoId(
        resolvedUrl || tunnelPlayer.sourceUrl || href,
        tunnelPlayer.sourceUrl || resolvedUrl || href,
      ),
      title: document.title,
    };
  }

  let direct = (globalThis as any).__VOT_DIRECT_SOURCES__;

if (!direct) {
  try {
    const raw = document.documentElement.dataset.votDirectSources;
    if (raw) {
      direct = JSON.parse(raw);
    }
  } catch {}
}

if (direct && typeof direct === "object") {
  const bestDirect = pickBestDirectSource(direct);
  const unitedVideoId = String(direct.unitedVideoId || href).trim();

  if (bestDirect && !isBadDirectVideoUrl(bestDirect)) {
    console.log("[VOT][custom][direct-sources] resolved direct source", {
      bestDirect,
      unitedVideoId,
    });

    return {
      url: bestDirect,
      videoId: toStableVideoId(unitedVideoId || bestDirect, bestDirect || href),
      title: String(direct.title || document.title || ""),
    };
  }
}

  // Odysee
  if (/^odysee\.com$/i.test(hostname)) {
    const structured = getStructuredVideoData();

    if (
      structured?.contentUrl &&
      /^https?:\/\//i.test(structured.contentUrl)
    ) {
      console.log("[VOT][custom][odysee] resolved contentUrl", structured.contentUrl);
      return {
        url: structured.contentUrl,
        videoId: href,
        title: structured.title || document.title,
      };
    }

    const entries = performance.getEntriesByType("resource");
    const names = entries
      .map((e) => (typeof e.name === "string" ? e.name : ""))
      .filter(Boolean);

    const isBadAsset = (url: string) => {
      const lower = url.toLowerCase();
      return (
        lower.includes(".jpg") ||
        lower.includes(".jpeg") ||
        lower.includes(".png") ||
        lower.includes(".webp") ||
        lower.includes("/speech/") ||
        lower.includes("thumbnails.odycdn.com")
      );
    };

    const pick = (predicate: (url: string) => boolean) =>
      names.find((url) => !isBadAsset(url) && predicate(url)) || null;

    const bestUrl =
      pick((url) => url.toLowerCase().includes(".m3u8")) ||
      pick((url) => url.toLowerCase().includes(".mpd")) ||
      pick((url) => url.toLowerCase().includes(".mp4")) ||
      pick((url) => url.toLowerCase().includes("/streams/"));

    if (bestUrl) {
      console.log("[VOT][custom][odysee] resolved media url", bestUrl);
      return {
        url: bestUrl,
        videoId: href,
        title: structured?.title || document.title,
      };
    }

    const video = document.querySelector("video") as HTMLVideoElement | null;
    const currentSrc = String(video?.currentSrc || video?.src || "");

    if (
      currentSrc &&
      !currentSrc.startsWith("blob:") &&
      !isBadAsset(currentSrc)
    ) {
      console.log("[VOT][custom][odysee] resolved direct src", currentSrc);
      return {
        url: currentSrc,
        videoId: href,
        title: structured?.title || document.title,
      };
    }

    if (structured?.embedUrl) {
      console.log("[VOT][custom][odysee] fallback embedUrl", structured.embedUrl);
      return {
        url: structured.embedUrl,
        videoId: href,
        title: structured.title || document.title,
      };
    }

    console.log("[VOT][custom][odysee] fallback page url", href);
    return {
      url: href,
      videoId: href,
      title: structured?.title || document.title,
    };
  }

  // cdnvideohub / okcdn inside kodik iframe chain
  if (
    /^player\.cdnvideohub\.com$/i.test(hostname) ||
    /(^|\.)okcdn\.ru$/i.test(hostname)
  ) {
    const referrer = String(document.referrer || "").trim();

    const video = document.querySelector("video") as HTMLVideoElement | null;
    const currentSrc = String(video?.currentSrc || video?.src || "").trim();

    if (!isBadDirectVideoUrl(currentSrc)) {
      console.log("[VOT][custom][cdnvideohub] using direct src", currentSrc);
      return {
        url: currentSrc,
        videoId: toStableVideoId(currentSrc, referrer || href),
        title: document.title,
      };
    }

    const entries = performance.getEntriesByType("resource");
    const names = entries
      .map((e) => (typeof e.name === "string" ? e.name : ""))
      .filter(Boolean);

    const best = pickBestResourceUrl(names);
    if (best) {
      console.log("[VOT][custom][cdnvideohub] using performance resource", best);
      return {
        url: best,
        videoId: toStableVideoId(best, referrer || href),
        title: document.title,
      };
    }

    if (/^https?:\/\/([^/]+\.)?kodikplayer\.com\//i.test(referrer)) {
      console.log("[VOT][custom][cdnvideohub] using kodik referrer", referrer);
      return {
        url: referrer,
        videoId: referrer,
        title: document.title,
      };
    }

    if (referrer) {
      console.log("[VOT][custom][cdnvideohub] fallback referrer", referrer);
      return {
        url: referrer,
        videoId: referrer,
        title: document.title,
      };
    }

    console.log("[VOT][custom][cdnvideohub] fallback page url", href);
    return {
      url: href,
      videoId: href,
      title: document.title,
    };
  }

  // Generic fallback for any custom site
  {
    const entries = performance.getEntriesByType("resource");
    const names = entries
      .map((e) => (typeof e.name === "string" ? e.name : ""))
      .filter(Boolean);

    const best = pickBestResourceUrl(names);
    if (best) {
      console.log("[VOT][custom][generic] resolved media url", best);
      return {
        url: best,
        videoId: toStableVideoId(best, href),
        title: document.title,
      };
    }

    const video = document.querySelector("video") as HTMLVideoElement | null;
    const currentSrc = String(video?.currentSrc || video?.src || "");

    if (!isBadDirectVideoUrl(currentSrc)) {
      console.log("[VOT][custom][generic] resolved direct src", currentSrc);
      return {
        url: currentSrc,
        videoId: toStableVideoId(currentSrc, href),
        title: document.title,
      };
    }
  }

  return null;
}
