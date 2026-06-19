export function isCloudMailSupportedPageHost(hostname: string): boolean {
  return /(^|\.)cloud\.mail\.ru$/i.test(String(hostname || "").trim());
}

function extractCloudMailPublicPath(
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

    try {
      const parsed = new URL(normalized, "https://cloud.mail.ru");
      if (!isCloudMailSupportedPageHost(parsed.hostname)) {
        continue;
      }

      const pathname = parsed.pathname.replace(/\/+$/u, "");
      const publicPathMatch = pathname.match(/^\/(public\/.+)$/i);
      if (!publicPathMatch?.[1]) {
        continue;
      }

      const publicPath = publicPathMatch[1]
        .split("/")
        .map((segment) => segment.trim())
        .filter(Boolean)
        .join("/");

      if (publicPath) {
        return publicPath;
      }
    } catch {
      const fallbackMatch = normalized.match(/(?:^|\/)(public\/.+)$/i);
      if (!fallbackMatch?.[1]) {
        continue;
      }

      const publicPath = fallbackMatch[1]
        .replace(/\/+$/u, "")
        .split("/")
        .map((segment) => segment.trim())
        .filter(Boolean)
        .join("/");

      if (publicPath) {
        return publicPath;
      }
    }
  }

  return undefined;
}

export function extractCloudMailVideoId(
  ...candidates: Array<unknown>
): string | undefined {
  return extractCloudMailPublicPath(...candidates);
}

export function buildCanonicalCloudMailFallbackTarget(
  pageUrl: string,
  ...candidates: Array<unknown>
): { url: string; videoId: string } | null {
  const videoId = extractCloudMailVideoId(pageUrl, ...candidates);
  if (!videoId) {
    return null;
  }

  return {
    videoId,
    url: `https://cloud.mail.ru/${videoId}`,
  };
}

const DIRECT_CLOUDMAIL_MEDIA_URL_RE =
  /\.(m3u8|mp4|m4v|mov|webm|avi|mpd)(?:[?#]|$)/i;

export function isCloudMailDirectMediaUrl(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }

  const normalized = value.trim();
  if (!normalized) {
    return false;
  }

  try {
    const parsed = new URL(normalized, "https://cloud.mail.ru");
    if (!/^https?:$/i.test(parsed.protocol)) {
      return false;
    }

    return (
      DIRECT_CLOUDMAIL_MEDIA_URL_RE.test(parsed.toString()) ||
      !isCloudMailSupportedPageHost(parsed.hostname)
    );
  } catch {
    return DIRECT_CLOUDMAIL_MEDIA_URL_RE.test(normalized);
  }
}

export function pickCloudMailSourceUrl(...candidates: Array<unknown>): string {
  for (const candidate of candidates) {
    if (typeof candidate !== "string") {
      continue;
    }

    const normalized = candidate.trim();
    if (!normalized || !isCloudMailDirectMediaUrl(normalized)) {
      continue;
    }

    return normalized;
  }

  return "";
}
