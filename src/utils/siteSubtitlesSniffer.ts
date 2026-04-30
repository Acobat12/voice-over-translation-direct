import { normalizeLang } from "@vot.js/shared/utils/utils";
import type { SubtitleDescriptor, SubtitleFormat } from "../subtitles/types";

const VK_HOST_PATTERN = /(?:^|\.)vkvideo\.ru$|(?:^|\.)vk\.(?:com|ru)$/i;
const VK_REQUEST_PATTERN =
  /api\.vkvideo\.ru|\/al_video\.php(?:$|[?#])|\/method\/video\.|video_ext\.php|vkvideo\.ru/i;
const SUBTITLE_URL_PATTERN = /\.(vtt|srt|ass|json)(?:$|[?#])/i;
const MAX_BODY_LENGTH = 1_500_000;
const MAX_TRACKS_PER_HOST = 64;
const TRACK_MAX_AGE_MS = 10 * 60 * 1000;

type SniffedSubtitleTrack = {
  descriptor: SubtitleDescriptor;
  seenAt: number;
  videoId?: string;
};

type CollectContext = {
  collectionHint: boolean;
  languageHint?: string;
  videoId?: string;
};

const sniffedTracksByHost = new Map<string, SniffedSubtitleTrack[]>();
const xhrUrlKey = Symbol("votSniffedSubtitleUrl");
let installed = false;

function isVkHost(hostname: string): boolean {
  return VK_HOST_PATTERN.test(hostname);
}

function isVkPage(): boolean {
  return isVkHost(String(globalThis.location.hostname || ""));
}

function normalizeUrl(input: string): string {
  try {
    return new URL(input, globalThis.location.href).href;
  } catch {
    return input;
  }
}

function inferSubtitleFormat(url: string): SubtitleFormat | null {
  const normalized = url.split(/[?#]/u, 1)[0]?.toLowerCase() ?? "";
  if (normalized.endsWith(".vtt")) return "vtt";
  if (normalized.endsWith(".srt")) return "srt";
  if (normalized.endsWith(".ass")) return "ass";
  if (normalized.endsWith(".json")) return "json";
  return null;
}

function normalizeLanguageCandidate(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }

  try {
    return normalizeLang(normalized);
  } catch {
    return normalized.toLowerCase().split(/[_;-]/u)[0]?.trim() || undefined;
  }
}

function inferLanguageFromUrl(rawUrl: string): string | undefined {
  try {
    const url = new URL(rawUrl, globalThis.location.href);
    const queryValue =
      url.searchParams.get("lang") ||
      url.searchParams.get("language") ||
      url.searchParams.get("locale") ||
      url.searchParams.get("srclang");
    if (queryValue) {
      return normalizeLanguageCandidate(queryValue);
    }

    const pathname = decodeURIComponent(url.pathname);
    const match =
      /(?:^|[._/-])([a-z]{2,3}(?:-[a-z]{2,4})?)(?=\.(?:vtt|srt|ass|json)\b)/i.exec(
        pathname,
      ) || /(?:^|[._/-])([a-z]{2,3})(?:[._-]captions?)(?=\b)/i.exec(pathname);
    return normalizeLanguageCandidate(match?.[1]);
  } catch {
    return undefined;
  }
}

function parseVideoId(ownerId: string, videoId: string): string | undefined {
  const normalizedOwner = String(ownerId || "").trim();
  const normalizedVideoId = String(videoId || "").trim();
  if (!normalizedOwner || !normalizedVideoId) {
    return undefined;
  }

  const ownerNumber = Number.parseInt(normalizedOwner, 10);
  if (Number.isNaN(ownerNumber)) {
    return undefined;
  }

  return `video-${Math.abs(ownerNumber)}_${normalizedVideoId}`;
}

function extractVideoIdFromUrl(rawUrl: string): string | undefined {
  try {
    const url = new URL(rawUrl, globalThis.location.href);
    const pathnameMatch =
      /\/(video-?\d+_\d+)/i.exec(url.pathname) ||
      /\/playlist\/[^/]+\/(video-?\d+_\d+)/i.exec(url.pathname);
    if (pathnameMatch?.[1]) {
      return pathnameMatch[1];
    }

    const paramZ = url.searchParams.get("z");
    if (paramZ) {
      const zMatch = /(video-?\d+_\d+)/i.exec(paramZ);
      if (zMatch?.[1]) {
        return zMatch[1];
      }
    }

    const oid = url.searchParams.get("oid");
    const id = url.searchParams.get("id");
    if (oid && id) {
      return parseVideoId(oid, id);
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function pickString(
  record: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function pickNumberish(
  record: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function toOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0") return false;
  }

  return undefined;
}

function extractVideoIdFromRecord(
  record: Record<string, unknown>,
): string | undefined {
  const explicitVideoId = pickString(record, [
    "videoId",
    "video_id",
    "video",
    "player_id",
  ]);
  if (explicitVideoId) {
    const matched = /(video-?\d+_\d+)/i.exec(explicitVideoId);
    if (matched?.[1]) {
      return matched[1];
    }
  }

  const ownerId = pickNumberish(record, [
    "owner_id",
    "ownerId",
    "oid",
    "video_oid",
  ]);
  const videoId = pickNumberish(record, ["id", "vid", "video_id", "videoId"]);
  if (ownerId && videoId) {
    return parseVideoId(ownerId, videoId);
  }

  return undefined;
}

function isSubtitleCollectionKey(key: string): boolean {
  return (
    key === "subs" ||
    key === "subtitles" ||
    key === "captions" ||
    key === "text_tracks" ||
    key.includes("subtitle") ||
    key.includes("caption")
  );
}

function toSubtitleDescriptor(
  record: Record<string, unknown>,
  context: CollectContext,
): SubtitleDescriptor | null {
  const rawUrl = pickString(record, [
    "url",
    "src",
    "file",
    "download_url",
    "downloadUrl",
    "webVttUrl",
    "webvtturl",
    "link",
  ]);
  if (!rawUrl) {
    return null;
  }

  const url = normalizeUrl(rawUrl);
  const format =
    inferSubtitleFormat(url) ?? (context.collectionHint ? "vtt" : null);
  if (!format) {
    return null;
  }

  const language = normalizeLanguageCandidate(
    pickString(record, [
      "lang",
      "language",
      "lang_code",
      "language_code",
      "locale",
      "locale_id",
      "srclang",
      "code",
      "subtitles_lang",
    ]) ??
      context.languageHint ??
      inferLanguageFromUrl(url),
  );
  if (!language) {
    return null;
  }

  return {
    source: "vk",
    format,
    language,
    url,
    translatedFromLanguage: normalizeLanguageCandidate(
      pickString(record, [
        "translatedFromLanguage",
        "translated_from_language",
        "from_lang",
        "source_lang",
      ]),
    ),
    isAutoGenerated: toOptionalBoolean(
      record.is_auto ??
        record.isAutoGenerated ??
        record.auto_generated ??
        record.autogenerated,
    ),
  };
}

function collectDescriptors(
  value: unknown,
  context: CollectContext,
  collected: SniffedSubtitleTrack[],
  visited: WeakSet<object>,
  depth = 0,
): void {
  if (depth > 7 || value == null) {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value.slice(0, 400)) {
      collectDescriptors(item, context, collected, visited, depth + 1);
    }
    return;
  }

  if (!isRecord(value) || visited.has(value)) {
    return;
  }
  visited.add(value);

  const record = value;
  const nextVideoId = context.videoId ?? extractVideoIdFromRecord(record);
  const nextLanguageHint =
    context.languageHint ??
    normalizeLanguageCandidate(
      pickString(record, [
        "subtitles_lang",
        "lang",
        "language",
        "locale",
        "locale_id",
      ]),
    );

  const descriptor = toSubtitleDescriptor(record, {
    ...context,
    languageHint: nextLanguageHint,
    videoId: nextVideoId,
  });
  if (descriptor) {
    collected.push({
      descriptor,
      seenAt: Date.now(),
      videoId: nextVideoId,
    });
  }

  for (const [key, nestedValue] of Object.entries(record)) {
    if (nestedValue == null) {
      continue;
    }

    const nextContext: CollectContext = {
      collectionHint:
        context.collectionHint || isSubtitleCollectionKey(key.toLowerCase()),
      languageHint: nextLanguageHint,
      videoId: nextVideoId,
    };

    collectDescriptors(nestedValue, nextContext, collected, visited, depth + 1);
  }
}

function unescapeResponseString(value: string): string {
  return value
    .replace(/\\u0026/giu, "&")
    .replace(/\\u002f/giu, "/")
    .replace(/\\\//gu, "/");
}

function extractDescriptorsFromText(
  text: string,
  requestUrl: string,
): SniffedSubtitleTrack[] {
  const result: SniffedSubtitleTrack[] = [];
  const seen = new Set<string>();
  const defaultVideoId = extractVideoIdFromUrl(requestUrl);
  const normalizedText = unescapeResponseString(text);

  const push = (
    language: string | undefined,
    url: string | undefined,
    isAutoGenerated?: boolean,
  ) => {
    const normalizedLanguage = normalizeLanguageCandidate(
      language ?? inferLanguageFromUrl(String(url || "")),
    );
    const normalizedUrl = typeof url === "string" ? normalizeUrl(url) : "";
    const format = inferSubtitleFormat(normalizedUrl) ?? "vtt";
    if (!normalizedLanguage || !normalizedUrl) {
      return;
    }

    const key = `${defaultVideoId ?? ""}|${normalizedLanguage}|${normalizedUrl}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);

    result.push({
      videoId: defaultVideoId,
      seenAt: Date.now(),
      descriptor: {
        source: "vk",
        format,
        language: normalizedLanguage,
        url: normalizedUrl,
        isAutoGenerated,
      },
    });
  };

  const langBeforeUrlPattern =
    /["'](?:lang|language|locale|subtitles_lang)["']\s*:\s*["']([a-zA-Z_-]{2,12})["'][\s\S]{0,400}?["']url["']\s*:\s*["']([^"'\\]+(?:\\.[^"'\\]*)*)["'][\s\S]{0,120}?(?:["']is_auto["']\s*:\s*(true|false|0|1))?/g;
  const urlBeforeLangPattern =
    /["']url["']\s*:\s*["']([^"'\\]+(?:\\.[^"'\\]*)*)["'][\s\S]{0,400}?["'](?:lang|language|locale|subtitles_lang)["']\s*:\s*["']([a-zA-Z_-]{2,12})["'][\s\S]{0,120}?(?:["']is_auto["']\s*:\s*(true|false|0|1))?/g;

  for (const match of normalizedText.matchAll(langBeforeUrlPattern)) {
    push(match[1], match[2], toOptionalBoolean(match[3]));
  }
  for (const match of normalizedText.matchAll(urlBeforeLangPattern)) {
    push(match[2], match[1], toOptionalBoolean(match[3]));
  }

  return result;
}

function rememberTracks(
  siteHost: string,
  tracks: readonly SniffedSubtitleTrack[],
): void {
  if (!tracks.length) {
    return;
  }

  const now = Date.now();
  const existing = sniffedTracksByHost.get(siteHost) ?? [];
  const deduped = new Map<string, SniffedSubtitleTrack>();

  for (const track of existing) {
    if (now - track.seenAt > TRACK_MAX_AGE_MS) {
      continue;
    }
    deduped.set(
      [
        track.videoId ?? "",
        track.descriptor.language,
        track.descriptor.translatedFromLanguage ?? "",
        track.descriptor.url,
      ].join("|"),
      track,
    );
  }

  for (const track of tracks) {
    if (now - track.seenAt > TRACK_MAX_AGE_MS) {
      continue;
    }
    deduped.set(
      [
        track.videoId ?? "",
        track.descriptor.language,
        track.descriptor.translatedFromLanguage ?? "",
        track.descriptor.url,
      ].join("|"),
      track,
    );
  }

  const nextTracks = Array.from(deduped.values())
    .sort((left, right) => right.seenAt - left.seenAt)
    .slice(0, MAX_TRACKS_PER_HOST);
  sniffedTracksByHost.set(siteHost, nextTracks);
}

function rememberSubtitleUrl(rawUrl: string): void {
  const url = normalizeUrl(rawUrl);
  const format = inferSubtitleFormat(url);
  const language = inferLanguageFromUrl(url);
  if (!format || !language) {
    return;
  }

  rememberTracks("vk", [
    {
      videoId: extractVideoIdFromUrl(url),
      seenAt: Date.now(),
      descriptor: {
        source: "vk",
        format,
        language,
        url,
      },
    },
  ]);
}

function shouldInspectVkRequest(url: string): boolean {
  return VK_REQUEST_PATTERN.test(url);
}

function processPotentialVkPayload(requestUrl: string, payload: unknown): void {
  const collected: SniffedSubtitleTrack[] = [];
  collectDescriptors(
    payload,
    {
      collectionHint: false,
      videoId: extractVideoIdFromUrl(requestUrl),
    },
    collected,
    new WeakSet<object>(),
  );
  rememberTracks("vk", collected);
}

function processPotentialVkTextResponse(
  requestUrl: string,
  text: string,
): void {
  if (!text || text.length > MAX_BODY_LENGTH) {
    return;
  }

  try {
    processPotentialVkPayload(requestUrl, JSON.parse(text));
    return;
  } catch {
    // Ignore and fall back to regexp extraction below.
  }

  rememberTracks("vk", extractDescriptorsFromText(text, requestUrl));
}

function inspectFetchResponse(url: string, response: Response): void {
  const contentType = String(response.headers.get("content-type") || "")
    .trim()
    .toLowerCase();
  if (
    !shouldInspectVkRequest(url) &&
    !(contentType.includes("json") && /vkvideo|vk\.com|okcdn\.ru/i.test(url))
  ) {
    return;
  }

  if (contentType.includes("json")) {
    void response
      .clone()
      .json()
      .then((payload) => {
        processPotentialVkPayload(url, payload);
      })
      .catch(() => {
        void response
          .clone()
          .text()
          .then((text) => {
            processPotentialVkTextResponse(url, text);
          })
          .catch(() => undefined);
      });
    return;
  }

  void response
    .clone()
    .text()
    .then((text) => {
      processPotentialVkTextResponse(url, text);
    })
    .catch(() => undefined);
}

export function getSniffedSiteSubtitles(
  siteHost: string,
  videoId?: string,
): SubtitleDescriptor[] {
  if (siteHost !== "vk") {
    return [];
  }

  const now = Date.now();
  const currentTracks = (sniffedTracksByHost.get(siteHost) ?? []).filter(
    (track) => now - track.seenAt <= TRACK_MAX_AGE_MS,
  );
  sniffedTracksByHost.set(siteHost, currentTracks);

  const filteredTracks = videoId
    ? currentTracks.filter(
        (track) => !track.videoId || track.videoId === videoId,
      )
    : currentTracks;

  const deduped = new Map<string, SubtitleDescriptor>();
  for (const track of filteredTracks) {
    deduped.set(
      [
        track.descriptor.language,
        track.descriptor.translatedFromLanguage ?? "",
        track.descriptor.url,
      ].join("|"),
      track.descriptor,
    );
  }

  return Array.from(deduped.values());
}

export function installSiteSubtitlesSniffer(): void {
  if (installed) {
    return;
  }
  installed = true;

  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (...args) => {
    const response = await originalFetch(...args);

    if (!isVkPage()) {
      return response;
    }

    const input = args[0];
    const url =
      typeof input === "string"
        ? input
        : input instanceof Request
          ? input.url
          : String(input ?? "");

    if (SUBTITLE_URL_PATTERN.test(url)) {
      rememberSubtitleUrl(url);
    }
    inspectFetchResponse(url, response);

    return response;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    const stringUrl = String(url);
    (this as XMLHttpRequest & { [xhrUrlKey]?: string })[xhrUrlKey] = stringUrl;
    if (isVkPage() && SUBTITLE_URL_PATTERN.test(stringUrl)) {
      rememberSubtitleUrl(stringUrl);
    }
    return originalOpen.call(this, method, url, ...(rest as []));
  };

  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args: unknown[]) {
    if (isVkPage()) {
      this.addEventListener(
        "load",
        () => {
          const requestUrl = (
            this as XMLHttpRequest & { [xhrUrlKey]?: string }
          )[xhrUrlKey];
          if (!requestUrl) {
            return;
          }

          const contentType = String(
            this.getResponseHeader("content-type") || "",
          )
            .trim()
            .toLowerCase();

          if (
            !shouldInspectVkRequest(requestUrl) &&
            !(
              contentType.includes("json") &&
              /vkvideo|vk\.com|okcdn\.ru/i.test(requestUrl)
            )
          ) {
            return;
          }

          if (this.responseType === "json" && this.response) {
            processPotentialVkPayload(requestUrl, this.response);
            return;
          }

          if (
            this.responseType !== "" &&
            this.responseType !== "text" &&
            this.responseType !== "json"
          ) {
            return;
          }

          const responseText =
            typeof this.responseText === "string" ? this.responseText : "";
          processPotentialVkTextResponse(requestUrl, responseText);
        },
        { once: true },
      );
    }

    return originalSend.apply(this, args as []);
  };
}
