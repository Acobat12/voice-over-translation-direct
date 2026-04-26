const manifestPatterns = [
  /\.m3u8(?:$|[?#])/i,
  /\.mpd(?:$|[?#])/i,
  /master\.m3u8/i,
  /manifest/i,
  /dashplaylist/i,
  /\.mp4(?:$|[?#])/i,
];

function isManifestUrl(url: string): boolean {
  return manifestPatterns.some((re) => re.test(url));
}

type ManifestCandidate = {
  url: string;
  seenAt: number;
};

let bestManifest: ManifestCandidate | null = null;
let installed = false;

function normalizeUrl(input: string): string {
  try {
    return new URL(input, globalThis.location.href).href;
  } catch {
    return input;
  }
}
function isBadSegmentUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    lower.includes("okcdn.ru/?") ||
    /[?&]bytes=\d+-\d+/i.test(lower) ||
    /[?&]type=\d+/i.test(lower)
  );
}
function rememberManifest(url: string): void {
  const normalized = normalizeUrl(url);
  
  if (isBadSegmentUrl(normalized)) {
    return;
  }

  if (!isManifestUrl(normalized)) {
    return;
  }

  if (!bestManifest) {
    bestManifest = { url: normalized, seenAt: Date.now() };
    return;
  }

  // Предпочитаем более "явные" URL поверх слишком общих manifest endpoint-ов.
  const currentScore = scoreManifestUrl(bestManifest.url);
  const nextScore = scoreManifestUrl(normalized);

  if (nextScore >= currentScore) {
    bestManifest = { url: normalized, seenAt: Date.now() };
  }
}

function scoreManifestUrl(url: string): number {
  let score = 0;
  if (/\.m3u8(?:$|[?#])/i.test(url)) score += 3;
  if (/\.mpd(?:$|[?#])/i.test(url)) score += 3;
  if (/master\.m3u8/i.test(url)) score += 2;
  if (/manifest/i.test(url)) score += 1;
  if (/dashplaylist/i.test(url)) score += 1;
  return score;
}

export function getLastManifestUrl(): string {
  return bestManifest?.url ?? "";
}

export function clearLastManifestUrl(): void {
  bestManifest = null;
}

export function installManifestSniffer(): void {
  if (installed) {
    return;
  }
  installed = true;

  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (...args) => {
    const input = args[0];
    const url =
      typeof input === "string"
        ? input
        : input instanceof Request
          ? input.url
          : String(input ?? "");

    rememberManifest(url);

    return originalFetch(...args);
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    rememberManifest(String(url));
    return originalOpen.call(this, method, url, ...(rest as []));
  };
}