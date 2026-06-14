export function isVkSupportedPageHost(hostname: string): boolean {
  return /(?:^|\.)vkvideo\.ru$|(?:^|\.)vk\.(?:com|ru)$/i.test(
    String(hostname || "").trim(),
  );
}

export function extractVkMediaId(
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

    const match = normalized.match(/\b((?:video|clip)-\d+_\d+)\b/i);
    if (match?.[1]) {
      return match[1].toLowerCase();
    }
  }

  return undefined;
}

export function normalizeVkMediaIdToVideo(mediaId: string): string {
  const normalized = String(mediaId || "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return normalized;
  }

  if (normalized.startsWith("clip-")) {
    return `video-${normalized.slice("clip-".length)}`;
  }

  return normalized;
}

export function buildCanonicalVkFallbackTarget(
  pageUrl: string,
  ...candidates: Array<unknown>
): { url: string; videoId: string } | null {
  const mediaId = extractVkMediaId(...candidates, pageUrl);
  if (!mediaId) {
    return null;
  }

  const normalizedVideoId = normalizeVkMediaIdToVideo(mediaId);
  if (!normalizedVideoId) {
    return null;
  }

  return {
    videoId: normalizedVideoId,
    url: `https://vk.com/video?z=${normalizedVideoId}`,
  };
}
