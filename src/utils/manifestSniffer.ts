import { normalizePageUrl } from "./pageContext";

const manifestPatterns = [
  /\.m3u8(?:$|[?#])/i,
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
let cloudMailRuManifest = "";

export function getCloudMailRuManifestUrl(): string {
  return cloudMailRuManifest;
}

function isDirectMediaCandidate(url: string): boolean {
  return (
    /\.m3u8(?:$|[?#])/i.test(url) ||
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
  const normalized = normalizePageUrl(url);
  // Cloud Mail.ru: prefer /video/0p/ over lower-quality variants.
  try {
    const parsed = new URL(normalized, globalThis.location?.href);
    const isCloudHls =
      /^[^.]+\.cloud\.mail\.ru$/i.test(parsed.hostname) &&
      /^\/video\/(?:0p|\d+p(?:_\d+)?)\/[^/]+\.m3u8$/i.test(parsed.pathname);
    if (isCloudHls) {
      const incomingIs0p = /^\/video\/0p\//i.test(parsed.pathname);
      const storedIs0p = /\/video\/0p\//i.test(cloudMailRuManifest);
      if (!cloudMailRuManifest || incomingIs0p || !storedIs0p) {
        cloudMailRuManifest = parsed.href;
        (globalThis as any).__FORK_CLOUDMAILRU_MANIFEST__ = cloudMailRuManifest;
        console.info("[FORK][mailru] saved", {
          incoming: parsed.href,
          saved: getCloudMailRuManifestUrl(),
          verified: getCloudMailRuManifestUrl() === parsed.href,
        });
      }
    }
  } catch {
    /* ignore invalid URLs */
  }

  if (isBadSegmentUrl(normalized)) {
    return;
  }

  if (!isManifestUrl(normalized)) {
    return;
  }

  console.log("[FORK][manifestSniffer] candidate", normalized);

  if (!bestManifest) {
    bestManifest = { url: normalized, seenAt: Date.now() };
    console.log("[FORK][manifestSniffer] selected", bestManifest.url);
    return;
  }

  const currentScore = scoreManifestUrl(bestManifest.url);
  const nextScore = scoreManifestUrl(normalized);

  if (nextScore >= currentScore) {
    bestManifest = { url: normalized, seenAt: Date.now() };
    console.log("[FORK][manifestSniffer] selected", bestManifest.url);
  }
}

function scoreManifestUrl(url: string): number {
  let score = 0;

  if (/\.mp4(?:$|[?#])/i.test(url)) score += 5;
  if (/\.m3u8(?:$|[?#])/i.test(url)) score += 4;
  if (
    /^[a-z0-9-]+\.cloud\.mail\.ru\/video\/0p\//i.test(
      url.replace(/^https?:\/\//i, ""),
    )
  )
    score += 20;
  if (/master\.m3u8/i.test(url)) score += 3;
  if (/\.mpd(?:$|[?#])/i.test(url)) {
    return Number.NEGATIVE_INFINITY;
  }
  if (/manifest/i.test(url)) score += 1;
  if (/dashplaylist/i.test(url)) score += 1;

  // VK/OK CDN чаще всего полезный источник.
  if (/vkvd\d+\.okcdn\.ru|\.okcdn\.ru|vkvideo\.ru/i.test(url)) {
    score += 2;
  }

  return score;
}

export function getLastManifestUrl(): string {
  if (
    globalThis.location?.hostname === "cloud.mail.ru" &&
    cloudMailRuManifest
  ) {
    return cloudMailRuManifest;
  }
  return bestManifest?.url ?? "";
}

export function clearLastManifestUrl(): void {
  bestManifest = null;
  cloudMailRuManifest = "";
  delete (globalThis as any).__FORK_CLOUDMAILRU_MANIFEST__;
}

const DIRECT_SOURCES_KEY = "__VOT_DIRECT_SOURCES__";

function scanMediaJson(root: unknown): void {
  const seen = new WeakSet<object>();
  let visited = 0;
  const walk = (value: unknown, key: string, depth: number): void => {
    if (depth > 13 || ++visited > 12000 || value == null) return;
    if (typeof value === "string") {
      if (/^https?:\/\//i.test(value)) captureMedia(value, "json", "", key);
      else if (value.length < 3000 && /https?%3A%2F%2F/i.test(value)) {
        try {
          captureMedia(decodeURIComponent(value), "json", "", key);
        } catch {
          /* ignore */
        }
      }
      return;
    }
    if (typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const entry of value.slice(0, 150)) walk(entry, key, depth + 1);
      return;
    }
    for (const [k, v] of Object.entries(value).slice(0, 180))
      walk(v, k === "url_list" ? key : k, depth + 1);
  };
  walk(root, "", 0);
}
function tryInjectDirectSources(text: string): void {
  try {
    const data = JSON.parse(text);
    scanMediaJson(data);
    if (!data || typeof data !== "object") return;
    const hasId =
      "unitedVideoId" in data ||
      ("video" in data && typeof data.video === "object");
    if (!hasId) return;
    const existing = (globalThis as any)[DIRECT_SOURCES_KEY];
    if (existing && typeof existing === "object") return;
    (globalThis as any)[DIRECT_SOURCES_KEY] = data;
    console.log(
      "[FORK][manifestSniffer] injected __VOT_DIRECT_SOURCES__",
      data,
    );
  } catch {
    // Not JSON or not relevant
  }
}

export function installManifestSniffer(): void {
  console.log("[FORK][manifestSniffer] install called", {
    host: location.hostname,
    installed,
  });
  if (installed) {
    return;
  }
  // One installation per JS realm, even when the module is bundled twice.
  const realm = globalThis as typeof globalThis & {
    __FORK_SNIFFER_INSTALLED__?: boolean;
  };
  if (realm.__FORK_SNIFFER_INSTALLED__) {
    installed = true;
    return;
  }
  realm.__FORK_SNIFFER_INSTALLED__ = true;
  installed = true;
  console.log("[FORK][manifestSniffer] ready", { host: location.hostname });

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
    const fetchRange = (() => {
      try {
        return (
          new Headers(
            args[1]?.headers ||
              (input instanceof Request ? input.headers : undefined),
          ).get("range") || ""
        );
      } catch {
        return "";
      }
    })();
    captureMedia(url, "fetch", "", "", fetchRange);

    const response = await originalFetch(...args);

    captureMedia(
      response.url,
      "fetch",
      response.headers.get("content-type") ?? "",
      "",
      fetchRange,
    );
    if (
      isStructuredMime(response.headers.get("content-type") ?? "") &&
      Number(response.headers.get("content-length") || 0) < 1500000
    ) {
      response
        .clone()
        .text()
        .then((text) => {
          if (text.length < 1500000) tryInjectDirectSources(text);
        })
        .catch(() => {});
    }

    return response;
  };

  const xhrRanges = new WeakMap<XMLHttpRequest, string>();
  const xhrUrls = new WeakMap<XMLHttpRequest, string>();
  const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.setRequestHeader = function (
    name: string,
    value: string,
  ) {
    if (name.toLowerCase() === "range") {
      xhrRanges.set(this, value);
      const url = xhrUrls.get(this);
      if (url) captureMedia(url, "xhr", "", "", value);
    }
    return originalSetRequestHeader.call(this, name, value);
  };
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    rememberManifest(String(url));
    captureMedia(String(url), "xhr");
    xhrUrls.set(this, String(url));

    this.addEventListener("load", function () {
      const ct = this.getResponseHeader("content-type") ?? "";
      captureMedia(this.responseURL, "xhr", ct, "", xhrRanges.get(this) || "");
      if (!isStructuredMime(ct)) {
        return;
      }

      if (this.responseType !== "" && this.responseType !== "text") {
        return;
      }

      try {
        if (typeof this.responseText === "string") {
          if (this.responseText.length < 1500000)
            tryInjectDirectSources(this.responseText);
        }
      } catch {
        // Some sites request JSON/script with a non-text responseType. Ignore it
        // instead of throwing into the page context from our global XHR hook.
      }
    });

    return originalOpen.call(this, method, url, ...(rest as []));
  };
  try {
    performance.getEntriesByType("resource").forEach((entry) => {
      captureMedia(entry.name, "performance");
    });
    if (typeof PerformanceObserver !== "undefined") {
      const observer = new PerformanceObserver((list) =>
        list.getEntries().forEach((entry) => {
          captureMedia(entry.name, "performance");
        }),
      );
      observer.observe({ type: "resource", buffered: true });
    }
  } catch (error) {
    console.warn("[FORK][manifestSniffer] performance unavailable", error);
  }
  // Player instrumentation. This establishes which blob URL belongs to a MediaSource.
  // It does NOT imply that an arbitrary network request belongs to that player.
  const originalCreateObjectURL = URL.createObjectURL;
  URL.createObjectURL = (object: Blob | MediaSource): string => {
    const blobUrl = originalCreateObjectURL.call(URL, object);
    if (typeof MediaSource !== "undefined" && object instanceof MediaSource) {
      const id = `mse-${++mseSequence}`;
      playerBlobs.set(blobUrl, id);
      mseOwners.set(object, id);
      mseSources.set(id, { blobUrl, buffers: [], createdAt: Date.now() });
    }
    return blobUrl;
  };
  if (typeof MediaSource !== "undefined") {
    const originalAddSourceBuffer = MediaSource.prototype.addSourceBuffer;
    MediaSource.prototype.addSourceBuffer = function (
      type: string,
    ): SourceBuffer {
      const buffer = originalAddSourceBuffer.call(this, type);
      const id = mseOwners.get(this);
      if (id) mseSources.get(id)?.buffers.push(type);
      return buffer;
    };
  }
  const scanDom = () => {
    document.querySelectorAll("video,audio,source").forEach((el) => {
      const media = el as HTMLMediaElement;
      captureMedia(
        media.currentSrc || media.src || el.getAttribute("src") || "",
        "dom",
      );
    });
  };
  if (typeof document !== "undefined") {
    if (document.readyState === "loading")
      document.addEventListener("DOMContentLoaded", scanDom, { once: true });
    else scanDom();
    if (typeof MutationObserver !== "undefined" && document.documentElement) {
      const mo = new MutationObserver(scanDom);
      mo.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["src"],
      });
    }
  }
  (globalThis as any).__VOT_MEDIA_SNIFFER__ = {
    list: () =>
      getDetectedMediaSources().map((s) => ({
        host: new URL(s.url).hostname,
        kind: s.kind,
        format: s.format,
        methods: s.methods,
      })),
    best: (kind: "audio" | "video") => getBestMediaSource(kind),
    getUrl: (kind: "audio" | "video") => getBestMediaSource(kind)?.url ?? "",
    clear: clearDetectedMediaSources,
    setActiveMediaId,
    players: listPlayers,
    playerGraph: () => ({
      players: listPlayers(),
      blobs: Array.from(playerBlobs.entries()),
      mediaSources: Array.from(mseSources.entries()),
      recentRequests: getDetectedMediaSources().slice(0, 30),
    }),
    diagnostics: () => ({
      players: listPlayers(),
      candidates: getDetectedMediaSources(),
      ignored: ignoredCounts,
      page: location.href,
    }),
    refresh: () =>
      performance.getEntriesByType("resource").forEach((entry) => {
        captureMedia(entry.name, "performance");
      }),
  };
  console.log("[FORK][manifestSniffer] hooks installed", {
    realm: globalThis === window,
    players: listPlayers().length,
  });
}

// Extended source discovery: preserves the legacy installer and its manifest selection.
export type MediaKind = "audio" | "video" | "unknown";
export type MediaFormat =
  | "mp4"
  | "mp3"
  | "aac"
  | "webm"
  | "hls"
  | "dash"
  | "unknown";
export type DetectionMethod =
  | "performance"
  | "fetch"
  | "xhr"
  | "dom"
  | "json"
  | "player";
export type DetectedMediaSource = {
  kind: MediaKind;
  format: MediaFormat;
  provider: "okcdn" | "cloud-mailru" | "other";
  url: string;
  mediaId?: string;
  trackType?: string;
  expiresAt?: number;
  firstSeen: number;
  seenAt: number;
  observations: number;
  methods: DetectionMethod[];
  score: number;
  isRangeRequest?: boolean;
  evidence?: string;
  playerMatched?: boolean;
  rangeHeader?: string;
};
const mediaSources = new Map<string, DetectedMediaSource>();
const playerBlobs = new Map<string, string>();
const mseSources = new Map<
  string,
  { blobUrl: string; buffers: string[]; createdAt: number }
>();
const mseOwners = new WeakMap<MediaSource, string>();
let mseSequence = 0;
let activeMediaId = "";
const ignoredCounts: Record<string, number> = {};
const ignore = (reason: string) => {
  ignoredCounts[reason] = (ignoredCounts[reason] || 0) + 1;
};
const ownHost =
  /(?:^|\.)(?:vtrans\.s3-private\.mds\.yandex\.net|api\.browser\.yandex\.ru|media-proxy\.mooo\.com)$/i;
function isStructuredMime(mime: string): boolean {
  return /(?:json|javascript|text\/plain)/i.test(mime);
}
function listPlayers(): Array<{
  index: number;
  active: boolean;
  playing: boolean;
  src: string;
  duration: number;
  area: number;
}> {
  return Array.from(document.querySelectorAll("video,audio"))
    .map((el, index) => {
      const m = el as HTMLMediaElement;
      const rect = m.getBoundingClientRect();
      return {
        index,
        active: !m.paused && !m.ended,
        playing: !m.paused,
        src: m.currentSrc || m.src || "",
        duration: Number.isFinite(m.duration) ? m.duration : 0,
        area: rect.width * rect.height,
      };
    })
    .sort((a, b) => Number(b.active) - Number(a.active) || b.area - a.area);
}
function captureMedia(
  raw: string,
  method: DetectionMethod,
  mime = "",
  evidence = "",
  rangeHeader = "",
): void {
  let u: URL;
  try {
    u = new URL(raw, location.href);
  } catch {
    return;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return;
  if (ownHost.test(u.hostname)) {
    ignore("own-vot-service");
    return;
  }
  const path = u.pathname.toLowerCase();
  const ct = u.searchParams.get("ct");
  const declaredMime = u.searchParams.get("mime_type") || "";
  const okcdn = u.hostname === "okcdn.ru" || u.hostname.endsWith(".okcdn.ru");
  const okTrack = okcdn && (ct === "11" || ct === "12");
  const hls =
    /\.m3u8$/.test(path) ||
    /\/dashplaylist(?:\/|$)/.test(path) ||
    /mpegurl/i.test(mime);
  const dash = /\.mpd$/.test(path) || /dash\+xml/i.test(mime);
  const extAudio = /\.(?:m4a|mp3|aac|ogg|opus|flac|wav)$/.test(path);
  const extVideo = /\.(?:mp4|m4v|webm|mov|ts)$/.test(path);
  const audio =
    (okTrack && ct === "12") ||
    (!okTrack &&
      (extAudio || /^audio\//i.test(mime) || /^audio[_/]/i.test(declaredMime)));
  const video =
    (okTrack && ct === "11") ||
    (!okTrack &&
      (extVideo || /^video\//i.test(mime) || /^video[_/]/i.test(declaredMime)));
  const hinted =
    /(?:play_addr|play_url|download_addr|url_list|bit_rate|video_url|audio_url|stream_url|playapi)/i.test(
      evidence,
    );
  const knownMediaHost =
    /(?:^|\.)(?:bilivideo\.com|mcdn\.bilivideo\.cn)$/i.test(u.hostname);
  if (!hls && !dash && !audio && !video && !(hinted && knownMediaHost)) {
    ignore("unknown-format");
    return;
  }
  const isRangeRequest =
    !!rangeHeader ||
    u.searchParams.has("bytes") ||
    u.searchParams.has("range") ||
    /(?:\/|^)segment|\.m4s$/i.test(path);
  const now = Date.now();
  const previous = mediaSources.get(u.href);
  const playerMatched = listPlayers().some(
    (p) =>
      p.src === u.href ||
      (p.src?.startsWith(u.origin) && !p.src.startsWith("blob:")),
  );
  const format: MediaFormat = hls
    ? "hls"
    : dash
      ? "dash"
      : /\.mp3$/.test(path)
        ? "mp3"
        : /\.(?:aac|m4a)$/.test(path)
          ? "aac"
          : /\.webm$/.test(path)
            ? "webm"
            : video || okTrack
              ? "mp4"
              : "unknown";
  const item: DetectedMediaSource = {
    kind: audio ? "audio" : "video",
    format,
    provider: okcdn
      ? "okcdn"
      : /(?:^|\.)cloud\.mail\.ru$/.test(u.hostname)
        ? "cloud-mailru"
        : "other",
    url: u.href,
    mediaId: u.searchParams.get("id") || undefined,
    trackType: u.searchParams.get("type") || undefined,
    firstSeen: previous?.firstSeen ?? now,
    seenAt: now,
    observations: (previous?.observations ?? 0) + 1,
    methods: previous
      ? Array.from(new Set([...previous.methods, method]))
      : [method],
    isRangeRequest,
    rangeHeader: rangeHeader || previous?.rangeHeader,
    playerMatched,
    evidence: evidence || previous?.evidence,
    score:
      (hls ? 65 : dash ? 45 : 50) +
      (okcdn ? 10 : 0) -
      (isRangeRequest ? 35 : 0) +
      (audio ? 3 : 0) +
      (playerMatched ? 35 : 0) +
      (method === "json" ? 10 : 0),
  };
  mediaSources.delete(u.href);
  mediaSources.set(u.href, item);
  if (!previous)
    console.log("[FORK][manifestSniffer] media candidate", {
      host: u.hostname,
      kind: item.kind,
      format: item.format,
      method,
      playerMatched,
      isRangeRequest,
    });
  if (mediaSources.size > 200) {
    const oldest = mediaSources.keys().next();
    if (!oldest.done) mediaSources.delete(oldest.value);
  }
}

export function getDetectedMediaSources(): DetectedMediaSource[] {
  return Array.from(mediaSources.values()).sort(
    (a, b) => b.score - a.score || b.seenAt - a.seenAt,
  );
}
export function getBestMediaSource(
  kind: "audio" | "video",
): DetectedMediaSource | null {
  const candidates = getDetectedMediaSources().filter(
    (s) =>
      s.kind === kind &&
      (!activeMediaId || !s.mediaId || s.mediaId === activeMediaId),
  );
  // Prefer whole resources over byte-range fragments, even when the latter were seen later.
  return candidates.find((s) => !s.isRangeRequest) ?? candidates[0] ?? null;
}
export function getLastAudioSourceUrl(): string {
  return getBestMediaSource("audio")?.url ?? "";
}
export function clearDetectedMediaSources(): void {
  mediaSources.clear();
}
export function setActiveMediaId(id: string): void {
  if (activeMediaId !== id) {
    activeMediaId = id;
    clearDetectedMediaSources();
  }
}
