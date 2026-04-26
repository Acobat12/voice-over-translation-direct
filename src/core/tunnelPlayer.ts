export type TunnelPlayerContext = {
  kind: "playlist-player";
  playerUrl: string;
  sourceUrl: string | null;
  playlistUrl: string | null;
  hasTranslationReadyCallback: boolean;
};

function normalizeAbsoluteUrl(
  value: string | null | undefined,
  baseUrl: string,
): string | null {
  const raw = String(value || "").trim();
  if (!raw) {
    return null;
  }

  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    return raw;
  }
}

export function getTunnelPlayerContext(
  href: string = globalThis.location.href,
): TunnelPlayerContext | null {
  try {
    const url = new URL(href, globalThis.location.href);
    if (!/\/player\.html$/i.test(url.pathname)) {
      return null;
    }

    const sourceUrl = normalizeAbsoluteUrl(url.searchParams.get("src"), url.toString());
    const playlistUrl = normalizeAbsoluteUrl(
      url.searchParams.get("list"),
      url.toString(),
    );

    if (!sourceUrl && !playlistUrl) {
      return null;
    }

    return {
      kind: "playlist-player",
      playerUrl: url.toString(),
      sourceUrl,
      playlistUrl,
      hasTranslationReadyCallback: Boolean(playlistUrl),
    };
  } catch {
    return null;
  }
}

export function isTunnelPlayerUrl(url: URL): boolean {
  return Boolean(getTunnelPlayerContext(url.toString()));
}
