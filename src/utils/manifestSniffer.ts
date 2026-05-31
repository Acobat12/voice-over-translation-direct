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

function isDirectMediaCandidate(url: string): boolean {
  return (
    /\.m3u8(?:$|[?#])/i.test(url) ||
    /\.mpd(?:$|[?#])/i.test(url) ||
    /master\.m3u8/i.test(url) ||
    /dashplaylist/i.test(url) ||
    /\.mp4(?:$|[?#])/i.test(url)
  );
}

function isBadSegmentUrl(url: string): boolean {
  const lower = url.toLowerCase();
  if (isDirectMediaCandidate(lower)) {
    return false;
  }
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

  console.log("[VOT][manifestSniffer] candidate", normalized);

  if (!bestManifest) {
    bestManifest = { url: normalized, seenAt: Date.now() };
    console.log("[VOT][manifestSniffer] selected", bestManifest.url);
    return;
  }

  const currentScore = scoreManifestUrl(bestManifest.url);
  const nextScore = scoreManifestUrl(normalized);

  if (nextScore >= currentScore) {
    bestManifest = { url: normalized, seenAt: Date.now() };
    console.log("[VOT][manifestSniffer] selected", bestManifest.url);
  }
}

function scoreManifestUrl(url: string): number {
  let score = 0;

  if (/\.mp4(?:$|[?#])/i.test(url)) score += 5;
  if (/\.m3u8(?:$|[?#])/i.test(url)) score += 4;
  if (/master\.m3u8/i.test(url)) score += 3;
  if (/\.mpd(?:$|[?#])/i.test(url)) score += 2;
  if (/manifest/i.test(url)) score += 1;
  if (/dashplaylist/i.test(url)) score += 1;

  // VK/OK CDN чаще всего полезный источник.
  if (/vkvd\d+\.okcdn\.ru|\.okcdn\.ru|vkvideo\.ru/i.test(url)) {
    score += 2;
  }

  return score;
}

export function getLastManifestUrl(): string {
  return bestManifest?.url ?? "";
}

export function clearLastManifestUrl(): void {
  bestManifest = null;
}

const DIRECT_SOURCES_KEY = "__VOT_DIRECT_SOURCES__";

function tryInjectDirectSources(text: string): void {
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== "object") return;
    const hasId =
      "unitedVideoId" in data ||
      ("video" in data && typeof data.video === "object");
    if (!hasId) return;
    const existing = (globalThis as any)[DIRECT_SOURCES_KEY];
    if (existing && typeof existing === "object") return;
    (globalThis as any)[DIRECT_SOURCES_KEY] = data;
    console.log("[VOT][manifestSniffer] injected __VOT_DIRECT_SOURCES__", data);
  } catch {
    // Not JSON or not relevant
  }
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

    const response = await originalFetch(...args);

    if (response.headers.get("content-type")?.includes("application/json")) {
      response
        .clone()
        .text()
        .then(tryInjectDirectSources)
        .catch(() => {});
    }

    return response;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    rememberManifest(String(url));

    this.addEventListener("load", function () {
      const ct = this.getResponseHeader("content-type") ?? "";
      if (ct.includes("application/json") || ct.includes("text/javascript")) {
        tryInjectDirectSources(this.responseText ?? "");
      }
    });

    return originalOpen.call(this, method, url, ...(rest as []));
  };
}
