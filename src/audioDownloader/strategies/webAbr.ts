import { config } from "@vot.js/shared";
import { SabrStream } from "googlevideo/sabr-stream";
import type { SabrFormat } from "googlevideo/shared-types";
import { createAbortableDelay } from "../../utils/abort";
import debug from "../../utils/debug";
import {
  getYoutubeAudioFormatLanguage as getAudioFormatLanguage,
  normalizeAudioLanguageTag as normalizeAudioLanguage,
  selectSmallestAudioFormat,
} from "../utils";
import { type AudioChunk, concatBuffers } from "./audioChunks";
import { prepareYouTubePlayer as preprocessYouTubePlayer } from "./ytPlayerSolver";

const MEDIA_RANGE_SIZES = [60_000, 80_000, 150_000, 330_000, 460_000];

type YouTubeConfig = {
  data_?: Record<string, unknown>;
  get?: (key: string) => unknown;
};

type WebAbrWindow = Window & {
  ytcfg?: YouTubeConfig;
  _yt_player?: Record<string, unknown>;
  ytInitialPlayerResponse?: WebEmbeddedPlayerResponse;
};

type PageUrlInstance = {
  set?: (key: string, value: string) => void;
  get?: (key: string) => string | null;
  [key: string]: unknown;
};

type PageUrlClass = new (...args: unknown[]) => PageUrlInstance;

type WebEmbeddedFormat = {
  itag?: number;
  url?: string;
  mimeType?: string;
  bitrate?: number;
  averageBitrate?: number;
  contentLength?: string | number;
  lastModified?: string;
  signatureCipher?: string;
  audioQuality?: string;
  language?: string;
  languageCode?: string;
  audioTrackId?: string;
  audioSampleRate?: string;
  audioChannels?: number;
  displayName?: string;
  xtags?: string;
  approxDurationMs?: string | number;
  quality?: string;
  qualityLabel?: string;
  width?: number;
  height?: number;
  audioTrack?: {
    id?: string;
    languageCode?: string;
    language?: string;
    displayName?: string;
    audioIsDefault?: boolean;
  };
};

type WebEmbeddedPlayerResponse = {
  responseContext?: {
    mainAppWebResponseContext?: { datasyncId?: string };
  };
  videoDetails?: { videoId?: string };
  playabilityStatus?: {
    status?: string;
    reason?: string;
    messages?: string[];
  };
  streamingData?: {
    adaptiveFormats?: WebEmbeddedFormat[];
    formats?: WebEmbeddedFormat[];
    serverAbrStreamingUrl?: string;
  };
  playerConfig?: {
    mediaCommonConfig?: {
      mediaUstreamerRequestConfig?: {
        videoPlaybackUstreamerConfig?: string;
      };
    };
  };
};

export function buildMediaRanges(
  contentLength: number,
): { start: number; end: number }[] {
  if (!Number.isInteger(contentLength) || contentLength < 1) return [];
  const ranges: { start: number; end: number }[] = [];
  let start = 0;
  let sizeIndex = 0;
  while (start < contentLength) {
    const size = MEDIA_RANGE_SIZES[sizeIndex] ?? MEDIA_RANGE_SIZES.at(-1) ?? 1;
    const end = Math.min(contentLength - 1, start + size - 1);
    ranges.push({ start, end });
    start = end + 1;
    if (sizeIndex < MEDIA_RANGE_SIZES.length - 1) sizeIndex++;
  }
  return ranges;
}

export async function mintPagePoToken(
  pageWindow: WebAbrWindow,
  binding: string,
  signal: AbortSignal,
): Promise<string | undefined> {
  const realms = new Set<WebAbrWindow>([pageWindow]);
  try {
    realms.add(pageWindow.parent as WebAbrWindow);
    realms.add(pageWindow.top as WebAbrWindow);
  } catch {
    // Cross-origin access is denied.
  }
  for (const realm of realms) {
    let keys: string[];
    try {
      keys = Object.getOwnPropertyNames(realm).filter(
        (key) => key === "bevasrsg" || key.startsWith("havuokmhhs-"),
      );
    } catch {
      continue;
    }
    for (const key of keys) {
      let bevasrs: { wpc?: unknown } | undefined;
      try {
        bevasrs = (
          (realm as unknown as Record<string, unknown>)[key] as {
            bevasrs?: { wpc?: unknown };
          }
        )?.bevasrs;
      } catch {
        continue;
      }
      const wpc = bevasrs?.wpc;
      if (typeof wpc !== "function") continue;
      for (let attempt = 0; attempt < 10; attempt++) {
        if (signal.aborted) throw signal.reason;
        try {
          const minter = await wpc.call(bevasrs);
          const token = await minter?.mws?.({
            c: binding,
            mc: false,
            me: false,
          });
          if (typeof token === "string" && token) return token;
        } catch (error) {
          if (!String(error).includes("SDF:notready")) break;
        }
        await createAbortableDelay(500, signal);
      }
    }
  }
}

export function selectGvsPoTokenBinding(
  videoId: string,
  options: {
    loggedIn: boolean;
    dataSyncId: unknown;
    visitorData: unknown;
    experimentFlags: string[];
  },
): { kind: "video" | "datasync" | "visitor"; value: string } | undefined {
  if (
    options.experimentFlags.some(
      (flags) =>
        new URLSearchParams(flags)
          .getAll("html5_generate_content_po_token")
          .at(-1) === "true",
    )
  ) {
    return { kind: "video", value: videoId };
  }
  // Authenticated GVS uses the full datasync ID, including the || separator.
  const value = options.loggedIn ? options.dataSyncId : options.visitorData;
  if (typeof value !== "string" || !value) return;
  return { kind: options.loggedIn ? "datasync" : "visitor", value };
}

function getConfigValue(config: YouTubeConfig, key: string): unknown {
  return config.get?.(key) ?? config.data_?.[key];
}

function buildContentPlaybackContext(
  signatureTimestamp: unknown,
): Record<string, unknown> {
  const context: Record<string, unknown> = {
    html5Preference: "HTML5_PREF_WANTS",
  };
  const timestamp = Number(signatureTimestamp);
  if (Number.isFinite(timestamp) && timestamp > 0) {
    context.signatureTimestamp = timestamp;
  }
  return context;
}

function findJsonValueEnd(source: string, start: number): number {
  const first = source[start];
  if (first !== "{" && first !== "[" && first !== '"') return -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index++) {
    const char = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') {
        inString = false;
        if (depth === 0) return index + 1;
      }
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{" || char === "[") depth++;
    else if ((char === "}" || char === "]") && --depth === 0) return index + 1;
  }
  return -1;
}

// The page keeps its config in the ytcfg global, which a sandboxed userscript
// realm cannot read. Both calling forms carry plain JSON, so the same inline
// script that builds ytcfg can be replayed from its source text instead.
export function parseYtcfgData(source: string): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  const pattern = /ytcfg\s*\.\s*set\s*\(/g;
  const skipSpaces = (index: number) => {
    while (index < source.length && /\s/.test(source[index] ?? "")) index++;
    return index;
  };
  for (let cursor = 0; cursor <= source.length; ) {
    pattern.lastIndex = cursor;
    const match = pattern.exec(source);
    if (!match) break;
    cursor = match.index + match[0].length;
    const start = skipSpaces(cursor);
    const end = findJsonValueEnd(source, start);
    if (end < 0) continue;
    try {
      const argument = JSON.parse(source.slice(start, end)) as unknown;
      if (argument && typeof argument === "object") {
        if (Array.isArray(argument)) continue;
        Object.assign(data, argument);
        cursor = end;
        continue;
      }
      if (typeof argument !== "string") continue;
      // ytcfg.set("KEY", value) assigns a single entry.
      const separator = skipSpaces(end);
      if (source[separator] !== ",") continue;
      const valueStart = skipSpaces(separator + 1);
      const jsonEnd = findJsonValueEnd(source, valueStart);
      const valueEnd = jsonEnd < 0 ? source.indexOf(")", valueStart) : jsonEnd;
      if (valueEnd < 0) continue;
      data[argument] = JSON.parse(source.slice(valueStart, valueEnd).trim());
      cursor = valueEnd;
    } catch {
      // Calls with non-JSON arguments are page code we cannot replay.
    }
  }
  return data;
}

function readInitialPlayerResponseFromDocument(
  targetWindow: Window,
): WebEmbeddedPlayerResponse | undefined {
  let scripts: HTMLScriptElement[] = [];
  try {
    scripts = [
      ...targetWindow.document.querySelectorAll<HTMLScriptElement>(
        "script:not([src])",
      ),
    ];
  } catch {
    return;
  }
  const markers = [
    "ytInitialPlayerResponse =",
    "ytInitialPlayerResponse=",
    "var ytInitialPlayerResponse =",
    "var ytInitialPlayerResponse=",
  ];
  for (const script of scripts) {
    const source = script.textContent;
    if (!source?.includes("ytInitialPlayerResponse")) continue;
    for (const marker of markers) {
      const markerIndex = source.indexOf(marker);
      if (markerIndex < 0) continue;
      const start = source.indexOf("{", markerIndex + marker.length);
      if (start < 0) continue;
      const end = findJsonValueEnd(source, start);
      if (end < 0) continue;
      try {
        return JSON.parse(
          source.slice(start, end),
        ) as WebEmbeddedPlayerResponse;
      } catch {
        // Keep scanning other inline scripts/assignment forms.
      }
    }
  }
}

function getMainWorldWindow(targetWindow: WebAbrWindow): WebAbrWindow {
  // Tampermonkey/Violentmonkey can expose the real page global as unsafeWindow.
  // Firefox userscript sandboxes can expose the underlying page object through
  // wrappedJSObject. Prefer those objects so Request/fetch are patched in the
  // same realm as YouTube's native MWEB player.
  try {
    const unsafe = (
      globalThis as typeof globalThis & {
        unsafeWindow?: WebAbrWindow;
      }
    ).unsafeWindow;
    if (unsafe?.document && unsafe.location?.hostname.endsWith("youtube.com")) {
      return unsafe;
    }
  } catch {}

  try {
    const wrapped = (
      targetWindow as WebAbrWindow & {
        wrappedJSObject?: WebAbrWindow;
      }
    ).wrappedJSObject;
    if (
      wrapped?.document &&
      wrapped.location?.hostname.endsWith("youtube.com")
    ) {
      return wrapped;
    }
  } catch {}

  return targetWindow;
}

function getTopPageWindow(targetWindow: WebAbrWindow): WebAbrWindow {
  const pageWindow = getMainWorldWindow(targetWindow);
  try {
    const top = pageWindow.top as
      | (WebAbrWindow & {
          wrappedJSObject?: WebAbrWindow;
        })
      | null;
    if (top?.document && top.location?.hostname.endsWith("youtube.com")) {
      try {
        return top.wrappedJSObject ?? top;
      } catch {
        return top;
      }
    }
  } catch {
    // Cross-origin frames cannot expose the top page. Fall back to page realm.
  }
  return pageWindow;
}

type NativeSabrSession = {
  url: string;
  cpn: string;
  cver: string;
  rn?: string;
  alr?: string;
  observedAt: number;
  source: "resource-timing";
};

type NativeSabrAtomicSnapshot = {
  url: string;
  bytes: Uint8Array;
  cpn: string;
  cver: string;
  mediaId: string;
  // YouTube is an SPA: the previous player can keep issuing SABR requests for
  // a short time after location.href already points at the next video.
  // Record which watch video was active when this exact request was captured.
  pageVideoId?: string;
  rn?: string;
  alr?: string;
  capturedAt: number;
  source: "live-fetch-capture";
};

type NativeSabrCaptureState = {
  installed: boolean;
  latest?: NativeSabrAtomicSnapshot;
  waiters: Set<(snapshot: NativeSabrAtomicSnapshot) => void>;
  requestBodyCopies?: WeakMap<Request, Uint8Array>;
};

const NATIVE_SABR_CAPTURE_KEY = "__VOT_NATIVE_SABR_CAPTURE__";

function getNativeSabrCaptureState(
  pageWindow: WebAbrWindow,
): NativeSabrCaptureState {
  const holder = pageWindow as unknown as Record<string, unknown>;
  let state = holder[NATIVE_SABR_CAPTURE_KEY] as
    | NativeSabrCaptureState
    | undefined;
  if (!state) {
    state = { installed: false, waiters: new Set() };
    holder[NATIVE_SABR_CAPTURE_KEY] = state;
  }
  return state;
}

function copyMaterializedRequestBodyBytes(
  body: unknown,
): Uint8Array | undefined {
  if (body instanceof ArrayBuffer) return new Uint8Array(body.slice(0));
  if (ArrayBuffer.isView(body)) {
    const source = new Uint8Array(
      body.buffer,
      body.byteOffset,
      body.byteLength,
    );
    return new Uint8Array(source);
  }
  if (typeof body === "string") return new TextEncoder().encode(body);
  if (body instanceof URLSearchParams) {
    return new TextEncoder().encode(body.toString());
  }
}

function armNativeSabrLiveCapture(
  targetWindow: WebAbrWindow,
): NativeSabrCaptureState {
  const pageWindow = getTopPageWindow(targetWindow);
  const state = getNativeSabrCaptureState(pageWindow);
  if (state.installed) return state;

  // MWEB commonly materializes the SABR protobuf while constructing Request,
  // then passes that Request to fetch without init.body. Capture those bytes at
  // construction time, before the Request body becomes a ReadableStream.
  const NativeRequest = pageWindow.Request;
  const requestBodyCopies = new WeakMap<Request, Uint8Array>();
  state.requestBodyCopies = requestBodyCopies;

  function CapturingRequest(
    this: Request,
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Request {
    const request = new NativeRequest(input, init);
    try {
      const copied = copyMaterializedRequestBodyBytes(init?.body);
      if (copied) {
        requestBodyCopies.set(request, copied);
      } else if (input instanceof NativeRequest) {
        const inherited = requestBodyCopies.get(input);
        if (inherited)
          requestBodyCopies.set(request, new Uint8Array(inherited));
      }
    } catch {
      // Body capture is best-effort and must never disturb YouTube playback.
    }
    return request;
  }

  Object.setPrototypeOf(CapturingRequest, NativeRequest);
  CapturingRequest.prototype = NativeRequest.prototype;
  try {
    Object.defineProperty(CapturingRequest, "name", {
      value: "Request",
      configurable: true,
    });
  } catch {}
  pageWindow.Request = CapturingRequest as unknown as typeof Request;

  // Match the document-start Inspector: never replace YouTube's fetch promise
  // with an async wrapper. Native playback must receive its original promise.
  const nativeFetch = pageWindow.fetch;
  pageWindow.fetch = function (
    this: Window,
    input: RequestInfo | URL,
    init?: RequestInit,
  ) {
    const request = input instanceof NativeRequest ? input : undefined;
    const href =
      request?.url ??
      (typeof input === "string" || input instanceof URL
        ? String(input)
        : input.url);
    let candidate: URL | undefined;
    try {
      const u = new URL(href, pageWindow.location.href);
      if (
        u.hostname.endsWith("googlevideo.com") &&
        u.pathname === "/videoplayback" &&
        u.searchParams.get("sabr") === "1" &&
        u.searchParams.get("cpn") &&
        u.searchParams.get("cver")
      ) {
        candidate = u;
      }
    } catch {}

    // Inspector copies materialized bytes synchronously before native fetch.
    // Do not clone/read a Request or wait on its body in the playback path.
    const bytes = candidate
      ? (copyMaterializedRequestBodyBytes(init?.body) ??
        (request ? requestBodyCopies.get(request) : undefined))
      : undefined;
    const fetchPromise = nativeFetch.apply(
      this,
      arguments as unknown as [RequestInfo, RequestInit?],
    );

    if (candidate && bytes?.byteLength) {
      const capturedUrl = candidate;
      void fetchPromise
        .then((response) => {
          if (!response.ok) return;
          const cpn = capturedUrl.searchParams.get("cpn");
          const cver = capturedUrl.searchParams.get("cver");
          const mediaId = capturedUrl.searchParams.get("id");
          if (!cpn || !cver || !mediaId) return;
          let pageVideoId: string | undefined;
          try {
            pageVideoId =
              new URL(pageWindow.location.href).searchParams.get("v") ??
              undefined;
          } catch {}
          const snapshot: NativeSabrAtomicSnapshot = {
            url: capturedUrl.toString(),
            bytes: new Uint8Array(bytes),
            cpn,
            cver,
            mediaId,
            pageVideoId,
            rn: capturedUrl.searchParams.get("rn") ?? undefined,
            alr: capturedUrl.searchParams.get("alr") ?? undefined,
            capturedAt: Date.now(),
            source: "live-fetch-capture",
          };
          state.latest = snapshot;
          for (const resolve of [...state.waiters]) resolve(snapshot);
        })
        .catch(() => {
          // Never change the result of YouTube's original fetch.
        });
    }
    return fetchPromise;
  } as typeof fetch;

  state.installed = true;
  return state;
}

// Install the top-page hook as soon as this module is evaluated. This closes the
// first-load race where YouTube can send its initial SABR request before VOT
// starts the web_abr strategy. The iframe copy is harmless: getTopPageWindow()
// resolves the same top-page state when same-origin access is available.
try {
  if (typeof window !== "undefined") {
    armNativeSabrLiveCapture(window as WebAbrWindow);
  }
} catch {
  // Cross-realm/bootstrap timing can temporarily make top inaccessible. The
  // normal wait path below will retry installation.
}

async function waitForNativeSabrSnapshot(
  targetWindow: WebAbrWindow,
  signal: AbortSignal,
  expectedVideoId: string,
  timeoutMs = 15000,
  minCapturedAt = Date.now() - 3000,
): Promise<NativeSabrAtomicSnapshot | undefined> {
  const state = armNativeSabrLiveCapture(targetWindow);

  const belongsToCurrentVideo = (snapshot: NativeSabrAtomicSnapshot): boolean =>
    snapshot.capturedAt >= minCapturedAt &&
    snapshot.pageVideoId === expectedVideoId;

  // Time alone is not enough on YouTube SPA navigation: the old player can
  // continue sending SABR for a few seconds. Only reuse a request captured
  // while the page URL itself belonged to the requested video.
  if (state.latest && belongsToCurrentVideo(state.latest)) return state.latest;

  return await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (value?: NativeSabrAtomicSnapshot) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      state.waiters.delete(onSnapshot);
      signal.removeEventListener("abort", onAbort);
      resolve(value);
    };
    const onSnapshot = (snapshot: NativeSabrAtomicSnapshot) => {
      if (!belongsToCurrentVideo(snapshot)) {
        debug.log("Audio downloader. SABR ignored stale SPA snapshot", {
          expectedVideoId,
          snapshotVideoId: snapshot.pageVideoId ?? "unknown",
          ageMs: Date.now() - snapshot.capturedAt,
          cpn: snapshot.cpn,
        });
        return;
      }
      finish(snapshot);
    };
    const onAbort = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        state.waiters.delete(onSnapshot);
        reject(signal.reason);
      }
    };
    const timer = setTimeout(() => finish(undefined), timeoutMs);
    state.waiters.add(onSnapshot);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

type NativeSabrBodySnapshot = {
  bytes: Uint8Array;
  url?: string;
  source: "inspector" | "passive-capture";
};

function splitTopLevelProto(
  bytes: Uint8Array,
): Array<{ field: number; start: number; end: number }> {
  const out: Array<{ field: number; start: number; end: number }> = [];
  const readVarint = (offset: number) => {
    let value = 0,
      shift = 0,
      i = offset;
    while (i < bytes.length && shift <= 35) {
      const b = bytes[i++];
      value += (b & 0x7f) * 2 ** shift;
      if ((b & 0x80) === 0) return { value, next: i };
      shift += 7;
    }
    throw new Error("invalid protobuf varint");
  };
  let offset = 0;
  while (offset < bytes.length) {
    const start = offset;
    const tag = readVarint(offset);
    offset = tag.next;
    const field = Math.floor(tag.value / 8),
      wire = tag.value & 7;
    if (wire === 0) offset = readVarint(offset).next;
    else if (wire === 1) offset += 8;
    else if (wire === 2) {
      const len = readVarint(offset);
      offset = len.next + len.value;
    } else if (wire === 5) offset += 4;
    else throw new Error(`unsupported protobuf wire ${wire}`);
    if (offset > bytes.length) throw new Error("truncated protobuf field");
    out.push({ field, start, end: offset });
  }
  return out;
}

function spliceNativeTopLevelFields(
  generated: Uint8Array,
  nativeBytes: Uint8Array,
  replaceFields: ReadonlySet<number>,
): Uint8Array {
  const generatedParts = splitTopLevelProto(generated);
  const nativeParts = splitTopLevelProto(nativeBytes);
  const nativeByField = new Map<number, Uint8Array[]>();
  for (const part of nativeParts) {
    if (!replaceFields.has(part.field)) continue;
    const list = nativeByField.get(part.field) ?? [];
    list.push(nativeBytes.slice(part.start, part.end));
    nativeByField.set(part.field, list);
  }
  const chunks: Uint8Array[] = [];
  const inserted = new Set<number>();
  for (const part of generatedParts) {
    if (!replaceFields.has(part.field)) {
      chunks.push(generated.slice(part.start, part.end));
      continue;
    }
    if (inserted.has(part.field)) continue;
    for (const chunk of nativeByField.get(part.field) ?? []) chunks.push(chunk);
    inserted.add(part.field);
  }
  for (const field of replaceFields) {
    if (inserted.has(field)) continue;
    for (const chunk of nativeByField.get(field) ?? []) chunks.push(chunk);
  }
  const size = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
function normalizeNativeSabrUrl(
  nativeSessionUrl: string,
  requestNumber = "0",
): string {
  const url = new URL(nativeSessionUrl);
  // rn is request-local. Let the custom stream start its own sequence while
  // preserving the native playback session identity (cpn/cver/alr and signed
  // media URL). rn is not part of sparams/lsparams in observed WEB requests.
  url.searchParams.set("rn", requestNumber);
  return url.toString();
}

function getNativePlayerResponse(
  targetWindow: WebAbrWindow,
  videoId: string,
): WebEmbeddedPlayerResponse | undefined {
  const candidates: Array<{
    source: string;
    value?: WebEmbeddedPlayerResponse;
  }> = [];
  try {
    candidates.push({
      source: "window",
      value: targetWindow.ytInitialPlayerResponse,
    });
  } catch {
    // Sandboxed userscript globals may hide the page property.
  }
  candidates.push({
    source: "document",
    value: readInitialPlayerResponseFromDocument(targetWindow),
  });
  for (const candidate of candidates) {
    const value = candidate.value;
    if (!value) continue;
    const responseVideoId = value.videoDetails?.videoId;
    if (responseVideoId && responseVideoId !== videoId) continue;
    if (
      value.streamingData?.serverAbrStreamingUrl &&
      value.playerConfig?.mediaCommonConfig?.mediaUstreamerRequestConfig
        ?.videoPlaybackUstreamerConfig &&
      value.streamingData?.adaptiveFormats?.length
    ) {
      return value;
    }
  }
}

function readYtcfgFromDocument(targetWindow: Window): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  let scripts: HTMLScriptElement[] = [];
  try {
    scripts = [
      ...targetWindow.document.querySelectorAll<HTMLScriptElement>(
        "script:not([src])",
      ),
    ];
  } catch {
    return data;
  }
  for (const script of scripts) {
    const source = script.textContent;
    if (!source?.includes("ytcfg")) continue;
    Object.assign(data, parseYtcfgData(source));
  }
  return data;
}

export async function resolveYtcfg(
  targetWindow: WebAbrWindow,
  signal: AbortSignal,
): Promise<YouTubeConfig> {
  const pageConfig = targetWindow.ytcfg;
  if (
    pageConfig &&
    typeof getConfigValue(pageConfig, "INNERTUBE_API_KEY") === "string"
  ) {
    return pageConfig;
  }
  // A sandboxed userscript realm (Tampermonkey with any @grant) sees its own
  // globals, so recover the config from the page markup instead.
  let data = readYtcfgFromDocument(targetWindow);
  let source = "document";
  if (typeof data.INNERTUBE_API_KEY !== "string") {
    try {
      const response = await targetWindow.fetch(targetWindow.location.href, {
        credentials: "include",
        signal,
      });
      if (response.ok) {
        data = parseYtcfgData(await response.text());
        source = "page";
      }
    } catch (error) {
      signal.throwIfAborted();
      debug.log("Audio downloader. web ABR config request failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (typeof data.INNERTUBE_API_KEY !== "string") {
    throw new Error("Audio downloader. web ABR config is unavailable");
  }
  debug.log("Audio downloader. web ABR config recovered", {
    source,
    hasContext: Boolean(data.INNERTUBE_CONTEXT),
    loggedIn: data.LOGGED_IN === true,
  });
  return { data_: data };
}

function audioLanguageMatches(
  trackLanguage: string,
  requestedLanguage: string,
): boolean {
  const track = normalizeAudioLanguage(trackLanguage);
  const requested = normalizeAudioLanguage(requestedLanguage);
  if (!track || !requested || requested === "auto") return false;
  if (track === requested) return true;
  return track.split("-")[0] === requested.split("-")[0];
}

function isDrcAudioFormat(format: WebEmbeddedFormat): boolean {
  if (typeof format.xtags === "string" && format.xtags.includes("drc=1")) {
    return true;
  }
  try {
    const cipher =
      typeof format.signatureCipher === "string"
        ? new URLSearchParams(format.signatureCipher)
        : undefined;
    const rawUrl = format.url ?? cipher?.get("url");
    const xtags = rawUrl ? new URL(rawUrl).searchParams.get("xtags") : null;
    return xtags?.includes("drc=1") === true;
  } catch {
    return false;
  }
}

export function selectAudioFormat(
  formats: WebEmbeddedFormat[],
  requestedLanguage?: string,
): WebEmbeddedFormat {
  const withUrl = formats.filter(
    ({ url, signatureCipher }) =>
      typeof url === "string" || typeof signatureCipher === "string",
  );
  const audioOnly = withUrl.filter(
    ({ mimeType }) =>
      mimeType?.includes("audio/") && !mimeType?.includes("video/"),
  );

  // If VOT explicitly selected a source language, prefer that YouTube audio
  // track. BCP-47 variants are matched by exact tag first, then base language.
  const normalizedRequestedLanguage = normalizeAudioLanguage(requestedLanguage);
  const exactLanguageCandidates =
    normalizedRequestedLanguage && normalizedRequestedLanguage !== "auto"
      ? audioOnly.filter(
          (format) =>
            getAudioFormatLanguage(format) === normalizedRequestedLanguage,
        )
      : [];
  const requestedLanguageCandidates =
    exactLanguageCandidates.length > 0
      ? exactLanguageCandidates
      : normalizedRequestedLanguage && normalizedRequestedLanguage !== "auto"
        ? audioOnly.filter((format) =>
            audioLanguageMatches(
              getAudioFormatLanguage(format),
              normalizedRequestedLanguage,
            ),
          )
        : [];

  const defaultAudioOnly = audioOnly.filter(
    ({ audioTrack }) => audioTrack?.audioIsDefault === true,
  );
  const trackCandidates =
    requestedLanguageCandidates.length > 0
      ? requestedLanguageCandidates
      : defaultAudioOnly.length > 0
        ? defaultAudioOnly
        : audioOnly;
  const nonDrcCandidates = trackCandidates.filter(
    (format) => !isDrcAudioFormat(format),
  );
  const selected = selectSmallestAudioFormat(
    nonDrcCandidates.length > 0 ? nonDrcCandidates : trackCandidates,
  );

  if (!selected) {
    throw new Error(
      "Audio downloader. web ABR returned no direct audio-only formats",
    );
  }

  return selected;
}

async function sha1(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-1",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function buildSidAuthorization(
  scheme: string,
  sid: string,
  origin: string,
  timestamp: string,
  userSessionId?: string,
): Promise<string> {
  const hash = await sha1(
    userSessionId
      ? `${userSessionId} ${timestamp} ${sid} ${origin}`
      : `${timestamp} ${sid} ${origin}`,
  );
  return `${scheme} ${timestamp}_${hash}${userSessionId ? "_u" : ""}`;
}

async function getYouTubeAuthorization(
  targetWindow: Window,
  userSessionId?: string,
): Promise<string | undefined> {
  const cookies = new Map(
    targetWindow.document.cookie.split("; ").map((cookie) => {
      const separator = cookie.indexOf("=");
      return separator < 0
        ? [cookie, ""]
        : [cookie.slice(0, separator), cookie.slice(separator + 1)];
    }),
  );
  const timestamp = String(Math.round(Date.now() / 1000));
  const origin = "https://www.youtube.com";
  const authorizations = await Promise.all(
    [
      [
        "SAPISIDHASH",
        cookies.get("SAPISID") ?? cookies.get("__Secure-3PAPISID"),
      ],
      ["SAPISID1PHASH", cookies.get("__Secure-1PAPISID")],
      ["SAPISID3PHASH", cookies.get("__Secure-3PAPISID")],
    ].map(async ([scheme, sid]) =>
      sid
        ? buildSidAuthorization(
            scheme,
            sid,
            origin,
            timestamp,
            userSessionId || undefined,
          )
        : "",
    ),
  );
  return authorizations.filter(Boolean).join(" ") || undefined;
}

function getPlayerUrl(config: YouTubeConfig): string | undefined {
  const playerContexts = getConfigValue(config, "WEB_PLAYER_CONTEXT_CONFIGS") as
    | {
        WEB_PLAYER_CONTEXT_CONFIG_ID_EMBEDDED_PLAYER?: { jsUrl?: unknown };
      }
    | undefined;
  const value =
    getConfigValue(config, "PLAYER_JS_URL") ??
    getConfigValue(config, "JS_URL") ??
    playerContexts?.WEB_PLAYER_CONTEXT_CONFIG_ID_EMBEDDED_PLAYER?.jsUrl;
  return typeof value === "string"
    ? new URL(value, "https://www.youtube.com").toString()
    : undefined;
}

type TrustedTypePolicyFactory = {
  createPolicy: (
    name: string,
    rules: { createScript: (value: string) => string },
  ) => { createScript: (value: string) => unknown };
};

// A sandboxed or proxied global can lack trustedTypes while its Function is
// still Trusted Types-checked. The policy and the Function sink must live in
// the same realm, so probe same-origin ancestors for the policy factory.
function resolveTrustedRealm(realm: Window): Window {
  const candidates: Window[] = [realm];
  const add = (candidate: Window | null | undefined): void => {
    if (candidate && candidate !== realm) candidates.push(candidate);
  };
  try {
    add(realm.parent as Window | null);
  } catch {
    // Cross-origin access is denied.
  }
  try {
    add(realm.top as Window | null);
  } catch {
    // Cross-origin access is denied.
  }
  for (const candidate of candidates) {
    try {
      if (
        (candidate as unknown as { trustedTypes?: TrustedTypePolicyFactory })
          .trustedTypes?.createPolicy
      ) {
        return candidate;
      }
    } catch {
      // Cross-origin access is denied.
    }
  }
  return realm;
}

function runChallengeSolver(
  realm: Window,
  preparedPlayer: string,
  signature?: string,
  n?: string,
): { signature?: string; n?: string } {
  const nativeRealm = resolveTrustedRealm(realm);
  const trustedTypes = (
    nativeRealm as unknown as { trustedTypes?: TrustedTypePolicyFactory }
  ).trustedTypes;
  const policy = trustedTypes?.createPolicy(
    `vot-youtube-solver-${crypto.randomUUID()}`,
    {
      createScript: (value) => value,
    },
  );
  // Chrome's Function constructor rejects TrustedScript arguments
  // (crbug.com/1087743), so evaluate through eval, which accepts
  // TrustedScript. The IIFE keeps the player locals out of the page too, and
  // handing its result back as the completion value keeps the solver working
  // when eval runs in another realm than the caller (a sandboxed userscript).
  const source = `(function(){\nconst _result={sig:null,n:null};\n${preparedPlayer}\nreturn _result;\n})()`;
  const script = policy?.createScript(source) ?? source;
  const result = (
    nativeRealm as unknown as { eval: (value: unknown) => unknown }
  ).eval(script) as {
    sig?: ((value: string) => string) | null;
    n?: ((value: string) => string) | null;
  } | null;
  if (!result) {
    throw new Error("Audio downloader. YouTube challenge solver returned none");
  }
  const solved = {
    signature: signature && result.sig ? result.sig(signature) : undefined,
    n: n && result.n ? result.n(n) : undefined,
  };
  if ((signature && !solved.signature) || (n && !solved.n)) {
    throw new Error("Audio downloader. YouTube challenge solve incomplete");
  }
  return solved;
}

const SIG_PATTERN = /^[A-Za-z0-9_-]{20,}={0,2}$/;
const N_PATTERN = /^[A-Za-z0-9_-]{4,}$/;

// Only reachable functions can be reused. IIFE-local factories need the AST solver.
function listPageFunctions(pageWindow: WebAbrWindow): SigFactory[] {
  const found: SigFactory[] = [];
  const seen = new Set<unknown>();
  let visited = 0;
  const visit = (value: unknown, path: string, depth: number): void => {
    if (!value || seen.has(value) || depth > 3 || visited++ >= 5000) return;
    seen.add(value);
    if (typeof value === "function") {
      found.push({ fn: value as SigFactory["fn"], path });
    } else if (typeof value === "object") {
      try {
        for (const [key, descriptor] of Object.entries(
          Object.getOwnPropertyDescriptors(value),
        )) {
          if ("value" in descriptor) {
            visit(descriptor.value, `${path}.${key}`, depth + 1);
          }
        }
      } catch {
        // Inaccessible objects are not candidates.
      }
    }
  };
  try {
    const descriptors = Object.getOwnPropertyDescriptors(pageWindow);
    visit(descriptors._yt_player?.value, "_yt_player", 0);
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (typeof descriptor.value === "function")
        visit(descriptor.value, key, 0);
    }
  } catch {
    // Cross-origin access is denied.
  }
  return found;
}

// Media URL builders may set alr too; require the decipher factory's URL wiring.
const SIG_FACTORY_NEW_PATTERN =
  /([A-Za-z_$][\w$]*)\s*=\s*new\s+[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*\s*\(\s*\1\s*,\s*(?:!\s*0|true)\s*\)\s*;\s*\1\.set\(\s*["']alr["']\s*,\s*["']yes["']\s*\)/;
const EJS_MOCK_URL = "https://youtube.com/watch?v=yt-dlp-wins";

type SigFactory = {
  fn: (url: string, sp: string, s: string) => PageUrlInstance;
  path: string;
};

function isSigFactory({ fn }: SigFactory): boolean {
  try {
    return SIG_FACTORY_NEW_PATTERN.test(Function.prototype.toString.call(fn));
  } catch {
    return false;
  }
}

function pageUrlMethods(proto: object | null) {
  if (!proto) return;
  const descriptors = new Map<string, PropertyDescriptor>();
  for (let current = proto; current; current = Object.getPrototypeOf(current)) {
    for (const [key, descriptor] of Object.entries(
      Object.getOwnPropertyDescriptors(current),
    )) {
      if (!descriptors.has(key)) descriptors.set(key, descriptor);
    }
  }
  const get = descriptors.get("get")?.value;
  const set = descriptors.get("set")?.value;
  if (
    typeof get !== "function" ||
    typeof set !== "function" ||
    typeof descriptors.get("clone")?.value !== "function"
  ) {
    return;
  }
  const transforms = [...descriptors].flatMap(([key, descriptor]) => {
    if (["constructor", "set", "get", "clone"].includes(key)) return [];
    const method = descriptor.value;
    if (typeof method !== "function") return [];
    const source = Function.prototype.toString.call(method);
    return /\.set\(\s*["']n["']\s*,/.test(source) ||
      (/for\s*\([^)]*\bof\b[^)]*\.params\b/.test(source) &&
        /\.params\.set\(/.test(source))
      ? [method as (this: PageUrlInstance) => void]
      : [];
  });
  return { get, set, transforms };
}

type PageSolution = { signature?: string; n?: string };
type PageChallenge = PageSolution & { url: string; sp?: string };

function validPageValue(
  value: unknown,
  input: string | undefined,
  pattern: RegExp,
): string | undefined {
  if (!input || typeof value !== "string") return;
  let decoded = value;
  for (let index = 0; index < 3 && decoded.includes("%"); index++) {
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      return;
    }
  }
  return decoded !== input && pattern.test(decoded) ? decoded : undefined;
}

export function collectPageSolutions(
  pageWindow: WebAbrWindow,
  challenge: PageChallenge,
): PageSolution[] {
  const realms = new Set<WebAbrWindow>([pageWindow]);
  for (const relation of ["parent", "top"] as const) {
    try {
      const other = pageWindow[relation] as WebAbrWindow | null;
      if (other) realms.add(other);
    } catch {
      // Cross-origin access is denied.
    }
  }
  const solutions: PageSolution[] = [];
  const seen = new Set<SigFactory["fn"]>();
  const collect = (
    instance: PageUrlInstance,
    methods: NonNullable<ReturnType<typeof pageUrlMethods>>,
    transform: ((this: PageUrlInstance) => void) | undefined,
    factory: boolean,
  ): void => {
    const solution: PageSolution = {};
    const readSignature = () => {
      if (!challenge.signature) return;
      const keys = factory ? ["s"] : ["s", challenge.sp];
      for (const key of keys) {
        if (!key) continue;
        const value = validPageValue(
          methods.get.call(instance, key),
          challenge.signature,
          SIG_PATTERN,
        );
        if (value) return value;
      }
    };
    if (challenge.signature) {
      try {
        solution.signature = readSignature();
      } catch {
        // A bad signature must not discard an independently valid n.
      }
    }
    if (challenge.n && transform) {
      try {
        if (factory) methods.set.call(instance, "n", challenge.n);
        solution.n = validPageValue(
          methods.get.call(instance, "n"),
          challenge.n,
          N_PATTERN,
        );
        if (!solution.n) {
          transform.call(instance);
          solution.n = validPageValue(
            methods.get.call(instance, "n"),
            challenge.n,
            N_PATTERN,
          );
          if (!solution.signature) solution.signature = readSignature();
        }
      } catch {
        // Keep the signature even if the n transform fails.
      }
    }
    if (solution.signature || solution.n) solutions.push(solution);
  };
  for (const realm of realms) {
    for (const entry of listPageFunctions(realm)) {
      const { fn, path } = entry;
      if (seen.has(fn)) continue;
      seen.add(fn);
      try {
        if (isSigFactory(entry)) {
          const make = () =>
            fn(
              EJS_MOCK_URL,
              "s",
              encodeURIComponent(challenge.signature ?? ""),
            );
          const instance = make();
          if (!instance || typeof instance !== "object") continue;
          const methods = pageUrlMethods(Object.getPrototypeOf(instance));
          if (!methods) continue;
          collect(instance, methods, methods.transforms[0], true);
          if (challenge.n) {
            for (const transform of methods.transforms.slice(1)) {
              collect(make(), methods, transform, true);
            }
          }
        } else if (challenge.n && path.startsWith("_yt_player.")) {
          const proto = Object.getOwnPropertyDescriptor(fn, "prototype")?.value;
          const methods = pageUrlMethods(proto);
          if (!methods?.transforms.length) continue;
          // Vet the interface and n fingerprint before constructing anything.
          const UrlCtor = fn as unknown as PageUrlClass;
          for (const transform of methods.transforms) {
            try {
              collect(
                new UrlCtor(challenge.url, true),
                methods,
                transform,
                false,
              );
            } catch {
              // One failed construction does not invalidate other candidates.
            }
          }
        }
      } catch {
        // Inaccessible or incompatible page functions are not solutions.
      }
    }
  }
  const consensus: PageSolution = {};
  for (const field of ["signature", "n"] as const) {
    const values = new Set(
      solutions.map((solution) => solution[field]).filter(Boolean),
    );
    if (values.size === 1) consensus[field] = values.values().next().value;
  }
  const merged = new Map<string, PageSolution>();
  for (const solution of solutions) {
    const candidate = {
      signature: solution.signature ?? consensus.signature,
      n: solution.n ?? consensus.n,
    };
    merged.set(JSON.stringify(candidate), candidate);
  }
  return [...merged.values()];
}

function solveYouTubeChallenges(
  targetWindow: Window,
  playerCode: string,
  signature?: string,
  n?: string,
): { signature?: string; n?: string } {
  const preparedPlayer = preprocessYouTubePlayer(playerCode);
  const errors: string[] = [];
  try {
    // The embed page CSP allows unsafe-eval; its globals are all defined,
    // so the solver setup is a no-op there and Function scope keeps the
    // player code from leaking into the page.
    return runChallengeSolver(targetWindow, preparedPlayer, signature, n);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  const sandbox = targetWindow.document.createElement("iframe");
  sandbox.style.display = "none";
  sandbox.setAttribute("aria-hidden", "true");
  sandbox.setAttribute("sandbox", "allow-scripts allow-same-origin");
  (targetWindow.document.body ?? targetWindow.document.documentElement).append(
    sandbox,
  );
  try {
    const realm = sandbox.contentWindow;
    if (!realm) throw new Error("Challenge solver sandbox is unavailable");
    return runChallengeSolver(realm, preparedPlayer, signature, n);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    sandbox.remove();
  }
  throw new Error(
    `Audio downloader. YouTube challenge solve failed (${errors.join(" | ")})`,
  );
}

function buildSolvedUrl(
  rawUrl: string,
  sp: string | undefined,
  solved: { signature?: string; n?: string },
): string {
  const url = new URL(rawUrl);
  if (solved.signature)
    url.searchParams.set(sp ?? "signature", solved.signature);
  if (solved.n) url.searchParams.set("n", solved.n);
  return url.toString();
}

export async function* resolveFormatUrl(
  targetWindow: WebAbrWindow,
  format: WebEmbeddedFormat,
  playerCode: () => Promise<string | undefined>,
  signal: AbortSignal,
): AsyncGenerator<string> {
  signal.throwIfAborted();
  const cipher = format.signatureCipher
    ? new URLSearchParams(format.signatureCipher)
    : undefined;
  const rawUrl = format.url ?? cipher?.get("url");
  if (!rawUrl) {
    throw new Error("Audio downloader. web ABR format URL is unavailable");
  }
  const url = new URL(rawUrl);
  const signature = cipher?.get("s") ?? undefined;
  const n = url.searchParams.get("n") ?? undefined;
  if (!signature && !n) {
    yield url.toString();
    signal.throwIfAborted();
    return;
  }
  const challenge = {
    url: rawUrl,
    sp: cipher?.get("sp") ?? undefined,
    signature,
    n,
  };
  const candidates = collectPageSolutions(targetWindow, challenge);
  signal.throwIfAborted();
  const complete = (solution: PageSolution) =>
    (!signature || !!solution.signature) && (!n || !!solution.n);
  candidates.sort((a, b) => Number(complete(b)) - Number(complete(a)));
  let source: Promise<string | undefined> | undefined;
  const astSolutions = new Map<string, PageSolution>();
  const solve = async (
    signature?: string,
    n?: string,
  ): Promise<PageSolution> => {
    signal.throwIfAborted();
    const key = JSON.stringify([signature, n]);
    const cached = astSolutions.get(key);
    if (cached) return cached;
    source ??= playerCode();
    const code = await source;
    signal.throwIfAborted();
    if (!code) {
      throw new Error("Audio downloader. YouTube player code is unavailable");
    }
    const raw = solveYouTubeChallenges(targetWindow, code, signature, n);
    signal.throwIfAborted();
    const solved = {
      signature: validPageValue(raw.signature, signature, SIG_PATTERN),
      n: validPageValue(raw.n, n, N_PATTERN),
    };
    if ((signature && !solved.signature) || (n && !solved.n)) {
      throw new Error("Audio downloader. YouTube challenge solve invalid");
    }
    astSolutions.set(key, solved);
    return solved;
  };
  const yielded = new Set<string>();
  const errors: string[] = [];
  for (const candidate of candidates) {
    signal.throwIfAborted();
    let solved = candidate;
    try {
      if (!complete(candidate)) {
        const missing = await solve(
          candidate.signature ? undefined : signature,
          candidate.n ? undefined : n,
        );
        solved = {
          signature: candidate.signature ?? missing.signature,
          n: candidate.n ?? missing.n,
        };
      }
    } catch (error) {
      signal.throwIfAborted();
      errors.push(error instanceof Error ? error.message : String(error));
      continue;
    }
    signal.throwIfAborted();
    const candidateUrl = buildSolvedUrl(rawUrl, challenge.sp, solved);
    if (!yielded.has(candidateUrl)) {
      yielded.add(candidateUrl);
      yield candidateUrl;
    }
  }
  // Resume only after the consumer has tried downloading the page candidates.
  signal.throwIfAborted();
  let solved: PageSolution;
  try {
    solved = await solve(signature, n);
  } catch (error) {
    signal.throwIfAborted();
    errors.push(error instanceof Error ? error.message : String(error));
    throw new Error(
      `Audio downloader. challenge solve failed (${errors.join(" | ")})`,
    );
  }
  signal.throwIfAborted();
  const fallbackUrl = buildSolvedUrl(rawUrl, challenge.sp, solved);
  if (!yielded.has(fallbackUrl)) yield fallbackUrl;
  signal.throwIfAborted();
}

export function buildSabrPlayerRequest(
  config: YouTubeConfig,
  videoId: string,
  extractedSignatureTimestamp?: number,
): Record<string, unknown> {
  const rawContext = getConfigValue(config, "INNERTUBE_CONTEXT");
  if (!rawContext || typeof rawContext !== "object") {
    throw new Error("Audio downloader. web client context is unavailable");
  }

  const context = JSON.parse(JSON.stringify(rawContext)) as {
    client?: Record<string, unknown>;
    thirdParty?: Record<string, unknown>;
  };
  context.client ??= {};
  const client = context.client;
  client.clientName = "WEB";
  client.clientVersion =
    getConfigValue(config, "INNERTUBE_CLIENT_VERSION") ?? client.clientVersion;
  client.originalUrl = `https://www.youtube.com/watch?v=${videoId}`;
  delete context.thirdParty;

  const contentPlaybackContext = buildContentPlaybackContext(
    extractedSignatureTimestamp ?? getConfigValue(config, "STS"),
  );

  return {
    context,
    videoId,
    playbackContext: { contentPlaybackContext },
    contentCheckOk: true,
    racyCheckOk: true,
  };
}

export function buildWebCreatorPlayerRequest(
  videoId: string,
  options: {
    visitorData?: unknown;
    signatureTimestamp?: number;
    clientVersion?: unknown;
  } = {},
): Record<string, unknown> {
  const contentPlaybackContext = buildContentPlaybackContext(
    options.signatureTimestamp,
  );
  return {
    context: {
      client: {
        clientName: "WEB_CREATOR",
        clientVersion:
          typeof options.clientVersion === "string" && options.clientVersion
            ? options.clientVersion
            : "1.20260708.06.00",
        hl: "en",
        gl: "US",
        timeZone: "UTC",
        utcOffsetMinutes: 0,
        ...(typeof options.visitorData === "string"
          ? { visitorData: options.visitorData }
          : {}),
      },
    },
    videoId,
    playbackContext: { contentPlaybackContext },
    contentCheckOk: true,
    racyCheckOk: true,
  };
}

async function postInnertubePlayer(
  targetWindow: Window,
  signal: AbortSignal,
  apiKey: string,
  body: Record<string, unknown>,
  clientName: string,
  clientVersion: string,
  extra: {
    authorization?: string;
    sessionIndex?: unknown;
    delegatedSessionId?: unknown;
  },
): Promise<WebEmbeddedPlayerResponse> {
  const visitorData = (body.context as { client?: { visitorData?: unknown } })
    ?.client?.visitorData;
  const authenticated = Boolean(extra.authorization);
  const response = await targetWindow.fetch(
    `https://www.youtube.com/youtubei/v1/player?prettyPrint=false&key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      credentials: authenticated ? "include" : "omit",
      signal,
      headers: {
        "content-type": "application/json",
        "x-youtube-client-name": clientName,
        "x-youtube-client-version": clientVersion,
        ...(typeof visitorData === "string"
          ? { "x-goog-visitor-id": visitorData }
          : {}),
        ...(authenticated
          ? {
              authorization: extra.authorization,
              "x-origin": "https://www.youtube.com",
              "x-youtube-bootstrap-logged-in": "true",
              ...(typeof extra.sessionIndex === "number" ||
              typeof extra.sessionIndex === "string"
                ? { "x-goog-authuser": String(extra.sessionIndex) }
                : {}),
              ...(typeof extra.delegatedSessionId === "string" &&
              extra.delegatedSessionId
                ? { "x-goog-pageid": extra.delegatedSessionId }
                : {}),
            }
          : {}),
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Audio downloader. player request failed (${response.status})`,
    );
  }
  return (await response.json()) as WebEmbeddedPlayerResponse;
}

async function probeContentLength(
  targetWindow: Window,
  streamUrl: string,
  signal: AbortSignal,
  authenticated: boolean,
): Promise<number> {
  const url = new URL(streamUrl);
  url.searchParams.set("range", "0-0");
  url.searchParams.delete("ump");
  const response = await targetWindow.fetch(url, {
    signal,
    credentials: authenticated ? "include" : "omit",
  });
  if (!response.ok) {
    throw new Error(
      `Audio downloader. web ABR media probe failed (${response.status})`,
    );
  }
  const total = Number(
    /\/(\d+)\s*$/.exec(response.headers.get("content-range") ?? "")?.[1],
  );
  if (!(total > 0)) {
    throw new Error("Audio downloader. web ABR content length unknown");
  }
  return total;
}

type MediaRange = { start: number; end: number };
type MediaUrlState = {
  value: string;
  refreshPromise: Promise<string> | null;
  version: number;
};
type RequestNumberRef = { value: number };
type PendingState = { buffers: Uint8Array[]; size: number };
type WebAbrTransport =
  | "parallel_4"
  | "4mb"
  | "parallel_8"
  | "8mb"
  | "parallel_2"
  | "2mb"
  | "stream"
  | "original";

const WEB_ABR_TRANSPORTS: WebAbrTransport[] = [
  "4mb",
  "2mb",
  "stream",
  "original",
  "8mb",
  "stream",
];

function makeFixedRanges(
  contentLength: number,
  chunkSize: number,
): MediaRange[] {
  const ranges: MediaRange[] = [];
  for (let start = 0; start < contentLength; start += chunkSize) {
    ranges.push({
      start,
      end: Math.min(contentLength - 1, start + chunkSize - 1),
    });
  }
  return ranges;
}

const WEB_ABR_RANGE_MAX_ATTEMPTS = 10;
const WEB_ABR_RANGE_REFRESH_EVERY_FAILURES = 2;
const WEB_ABR_RANGE_RETRY_BASE_DELAY_MS = 250;
const WEB_ABR_RANGE_RETRY_MAX_DELAY_MS = 1500;

// Permanent media HTTP statuses should not be retried repeatedly by the same
// range request. After one signed URL refresh, fail the current transport and
// let the transport matrix try the remaining alternatives.
// 408/425/429/5xx and network errors stay retryable.
const WEB_ABR_FATAL_MEDIA_STATUSES = new Set([401, 403, 404, 410]);

class MediaHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "MediaHttpError";
  }
}

function isFatalMediaError(error: unknown): boolean {
  return (
    error instanceof MediaHttpError &&
    WEB_ABR_FATAL_MEDIA_STATUSES.has(error.status)
  );
}

async function refreshMediaUrl(
  urlState: MediaUrlState,
  refreshUrl: () => Promise<string>,
  reason: unknown = null,
): Promise<string> {
  if (!urlState.refreshPromise) {
    const previousUrl = urlState.value;
    const previousVersion = urlState.version ?? 0;
    urlState.refreshPromise = Promise.resolve()
      .then(() => refreshUrl())
      .then((nextUrl) => {
        if (typeof nextUrl !== "string" || !nextUrl) {
          throw new Error("Audio downloader. Failed to refresh media URL");
        }
        urlState.value = nextUrl;
        urlState.version = previousVersion + 1;
        debug.log("Audio downloader. web ABR media URL refresh applied", {
          reason,
          version: urlState.version,
          urlChanged: nextUrl !== previousUrl,
        });
        return nextUrl;
      })
      .finally(() => {
        urlState.refreshPromise = null;
      });
  }
  return await urlState.refreshPromise;
}

async function fetchMediaRange(
  targetWindow: Window,
  urlState: MediaUrlState,
  start: number,
  end: number,
  signal: AbortSignal,
  refreshUrl: () => Promise<string>,
  requestNumberRef: RequestNumberRef,
  authenticated: boolean,
): Promise<Uint8Array> {
  let lastError: unknown;
  let refreshedFatal = false;
  for (let attempt = 0; attempt < WEB_ABR_RANGE_MAX_ATTEMPTS; attempt++) {
    signal.throwIfAborted();
    // If another failed range is already refreshing the signed media URL,
    // wait for that refresh before starting this retry. This keeps every retry
    // on the newest URL without restarting ranges that already succeeded.
    if (attempt > 0 && urlState.refreshPromise) {
      await urlState.refreshPromise;
    }
    try {
      const urlVersion = urlState.version ?? 0;
      const url = new URL(urlState.value);
      url.searchParams.set("range", `${start}-${end}`);
      url.searchParams.set("rn", String(++requestNumberRef.value));
      url.searchParams.delete("ump");
      const response = await targetWindow.fetch(url, {
        signal,
        cache: "no-store",
        credentials: authenticated ? "include" : "omit",
      });
      if (!response.ok) {
        debug.log("Audio downloader. web ABR media HTTP failure", {
          status: response.status,
          range: `${start}-${end}`,
          urlVersion,
          host: url.hostname,
          hasPoToken: url.searchParams.has("pot"),
          hasN: url.searchParams.has("n"),
          hasSignature:
            url.searchParams.has("sig") || url.searchParams.has("signature"),
          expire: url.searchParams.get("expire") ?? "none",
        });
        throw new MediaHttpError(
          response.status,
          `Audio downloader. Media request failed (${response.status}, range ${start}-${end})`,
        );
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      signal.throwIfAborted();
      if (bytes.byteLength === end - start + 1) {
        if (attempt > 0) {
          debug.log("Audio downloader. web ABR range recovered", {
            range: `${start}-${end}`,
            attempt: attempt + 1,
            maxAttempts: WEB_ABR_RANGE_MAX_ATTEMPTS,
            urlVersion,
          });
        }
        return bytes;
      }
      const redirect = new TextDecoder("ascii")
        .decode(bytes)
        .match(/^\s*(https:\/\/\S+)\s*$/)?.[1];
      if (redirect) {
        const next = new URL(redirect);
        if (!/(?:^|\.)googlevideo\.com$/.test(next.hostname))
          throw new Error("Audio downloader. Invalid media redirect");
        urlState.value = next.toString();
        if (attempt + 1 < WEB_ABR_RANGE_MAX_ATTEMPTS) continue;
      }
      throw new Error(
        `Audio downloader. Incomplete web ABR chunk (${bytes.byteLength}/${end - start + 1}, range ${start}-${end})`,
      );
    } catch (error) {
      signal.throwIfAborted();
      lastError = error;
      const failedAttempt = attempt + 1;
      const fatal = isFatalMediaError(error);
      const hasMoreAttempts = failedAttempt < WEB_ABR_RANGE_MAX_ATTEMPTS;
      // A permanent status still gets one URL refresh (expired signatures look
      // like 403), but a second fatal failure or a failed refresh ends this
      // range so the current transport can fail and the matrix can continue.
      const shouldRefreshUrl =
        hasMoreAttempts &&
        (fatal || failedAttempt % WEB_ABR_RANGE_REFRESH_EVERY_FAILURES === 0);

      debug.log("Audio downloader. web ABR range request failed", {
        range: `${start}-${end}`,
        attempt: failedAttempt,
        maxAttempts: WEB_ABR_RANGE_MAX_ATTEMPTS,
        fatal,
        refreshUrl: shouldRefreshUrl,
        error: error instanceof Error ? error.message : String(error),
      });

      if (!hasMoreAttempts) break;
      if (fatal && refreshedFatal) break;

      await createAbortableDelay(
        Math.min(
          WEB_ABR_RANGE_RETRY_BASE_DELAY_MS * failedAttempt,
          WEB_ABR_RANGE_RETRY_MAX_DELAY_MS,
        ),
        signal,
      );

      if (shouldRefreshUrl) {
        try {
          await refreshMediaUrl(urlState, refreshUrl, {
            range: `${start}-${end}`,
            failedAttempt,
          });
          if (fatal) refreshedFatal = true;
          debug.log(
            "Audio downloader. web ABR media URL refreshed for range retry",
            {
              range: `${start}-${end}`,
              nextAttempt: failedAttempt + 1,
              urlVersion: urlState.version ?? 0,
            },
          );
        } catch (refreshError) {
          signal.throwIfAborted();
          debug.log("Audio downloader. web ABR media URL refresh failed", {
            range: `${start}-${end}`,
            nextAttempt: failedAttempt + 1,
            error:
              refreshError instanceof Error
                ? refreshError.message
                : String(refreshError),
          });
          // Keep the fatal HTTP error as lastError so the current transport
          // stops instead of retrying the same permanent failure.
          if (fatal) break;
          lastError = refreshError;
        }
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Audio downloader. Media range failed");
}

async function* emitOrderedBuffers(
  buffers: Uint8Array[],
  isLastBatch: boolean,
  pendingState: PendingState,
): AsyncGenerator<AudioChunk> {
  for (let bufferIndex = 0; bufferIndex < buffers.length; bufferIndex++) {
    const buffer = buffers[bufferIndex];
    pendingState.buffers.push(buffer);
    pendingState.size += buffer.byteLength;

    const isFinalBuffer = isLastBatch && bufferIndex === buffers.length - 1;
    if (pendingState.size >= config.minChunkSize && !isFinalBuffer) {
      yield {
        buffer: concatBuffers(pendingState.buffers),
        isLastChunk: false,
      };
      pendingState.buffers = [];
      pendingState.size = 0;
    }
  }

  if (isLastBatch) {
    if (pendingState.size < 1) {
      throw new Error("Audio downloader. Final web ABR chunk is empty");
    }
    yield {
      buffer: concatBuffers(pendingState.buffers),
      isLastChunk: true,
    };
    pendingState.buffers = [];
    pendingState.size = 0;
  }
}

async function* downloadRangesSequential(
  targetWindow: Window,
  streamUrl: string,
  _contentLength: number,
  signal: AbortSignal,
  refreshUrl: () => Promise<string>,
  ranges: MediaRange[],
  authenticated: boolean,
): AsyncGenerator<AudioChunk> {
  const urlState: MediaUrlState = {
    value: streamUrl,
    refreshPromise: null,
    version: 0,
  };
  const requestNumberRef: RequestNumberRef = { value: 0 };
  const pendingState: PendingState = { buffers: [], size: 0 };
  for (let index = 0; index < ranges.length; index++) {
    const { start, end } = ranges[index];
    const buffer = await fetchMediaRange(
      targetWindow,
      urlState,
      start,
      end,
      signal,
      refreshUrl,
      requestNumberRef,
      authenticated,
    );
    for await (const chunk of emitOrderedBuffers(
      [buffer],
      index === ranges.length - 1,
      pendingState,
    ))
      yield chunk;
  }
}

async function* downloadRangesParallel(
  targetWindow: Window,
  streamUrl: string,
  contentLength: number,
  signal: AbortSignal,
  refreshUrl: () => Promise<string>,
  concurrency: number,
  authenticated: boolean,
): AsyncGenerator<AudioChunk> {
  const ranges = makeFixedRanges(contentLength, 4 * 1024 * 1024);
  const urlState: MediaUrlState = {
    value: streamUrl,
    refreshPromise: null,
    version: 0,
  };
  const requestNumberRef: RequestNumberRef = { value: 0 };
  const pendingState: PendingState = { buffers: [], size: 0 };

  for (let index = 0; index < ranges.length; index += concurrency) {
    signal.throwIfAborted();
    const batch = ranges.slice(index, index + concurrency);
    const buffers = await Promise.all(
      batch.map(({ start, end }) =>
        fetchMediaRange(
          targetWindow,
          urlState,
          start,
          end,
          signal,
          refreshUrl,
          requestNumberRef,
          authenticated,
        ),
      ),
    );
    for await (const chunk of emitOrderedBuffers(
      buffers,
      index + batch.length >= ranges.length,
      pendingState,
    ))
      yield chunk;
  }
}

async function* downloadStream(
  targetWindow: Window,
  streamUrl: string,
  signal: AbortSignal,
  authenticated: boolean,
): AsyncGenerator<AudioChunk> {
  const url = new URL(streamUrl);
  url.searchParams.delete("range");
  url.searchParams.delete("rn");
  url.searchParams.delete("ump");
  const response = await targetWindow.fetch(url, {
    signal,
    credentials: authenticated ? "include" : "omit",
  });
  if (!response.ok)
    throw new Error(
      `Audio downloader. Stream request failed (${response.status})`,
    );
  if (!response.body)
    throw new Error("Audio downloader. Stream body is unavailable");

  const reader = response.body.getReader();
  const pending: Uint8Array[] = [];
  let pendingSize = 0;
  let readyChunk: Uint8Array | null = null;
  try {
    for (;;) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
      pending.push(bytes);
      pendingSize += bytes.byteLength;
      if (pendingSize >= config.minChunkSize) {
        const nextChunk = concatBuffers(pending);
        pending.length = 0;
        pendingSize = 0;

        if (readyChunk) {
          yield {
            buffer: readyChunk,
            isLastChunk: false,
          };
        }
        readyChunk = nextChunk;
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {}
  }

  if (pendingSize > 0) {
    if (readyChunk) {
      yield {
        buffer: readyChunk,
        isLastChunk: false,
      };
    }
    yield {
      buffer: concatBuffers(pending),
      isLastChunk: true,
    };
    return;
  }

  if (!readyChunk?.byteLength) {
    throw new Error("Audio downloader. Stream ended without audio data");
  }
  yield {
    buffer: readyChunk,
    isLastChunk: true,
  };
}

async function* downloadWithTransport(
  targetWindow: Window,
  transport: WebAbrTransport,
  streamUrl: string,
  contentLength: number,
  signal: AbortSignal,
  refreshUrl: () => Promise<string>,
  authenticated: boolean,
): AsyncGenerator<AudioChunk> {
  switch (transport) {
    case "parallel_4":
      yield* downloadRangesParallel(
        targetWindow,
        streamUrl,
        contentLength,
        signal,
        refreshUrl,
        4,
        authenticated,
      );
      return;
    case "parallel_2":
      yield* downloadRangesParallel(
        targetWindow,
        streamUrl,
        contentLength,
        signal,
        refreshUrl,
        2,
        authenticated,
      );
      return;
    case "parallel_8":
      yield* downloadRangesParallel(
        targetWindow,
        streamUrl,
        contentLength,
        signal,
        refreshUrl,
        8,
        authenticated,
      );
      return;
    case "stream":
      yield* downloadStream(targetWindow, streamUrl, signal, authenticated);
      return;
    case "8mb":
      yield* downloadRangesSequential(
        targetWindow,
        streamUrl,
        contentLength,
        signal,
        refreshUrl,
        makeFixedRanges(contentLength, 8 * 1024 * 1024),
        authenticated,
      );
      return;
    case "4mb":
      yield* downloadRangesSequential(
        targetWindow,
        streamUrl,
        contentLength,
        signal,
        refreshUrl,
        makeFixedRanges(contentLength, 4 * 1024 * 1024),
        authenticated,
      );
      return;
    case "2mb":
      yield* downloadRangesSequential(
        targetWindow,
        streamUrl,
        contentLength,
        signal,
        refreshUrl,
        makeFixedRanges(contentLength, 2 * 1024 * 1024),
        authenticated,
      );
      return;
    case "original":
      yield* downloadRangesSequential(
        targetWindow,
        streamUrl,
        contentLength,
        signal,
        refreshUrl,
        buildMediaRanges(contentLength),
        authenticated,
      );
      return;
    default:
      throw new Error(
        `Audio downloader. Unknown web ABR transport: ${transport}`,
      );
  }
}

export async function* downloadMediaRanges(
  targetWindow: Window,
  streamUrl: string,
  contentLength: number,
  signal: AbortSignal,
  refreshUrl: () => Promise<string>,
  authenticated: boolean,
): AsyncGenerator<AudioChunk> {
  if (!Number.isSafeInteger(contentLength) || contentLength < 1)
    throw new Error("Audio downloader. Invalid media content length");

  // Start with parallel_4 and move forward through the fallback list.
  const transports = [...WEB_ABR_TRANSPORTS];
  debug.log("Audio downloader. web ABR transport order", {
    transports,
    bufferBeforeEmit: true,
  });

  let lastError: unknown;
  for (const transport of transports) {
    signal.throwIfAborted();
    const startedAt = performance.now();
    try {
      debug.log("Audio downloader. web ABR transport started", {
        transport,
        contentLength,
        bufferBeforeEmit: true,
      });

      // Do not expose any audio to the outer uploader until the selected
      // transport has downloaded the complete source audio successfully.
      // This makes fallback safe even if a transport fails near the end.
      const bufferedChunks: AudioChunk[] = [];
      let downloadedBytes = 0;
      for await (const chunk of downloadWithTransport(
        targetWindow,
        transport,
        streamUrl,
        contentLength,
        signal,
        refreshUrl,
        authenticated,
      )) {
        if (!chunk?.buffer?.byteLength) {
          throw new Error(
            "Audio downloader. Web ABR transport produced an empty chunk",
          );
        }
        bufferedChunks.push(chunk);
        downloadedBytes += chunk.buffer.byteLength;
      }

      if (downloadedBytes !== contentLength) {
        throw new Error(
          `Audio downloader. Incomplete web ABR download (${downloadedBytes}/${contentLength} bytes)`,
        );
      }
      if (bufferedChunks.length < 1) {
        throw new Error(
          "Audio downloader. Web ABR transport returned no audio chunks",
        );
      }

      // Normalize finalization after the full download is verified.
      for (let index = 0; index < bufferedChunks.length; index++) {
        bufferedChunks[index] = {
          ...bufferedChunks[index],
          isLastChunk: index === bufferedChunks.length - 1,
        };
      }

      debug.log("Audio downloader. web ABR transport fully buffered", {
        transport,
        chunks: bufferedChunks.length,
        downloadedBytes,
        elapsedMs: Math.round(performance.now() - startedAt),
      });

      // Only now make the chunks visible to AudioDownloader/Yandex upload.
      for (const chunk of bufferedChunks) yield chunk;

      debug.log("Audio downloader. web ABR transport finished", {
        transport,
        elapsedMs: Math.round(performance.now() - startedAt),
        bufferBeforeEmit: true,
      });
      return;
    } catch (error) {
      signal.throwIfAborted();
      lastError = error;
      debug.log("Audio downloader. web ABR transport failed", {
        transport,
        emitted: false,
        bufferBeforeEmit: true,
        elapsedMs: Math.round(performance.now() - startedAt),
        error: error instanceof Error ? error.message : String(error),
      });
      // A fatal media status only ends the current transport. Other transports
      // use different request shapes and may still succeed with the same media.
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Audio downloader. All web ABR transports failed");
}

function toSabrFormat(format: WebEmbeddedFormat): SabrFormat | undefined {
  const itag = Number(format.itag);
  const bitrate = Number(format.bitrate ?? format.averageBitrate);
  const approxDurationMs = Number(format.approxDurationMs);
  const lastModified = String(format.lastModified ?? "");
  if (!(itag > 0) || !(bitrate > 0) || !(approxDurationMs > 0) || !lastModified)
    return;
  const language = getAudioFormatLanguage(format) || undefined;
  return {
    itag,
    lastModified,
    xtags: format.xtags,
    width: format.width,
    height: format.height,
    contentLength: Number(format.contentLength) || undefined,
    audioTrackId: format.audioTrackId ?? format.audioTrack?.id,
    mimeType: format.mimeType,
    isDrc: isDrcAudioFormat(format),
    quality: format.quality,
    qualityLabel: format.qualityLabel,
    averageBitrate: Number(format.averageBitrate) || undefined,
    bitrate,
    audioQuality: format.audioQuality,
    approxDurationMs,
    language,
    isOriginal: format.audioTrack?.audioIsDefault === true,
  };
}

function describeError(error: unknown) {
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    errorMessage: error instanceof Error ? error.message : String(error),
    errorStack: error instanceof Error ? error.stack : undefined,
    errorCause:
      error instanceof Error && "cause" in error
        ? String(error.cause)
        : undefined,
  };
}

type VotNativeProtoContext = {
  videoId: string;
  nativeSabrBody?: NativeSabrBodySnapshot;
  buildIndex: number;
  pageWindow: WebAbrWindow;
};

// Context must belong to a SabrStream INSTANCE, not SabrStream.prototype.
// YouTube SPA navigation can leave the previous stream alive briefly.
const VOT_SABR_INSTANCE_CONTEXT = new WeakMap<object, VotNativeProtoContext>();

async function* trySabrAudioChunks(
  targetWindow: WebAbrWindow,
  videoId: string,
  signal: AbortSignal,
  sourceLanguage?: string,
): AsyncGenerator<AudioChunk> {
  debug.log("Audio downloader. SABR strategy started", { videoId });
  const config = await resolveYtcfg(targetWindow, signal);
  const apiKey = getConfigValue(config, "INNERTUBE_API_KEY");
  if (typeof apiKey !== "string")
    throw new Error("Audio downloader. SABR config is unavailable");

  const body = buildSabrPlayerRequest(
    config,
    videoId,
    Number(getConfigValue(config, "STS")),
  );
  const context = body.context as { client: Record<string, unknown> };
  const clientVersion = String(context.client.clientVersion ?? "");
  const visitorData =
    context.client.visitorData ?? getConfigValue(config, "VISITOR_DATA");
  if (typeof visitorData === "string") context.client.visitorData = visitorData;

  const dataSyncId = getConfigValue(config, "DATASYNC_ID");
  const [firstSyncId, secondSyncId] =
    typeof dataSyncId === "string" ? dataSyncId.split("||") : [];
  const authorization = await getYouTubeAuthorization(
    targetWindow,
    String(
      getConfigValue(config, "USER_SESSION_ID") ??
        (secondSyncId || firstSyncId) ??
        "",
    ) || undefined,
  );
  const auth = authorization
    ? {
        authorization,
        sessionIndex: getConfigValue(config, "SESSION_INDEX"),
        delegatedSessionId:
          getConfigValue(config, "DELEGATED_SESSION_ID") ??
          (secondSyncId ? firstSyncId : undefined),
      }
    : {};

  let player = await postInnertubePlayer(
    targetWindow,
    signal,
    apiKey,
    body,
    "1",
    clientVersion,
    {},
  );
  if (
    authorization &&
    /LOGIN_REQUIRED|AGE_CHECK_REQUIRED|CONTENT_CHECK_REQUIRED/.test(
      player.playabilityStatus?.status ?? "",
    )
  ) {
    player = await postInnertubePlayer(
      targetWindow,
      signal,
      apiKey,
      body,
      "1",
      clientVersion,
      auth,
    );
  }

  // Prefer the exact player response used by the native YouTube player.
  // SABR authorization is tied to its ustreamer config/format metadata; a
  // separately generated /player response can be valid while still producing
  // a different SABR request payload. Keep our fetched response as fallback.
  const nativePlayer = getNativePlayerResponse(targetWindow, videoId);
  if (nativePlayer) player = nativePlayer;

  const playerServerAbrStreamingUrl =
    player.streamingData?.serverAbrStreamingUrl;

  // Standalone mode: capture the next successful native SABR request from the
  // real top-level YouTube player. URL and protobuf body are captured atomically;
  // never combine a player-response URL with a body from another SABR session.
  const nativeWaitStartedAt = Date.now();
  const liveSnapshot = await waitForNativeSabrSnapshot(
    targetWindow,
    signal,
    videoId,
    15000,
    nativeWaitStartedAt - 3000,
  );
  const nativeSabrSession: NativeSabrSession | undefined = liveSnapshot
    ? {
        url: liveSnapshot.url,
        cpn: liveSnapshot.cpn,
        cver: liveSnapshot.cver,
        rn: liveSnapshot.rn,
        alr: liveSnapshot.alr,
        observedAt: liveSnapshot.capturedAt,
        source: "resource-timing",
      }
    : undefined;
  const nativeSabrBody: NativeSabrBodySnapshot | undefined = liveSnapshot
    ? {
        bytes: liveSnapshot.bytes,
        url: liveSnapshot.url,
        source: "passive-capture",
      }
    : undefined;

  if (!liveSnapshot) {
    debug.log("Audio downloader. SABR native capture unavailable", {
      videoId,
      waitedMs: 15000,
      action: "do-not-send-independent-sabr",
    });
    throw new Error("Audio downloader. Native SABR bootstrap was not captured");
  }

  const serverAbrStreamingUrl = normalizeNativeSabrUrl(liveSnapshot.url);
  const videoPlaybackUstreamerConfig =
    player.playerConfig?.mediaCommonConfig?.mediaUstreamerRequestConfig
      ?.videoPlaybackUstreamerConfig;

  debug.log("Audio downloader. SABR native session ready", { videoId });
  if (!serverAbrStreamingUrl || !videoPlaybackUstreamerConfig) {
    throw new Error("Audio downloader. SABR metadata is unavailable");
  }

  const rawFormats = [
    ...(player.streamingData?.adaptiveFormats ?? []),
    ...(player.streamingData?.formats ?? []),
  ];
  const sabrFormats = rawFormats.flatMap((format) => {
    const converted = toSabrFormat(format);
    return converted ? [converted] : [];
  });
  const audioCandidates = rawFormats.filter(
    (format) =>
      format.mimeType?.includes("audio/") &&
      !format.mimeType?.includes("video/"),
  );
  const requested = normalizeAudioLanguage(sourceLanguage);
  const languageCandidates =
    requested && requested !== "auto"
      ? audioCandidates.filter((format) =>
          audioLanguageMatches(getAudioFormatLanguage(format), requested),
        )
      : [];
  const defaultCandidates = audioCandidates.filter(
    (format) => format.audioTrack?.audioIsDefault === true,
  );
  const trackCandidates = languageCandidates.length
    ? languageCandidates
    : defaultCandidates.length
      ? defaultCandidates
      : audioCandidates;
  const nonDrc = trackCandidates.filter((format) => !isDrcAudioFormat(format));
  const selected = selectSmallestAudioFormat(
    nonDrc.length ? nonDrc : trackCandidates,
  );
  if (!selected?.itag)
    throw new Error("Audio downloader. SABR audio format is unavailable");

  const selectedSabr = sabrFormats.find(
    (format) => format.itag === selected.itag,
  );
  if (!selectedSabr)
    throw new Error(
      "Audio downloader. SABR selected format metadata is incomplete",
    );

  debug.log("Audio downloader. SABR audio selected", {
    videoId,
    itag: selected.itag,
    language: getAudioFormatLanguage(selected) || "unknown",
    bitrate: selected.bitrate ?? selected.averageBitrate ?? 0,
  });

  const rawInnertubeContext = getConfigValue(config, "INNERTUBE_CONTEXT") as
    | { client?: Record<string, unknown> }
    | undefined;
  const nativeClient = rawInnertubeContext?.client ?? {};
  const pageWindow = getTopPageWindow(targetWindow);
  const clientInfo = {
    clientName:
      Number(getConfigValue(config, "INNERTUBE_CONTEXT_CLIENT_NAME")) || 1,
    clientVersion,
    ...(typeof nativeClient.osName === "string" && nativeClient.osName
      ? { osName: nativeClient.osName }
      : {}),
    ...(typeof nativeClient.osVersion === "string" && nativeClient.osVersion
      ? { osVersion: nativeClient.osVersion }
      : {}),
    acceptLanguage:
      typeof nativeClient.hl === "string" && nativeClient.hl
        ? nativeClient.hl
        : pageWindow.navigator.language,
    acceptRegion:
      typeof nativeClient.gl === "string" && nativeClient.gl
        ? nativeClient.gl
        : undefined,
    screenWidthPoints: Math.max(
      1,
      Math.round(pageWindow.screen?.width || pageWindow.innerWidth || 1),
    ),
    screenHeightPoints: Math.max(
      1,
      Math.round(pageWindow.screen?.height || pageWindow.innerHeight || 1),
    ),
    windowWidthPoints: Math.max(1, Math.round(pageWindow.innerWidth || 1)),
    windowHeightPoints: Math.max(1, Math.round(pageWindow.innerHeight || 1)),
    screenPixelDensity: Math.max(
      1,
      Math.round(pageWindow.devicePixelRatio || 1),
    ),
    utcOffsetMinutes: String(-new Date().getTimezoneOffset()),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || undefined,
  } as ConstructorParameters<typeof SabrStream>[0]["clientInfo"];

  // SABR (sabr=1) does not send the GVS PO token as a `pot=` URL query.
  // googlevideo/SabrStream serializes `poToken` into the SABR protobuf payload.
  // Reuse the same page BotGuard minter/binding policy as the direct Web-ABR path.
  const playerContexts = getConfigValue(config, "WEB_PLAYER_CONTEXT_CONFIGS");
  const pageExperimentFlags = Object.values(
    playerContexts && typeof playerContexts === "object" ? playerContexts : {},
  ).flatMap((entry: { serializedExperimentFlags?: unknown } | null) =>
    typeof entry?.serializedExperimentFlags === "string"
      ? [entry.serializedExperimentFlags]
      : [],
  );
  const sabrPoTokenBinding = selectGvsPoTokenBinding(videoId, {
    loggedIn: Boolean(authorization),
    dataSyncId:
      player.responseContext?.mainAppWebResponseContext?.datasyncId ??
      dataSyncId,
    visitorData,
    experimentFlags: pageExperimentFlags,
  });
  const sabrPoToken = sabrPoTokenBinding
    ? await mintPagePoToken(targetWindow, sabrPoTokenBinding.value, signal)
    : undefined;

  type SabrProtoFieldSummary = {
    field: number;
    wireType: number;
    length?: number;
    value?: string;
  };

  const readSabrVarint = (
    bytes: Uint8Array,
    start: number,
  ): { value: bigint; next: number } | undefined => {
    let value = 0n;
    let shift = 0n;
    for (
      let offset = start;
      offset < bytes.length && offset < start + 10;
      offset++
    ) {
      const byte = bytes[offset]!;
      value |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return { value, next: offset + 1 };
      shift += 7n;
    }
  };

  const inspectSabrProto = (bytes: Uint8Array) => {
    const fields: SabrProtoFieldSummary[] = [];
    let offset = 0;
    let parseError: string | undefined;
    while (offset < bytes.length && fields.length < 512) {
      const tag = readSabrVarint(bytes, offset);
      if (!tag) {
        parseError = `invalid tag at ${offset}`;
        break;
      }
      offset = tag.next;
      const field = Number(tag.value >> 3n);
      const wireType = Number(tag.value & 7n);
      if (!field) {
        parseError = `field 0 at ${offset}`;
        break;
      }
      if (wireType === 0) {
        const item = readSabrVarint(bytes, offset);
        if (!item) {
          parseError = `invalid varint field ${field}`;
          break;
        }
        offset = item.next;
        fields.push({ field, wireType, value: item.value.toString() });
      } else if (wireType === 1) {
        if (offset + 8 > bytes.length) {
          parseError = `truncated fixed64 field ${field}`;
          break;
        }
        fields.push({ field, wireType, length: 8 });
        offset += 8;
      } else if (wireType === 2) {
        const length = readSabrVarint(bytes, offset);
        if (!length) {
          parseError = `invalid length field ${field}`;
          break;
        }
        offset = length.next;
        const size = Number(length.value);
        if (
          !Number.isSafeInteger(size) ||
          size < 0 ||
          offset + size > bytes.length
        ) {
          parseError = `truncated bytes field ${field} length ${length.value}`;
          break;
        }
        fields.push({ field, wireType, length: size });
        offset += size;
      } else if (wireType === 5) {
        if (offset + 4 > bytes.length) {
          parseError = `truncated fixed32 field ${field}`;
          break;
        }
        fields.push({ field, wireType, length: 4 });
        offset += 4;
      } else {
        parseError = `unsupported wire type ${wireType} field ${field}`;
        break;
      }
    }
    const counts: Record<string, number> = {};
    const lengths: Record<string, number[]> = {};
    for (const item of fields) {
      const key = String(item.field);
      counts[key] = (counts[key] ?? 0) + 1;
      if (item.length !== undefined) {
        lengths[key] ??= [];
        lengths[key].push(item.length);
      }
    }
    return {
      byteLength: bytes.byteLength,
      fieldFingerprint: fields
        .map(
          (item) =>
            `${item.field}:${item.wireType}:${item.length ?? item.value ?? ""}`,
        )
        .join("|"),
      fieldCounts: counts,
      fieldLengths: lengths,
      targetFields: Object.fromEntries(
        [1, 2, 3, 5, 16, 19].map((field) => [
          String(field),
          {
            count: counts[String(field)] ?? 0,
            lengths: lengths[String(field)] ?? [],
          },
        ]),
      ),
      parseError: parseError ?? null,
      parsedBytes: offset,
    };
  };

  let sabrRequestIndex = 0;
  let consecutivePostBootstrapRequestsWithoutBufferedRanges = 0;
  const sabrDiagnosticFetch: typeof fetch = async (input, init) => {
    const index = ++sabrRequestIndex;
    const startedAt = performance.now();
    const inputIsRequest =
      typeof targetWindow.Request !== "undefined" &&
      input instanceof targetWindow.Request;
    // For the bootstrap request preserve the exact native URL together with
    // the exact native protobuf body. In particular, do not reset native rn.
    const requestUrl =
      index === 1 && liveSnapshot
        ? liveSnapshot.url
        : typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
    const url = new URL(requestUrl, targetWindow.location.href);
    const method =
      init?.method ?? (inputIsRequest ? input.method : undefined) ?? "GET";
    const credentials =
      init?.credentials ?? (inputIsRequest ? input.credentials : undefined);
    const mode = init?.mode ?? (inputIsRequest ? input.mode : undefined);
    const redirect =
      init?.redirect ?? (inputIsRequest ? input.redirect : undefined);
    const cache = init?.cache ?? (inputIsRequest ? input.cache : undefined);
    const body = init?.body ?? null;

    const headers = new targetWindow.Headers(
      init?.headers ?? (inputIsRequest ? input.headers : undefined),
    );
    const headerEntries = Object.fromEntries(headers.entries());

    let bodyType = body === null ? "none" : typeof body;
    let bodyConstructor: string | null = null;
    let bodyByteLength: number | null = null;
    let bodyIsReadableStream = false;
    let bodyHexPreview: string | null = null;

    if (body !== null) {
      bodyConstructor =
        typeof body === "object" && body && "constructor" in body
          ? ((body as { constructor?: { name?: string } }).constructor?.name ??
            null)
          : null;
      bodyIsReadableStream =
        typeof targetWindow.ReadableStream !== "undefined" &&
        body instanceof targetWindow.ReadableStream;

      let bytes: Uint8Array | null = null;
      if (typeof body === "string") {
        bytes = new TextEncoder().encode(body);
      } else if (body instanceof ArrayBuffer) {
        bytes = new Uint8Array(body);
      } else if (ArrayBuffer.isView(body)) {
        bytes = new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
      } else if (
        typeof targetWindow.Blob !== "undefined" &&
        body instanceof targetWindow.Blob
      ) {
        bodyByteLength = body.size;
      }

      if (bytes) {
        bodyByteLength = bytes.byteLength;
        bodyHexPreview = [...bytes.subarray(0, 24)]
          .map((value) => value.toString(16).padStart(2, "0"))
          .join(" ");
        const protobuf = inspectSabrProto(bytes);

        // A healthy post-bootstrap SabrStream must start reporting buffered
        // ranges. Without field 3 the server can keep returning data while the
        // client's playback position never advances, producing a request storm.
        if (index > 1) {
          const hasBufferedRanges =
            (protobuf.targetFields?.["3"]?.count ?? 0) > 0;
          consecutivePostBootstrapRequestsWithoutBufferedRanges =
            hasBufferedRanges
              ? 0
              : consecutivePostBootstrapRequestsWithoutBufferedRanges + 1;
          if (consecutivePostBootstrapRequestsWithoutBufferedRanges >= 8) {
            debug.log("Audio downloader. SABR state progress guard", {
              videoId,
              index,
              consecutiveWithoutBufferedRanges:
                consecutivePostBootstrapRequestsWithoutBufferedRanges,
              action: "abort-request-storm",
              fieldFingerprint: protobuf.fieldFingerprint,
            });
            throw new Error(
              "SABR state did not produce buffered ranges after native bootstrap",
            );
          }
        }
      }
    } else if (inputIsRequest) {
      bodyType = input.body ? "request-stream" : "none";
      bodyConstructor = input.body?.constructor?.name ?? null;
      bodyIsReadableStream = Boolean(input.body);
    }

    const fetchWithGmFallback = async (): Promise<Response> => {
      try {
        const nativeInit: RequestInit = {
          ...(init ?? {}),
          credentials: "include",
          mode: "cors",
          cache: "no-store",
          redirect: "follow",
        };
        const nativeInput: RequestInfo | URL =
          index === 1 && liveSnapshot ? liveSnapshot.url : input;
        return await targetWindow.fetch(nativeInput, nativeInit);
      } catch (nativeError) {
        const gm = (
          globalThis as typeof globalThis & {
            GM_xmlhttpRequest?: (details: Record<string, unknown>) => unknown;
          }
        ).GM_xmlhttpRequest;
        if (typeof gm !== "function") throw nativeError;

        let gmBody: string | ArrayBuffer | Blob | undefined;
        if (typeof body === "string") {
          gmBody = body;
        } else if (body instanceof ArrayBuffer) {
          gmBody = body.slice(0);
        } else if (ArrayBuffer.isView(body)) {
          gmBody = body.buffer.slice(
            body.byteOffset,
            body.byteOffset + body.byteLength,
          ) as ArrayBuffer;
        } else if (
          typeof targetWindow.Blob !== "undefined" &&
          body instanceof targetWindow.Blob
        ) {
          gmBody = body;
        } else if (body !== null || (inputIsRequest && input.body)) {
          throw nativeError;
        }

        return await new Promise<Response>((resolve, reject) => {
          let settled = false;
          let requestHandle: unknown;
          const signal =
            init?.signal ?? (inputIsRequest ? input.signal : undefined);
          const cleanup = () => signal?.removeEventListener("abort", onAbort);
          const finishReject = (error: unknown) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(error);
          };
          const onAbort = () => {
            try {
              (requestHandle as { abort?: () => void } | undefined)?.abort?.();
            } catch {}
            finishReject(
              new DOMException("The operation was aborted.", "AbortError"),
            );
          };
          if (signal?.aborted) {
            onAbort();
            return;
          }
          signal?.addEventListener("abort", onAbort, { once: true });

          const parseHeaders = (raw: string | undefined) => {
            const result = new targetWindow.Headers();
            for (const line of (raw ?? "").split(/\r?\n/)) {
              const colon = line.indexOf(":");
              if (colon > 0) {
                try {
                  result.append(
                    line.slice(0, colon).trim(),
                    line.slice(colon + 1).trim(),
                  );
                } catch {}
              }
            }
            return result;
          };

          const details: Record<string, unknown> = {
            method,
            url: url.toString(),
            headers: headerEntries,
            data: gmBody,
            responseType: "arraybuffer",
            anonymous: false,
            onload: (gmResponse: {
              status?: number;
              statusText?: string;
              response?: ArrayBuffer;
              responseHeaders?: string;
              finalUrl?: string;
            }) => {
              if (settled) return;
              settled = true;
              cleanup();
              const responseHeaders = parseHeaders(gmResponse.responseHeaders);
              const response = new targetWindow.Response(
                gmResponse.response ?? new ArrayBuffer(0),
                {
                  status: gmResponse.status || 200,
                  statusText: gmResponse.statusText ?? "",
                  headers: responseHeaders,
                },
              );
              resolve(response);
            },
            onerror: (gmError: unknown) =>
              finishReject(
                gmError instanceof Error
                  ? gmError
                  : new TypeError("GM_xmlhttpRequest SABR request failed"),
              ),
            ontimeout: () =>
              finishReject(
                new TypeError("GM_xmlhttpRequest SABR request timed out"),
              ),
            onabort: () =>
              finishReject(
                new DOMException("The operation was aborted.", "AbortError"),
              ),
          };

          try {
            requestHandle = gm(details);
            if (
              requestHandle &&
              typeof (requestHandle as Promise<unknown>).then === "function"
            ) {
              (requestHandle as Promise<unknown>).catch(finishReject);
            }
          } catch (gmError) {
            finishReject(gmError);
          }
        });
      }
    };

    try {
      const response = await fetchWithGmFallback();
      // `targetWindow.fetch()` (and the GM fallback above) return a Response
      // whose body chunks are created in the YouTube page realm. googlevideo's
      // CompositeBuffer currently distinguishes Uint8Array with `instanceof`.
      // A cross-realm Uint8Array fails that check and is then incorrectly
      // treated as CompositeBuffer (`chunk.chunks.forEach(...)`), which crashes.
      //
      // Re-stream the body and copy every chunk into this userscript realm.
      // Keep it streaming: buffering the whole SABR response here would add
      // unnecessary latency/memory use.
      if (response.body) {
        const foreignReader = response.body.getReader();
        const localBody = new ReadableStream<Uint8Array>({
          async pull(controller) {
            try {
              const { value, done } = await foreignReader.read();
              if (done) {
                controller.close();
                return;
              }
              if (!value) return;

              const source = ArrayBuffer.isView(value)
                ? new Uint8Array(
                    value.buffer,
                    value.byteOffset,
                    value.byteLength,
                  )
                : new Uint8Array(value as ArrayBuffer);
              const localChunk = new Uint8Array(source.byteLength);
              localChunk.set(source);
              controller.enqueue(localChunk);
            } catch (error) {
              controller.error(error);
            }
          },
          cancel(reason) {
            return foreignReader.cancel(reason);
          },
        });

        return new Response(localBody, {
          status: response.status,
          statusText: response.statusText,
          headers: new Headers(response.headers),
        });
      }

      return response;
    } catch (error) {
      debug.log("Audio downloader. SABR fetch network failure", {
        videoId,
        index,
        method,
        href: url.toString(),
        host: url.hostname,
        path: url.pathname,
        queryKeys: [...new Set(url.searchParams.keys())],
        credentials: credentials ?? "default",
        mode: mode ?? "default",
        bodyType,
        bodyConstructor,
        bodyByteLength,
        bodyIsReadableStream,
        elapsedMs: Math.round(performance.now() - startedAt),
        ...describeError(error),
      });
      throw error;
    }
  };

  // Bring googlevideo's sparse cold-start ClientAbrState closer to the state
  // emitted by the native WEB player. Keep the bridge state per SabrStream
  // instance: an old SPA stream may still finish requests after the next video
  // has already created a new stream.
  const sabrPrototype = SabrStream.prototype as unknown as {
    buildRequestBody?: (
      abrState: Record<string, unknown>,
      selectedAudioFormat: unknown,
      selectedVideoFormat: unknown,
    ) => Uint8Array;
    __votNativeAbrStatePatched?: boolean;
  };

  if (
    typeof sabrPrototype.buildRequestBody === "function" &&
    !sabrPrototype.__votNativeAbrStatePatched
  ) {
    const originalBuildRequestBody = sabrPrototype.buildRequestBody;
    sabrPrototype.buildRequestBody = function (
      abrState,
      selectedAudioFormat,
      selectedVideoFormat,
    ) {
      const context = VOT_SABR_INSTANCE_CONTEXT.get(this as object);
      const activePageWindow = context?.pageWindow;
      const activeVideoId = context?.videoId ?? "unknown";
      const activeNativeSabrBody = context?.nativeSabrBody;

      if (activePageWindow) {
        const viewportWidth = Math.max(
          1,
          Math.round(activePageWindow.innerWidth || 0),
        );
        const viewportHeight = Math.max(
          1,
          Math.round(activePageWindow.innerHeight || 0),
        );
        const connection = (
          activePageWindow.navigator as Navigator & {
            connection?: {
              downlink?: number;
              saveData?: boolean;
              effectiveType?: string;
            };
          }
        ).connection;
        const downlinkMbps = Number(connection?.downlink);
        const bandwidthEstimate =
          Number.isFinite(downlinkMbps) && downlinkMbps > 0
            ? String(Math.round(downlinkMbps * 1_000_000))
            : undefined;
        const elapsed = Math.max(
          1,
          Math.round(activePageWindow.performance.now()),
        );

        Object.assign(abrState, {
          clientViewportWidth: viewportWidth,
          clientViewportHeight: viewportHeight,
          ...(bandwidthEstimate ? { bandwidthEstimate } : {}),
          dataSaverMode: Boolean(connection?.saveData),
          networkMeteredState: connection?.saveData ? 1 : 0,
          elapsedWallTimeMs: String(elapsed),
          timeSinceLastActionMs: String(elapsed),
          playerState: "1",
          maxPacingRate: 1,
          sabrSupportQualityConstraints: true,
        });
      }

      const generated = originalBuildRequestBody.call(
        this,
        abrState,
        selectedAudioFormat,
        selectedVideoFormat,
      );
      if (!context) return generated;

      context.buildIndex += 1;
      const buildIndex = context.buildIndex;
      if (!activeNativeSabrBody?.bytes.byteLength) return generated;

      // Keep SabrStream's generated request as the authoritative ABR/format
      // selection state. In particular, preferredAudioFormatIds,
      // selectedFormatIds and bufferedRanges must describe OUR selected audio
      // format, not the native YouTube player's possibly stale SPA state.
      //
      // Only transplant the native field 5 (videoPlaybackUstreamerConfig).
      // This is the field that previously made the otherwise generated request
      // pass Google's SABR config validation.
      try {
        const bridged = spliceNativeTopLevelFields(
          generated,
          activeNativeSabrBody.bytes,
          new Set<number>([5]),
        );
        return bridged;
      } catch (error) {
        debug.log("Audio downloader. SABR native protobuf bridge failed", {
          videoId: activeVideoId,
          buildIndex,
          error: error instanceof Error ? error.message : String(error),
        });
        return generated;
      }
    };
    sabrPrototype.__votNativeAbrStatePatched = true;
  }

  let stream: SabrStream;
  try {
    stream = new SabrStream({
      videoId,
      fetch: sabrDiagnosticFetch,
      poToken: sabrPoToken,
      serverAbrStreamingUrl,
      videoPlaybackUstreamerConfig,
      clientInfo,
      formats: sabrFormats,
      stripDuplicateInit: true,
    });
    VOT_SABR_INSTANCE_CONTEXT.set(stream as unknown as object, {
      videoId,
      nativeSabrBody,
      buildIndex: 0,
      pageWindow,
    });
  } catch (error) {
    debug.log("Audio downloader. SABR constructor failed", {
      videoId,
      errorName: error instanceof Error ? error.name : typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }

  const abort = () => stream.abort();
  signal.addEventListener("abort", abort, { once: true });
  try {
    let started: Awaited<ReturnType<typeof stream.start>>;
    try {
      started = await stream.start({
        audioFormat: selectedSabr,
        // SABR currently initializes both tracks. Pick the smallest video and
        // drain it below so video backpressure cannot stall the audio download.
        videoFormat: (formats) =>
          formats
            .filter((format) => format.mimeType?.includes("video/"))
            .sort((a, b) => a.bitrate - b.bitrate)[0],
        isPostLiveDvr: false,
        // We only consume audio. Telling SabrStream this explicitly makes it
        // mark the dummy video format as discarded and, crucially, emit a
        // BufferedRange (protobuf field 3) from the first post-bootstrap
        // request instead of waiting for both tracks to initialize.
        enabledTrackTypes: 1,
        maxRetries: 3,
        stallDetectionMs: 20_000,
      });
    } catch (error) {
      debug.log("Audio downloader. SABR start failed", {
        videoId,
        errorName: error instanceof Error ? error.name : typeof error,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }

    let audioReadCount = 0;

    // Do not cancel videoStream while SabrStream is active. Some versions use
    // both exposed streams as part of their internal scheduling/backpressure
    // state even when enabledTrackTypes=1. Cancelling video here can therefore
    // stop the request pump while audioReader is still waiting for more bytes.
    // enabledTrackTypes=1 already tells SABR that only audio is wanted; abort the
    // whole SabrStream during final cleanup instead.

    const audioReader = started.audioStream.getReader();

    const buffers: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        signal.throwIfAborted();
        const index = ++audioReadCount;
        const startedAt = performance.now();

        let result: ReadableStreamReadResult<Uint8Array>;
        try {
          const readTimeoutMs = 25_000;
          let timeoutId: ReturnType<typeof setTimeout> | undefined;
          const timeout = new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => {
              reject(
                new Error(
                  `Audio downloader. SABR audio stream stalled for ${readTimeoutMs}ms`,
                ),
              );
            }, readTimeoutMs);
          });
          try {
            result = await Promise.race([audioReader.read(), timeout]);
          } finally {
            if (timeoutId !== undefined) clearTimeout(timeoutId);
          }
        } catch (error) {
          debug.log("Audio downloader. SABR audio read FAILED", {
            videoId,
            index,
            elapsedMs: Math.round(performance.now() - startedAt),
            sabrRequestsStarted: sabrRequestIndex,
            aborted: signal.aborted,
            ...describeError(error),
          });
          throw error;
        }

        const { value, done } = result;

        if (done) break;
        if (!value?.byteLength) continue;

        const copy = new Uint8Array(value.byteLength);
        try {
          copy.set(
            new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
          );
        } catch (error) {
          debug.log("Audio downloader. SABR audio buffer copy FAILED", {
            videoId,
            index,
            byteLength: value.byteLength,
            byteOffset: value.byteOffset,
            bufferConstructor: value.buffer?.constructor?.name,
            ...describeError(error),
          });
          throw error;
        }

        buffers.push(copy);
        total += copy.byteLength;
      }
    } finally {
      try {
        audioReader.releaseLock();
      } catch {
        // Ignore diagnostic cleanup errors.
      }
    }

    if (total < 1)
      throw new Error("Audio downloader. SABR returned empty audio");
    const completeAudio = concatBuffers(buffers);
    debug.log("Audio downloader. SABR strategy succeeded", {
      videoId,
      itag: selected.itag,
      bytes: completeAudio.byteLength,
      language: getAudioFormatLanguage(selected) || "unknown",
    });
    yield { buffer: completeAudio, isLastChunk: true };
  } finally {
    signal.removeEventListener("abort", abort);
    stream.abort();
  }
}

async function* getWebAbrAudioChunksImpl(
  targetWindow: WebAbrWindow,
  videoId: string,
  signal: AbortSignal,
  sourceLanguage?: string,
): AsyncGenerator<AudioChunk> {
  // Legacy web_embedded / tv_downgraded / web clients were removed. Keep a
  // single WEB_CREATOR fallback so SABR remains the primary transport and the
  // fallback path stays deterministic.
  const config = await resolveYtcfg(targetWindow, signal);
  const apiKey = getConfigValue(config, "INNERTUBE_API_KEY");
  if (typeof apiKey !== "string") {
    throw new Error("Audio downloader. web ABR config is unavailable");
  }

  const playerCodes = new Map<string, Promise<string>>();
  const fetchPlayerCode = (url = getPlayerUrl(config)) => {
    if (!url) return Promise.resolve(undefined);
    let code = playerCodes.get(url);
    if (!code) {
      code = targetWindow.fetch(url, { signal }).then((response) => {
        if (!response.ok) {
          throw new Error(
            `Audio downloader. YouTube player request failed (${response.status})`,
          );
        }
        return response.text();
      });
      playerCodes.set(url, code);
    }
    return code;
  };

  let sts = Number(getConfigValue(config, "STS"));
  if (!(sts > 0)) {
    sts = Number(
      (await fetchPlayerCode())?.match(
        /(?:signatureTimestamp|sts)\s*:\s*([0-9]{5})/,
      )?.[1],
    );
  }

  const visitorData = getConfigValue(config, "VISITOR_DATA");
  const dataSyncId = getConfigValue(config, "DATASYNC_ID");
  const [firstSyncId, secondSyncId] =
    typeof dataSyncId === "string" ? dataSyncId.split("||") : [];
  const delegatedSessionId =
    getConfigValue(config, "DELEGATED_SESSION_ID") ??
    (secondSyncId ? firstSyncId : undefined);
  const authorization = await getYouTubeAuthorization(
    targetWindow,
    String(
      getConfigValue(config, "USER_SESSION_ID") ??
        (secondSyncId || firstSyncId) ??
        "",
    ) || undefined,
  );
  const sessionIndex = getConfigValue(config, "SESSION_INDEX");
  const authenticatedAuth = { authorization, sessionIndex, delegatedSessionId };
  const playerContexts = getConfigValue(config, "WEB_PLAYER_CONTEXT_CONFIGS");
  const pageExperimentFlags = Object.values(
    playerContexts && typeof playerContexts === "object" ? playerContexts : {},
  ).flatMap((entry: { serializedExperimentFlags?: unknown } | null) =>
    typeof entry?.serializedExperimentFlags === "string"
      ? [entry.serializedExperimentFlags]
      : [],
  );

  const candidateBody = buildWebCreatorPlayerRequest(videoId, {
    visitorData,
    signatureTimestamp: sts,
  });
  const candidateContext = candidateBody.context as {
    client: Record<string, unknown>;
  };
  const clientVersion = String(candidateContext.client.clientVersion ?? "");
  const postPlayer = (authenticated: boolean) =>
    postInnertubePlayer(
      targetWindow,
      signal,
      apiKey,
      candidateBody,
      "62",
      clientVersion,
      authenticated ? authenticatedAuth : {},
    );
  const requestPlayer = async (authenticated = false) => {
    const response = await postPlayer(authenticated);
    const status = response.playabilityStatus?.status ?? "";
    if (
      !authenticated &&
      authorization &&
      /LOGIN_REQUIRED|AGE_CHECK_REQUIRED|CONTENT_CHECK_REQUIRED/.test(status)
    ) {
      debug.log("Audio downloader. retrying WEB_CREATOR with YouTube session", {
        videoId,
        status,
      });
      return { response: await postPlayer(true), authenticated: true };
    }
    return { response, authenticated };
  };

  debug.log("Audio downloader. trying player client", {
    videoId,
    client: "web_creator",
  });

  const initialPlayer = await requestPlayer();
  const playerResponse = initialPlayer.response;
  const requestAuthenticated = initialPlayer.authenticated;
  const formats = [
    ...(playerResponse.streamingData?.adaptiveFormats ?? []),
    ...(playerResponse.streamingData?.formats ?? []),
  ];
  if (!formats.length) {
    const status = playerResponse.playabilityStatus;
    if (status?.status === "LOGIN_REQUIRED" && !authorization) {
      throw new Error("YOUTUBE_SIGN_IN_SUGGESTED");
    }
    throw new Error(
      `Audio downloader. web_creator ${status?.status ?? "failed"}: ${
        status?.reason ?? status?.messages?.join(" ") ?? "no streaming data"
      }`,
    );
  }

  const format = selectAudioFormat(formats, sourceLanguage);
  const poTokenBinding = selectGvsPoTokenBinding(videoId, {
    loggedIn: requestAuthenticated,
    dataSyncId:
      playerResponse.responseContext?.mainAppWebResponseContext?.datasyncId ||
      dataSyncId,
    visitorData: candidateContext.client.visitorData ?? visitorData,
    experimentFlags: pageExperimentFlags,
  });
  let poToken: Promise<string | undefined> | undefined;
  const authorizeUrl = async (streamUrl: string) => {
    const url = new URL(streamUrl);
    if (!url.searchParams.has("pot") && poTokenBinding) {
      poToken ??= mintPagePoToken(targetWindow, poTokenBinding.value, signal);
      const token = await poToken;
      if (token) url.searchParams.set("pot", token);
      else poToken = undefined;
    }
    return url.toString();
  };
  const getCode = () => fetchPlayerCode();
  let lastError: unknown;

  for await (const solvedUrl of resolveFormatUrl(
    targetWindow,
    format,
    getCode,
    signal,
  )) {
    try {
      const streamUrl = await authorizeUrl(solvedUrl);
      const contentLength =
        Number(format.contentLength) ||
        (await probeContentLength(
          targetWindow,
          streamUrl,
          signal,
          requestAuthenticated,
        ));
      const refreshUrl = async () => {
        const refreshedPlayer = await requestPlayer(requestAuthenticated);
        const response = refreshedPlayer.response;
        const refreshed = [
          ...(response.streamingData?.adaptiveFormats ?? []),
          ...(response.streamingData?.formats ?? []),
        ].find(
          (entry) =>
            entry.itag === format.itag &&
            entry.mimeType === format.mimeType &&
            Number(entry.contentLength) === contentLength &&
            entry.lastModified === format.lastModified,
        );
        if (!refreshed) {
          throw new Error("Audio downloader. Refreshed audio format changed");
        }
        for await (const url of resolveFormatUrl(
          targetWindow,
          refreshed,
          getCode,
          signal,
        )) {
          return await authorizeUrl(url);
        }
        throw new Error("Audio downloader. Refreshed audio URL unavailable");
      };
      yield* downloadMediaRanges(
        targetWindow,
        streamUrl,
        contentLength,
        signal,
        refreshUrl,
        requestAuthenticated,
      );
      return;
    } catch (error) {
      signal.throwIfAborted();
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Audio downloader. web_creator has no playable audio URL");
}

const WEB_ABR_DOWNLOAD_QUEUE = new Map<string, Promise<void>>();

/**
 * Serialize concurrent web_abr downloads for the same video.
 *
 * If VOT accidentally calls web_abr twice for one video, the second call waits
 * until the first generator is completely finished before it starts resolving
 * clients/media URLs or issuing media requests. Calls for different videos can
 * still run independently.
 */
export async function* getWebAbrAudioChunks(
  targetWindow: WebAbrWindow,
  videoId: string,
  signal: AbortSignal,
  transportStartIndex = 0,
  sourceLanguage?: string,
): AsyncGenerator<AudioChunk> {
  void transportStartIndex;
  const queueKey = String(videoId);
  const previous = WEB_ABR_DOWNLOAD_QUEUE.get(queueKey) ?? Promise.resolve();
  const hadPrevious = WEB_ABR_DOWNLOAD_QUEUE.has(queueKey);

  let releaseCurrent: (() => void) | undefined;
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  WEB_ABR_DOWNLOAD_QUEUE.set(queueKey, current);

  debug.log("Audio downloader. web ABR queued", {
    videoId,
    hasPrevious: hadPrevious,
  });

  try {
    await previous;
    signal.throwIfAborted();
    let sabrEmitted = false;
    try {
      for await (const chunk of trySabrAudioChunks(
        targetWindow,
        videoId,
        signal,
        sourceLanguage,
      )) {
        sabrEmitted = true;
        yield chunk;
      }
      if (sabrEmitted) return;
    } catch (error) {
      signal.throwIfAborted();
      if (sabrEmitted) throw error;
      debug.log(
        "Audio downloader. SABR strategy failed; falling back to web ABR",
        {
          videoId,
          aborted: signal.aborted,
          ...describeError(error),
        },
      );
    }
    yield* getWebAbrAudioChunksImpl(
      targetWindow,
      videoId,
      signal,
      sourceLanguage,
    );
  } finally {
    releaseCurrent?.();
    if (WEB_ABR_DOWNLOAD_QUEUE.get(queueKey) === current) {
      WEB_ABR_DOWNLOAD_QUEUE.delete(queueKey);
    }
    debug.log("Audio downloader. web ABR queue released", { videoId });
  }
}
