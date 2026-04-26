import YoutubeHelper from "@vot.js/ext/helpers/youtube";
import { getVideoData } from "@vot.js/ext/utils/videoData";
import { getLastManifestUrl } from "../utils/manifestSniffer";
import votConfig from "@vot.js/shared/config";
import { availableLangs } from "@vot.js/shared/consts";
import type { RequestLang, ResponseLang } from "@vot.js/shared/types/data";

import type { VideoHandler } from "..";
import { localizationProvider } from "../localization/localizationProvider";
import debug from "../utils/debug";
import { votStorage } from "../utils/storage";
import { GM_fetch } from "../utils/gm";
import { cleanText } from "../utils/text";
import { detect } from "../utils/translateApis";
import VOTLocalizedError from "../utils/VOTLocalizedError";
import {
  clampPercentInt,
  percentToVolume01,
  snapVolume01,
  volume01ToPercent,
} from "../utils/volume";
import type { VideoData as RuntimeVideoData } from "../videoHandler/shared";
import { isExternalVolumeHost } from "./hostPolicies";
import { resolveCustomSiteVideo } from "./customSiteResolvers";

const FORCED_DETECTED_LANGUAGE_BY_HOST: Record<string, RequestLang> = {
  rutube: "ru",
  "ok.ru": "ru",
  mail_ru: "ru",
  weverse: "ko",
  niconico: "ja",
  youku: "zh",
  bilibili: "zh",
  weibo: "zh",
  zdf: "de",
};



const YT_VOLUME_NOW_SELECTOR = ".ytp-volume-panel [aria-valuenow]";
const MIN_DETECT_TEXT_LENGTH = 35;
const MAX_SHARED_LANGUAGE_STATES = 500;
const REQUEST_LANG_SET = new Set<RequestLang>(
  availableLangs as readonly RequestLang[],
);

type ResolvedRequestLang = Exclude<RequestLang, "auto">;
type SharedLanguageState = {
  detectInFlight?: Promise<ResolvedRequestLang | undefined>;
  detectedLanguage?: ResolvedRequestLang;
  userLanguageOverride?: ResolvedRequestLang;
  lastLoggedDetectedLanguage?: RequestLang;
  lastLoggedLangPair?: string;
};

type ResolveDetectedLanguageOptions = {
  isStream: boolean;
  host: string;
  possibleLanguage: unknown;
  subtitles?: unknown;
  userOverrideLanguage?: ResolvedRequestLang;
  cachedDetectedLanguage?: ResolvedRequestLang;
  title: unknown;
  description: unknown;
  allowTextLanguageDetection?: boolean;
  detectLanguage(text: string): Promise<ResolvedRequestLang | undefined>;
};

type ResolveDetectedLanguageResult = {
  detectedLanguage: RequestLang;
  cacheLanguage?: ResolvedRequestLang;
};

/**
 * Shared language caches across VideoManager instances within one frame.
 *
 * YouTube Shorts can transiently create multiple video handlers while the URL
 * (and therefore resolved `videoId`) still points to the same active short.
 * Per-instance caches are insufficient in that case and can trigger duplicate
 * language detection requests.
 */
const sharedLanguageStateByVideoId = new Map<string, SharedLanguageState>();

function normalizeLocalTitleFromUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;

  try {
    const parsed = new URL(value, globalThis.location.href);
    const lastSegment = decodeURIComponent(parsed.pathname.split("/").pop() || "");
    return lastSegment.replace(/\.[^.]+$/u, "").trim() || undefined;
  } catch {
    return undefined;
  }
}

function getGoogleDrivePageTitle(): string | undefined {
  const exactDriveTitle =
    Array.from(
      document.querySelectorAll('[data-is-tooltip-wrapper="true"] > span'),
    )
      .map((el) => el.textContent?.trim() ?? "")
      .find((text) => /\.(mp4|mkv|mov|webm|avi|m4v)$/i.test(text)) || "";

  const metaTitle =
    document
      .querySelector('meta[property="og:title"], meta[name="title"]')
      ?.getAttribute("content")
      ?.trim() || "";

  const headerTitle =
    document
      .querySelector('h1, [role="heading"], div[role="heading"], [data-tooltip]')
      ?.textContent
      ?.trim() || "";

  const docTitle = String(document.title || "").trim();

  const raw = exactDriveTitle || metaTitle || headerTitle || docTitle;
  if (!raw) return undefined;

  return raw
    .replace(/\s*-\s*Google Drive\s*$/i, "")
    .replace(/\s*-\s*Google Диск\s*$/i, "")
    .trim();
}


function isBadGoogleDriveTitle(value: unknown): boolean {
  if (typeof value !== "string") return true;

  const normalized = value.trim();
  if (!normalized) return true;

  return (
    /^youtube$/i.test(normalized) ||
    /^google drive$/i.test(normalized) ||
    /^google диск$/i.test(normalized) ||
    /^[A-Za-z0-9_-]{20,}$/.test(normalized) // похоже на fileId
  );
}

function normalizeGoogleDriveTitle(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;

  const normalized = value
    .replace(/\s*-\s*Google Drive\s*$/i, "")
    .replace(/\s*-\s*Google Диск\s*$/i, "")
    .trim();

  return normalized || undefined;
}

async function getStoredGoogleDriveTitle(
  videoId: string,
): Promise<string | undefined> {
  try {
    const storedTitle = await votStorage.get(`googledrive:title:${videoId}`);
    return normalizeGoogleDriveTitle(storedTitle);
  } catch {
    return undefined;
  }
}

function inferSubtitleFormatFromUrl(url: string): "vtt" | "srt" | "json" {
  const normalized = url.split(/[?#]/u, 1)[0]?.toLowerCase() ?? "";
  if (normalized.endsWith(".srt")) return "srt";
  if (normalized.endsWith(".json")) return "json";
  return "vtt";
}

function getTrackSubtitleSource(siteHost: string): string {
  if (siteHost === "custom") {
    return String(globalThis.location.hostname || "native").trim() || "native";
  }

  return siteHost || String(globalThis.location.hostname || "native").trim();
}

function getElementTrackSubtitles(
  video: HTMLVideoElement,
  source: string,
): RuntimeVideoData["subtitles"] {
  const subtitles: NonNullable<RuntimeVideoData["subtitles"]> = [];
  const tracks = Array.from(video.querySelectorAll("track"));

  for (const track of tracks) {
    const kind = String(track.kind || track.getAttribute("kind") || "")
      .trim()
      .toLowerCase();

    if (kind === "metadata") {
      continue;
    }

    const language = String(
      track.srclang || track.track?.language || track.getAttribute("srclang") || "",
    )
      .trim()
      .toLowerCase();

    const rawUrl = String(track.src || track.getAttribute("src") || "").trim();
    if (!language || !rawUrl) {
      continue;
    }

    let url = rawUrl;
    try {
      url = new URL(rawUrl, document.baseURI).href;
    } catch {
      // leave rawUrl as-is
    }

    subtitles.push({
      language,
      url,
      format: inferSubtitleFormatFromUrl(url),
      source,
      isAutoGenerated: kind === "captions",
    });
  }

  return subtitles;
}

function mergeSubtitleDescriptors(
  primary: unknown,
  extra: RuntimeVideoData["subtitles"],
): RuntimeVideoData["subtitles"] {
  const merged: NonNullable<RuntimeVideoData["subtitles"]> = [];
  const seen = new Set<string>();

  const append = (list: unknown) => {
    if (!Array.isArray(list)) {
      return;
    }

    for (const item of list) {
      if (!item || typeof item !== "object") {
        continue;
      }

      const subtitle = item as {
        language?: unknown;
        url?: unknown;
        source?: unknown;
        format?: unknown;
        translatedFromLanguage?: unknown;
        isAutoGenerated?: unknown;
      };

      if (
        typeof subtitle.language !== "string" ||
        typeof subtitle.url !== "string" ||
        typeof subtitle.source !== "string" ||
        typeof subtitle.format !== "string"
      ) {
        continue;
      }

      const key = [
        subtitle.source,
        subtitle.language,
        subtitle.translatedFromLanguage ?? "",
        subtitle.url,
      ].join("|");
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push({
        language: subtitle.language,
        url: subtitle.url,
        source: subtitle.source,
        format: subtitle.format as any,
        translatedFromLanguage:
          typeof subtitle.translatedFromLanguage === "string"
            ? subtitle.translatedFromLanguage
            : undefined,
        isAutoGenerated:
          typeof subtitle.isAutoGenerated === "boolean"
            ? subtitle.isAutoGenerated
            : undefined,
      });
    }
  };

  append(primary);
  append(extra);
  return merged;
}

function isBadGenericVideoId(value: unknown): boolean {
  if (typeof value !== "string") return true;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return true;

  return (
    normalized === "undefined" ||
    normalized === "null" ||
    normalized.startsWith("blob:") ||
    normalized.includes("/frame/") ||
    /\/s\d+\/v[\d.]+\/frame\/?$/i.test(normalized) ||
    normalized.includes("okcdn.ru/?") ||
    /[?&]bytes=\d+-\d+/i.test(normalized) ||
    /[?&]type=\d+/i.test(normalized)
  );
}

function isPageScopedVideoId(value: unknown, pageUrl: string): boolean {
  if (typeof value !== "string") {
    return false;
  }

  const normalized = value.trim();
  if (!normalized) {
    return false;
  }

  if (normalized === pageUrl) {
    return true;
  }

  try {
    const candidateUrl = new URL(normalized, globalThis.location.href);
    const currentUrl = new URL(pageUrl, globalThis.location.href);

    candidateUrl.hash = "";
    currentUrl.hash = "";

    if (candidateUrl.toString() === currentUrl.toString()) {
      return true;
    }

    if (
      candidateUrl.origin !== currentUrl.origin ||
      candidateUrl.pathname !== currentUrl.pathname
    ) {
      return false;
    }

    const normalizeSearch = (url: URL): string =>
      Array.from(url.searchParams.entries())
        .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
          if (leftKey === rightKey) {
            return leftValue.localeCompare(rightValue);
          }
          return leftKey.localeCompare(rightKey);
        })
        .map(([key, paramValue]) => `${key}=${paramValue}`)
        .join("&");

    return normalizeSearch(candidateUrl) === normalizeSearch(currentUrl);
  } catch {
    return false;
  }
}

function isBadGenericMediaUrl(value: unknown): boolean {
  if (typeof value !== "string") return true;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return true;

  return (
    normalized.startsWith("blob:") ||
    normalized.startsWith("data:") ||
    normalized.includes("/frame/") ||
    /\/s\d+\/v[\d.]+\/frame\/?$/i.test(normalized) ||
    normalized.includes("okcdn.ru/?") ||
    /[?&]bytes=\d+-\d+/i.test(normalized) ||
    /[?&]type=\d+/i.test(normalized)
  );
}

function pickPreferredVideoUrl(...candidates: Array<unknown>): string {
  for (const candidate of candidates) {
    if (typeof candidate !== "string") {
      continue;
    }

    const normalized = candidate.trim();
    if (!normalized || isBadGenericMediaUrl(normalized)) {
      continue;
    }

    return normalized;
  }

  return "";
}

function isUsefulResolvedFallback(
  currentUrl: unknown,
  currentVideoId: unknown,
  resolved: { url: string; videoId?: string } | null,
): boolean {
  if (!resolved || isBadGenericMediaUrl(resolved.url)) {
    return false;
  }

  return (
    isBadGenericMediaUrl(currentUrl) ||
    isBadGenericVideoId(currentVideoId) ||
    (/^https?:\/\//i.test(resolved.url) &&
      !/^https?:\/\//i.test(String(currentUrl || "").trim()))
  );
}

function getSharedLanguageState(videoId: string): SharedLanguageState {
  const cachedState = sharedLanguageStateByVideoId.get(videoId);
  if (cachedState) {
    return cachedState;
  }

  const createdState: SharedLanguageState = {};
  sharedLanguageStateByVideoId.set(videoId, createdState);
  while (sharedLanguageStateByVideoId.size > MAX_SHARED_LANGUAGE_STATES) {
    const oldestVideoId = sharedLanguageStateByVideoId.keys().next().value;
    if (typeof oldestVideoId !== "string") {
      break;
    }
    sharedLanguageStateByVideoId.delete(oldestVideoId);
  }
  return createdState;
}

function normalizeToRequestLang(value: unknown): RequestLang | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.toLowerCase().split(/[-_]/)[0] as RequestLang;
  return REQUEST_LANG_SET.has(normalized) ? normalized : undefined;
}

function isResolvedLanguage(
  value: RequestLang | undefined,
): value is ResolvedRequestLang {
  return Boolean(value && value !== "auto");
}

function buildDetectText(title: unknown, description: unknown): string {
  const textTitle = typeof title === "string" ? title : "";
  const textDescription =
    typeof description === "string" ? description : undefined;
  return cleanText(textTitle, textDescription);
}

function resolveHostDetectedLanguage(host: string): RequestLang | undefined {
  const forcedDetectedLanguage = FORCED_DETECTED_LANGUAGE_BY_HOST[host];
  if (forcedDetectedLanguage) {
    return forcedDetectedLanguage;
  }

  if (host === "vk") {
    const trackLang = document.getElementsByTagName("track")?.[0]?.srclang;
    return normalizeToRequestLang(trackLang);
  }

  return undefined;
}

function resolveYoutubeDetectedLanguageFromSubtitles(
  subtitles: unknown,
): RequestLang | undefined {
  if (!Array.isArray(subtitles) || subtitles.length === 0) {
    return undefined;
  }

  const pickLanguage = (preferManual: boolean): RequestLang | undefined => {
    for (const subtitle of subtitles) {
      if (!subtitle || typeof subtitle !== "object") {
        continue;
      }

      const candidate = subtitle as {
        source?: unknown;
        language?: unknown;
        translatedFromLanguage?: unknown;
        isAutoGenerated?: unknown;
      };
      if (candidate.source !== "youtube") {
        continue;
      }
      if (typeof candidate.translatedFromLanguage === "string") {
        continue;
      }
      if (preferManual && candidate.isAutoGenerated === true) {
        continue;
      }

      const language = normalizeToRequestLang(candidate.language);
      if (isResolvedLanguage(language)) {
        return language;
      }
    }

    return undefined;
  };

  return pickLanguage(true) ?? pickLanguage(false);
}

export async function resolveDetectedLanguageForVideo(
  options: ResolveDetectedLanguageOptions,
): Promise<ResolveDetectedLanguageResult> {
  if (options.isStream) {
    return { detectedLanguage: "auto" };
  }

  if (options.userOverrideLanguage) {
    return { detectedLanguage: options.userOverrideLanguage };
  }

  const hostDetectedLanguage = resolveHostDetectedLanguage(options.host);
  if (isResolvedLanguage(hostDetectedLanguage)) {
    return {
      detectedLanguage: hostDetectedLanguage,
      cacheLanguage: hostDetectedLanguage,
    };
  }

  const normalizedPossibleLanguage = normalizeToRequestLang(
    options.possibleLanguage,
  );
  if (isResolvedLanguage(normalizedPossibleLanguage)) {
    return {
      detectedLanguage: normalizedPossibleLanguage,
      cacheLanguage: normalizedPossibleLanguage,
    };
  }

  const youtubeSubtitleDetectedLanguage =
    options.host === "youtube"
      ? resolveYoutubeDetectedLanguageFromSubtitles(options.subtitles)
      : undefined;
  if (isResolvedLanguage(youtubeSubtitleDetectedLanguage)) {
    return {
      detectedLanguage: youtubeSubtitleDetectedLanguage,
      cacheLanguage: youtubeSubtitleDetectedLanguage,
    };
  }

  if (options.cachedDetectedLanguage) {
    return { detectedLanguage: options.cachedDetectedLanguage };
  }

  if (!options.allowTextLanguageDetection) {
    return { detectedLanguage: "auto" };
  }

  const text = buildDetectText(options.title, options.description);
  if (!text || text.length < MIN_DETECT_TEXT_LENGTH) {
    return { detectedLanguage: "auto" };
  }

  const detectedLanguage = await options.detectLanguage(text);
  if (!detectedLanguage) {
    return { detectedLanguage: "auto" };
  }

  return {
    detectedLanguage,
    cacheLanguage: detectedLanguage,
  };
}

function getAriaValueNowPercent(selector: string): number | null {
  const el = document.querySelector(selector);
  const rawNow = el?.getAttribute("aria-valuenow");
  const rawMax = el?.getAttribute("aria-valuemax");
  const now = rawNow == null ? Number.NaN : Number.parseFloat(rawNow);
  const max = rawMax == null ? Number.NaN : Number.parseFloat(rawMax);

  if (!Number.isFinite(now)) return null;
  if (Number.isFinite(max) && max > 0) {
    return clampPercentInt((now / max) * 100);
  }

  return clampPercentInt(now);
}

export class VOTVideoManager {
  videoHandler: VideoHandler;

  constructor(videoHandler: VideoHandler) {
    this.videoHandler = videoHandler;
  }

  private setDetectedLanguageCache(
    videoId: string,
    language: ResolvedRequestLang,
  ): void {
    getSharedLanguageState(videoId).detectedLanguage = language;
  }

  rememberUserLanguageSelection(videoId: string, language: RequestLang): void {
    const normalizedLanguage = normalizeToRequestLang(language);
    if (!isResolvedLanguage(normalizedLanguage)) {
      // "auto" means no manual override for this video.
      const sharedLanguageState = sharedLanguageStateByVideoId.get(videoId);
      if (sharedLanguageState) {
        delete sharedLanguageState.userLanguageOverride;
      }
      return;
    }

    const sharedLanguageState = getSharedLanguageState(videoId);
    sharedLanguageState.userLanguageOverride = normalizedLanguage;
    sharedLanguageState.detectedLanguage = normalizedLanguage;
  }

  rememberDetectedLanguage(videoId: string, language: RequestLang): void {
    const normalizedLanguage = normalizeToRequestLang(language);
    if (!isResolvedLanguage(normalizedLanguage)) {
      return;
    }

    this.setDetectedLanguageCache(videoId, normalizedLanguage);

    if (this.videoHandler.videoData?.videoId === videoId) {
      this.videoHandler.videoData.detectedLanguage = normalizedLanguage;
    }
  }

  private async detectLanguageSingleFlight(
    videoId: string,
    text: string,
  ): Promise<ResolvedRequestLang | undefined> {
    const sharedLanguageState = getSharedLanguageState(videoId);
    const inFlightDetect = sharedLanguageState.detectInFlight;
    if (inFlightDetect !== undefined) {
      return inFlightDetect;
    }

    const task: Promise<ResolvedRequestLang | undefined> = (async () => {
      debug.log(`Detecting language text: ${text}`);
      const language = normalizeToRequestLang(await detect(text));
      return isResolvedLanguage(language) ? language : undefined;
    })();

    sharedLanguageState.detectInFlight = task;
    try {
      return await task;
    } finally {
      if (sharedLanguageState.detectInFlight === task) {
        delete sharedLanguageState.detectInFlight;
      }
    }
  }

  async ensureDetectedLanguageForTranslation(
    videoData: RuntimeVideoData | undefined,
  ): Promise<void> {
    if (!videoData?.videoId || videoData.detectedLanguage !== "auto") {
      return;
    }

    const sharedLanguageState = getSharedLanguageState(videoData.videoId);
    const { detectedLanguage, cacheLanguage } =
      await resolveDetectedLanguageForVideo({
        isStream: videoData.isStream,
        host: this.videoHandler.site.host,
        possibleLanguage: videoData.detectedLanguage,
        subtitles: videoData.subtitles,
        userOverrideLanguage: sharedLanguageState.userLanguageOverride,
        cachedDetectedLanguage: sharedLanguageState.detectedLanguage,
        title: videoData.title,
        description: videoData.description,
        allowTextLanguageDetection: true,
        detectLanguage: async (text) =>
          await this.detectLanguageSingleFlight(videoData.videoId, text),
      });

    if (cacheLanguage) {
      this.setDetectedLanguageCache(videoData.videoId, cacheLanguage);
    }

    if (detectedLanguage === "auto") {
      return;
    }

    videoData.detectedLanguage = detectedLanguage;
    if (this.videoHandler.translateFromLang === "auto") {
      this.videoHandler.translateFromLang = detectedLanguage;
    }
  }

async getVideoData() {
  const pageUrl = String(globalThis.location.href || "").trim();
  const hostname = String(globalThis.location.hostname || "").trim();
  const sniffedManifestUrl = getLastManifestUrl();
  const mediaUrl = String(
    this.videoHandler.video.currentSrc ||
      this.videoHandler.video.src ||
      "",
  ).trim();
  const nativeTrackSubtitles = getElementTrackSubtitles(
    this.videoHandler.video,
    getTrackSubtitleSource(this.videoHandler.site.host),
  );

  let rawVideoDataError: unknown;
  let rawVideoData:
    | Awaited<ReturnType<typeof getVideoData>>
    | {
        duration: number;
        url: string;
        videoId: string;
        host: string;
        title?: string;
        translationHelp: null;
        localizedTitle?: string;
        description?: string;
        detectedLanguage: "auto";
        subtitles: RuntimeVideoData["subtitles"];
        isStream: false;
      };

  try {
    rawVideoData = await getVideoData(this.videoHandler.site, {
      fetchFn: GM_fetch,
      video: this.videoHandler.video,
      language: localizationProvider.lang,
    });
  } catch (error) {
    rawVideoDataError = error;
    console.warn(
      "[VOT][fallback:getVideoData] site getVideoData() failed, using DOM fallback",
      {
        siteHost: this.videoHandler.site.host,
        hostname,
        error,
      },
    );

    rawVideoData = {
      duration:
        this.videoHandler.video?.duration || votConfig.defaultDuration,
      url: "",
      videoId: "",
      host: this.videoHandler.site.host,
      title: document.title,
      translationHelp: null,
      localizedTitle: document.title,
      description: undefined,
      detectedLanguage: "auto",
      subtitles: nativeTrackSubtitles,
      isStream: false,
    };
  }

  let {
    duration,
    url,
    videoId,
    host,
    title,
    translationHelp = null,
    localizedTitle,
    description,
    detectedLanguage: possibleLanguage,
    subtitles,
    isStream = false,
  } = rawVideoData;
  subtitles = mergeSubtitleDescriptors(subtitles, nativeTrackSubtitles);

  const resolvedFallback = await resolveCustomSiteVideo(hostname, pageUrl);
  const shouldUseDomFallback =
    this.videoHandler.site.host === "custom" ||
    Boolean(rawVideoDataError) ||
    isUsefulResolvedFallback(url, videoId, resolvedFallback);

  if (shouldUseDomFallback) {
    const fallbackUrl = pickPreferredVideoUrl(
      resolvedFallback?.url,
      sniffedManifestUrl,
      mediaUrl,
      url,
      pageUrl,
    );

    if (fallbackUrl) {
      url = fallbackUrl;
    }

    if (
      isBadGenericVideoId(videoId) ||
      isPageScopedVideoId(videoId, pageUrl)
    ) {
      const fallbackVideoIdCandidate =
        !isBadGenericVideoId(fallbackUrl) &&
        !isPageScopedVideoId(fallbackUrl, pageUrl)
          ? fallbackUrl
          : "";
      const resolvedVideoIdCandidate =
        !isBadGenericVideoId(resolvedFallback?.videoId) &&
        !isPageScopedVideoId(String(resolvedFallback?.videoId || ""), pageUrl)
          ? String(resolvedFallback?.videoId).trim()
          : "";

      videoId = fallbackVideoIdCandidate || resolvedVideoIdCandidate || pageUrl;
    }

    host = "custom";

    const fallbackTitle =
      resolvedFallback?.title ||
      normalizeLocalTitleFromUrl(url) ||
      (typeof document.title === "string" ? document.title.trim() : undefined);

    if (fallbackTitle) {
      title = fallbackTitle;
      if (!localizedTitle) {
        localizedTitle = fallbackTitle;
      }
    }

    console.log("[VOT][fallback:getVideoData] using DOM/media fallback", {
      siteHost: this.videoHandler.site.host,
      sniffedManifestUrl,
      mediaUrl,
      pageUrl,
      resolvedFallback,
      finalUrl: url,
      finalVideoId: videoId,
      finalHost: host,
    });
  }

  if (this.videoHandler.site.host === "googledrive") {
    subtitles = mergeSubtitleDescriptors(
      subtitles,
      getElementTrackSubtitles(this.videoHandler.video, "googledrive"),
    );

    const pageTitle = normalizeGoogleDriveTitle(getGoogleDrivePageTitle());
    const storedTitle = await getStoredGoogleDriveTitle(videoId);
    const safeTitle = normalizeGoogleDriveTitle(title);
    const safeLocalizedTitle = normalizeGoogleDriveTitle(localizedTitle);

    const resolvedGoogleDriveTitle =
      !isBadGoogleDriveTitle(safeTitle)
        ? safeTitle
        : !isBadGoogleDriveTitle(storedTitle)
          ? storedTitle
          : !isBadGoogleDriveTitle(pageTitle)
            ? pageTitle
            : !isBadGoogleDriveTitle(safeLocalizedTitle)
              ? safeLocalizedTitle
              : undefined;

    if (resolvedGoogleDriveTitle) {
      title = resolvedGoogleDriveTitle;

      if (isBadGoogleDriveTitle(localizedTitle)) {
        localizedTitle = resolvedGoogleDriveTitle;
      }
    }
  }

  const sharedLanguageState = getSharedLanguageState(videoId);
  const { detectedLanguage, cacheLanguage } =
    await resolveDetectedLanguageForVideo({
      isStream,
      host: this.videoHandler.site.host,
      possibleLanguage,
      subtitles,
      userOverrideLanguage: sharedLanguageState.userLanguageOverride,
      cachedDetectedLanguage: sharedLanguageState.detectedLanguage,
      title,
      description,
      allowTextLanguageDetection: false,
      detectLanguage: async (text) =>
        await this.detectLanguageSingleFlight(videoId, text),
    });

  if (cacheLanguage) {
    this.setDetectedLanguageCache(videoId, cacheLanguage);
  }

  if (host === "custom") {
    const localTitle =
      normalizeLocalTitleFromUrl(url) ||
      (typeof document.title === "string" ? document.title.trim() : undefined);

    if (localTitle) {
      title = localTitle;
      if (!localizedTitle) {
        localizedTitle = localTitle;
      }
    }
  }

  const videoData = {
    translationHelp,
    isStream,
    duration:
      duration ||
      this.videoHandler.video?.duration ||
      votConfig.defaultDuration,
    videoId,
    url,
    host,
    detectedLanguage,
    responseLanguage: this.videoHandler.translateToLang,
    subtitles,
    title,
    localizedTitle,
    description,
    downloadTitle:
      this.videoHandler.site.host === "googledrive"
        ? (
            normalizeGoogleDriveTitle(title) ??
            normalizeGoogleDriveTitle(localizedTitle) ??
            normalizeGoogleDriveTitle(getGoogleDrivePageTitle()) ??
            videoId
          )
        : host === "custom"
          ? (
              normalizeLocalTitleFromUrl(url) ??
              title ??
              localizedTitle ??
              videoId
            )
          : (localizedTitle ?? title ?? videoId),
  } satisfies RuntimeVideoData;

  if (sharedLanguageState.lastLoggedDetectedLanguage !== detectedLanguage) {
    console.log("[VOT] Detected language:", detectedLanguage);
    sharedLanguageState.lastLoggedDetectedLanguage = detectedLanguage;
  }

  if (Array.isArray(videoData.subtitles) && videoData.subtitles.length > 0) {
    console.log(
      `[VOT][subtitles] video data contains ${videoData.subtitles.length} subtitle track(s).`,
    );
    console.table(
      videoData.subtitles.map((subtitle, index) => ({
        index,
        language: subtitle.language,
        translatedFromLanguage: subtitle.translatedFromLanguage ?? "",
        source: subtitle.source,
        isAutoGenerated: Boolean(subtitle.isAutoGenerated),
        url: subtitle.url,
      })),
    );
  }

  return videoData;
}

  async videoValidator() {
    const videoData = this.videoHandler.videoData;
    const data = this.videoHandler.data;
    if (!videoData || !data) {
      throw new VOTLocalizedError("VOTNoVideoIDFound");
    }

    debug.log("VideoValidator videoData: ", this.videoHandler.videoData);
    if (
      this.videoHandler.data.enabledDontTranslateLanguages &&
      this.videoHandler.data.dontTranslateLanguages?.includes(
        this.videoHandler.videoData.detectedLanguage,
      )
    ) {
      throw new VOTLocalizedError("VOTDisableFromYourLang");
    }

    if (this.videoHandler.videoData.isStream) {
      // Stream translation is disabled for all hosts.
      throw new VOTLocalizedError("VOTStreamNotAvailable");
    }

    if (this.videoHandler.videoData.duration > 14400) {
      throw new VOTLocalizedError("VOTVideoIsTooLong");
    }
    return true;
  }

  /**
   * Gets current video volume (0.0 - 1.0)
   */
  getVideoVolume() {
    const video = this.videoHandler.video;
    if (!video) return undefined;

    // For external players (YouTube / Google Drive), prefer the UI's aria values
    // when available. This avoids float drift and off-by-one issues like 100% -> 99%.
    if (isExternalVolumeHost(this.videoHandler.site.host)) {
      const ariaPercent = getAriaValueNowPercent(YT_VOLUME_NOW_SELECTOR);
      if (ariaPercent != null) {
        return percentToVolume01(ariaPercent);
      }

      const extVolume = YoutubeHelper.getVolume();
      if (typeof extVolume === "number" && Number.isFinite(extVolume)) {
        return snapVolume01(extVolume);
      }
    }

    return snapVolume01(video.volume);
  }

  /**
   * Sets the video volume
   */
  setVideoVolume(volume: number) {
    const snapped = snapVolume01(volume);

    if (!isExternalVolumeHost(this.videoHandler.site.host)) {
      this.videoHandler.video.volume = snapped;
      return this;
    }

    // YoutubeHelper.setVolume() historically returned either a boolean or a number.
    // Do NOT use a truthy check here, or setting volume to 0 (0%) will be treated
    // as a failure.
    try {
      const result = YoutubeHelper.setVolume(snapped) as unknown;
      const ok =
        (typeof result === "boolean" && result) ||
        (typeof result === "number" && Number.isFinite(result));
      if (ok) return this;
    } catch {
      // ignore - fall back to setting the HTMLMediaElement volume below.
    }

    this.videoHandler.video.volume = snapped;
    return this;
  }

  /**
   * Checks if the video is muted
   */
  isMuted() {
    return isExternalVolumeHost(this.videoHandler.site.host)
      ? YoutubeHelper.isMuted()
      : this.videoHandler.video?.muted;
  }

  /**
   * Syncs the video volume slider with the actual video volume.
   */
  syncVideoVolumeSlider() {
    const overlayView = this.videoHandler.uiManager.votOverlayView;
    if (!overlayView?.isInitialized()) return this;

    const ariaPercent = isExternalVolumeHost(this.videoHandler.site.host)
      ? getAriaValueNowPercent(YT_VOLUME_NOW_SELECTOR)
      : null;

    const volumePercent = this.isMuted()
      ? 0
      : (ariaPercent ?? volume01ToPercent(this.getVideoVolume() ?? 0));

    overlayView.videoVolumeSlider.value = volumePercent;

    // Keep syncVolume delta state aligned with programmatic slider updates.
    this.videoHandler.onVideoVolumeSliderSynced?.(volumePercent);
    return this;
  }

  setSelectMenuValues(from: RequestLang, to: ResponseLang): this {
    const videoData = this.videoHandler.videoData;
    if (!videoData) {
      return this;
    }

    const normalizedFrom = normalizeToRequestLang(from) ?? "auto";
    const langPairLogKey = `${normalizedFrom}->${to}`;
    const sharedLanguageState = getSharedLanguageState(videoData.videoId);
    if (sharedLanguageState.lastLoggedLangPair !== langPairLogKey) {
      console.log(`[VOT] Set translation from ${normalizedFrom} to ${to}`);
      sharedLanguageState.lastLoggedLangPair = langPairLogKey;
    }
    videoData.detectedLanguage = normalizedFrom;
    videoData.responseLanguage = to;
    this.videoHandler.translateFromLang = normalizedFrom;
    this.videoHandler.translateToLang = to;

    const overlayView = this.videoHandler.uiManager.votOverlayView;
    if (!overlayView?.isInitialized()) {
      return this;
    }

    overlayView.languagePairSelect.fromSelect.selectTitle =
      localizationProvider.getLangLabel(normalizedFrom);
    overlayView.languagePairSelect.toSelect.selectTitle =
      localizationProvider.getLangLabel(to);
    overlayView.languagePairSelect.fromSelect.setSelectedValue(normalizedFrom);
    overlayView.languagePairSelect.toSelect.setSelectedValue(to);
    return this;
  }
}
