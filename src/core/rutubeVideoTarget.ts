export function isRutubeSupportedPageHost(hostname: string): boolean {
  return /(?:^|\.)rutube\.ru$/i.test(String(hostname || "").trim());
}

export function extractRutubeVideoId(
  ...candidates: Array<unknown>
): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate !== "string") {
      continue;
    }

    const normalized = candidate.trim();
    if (!normalized) {
      continue;
    }

    const pageMatch = normalized.match(
      /(?:^|\/)video\/([a-z0-9]{12,})(?:\/|$)/i,
    );
    if (pageMatch?.[1]) {
      return pageMatch[1].toLowerCase();
    }

    const manifestMatch = normalized.match(
      /(?:^|\/)route\/([a-z0-9]{12,})\.m3u8(?:[?#]|$)/i,
    );
    if (manifestMatch?.[1]) {
      return manifestMatch[1].toLowerCase();
    }
  }

  return undefined;
}

export function buildCanonicalRutubeFallbackTarget(
  pageUrl: string,
  ...candidates: Array<unknown>
): { url: string; videoId: string } | null {
  const videoId = extractRutubeVideoId(pageUrl, ...candidates);
  if (!videoId) {
    return null;
  }

  return {
    videoId,
    url: `https://rutube.ru/video/${videoId}/`,
  };
}
