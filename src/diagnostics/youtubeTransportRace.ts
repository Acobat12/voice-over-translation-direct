/*
 * YouTube Transport Race diagnostics.
 *
 * Passive diagnostics only: this module observes transports already used by the
 * page/player. It does not mint/replay PO tokens or reconstruct protected SABR
 * requests. Enabled only in DEBUG_MODE builds.
 */

type Counter = { bytes: number; count: number };
type MimeKind = "audio" | "video" | "unknown";

type RaceRow = {
  layer: string;
  method: string;
  media: string;
  status: string;
  sec: number;
  mb: number;
  mbps: number;
  count: number;
  info: string;
};

type PlayerFormat = {
  url?: string;
  signatureCipher?: string;
  cipher?: string;
  mimeType?: string;
  itag?: number;
};

type PlayerResponse = {
  streamingData?: {
    formats?: PlayerFormat[];
    adaptiveFormats?: PlayerFormat[];
    hlsManifestUrl?: string;
    dashManifestUrl?: string;
    serverAbrStreamingUrl?: string;
  };
};

const INSTALL_KEY = "__VOT_YT_TRANSPORT_RACE_V4__";
const PANEL_ID = "vot-transport-race-v4";
const BUTTON_ID = "vot-transport-race-v4-button";
const MB = 1024 * 1024;

const counters = {
  stream: { bytes: 0, count: 0 } as Counter,
  fetchBody: { bytes: 0, count: 0 } as Counter,
  fetchGooglevideo: { bytes: 0, count: 0 } as Counter,
  xhrBody: { bytes: 0, count: 0 } as Counter,
  xhrGooglevideo: { bytes: 0, count: 0 } as Counter,
  mseTotal: { bytes: 0, count: 0 } as Counter,
  mseAudio: { bytes: 0, count: 0 } as Counter,
  mseVideo: { bytes: 0, count: 0 } as Counter,
  mseUnknown: { bytes: 0, count: 0 } as Counter,
};

const bodyUrls = new WeakMap<object, string>();
const sourceBufferKinds = new WeakMap<object, MimeKind>();
const xhrUrls = new WeakMap<object, string>();
let lastResult: {
  createdAt: string;
  durationSec: number;
  rows: RaceRow[];
} | null = null;

function byteLengthOf(value: unknown): number {
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (value instanceof Blob) return value.size;
  return 0;
}

function isGooglevideo(url: string): boolean {
  try {
    return /(^|\.)googlevideo\.com$/i.test(
      new URL(url, location.href).hostname,
    );
  } catch {
    return /googlevideo\.com/i.test(url);
  }
}

function isLikelySabr(url: string): boolean {
  return /(?:\bsabr\b|serverabr|server_abr|abr_streaming|sabr=)/i.test(url);
}

function add(counter: Counter, bytes: number): void {
  counter.count += 1;
  counter.bytes += Math.max(0, bytes || 0);
}

function snapshotCounters() {
  return Object.fromEntries(
    Object.entries(counters).map(([key, value]) => [key, { ...value }]),
  ) as Record<keyof typeof counters, Counter>;
}

function deltaCounter(before: Counter, after: Counter): Counter {
  return {
    bytes: Math.max(0, after.bytes - before.bytes),
    count: Math.max(0, after.count - before.count),
  };
}

function toMb(bytes: number): number {
  return bytes / MB;
}

function toMbps(bytes: number, sec: number): number {
  return sec > 0 ? (bytes * 8) / sec / 1_000_000 : 0;
}

function playerResponse(): PlayerResponse | null {
  try {
    const player =
      document.querySelector("#movie_player") ??
      document.querySelector("#shorts-player");
    const fn = (player as any)?.getPlayerResponse;
    if (typeof fn === "function") {
      const value = fn.call(player);
      if (value && typeof value === "object") return value as PlayerResponse;
    }
  } catch {}
  try {
    const value = (globalThis as any).ytInitialPlayerResponse;
    if (value && typeof value === "object") return value as PlayerResponse;
  } catch {}
  return null;
}

function classifyDirectFormats() {
  const response = playerResponse();
  const formats = response?.streamingData?.formats ?? [];
  const adaptive = response?.streamingData?.adaptiveFormats ?? [];
  const all = [...formats, ...adaptive];
  const direct = all.filter(
    (f) => typeof f.url === "string" && f.url.length > 0,
  );
  const ciphered = all.filter((f) => Boolean(f.signatureCipher || f.cipher));
  const audio = adaptive.filter((f) => f.mimeType?.startsWith("audio/"));
  const video = adaptive.filter((f) => f.mimeType?.startsWith("video/"));
  const muxed = formats.filter((f) => f.mimeType?.startsWith("video/"));
  const directAudio = audio.filter((f) => f.url);
  const directVideo = video.filter((f) => f.url);
  const directMuxed = muxed.filter((f) => f.url);
  return {
    response,
    all,
    direct,
    ciphered,
    audio,
    video,
    muxed,
    directAudio,
    directVideo,
    directMuxed,
  };
}

function getYtcfgLoggedIn(): boolean | null {
  try {
    const ytcfg = (globalThis as any).ytcfg;
    if (typeof ytcfg?.get === "function") {
      const value = ytcfg.get("LOGGED_IN");
      return typeof value === "boolean" ? value : null;
    }
  } catch {}
  return null;
}

function installPassiveHooks(): void {
  const anyGlobal = globalThis as any;
  if (anyGlobal[INSTALL_KEY]?.hooksInstalled) return;

  // FETCH: associate response bodies/readers with their final URL and count
  // explicit body consumption without forcing consumption ourselves.
  const nativeFetch = globalThis.fetch;
  if (typeof nativeFetch === "function") {
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      const response = await nativeFetch(...args);
      try {
        if (response.body)
          bodyUrls.set(response.body, response.url || String(args[0]));
      } catch {}
      return response;
    }) as typeof fetch;
  }

  const responseArrayBuffer = Response.prototype.arrayBuffer;
  Response.prototype.arrayBuffer = async function () {
    const result = await responseArrayBuffer.call(this);
    const bytes = result.byteLength;
    add(counters.fetchBody, bytes);
    if (isGooglevideo(this.url)) add(counters.fetchGooglevideo, bytes);
    return result;
  };

  const responseBlob = Response.prototype.blob;
  Response.prototype.blob = async function () {
    const result = await responseBlob.call(this);
    const bytes = result.size;
    add(counters.fetchBody, bytes);
    if (isGooglevideo(this.url)) add(counters.fetchGooglevideo, bytes);
    return result;
  };

  const streamGetReader = ReadableStream.prototype.getReader;
  ReadableStream.prototype.getReader = function (...args: any[]) {
    const reader = Reflect.apply(
      streamGetReader,
      this,
      args,
    ) as ReadableStreamDefaultReader;
    const url = bodyUrls.get(this as object) ?? "";
    const nativeRead = reader.read.bind(reader);
    reader.read = (async (...readArgs: any[]) => {
      const result = await nativeRead(...readArgs);
      if (!result.done) {
        const bytes = byteLengthOf(result.value);
        add(counters.stream, bytes);
        if (url && isGooglevideo(url)) {
          // The stream counter intentionally remains aggregate; URL attribution
          // is available through fetch-googlevideo when body methods are used.
        }
      }
      return result;
    }) as typeof reader.read;
    return reader as any;
  } as typeof ReadableStream.prototype.getReader;

  // XHR: only count responses the page actually requested as binary.
  const xhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (
    method: string,
    url: string | URL,
    ...rest: any[]
  ) {
    try {
      xhrUrls.set(this, String(url));
    } catch {}
    return Reflect.apply(xhrOpen, this, [method, url, ...rest]);
  } as typeof XMLHttpRequest.prototype.open;

  const xhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args: any[]) {
    this.addEventListener(
      "loadend",
      () => {
        try {
          const bytes = byteLengthOf(this.response);
          if (bytes > 0) {
            add(counters.xhrBody, bytes);
            const url = xhrUrls.get(this) ?? this.responseURL ?? "";
            if (isGooglevideo(url)) add(counters.xhrGooglevideo, bytes);
          }
        } catch {}
      },
      { once: true },
    );
    return Reflect.apply(xhrSend, this, args);
  } as typeof XMLHttpRequest.prototype.send;

  // MSE: count the exact BufferSource bytes passed to appendBuffer.
  const mediaSourceProto = (globalThis as any).MediaSource?.prototype;
  if (mediaSourceProto?.addSourceBuffer) {
    const nativeAddSourceBuffer = mediaSourceProto.addSourceBuffer;
    mediaSourceProto.addSourceBuffer = function (mime: string) {
      const sb = nativeAddSourceBuffer.call(this, mime) as SourceBuffer;
      const lower = String(mime || "").toLowerCase();
      const kind: MimeKind = lower.startsWith("audio/")
        ? "audio"
        : lower.startsWith("video/")
          ? "video"
          : "unknown";
      sourceBufferKinds.set(sb, kind);
      const nativeAppend = sb.appendBuffer;
      sb.appendBuffer = function (buffer: BufferSource) {
        const bytes = byteLengthOf(buffer);
        add(counters.mseTotal, bytes);
        const mapped = sourceBufferKinds.get(this) ?? "unknown";
        if (mapped === "audio") add(counters.mseAudio, bytes);
        else if (mapped === "video") add(counters.mseVideo, bytes);
        else add(counters.mseUnknown, bytes);
        return nativeAppend.call(this, buffer);
      };
      return sb;
    };
  }

  if ((globalThis as any).ManagedMediaSource?.prototype?.addSourceBuffer) {
    const proto = (globalThis as any).ManagedMediaSource.prototype;
    if (proto !== mediaSourceProto) {
      const nativeAddSourceBuffer = proto.addSourceBuffer;
      proto.addSourceBuffer = function (mime: string) {
        const sb = nativeAddSourceBuffer.call(this, mime) as SourceBuffer;
        const lower = String(mime || "").toLowerCase();
        const kind: MimeKind = lower.startsWith("audio/")
          ? "audio"
          : lower.startsWith("video/")
            ? "video"
            : "unknown";
        sourceBufferKinds.set(sb, kind);
        const nativeAppend = sb.appendBuffer;
        sb.appendBuffer = function (buffer: BufferSource) {
          const bytes = byteLengthOf(buffer);
          add(counters.mseTotal, bytes);
          const mapped = sourceBufferKinds.get(this) ?? "unknown";
          if (mapped === "audio") add(counters.mseAudio, bytes);
          else if (mapped === "video") add(counters.mseVideo, bytes);
          else add(counters.mseUnknown, bytes);
          return nativeAppend.call(this, buffer);
        };
        return sb;
      };
    }
  }

  anyGlobal[INSTALL_KEY] = {
    ...(anyGlobal[INSTALL_KEY] || {}),
    hooksInstalled: true,
  };
}

function resourceTimingDelta(startTime: number) {
  const entries = performance
    .getEntriesByType("resource")
    .filter(
      (entry): entry is PerformanceResourceTiming =>
        entry instanceof PerformanceResourceTiming,
    )
    .filter(
      (entry) => entry.startTime >= startTime && isGooglevideo(entry.name),
    );
  const sabr = entries.filter((entry) => isLikelySabr(entry.name));
  const nonSabr = entries.filter((entry) => !isLikelySabr(entry.name));
  const sum = (items: PerformanceResourceTiming[]) =>
    items.reduce(
      (n, e) =>
        n + (e.transferSize || e.encodedBodySize || e.decodedBodySize || 0),
      0,
    );
  return {
    all: { bytes: sum(entries), count: entries.length },
    sabr: { bytes: sum(sabr), count: sabr.length },
    nonSabr: { bytes: sum(nonSabr), count: nonSabr.length },
  };
}

function getMainVideo(): HTMLVideoElement | null {
  const candidates = [...document.querySelectorAll<HTMLVideoElement>("video")];
  return (
    candidates.sort(
      (a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight,
    )[0] ?? null
  );
}

function mediaBufferInfo(
  video: HTMLVideoElement | null,
  beforeEnd: number | null,
  sec: number,
) {
  if (!video) return { status: "NOT_SEEN", info: "no video element", count: 0 };
  let end = video.currentTime;
  try {
    for (let i = 0; i < video.buffered.length; i++) {
      if (video.buffered.start(i) <= video.currentTime + 0.25)
        end = Math.max(end, video.buffered.end(i));
    }
  } catch {}
  const bufferAhead = Math.max(0, end - video.currentTime);
  const growth = beforeEnd === null ? 0 : end - beforeEnd;
  const rate = sec > 0 ? growth / sec : 0;
  return {
    status: "OBSERVED",
    info: `buffer +${bufferAhead.toFixed(2)} sec; buffer-rate=${rate.toFixed(2)}x`,
    count: 0,
  };
}

function makeRow(
  layer: string,
  method: string,
  media: string,
  status: string,
  sec: number,
  counter: Counter,
  info: string,
): RaceRow {
  return {
    layer,
    method,
    media,
    status,
    sec,
    mb: toMb(counter.bytes),
    mbps: toMbps(counter.bytes, sec),
    count: counter.count,
    info,
  };
}

async function runRace(durationSec = 10): Promise<RaceRow[]> {
  const sec = Math.max(1, Math.min(60, durationSec));
  const before = snapshotCounters();
  const perfStart = performance.now();
  const video = getMainVideo();
  let bufferEndBefore: number | null = null;
  if (video) {
    try {
      for (let i = 0; i < video.buffered.length; i++)
        bufferEndBefore = Math.max(bufferEndBefore ?? 0, video.buffered.end(i));
    } catch {}
  }

  await new Promise((resolve) => setTimeout(resolve, sec * 1000));

  const after = snapshotCounters();
  const perf = resourceTimingDelta(perfStart);
  const direct = classifyDirectFormats();
  const rows: RaceRow[] = [];
  const d = (key: keyof typeof counters) =>
    deltaCounter(before[key], after[key]);

  rows.push(
    makeRow(
      "PERF",
      "resource-googlevideo",
      "playback",
      perf.all.count ? "OBSERVED" : "NOT_SEEN",
      sec,
      perf.all,
      "Resource Timing; cross-origin byte sizes may be undercounted",
    ),
  );
  rows.push(
    makeRow(
      "PERF",
      "resource-sabr",
      "playback",
      perf.sabr.count ? "OBSERVED" : "NOT_SEEN",
      sec,
      perf.sabr,
      perf.sabr.count
        ? "Resource Timing entries classified as SABR-like"
        : "no SABR-like Resource Timing entry",
    ),
  );
  rows.push(
    makeRow(
      "STREAM",
      "readable-stream",
      "network",
      d("stream").count ? "OBSERVED" : "NOT_SEEN",
      sec,
      d("stream"),
      "aggregate chunks returned by ReadableStreamDefaultReader.read()",
    ),
  );
  rows.push(
    makeRow(
      "MSE",
      "mse-total",
      "combined",
      d("mseTotal").count ? "OBSERVED" : "NOT_SEEN",
      sec,
      d("mseTotal"),
      "exact bytes passed to SourceBuffer.appendBuffer",
    ),
  );
  rows.push(
    makeRow(
      "MSE",
      "mse-video",
      "video",
      d("mseVideo").count ? "OBSERVED" : "NOT_SEEN",
      sec,
      d("mseVideo"),
      "exact bytes passed to video SourceBuffer.appendBuffer",
    ),
  );
  rows.push(
    makeRow(
      "MSE",
      "mse-audio",
      "audio",
      d("mseAudio").count ? "OBSERVED" : "NOT_SEEN",
      sec,
      d("mseAudio"),
      "exact bytes passed to audio SourceBuffer.appendBuffer",
    ),
  );
  rows.push(
    makeRow(
      "FETCH",
      "fetch-body",
      "network",
      d("fetchBody").count ? "OBSERVED" : "NOT_SEEN",
      sec,
      d("fetchBody"),
      "Response.arrayBuffer()/blob() body consumption",
    ),
  );
  rows.push(
    makeRow(
      "FETCH",
      "fetch-googlevideo",
      "network",
      d("fetchGooglevideo").count ? "OBSERVED" : "NOT_SEEN",
      sec,
      d("fetchGooglevideo"),
      "bytes counted only for consumed googlevideo Response bodies",
    ),
  );
  const media = mediaBufferInfo(video, bufferEndBefore, sec);
  rows.push(
    makeRow(
      "MEDIA",
      "media-buffer",
      "playback",
      media.status,
      sec,
      { bytes: 0, count: media.count },
      media.info,
    ),
  );
  rows.push(
    makeRow(
      "MSE",
      "mse-unknown",
      "unknown",
      d("mseUnknown").count ? "OBSERVED" : "NOT_SEEN",
      sec,
      d("mseUnknown"),
      "SourceBuffer created before/without MIME classification",
    ),
  );
  rows.push(
    makeRow(
      "PERF",
      "resource-non-sabr",
      "playback",
      perf.nonSabr.count ? "OBSERVED" : "NOT_SEEN",
      sec,
      perf.nonSabr,
      "Resource Timing non-SABR-classified googlevideo entries",
    ),
  );
  rows.push(
    makeRow(
      "XHR",
      "xhr-body",
      "network",
      d("xhrBody").count ? "OBSERVED" : "NOT_SEEN",
      sec,
      d("xhrBody"),
      "binary XHR responses observed",
    ),
  );
  rows.push(
    makeRow(
      "XHR",
      "xhr-googlevideo",
      "network",
      d("xhrGooglevideo").count ? "OBSERVED" : "NOT_SEEN",
      sec,
      d("xhrGooglevideo"),
      "binary googlevideo XHR responses observed",
    ),
  );

  const directStatus = (items: PlayerFormat[], total: PlayerFormat[]) =>
    items.length ? "DIRECT_URL" : total.length ? "PLAYER_MANAGED" : "NOT_SEEN";
  rows.push(
    makeRow(
      "DIRECT",
      "direct/audio",
      "audio",
      directStatus(direct.directAudio, direct.audio),
      sec,
      { bytes: 0, count: direct.directAudio.length },
      direct.directAudio.length
        ? `${direct.directAudio.length} independent URL(s)`
        : direct.audio.length
          ? "format exists but has no independent URL"
          : "no audio adaptive format",
    ),
  );
  rows.push(
    makeRow(
      "DIRECT",
      "direct/muxed",
      "muxed",
      directStatus(direct.directMuxed, direct.muxed),
      sec,
      { bytes: 0, count: direct.directMuxed.length },
      direct.directMuxed.length
        ? `${direct.directMuxed.length} independent URL(s)`
        : direct.muxed.length
          ? "format exists but has no independent URL"
          : "no muxed format",
    ),
  );
  rows.push(
    makeRow(
      "DIRECT",
      "direct/video",
      "video",
      directStatus(direct.directVideo, direct.video),
      sec,
      { bytes: 0, count: direct.directVideo.length },
      direct.directVideo.length
        ? `${direct.directVideo.length} independent URL(s)`
        : direct.video.length
          ? "format exists but has no independent URL"
          : "no video adaptive format",
    ),
  );

  const loggedIn = getYtcfgLoggedIn();
  rows.push(
    makeRow(
      "SESSION",
      "browser-session",
      "session",
      loggedIn === true
        ? "LOGGED_IN"
        : loggedIn === false
          ? "LOGGED_OUT"
          : "UNKNOWN",
      sec,
      { bytes: 0, count: 0 },
      loggedIn === null
        ? "ytcfg LOGGED_IN unavailable"
        : `ytcfg.LOGGED_IN=${loggedIn}`,
    ),
  );
  rows.push(
    makeRow(
      "SESSION",
      "current-player-response",
      "resolver",
      direct.response ? "READY" : "NOT_SEEN",
      sec,
      { bytes: 0, count: direct.all.length },
      direct.response
        ? `${direct.all.length} formats; ${direct.direct.length} direct URL; ${direct.ciphered.length} ciphered/player-managed`
        : "no current player response",
    ),
  );
  const sabrUrl = direct.response?.streamingData?.serverAbrStreamingUrl;
  rows.push(
    makeRow(
      "SESSION",
      "server-abr",
      "resolver",
      sabrUrl ? "PRESENT" : "NOT_SEEN",
      sec,
      { bytes: 0, count: sabrUrl ? 1 : 0 },
      sabrUrl
        ? "player response exposes serverAbrStreamingUrl"
        : "serverAbrStreamingUrl absent",
    ),
  );

  lastResult = { createdAt: new Date().toISOString(), durationSec: sec, rows };
  return rows;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] || c,
  );
}

function renderRows(tbody: HTMLTableSectionElement, rows: RaceRow[]): void {
  tbody.innerHTML = rows
    .map(
      (row) => `<tr>
    <td>${escapeHtml(row.layer)}</td><td>${escapeHtml(row.method)}</td><td>${escapeHtml(row.media)}</td>
    <td>${escapeHtml(row.status)}</td><td>${row.sec.toFixed(2)}</td><td>${row.mb.toFixed(2)}</td>
    <td>${row.mbps.toFixed(2)}</td><td>${row.count}</td><td>${escapeHtml(row.info)}</td>
  </tr>`,
    )
    .join("");
}

function createPanel(): HTMLElement {
  document.getElementById(PANEL_ID)?.remove();
  const panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.style.cssText =
    "position:fixed;inset:12px;z-index:2147483647;background:#111;color:#eee;border:1px solid #555;border-radius:8px;padding:10px;font:12px/1.35 ui-monospace,SFMono-Regular,Consolas,monospace;overflow:auto;box-shadow:0 8px 40px #000b";
  panel.innerHTML = `<div style="display:flex;align-items:center;gap:8px;position:sticky;top:0;background:#111;padding-bottom:8px">
    <strong style="font-size:14px">VOT Transport Race v4</strong>
    <button data-run>Run 10s test</button><button data-export>Export JSON</button>
    <span data-summary style="margin-left:8px"></span>
    <button data-close style="margin-left:auto">×</button>
  </div>
  <table style="width:100%;border-collapse:collapse"><thead><tr>
    <th>Layer</th><th>Method</th><th>Media</th><th>Status</th><th>sec</th><th>MB</th><th>Mbps</th><th>Count</th><th>Info</th>
  </tr></thead><tbody data-body></tbody></table>`;
  const style = document.createElement("style");
  style.textContent = `#${PANEL_ID} button{background:#2d2d2d;color:#fff;border:1px solid #666;border-radius:5px;padding:5px 8px;cursor:pointer}#${PANEL_ID} th,#${PANEL_ID} td{text-align:left;border-bottom:1px solid #333;padding:4px 6px;white-space:nowrap}#${PANEL_ID} td:last-child{white-space:normal}`;
  panel.appendChild(style);
  const tbody = panel.querySelector<HTMLTableSectionElement>("[data-body]");
  const summary = panel.querySelector<HTMLElement>("[data-summary]");
  const run = panel.querySelector<HTMLButtonElement>("[data-run]");
  const exportButton = panel.querySelector<HTMLButtonElement>("[data-export]");
  const closeButton = panel.querySelector<HTMLButtonElement>("[data-close]");
  if (!tbody || !summary || !run || !exportButton || !closeButton) {
    throw new Error("VOT transport race panel markup is incomplete");
  }
  run.onclick = async () => {
    run.disabled = true;
    run.textContent = "Running…";
    const rows = await runRace(10);
    renderRows(tbody, rows);
    const mse = rows.find((r) => r.method === "mse-total");
    summary.textContent = mse
      ? `MSE: ${mse.mbps.toFixed(2)} Mbps → ${mse.mb.toFixed(2)} MB / 10s`
      : "";
    run.disabled = false;
    run.textContent = "Run 10s test";
  };
  exportButton.onclick = () => {
    if (!lastResult) return;
    const blob = new Blob([JSON.stringify(lastResult, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vot-transport-race-${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  closeButton.onclick = () => panel.remove();
  (document.body ?? document.documentElement).appendChild(panel);
  return panel;
}

export function installYouTubeTransportRace(): void {
  if (!/(^|\.)youtube\.com$/i.test(location.hostname)) return;
  installPassiveHooks();

  const addButton = () => {
    if (document.getElementById(BUTTON_ID) || !document.documentElement) return;
    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.textContent = "VOT Race";
    button.title = "Open VOT Transport Race v4 diagnostics";
    button.style.cssText =
      "position:fixed;right:10px;bottom:10px;z-index:2147483646;background:#111;color:#fff;border:1px solid #777;border-radius:6px;padding:6px 9px;font:12px ui-monospace,monospace;cursor:pointer;opacity:.88";
    button.onclick = () => createPanel();
    (document.body ?? document.documentElement).appendChild(button);
  };

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", addButton, { once: true });
  else addButton();
}
