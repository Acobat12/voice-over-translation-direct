import type { VideoData as CoreVideoData } from "@vot.js/core/types/client";
import { getVideoData } from "@vot.js/ext/utils/videoData";
import votConfig from "@vot.js/shared/config";
import { availableLangs } from "@vot.js/shared/consts";
import type { RequestLang, ResponseLang } from "@vot.js/shared/types/data";
import type { VideoHandler } from "..";
import {
  getYouTubeAudioMetadata,
  YOUTUBE_VOT_SOURCE_LANGUAGES,
} from "../audioDownloader/strategies/youtubeAudioMetadata";
import { localizationProvider } from "../localization/localizationProvider";
import debug from "../utils/debug";
import { GM_fetch } from "../utils/gm";
import { getLastManifestUrl } from "../utils/manifestSniffer";
import { getSniffedSiteSubtitles } from "../utils/siteSubtitlesSniffer";
import { votStorage } from "../utils/storage";
import { cleanText, normalizeGoogleDriveTitle } from "../utils/text";
import { detect } from "../utils/translateApis";
import VOTLocalizedError from "../utils/VOTLocalizedError";
import {
  clampPercentInt,
  percentToVolume01,
  snapVolume01,
  volume01ToPercent,
} from "../utils/volume";
import type { VideoData as RuntimeVideoData } from "../videoHandler/shared";
import { resolveCustomSiteVideo } from "./customSiteResolvers";
import { isExternalVolumeHost } from "./hostPolicies";
import {
  buildCanonicalRutubeFallbackTarget,
  isRutubeSupportedPageHost,
} from "./rutubeVideoTarget";
import { getSourceAudioAvailability } from "./sourceAudioAvailability";
import {
  buildCanonicalVkFallbackTarget,
  isVkSupportedPageHost,
} from "./vkVideoTarget";
import YoutubeHelper, { isMobileYouTubeAdditionalData } from "./youtubeHelper";

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
const SUPPORTED_TRANSLATION_SOURCE_LANGS =
  YOUTUBE_VOT_SOURCE_LANGUAGES as Set<RequestLang>;

type ResolvedRequestLang = Exclude<RequestLang, "auto">;
type SharedLanguageState = {
  detectInFlight?: Promise<ResolvedRequestLang | undefined>;
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
  title: unknown;
  description: unknown;
  allowTextLanguageDetection?: boolean;
  detectLanguage(text: string): Promise<ResolvedRequestLang | undefined>;
};

type ResolveDetectedLanguageResult = {
  detectedLanguage: RequestLang;
};

/**
 * Shared transient language state across VideoManager instances within one frame.
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
    const lastSegment = decodeURIComponent(
      parsed.pathname.split("/").pop() || "",
    );
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
      .querySelector(
        'h1, [role="heading"], div[role="heading"], [data-tooltip]',
      )
      ?.textContent?.trim() || "";

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

async function getStoredGoogleDriveTitle(
  videoId: string,
): Promise<string | undefined> {
  try {
    const storedTitle = await votStorage.getRaw<string>(
      `googledrive:title:${videoId}`,
    );
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
      track.srclang ||
        track.track?.language ||
        track.getAttribute("srclang") ||
        "",
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
  const isManifest =
    /\.m3u8([?#]|$)/i.test(normalized) || /\.mpd([?#]|$)/i.test(normalized);

  return (
    normalized.startsWith("blob:") ||
    normalized.startsWith("data:") ||
    normalized.includes("/frame/") ||
    /\/s\d+\/v[\d.]+\/frame\/?$/i.test(normalized) ||
    normalized.includes("okcdn.ru/?") ||
    /[?&]bytes=\d+-\d+/i.test(normalized) ||
    (!isManifest && /[?&]type=\d+/i.test(normalized))
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

function isBilibiliSupportedPageHost(hostname: string): boolean {
  return /^(www|m)\.bilibili\.com$/i.test(String(hostname || "").trim());
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

// YouTube can report a real source language that VOT/Yandex does not support
// (for example `pt`). Do not filter that evidence through `availableLangs`,
// otherwise an unsupported real language disappears and later text detection
// can incorrectly replace it with `en`. The RequestLang cast is only a typing
// bridge; support is checked separately by SUPPORTED_TRANSLATION_SOURCE_LANGS.
function normalizeYoutubeSourceLanguage(
  value: unknown,
): RequestLang | undefined {
  if (typeof value !== "string") return undefined;

  const raw = value.trim();
  if (!raw) return undefined;

  const base = raw
    .replace(/\.\d{1,3}$/u, "")
    .split(/[-_]/u)[0]
    ?.trim()
    .toLowerCase();

  if (!base || base === "auto" || base === "und") return undefined;
  if (!/^[a-z]{2,3}$/u.test(base)) return undefined;

  return base as RequestLang;
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

function resolveVkTranslationSourceLanguage(): RequestLang | undefined {
  try {
    const videos: HTMLVideoElement[] = [];
    const seenVideos = new Set<HTMLVideoElement>();

    const appendVideo = (video: HTMLVideoElement) => {
      if (seenVideos.has(video)) return;
      seenVideos.add(video);
      videos.push(video);
    };

    // VK currently keeps the active MSE video in an open ShadowRoot.
    // Inspect every open root rather than depending on a particular class name.
    for (const element of Array.from(document.querySelectorAll("*"))) {
      const root = element.shadowRoot;
      if (!root) continue;

      for (const video of Array.from(root.querySelectorAll("video"))) {
        appendVideo(video);
      }
    }

    // Fallback for VK builds that expose the media element in the light DOM.
    for (const video of Array.from(document.querySelectorAll("video"))) {
      appendVideo(video);
    }

    const scoreVideo = (video: HTMLVideoElement): number =>
      (video.readyState > 0 ? 10 : 0) +
      (video.currentSrc ? 5 : 0) +
      (Number.isFinite(video.duration) ? 2 : 0) +
      (video.videoWidth > 0 && video.videoHeight > 0 ? 1 : 0);

    videos.sort((left, right) => scoreVideo(right) - scoreVideo(left));

    for (const video of videos) {
      const tracks = Array.from(video.textTracks ?? []);
      const supportedTracks = tracks
        .map((track) => ({
          track,
          language: normalizeToRequestLang(track.language),
        }))
        .filter(
          (
            item,
          ): item is {
            track: TextTrack;
            language: ResolvedRequestLang;
          } =>
            isResolvedLanguage(item.language) &&
            SUPPORTED_TRANSLATION_SOURCE_LANGS.has(item.language),
        );

      if (supportedTracks.length === 0) {
        continue;
      }

      const languages = Array.from(
        new Set(supportedTracks.map(({ language }) => language)),
      );

      debug.log("[language] VK runtime text-track languages found", {
        languages,
        tracks: tracks.map((track) => ({
          id: track.id,
          language: track.language,
          kind: track.kind,
          label: track.label,
          mode: track.mode,
        })),
      });

      // For automatic VK detection, Russian subtitle tracks are deliberately
      // not used as a source-language hint. The user can still explicitly
      // select Russian via the normal language selector/user override.
      const autoSourcePriority: readonly ResolvedRequestLang[] = [
        "en",
        "es",
        "it",
        "fr",
        "de",
        "ja",
        "ko",
        "zh",
      ];

      const autoLanguage = autoSourcePriority.find((language) =>
        languages.includes(language),
      );

      if (autoLanguage) {
        const matchedTrack = supportedTracks.find(
          ({ language }) => language === autoLanguage,
        );

        debug.log("[language] VK translation source resolved", {
          language: autoLanguage,
          source: "vk-runtime-text-track-auto-priority",
          trackId: matchedTrack?.track.id,
          availableLanguages: languages,
        });
        return autoLanguage;
      }

      // `ru` alone must not force automatic source-language detection here.
      // Keep the result unknown so the normal fallback chain can continue.
      debug.log(
        "[language] VK runtime text tracks contain no auto-source candidate",
        {
          languages,
          reason: "russian-is-manual-only-for-vk-text-track-hint",
        },
      );
    }
  } catch (error) {
    debug.warn("[language] failed to inspect VK runtime text tracks", error);
  }

  return undefined;
}

function resolveHostDetectedLanguage(host: string): RequestLang | undefined {
  const forcedDetectedLanguage = FORCED_DETECTED_LANGUAGE_BY_HOST[host];
  if (forcedDetectedLanguage) {
    return forcedDetectedLanguage;
  }

  if (host === "vk") {
    const runtimeLanguage = resolveVkTranslationSourceLanguage();
    if (runtimeLanguage) {
      return runtimeLanguage;
    }

    // Legacy fallback for VK/player variants that expose a normal DOM <track>.
    const trackLang = document.getElementsByTagName("track")?.[0]?.srclang;
    return normalizeToRequestLang(trackLang);
  }

  return undefined;
}

// Single YouTube player-response source of truth for source-language detection.
function findSupportedYoutubeAlternateAudioTrack() {
  const videoId = globalThis.location.pathname.startsWith("/shorts/")
    ? globalThis.location.pathname.split("/")[2]
    : new URLSearchParams(globalThis.location.search).get("v");
  const metadata = videoId ? getYouTubeAudioMetadata(videoId) : undefined;
  if (!metadata?.usingAlternative || !metadata.trackId || !metadata.language)
    return undefined;
  return {
    language: metadata.language as ResolvedRequestLang,
    trackId: metadata.trackId,
  };
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
    };
  }

  if (options.host === "youtube") {
    const id = globalThis.location.pathname.startsWith("/shorts/")
      ? globalThis.location.pathname.split("/")[2]
      : new URLSearchParams(globalThis.location.search).get("v");
    const language = id ? getYouTubeAudioMetadata(id)?.language : undefined;
    if (language) return { detectedLanguage: language as RequestLang };
  }

  // For YouTube, ambiguous caption arrays must not poison source-language
  // detection. When no concrete audio/caption source evidence
  // exists, title/description detection is safer than possibleLanguage,
  // both of which may contain a value derived from an earlier caption guess.
  if (options.host === "youtube" && options.allowTextLanguageDetection) {
    const text = buildDetectText(options.title, options.description);
    if (text && text.length >= MIN_DETECT_TEXT_LENGTH) {
      const detectedLanguage = await options.detectLanguage(text);
      if (isResolvedLanguage(detectedLanguage)) {
        debug.log("[language] YouTube source language resolved from metadata", {
          language: detectedLanguage,
          source: "title-description",
        });
        return {
          detectedLanguage,
        };
      }
    }
  }

  const normalizedPossibleLanguage = normalizeToRequestLang(
    options.possibleLanguage,
  );
  if (isResolvedLanguage(normalizedPossibleLanguage)) {
    return {
      detectedLanguage: normalizedPossibleLanguage,
    };
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
  }

  rememberDetectedLanguage(videoId: string, language: RequestLang): void {
    const normalizedLanguage = normalizeToRequestLang(language);
    if (!isResolvedLanguage(normalizedLanguage)) {
      return;
    }

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
    if (!videoData?.videoId) {
      return;
    }

    // First resolve "auto" normally. Unlike the old implementation, do NOT
    // return merely because a language such as "pt" has already been detected:
    // it still has to pass the translation-source whitelist.
    if (videoData.detectedLanguage === "auto") {
      const sharedLanguageState = getSharedLanguageState(videoData.videoId);
      const { detectedLanguage } = await resolveDetectedLanguageForVideo({
        isStream: videoData.isStream,
        host: this.videoHandler.site.host,
        possibleLanguage: videoData.detectedLanguage,
        subtitles: videoData.subtitles,
        userOverrideLanguage: sharedLanguageState.userLanguageOverride,
        title: videoData.title,
        description: videoData.description,
        allowTextLanguageDetection: true,
        detectLanguage: async (text) =>
          await this.detectLanguageSingleFlight(videoData.videoId, text),
      });

      if (detectedLanguage !== "auto") {
        videoData.detectedLanguage = detectedLanguage;
      }
    }

    const detected = normalizeToRequestLang(videoData.detectedLanguage);
    if (
      detected &&
      detected !== "auto" &&
      SUPPORTED_TRANSLATION_SOURCE_LANGS.has(detected)
    ) {
      return;
    }

    // A confidently detected unsupported YouTube original is not necessarily
    // a dead end: the player may expose a real supported alternate/dubbed track.
    // Prefer runtime AudioTrack metadata, with a supported-language fallback
    // using concrete adaptiveFormats[].audioTrack.id (never duplicate itags).
    if (
      detected &&
      detected !== "auto" &&
      this.videoHandler.site.host === "youtube"
    ) {
      const alternate = findSupportedYoutubeAlternateAudioTrack();
      if (alternate) {
        videoData.detectedLanguage = alternate.language;
        this.videoHandler.translateFromLang = alternate.language;
        debug.log("[language] supported YouTube alternate audio track found", {
          videoId: videoData.videoId,
          originalLanguage: detected,
          selectedLanguage: alternate.language,
          audioTrackId: alternate.trackId,
          action: "allow-translation-with-concrete-alternate-track",
        });
        return;
      }
    }

    if (detected && detected !== "auto") {
      debug.warn("[language] detected source language is not supported", {
        videoId: videoData.videoId,
        detectedLanguage: detected,
        host: this.videoHandler.site.host,
        action: "no-supported-concrete-alternate-track",
      });
    }
  }

  private shouldUseRuntimeYouTubeHelper(): boolean {
    return (
      this.videoHandler.site.host === "youtube" &&
      isMobileYouTubeAdditionalData(this.videoHandler.site.additionalData)
    );
  }

  private buildRuntimeYouTubeVideoData() {
    const videoId = YoutubeHelper.getCurrentVideoId();
    if (!videoId) {
      throw new Error("Failed to resolve mobile YouTube video id");
    }

    const response = YoutubeHelper.getPlayerResponse();
    const playerData = YoutubeHelper.getPlayerData();
    const subtitles = YoutubeHelper.getSubtitles(localizationProvider.lang);
    let detectedLanguage = YoutubeHelper.getLanguage();
    if (
      detectedLanguage &&
      !REQUEST_LANG_SET.has(detectedLanguage as RequestLang)
    ) {
      detectedLanguage = undefined;
    }

    const title =
      response?.videoDetails?.title || playerData?.title || document.title;
    const canonicalUrl =
      YoutubeHelper.getCanonicalVideoUrl(videoId) ||
      `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;

    return {
      url: canonicalUrl,
      videoId,
      host: "youtube",
      title,
      localizedTitle: playerData?.title || title,
      description: response?.videoDetails?.shortDescription,
      detectedLanguage: (detectedLanguage ?? "auto") as "auto" | RequestLang,
      subtitles,
      duration:
        YoutubeHelper.getVideoDuration(this.videoHandler.video) ??
        this.videoHandler.video?.duration ??
        votConfig.defaultDuration,
      translationHelp: null,
      isStream:
        response?.videoDetails?.isLive === true ||
        response?.microformat?.playerMicroformatRenderer?.liveBroadcastDetails
          ?.isLiveNow === true,
    };
  }

  async getVideoData() {
    const pageUrl = String(globalThis.location.href || "").trim();
    const hostname = String(globalThis.location.hostname || "").trim();
    const sniffedManifestUrl = getLastManifestUrl();
    const mediaUrl = String(
      this.videoHandler.video.currentSrc || this.videoHandler.video.src || "",
    ).trim();
    const nativeTrackSubtitles = getElementTrackSubtitles(
      this.videoHandler.video,
      getTrackSubtitleSource(this.videoHandler.site.host),
    );

    let rawVideoDataError: unknown;
    let rawVideoData: Omit<CoreVideoData<string>, "subtitles"> & {
      subtitles?: RuntimeVideoData["subtitles"];
    };

    try {
      rawVideoData = this.shouldUseRuntimeYouTubeHelper()
        ? this.buildRuntimeYouTubeVideoData()
        : await getVideoData(this.videoHandler.site, {
            fetchFn: GM_fetch,
            video: this.videoHandler.video,
            language: localizationProvider.lang,
          });
    } catch (error) {
      rawVideoDataError = error;
      console.warn(
        "[FORK][fallback:getVideoData] site getVideoData() failed, using DOM fallback",
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

    // Cloud Mail.ru requires a registered UMP media URL. Never substitute
    // a sniffed HLS manifest or route this service through Yandex Disk.
    if (this.videoHandler.site.host === "cloudmailru" && rawVideoDataError) {
      throw rawVideoDataError instanceof Error
        ? rawVideoDataError
        : new Error("Cloud Mail.ru helper failed");
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
    if (this.videoHandler.site.host === "cloudmailru") {
      let registeredMediaUrl: URL;
      try {
        registeredMediaUrl = new URL(String(url || ""));
      } catch {
        throw new Error(
          "Cloud Mail.ru: UMP registration returned no valid URL",
        );
      }
      if (
        host !== "cloudmailru" ||
        !videoId ||
        registeredMediaUrl.origin !== "https://media-proxy.mooo.com" ||
        !registeredMediaUrl.pathname.startsWith("/media/cloudmailru/")
      ) {
        throw new Error(
          "Cloud Mail.ru: helper did not return a registered UMP media URL",
        );
      }
    }

    subtitles = mergeSubtitleDescriptors(subtitles, nativeTrackSubtitles);
    if (this.videoHandler.site.host === "vk") {
      subtitles = mergeSubtitleDescriptors(
        subtitles,
        getSniffedSiteSubtitles("vk", videoId),
      );
    }

    const canonicalVkTarget =
      this.videoHandler.site.host === "vk"
        ? buildCanonicalVkFallbackTarget(pageUrl, videoId, url)
        : null;
    const canonicalRutubeTarget =
      this.videoHandler.site.host === "rutube"
        ? buildCanonicalRutubeFallbackTarget(pageUrl, videoId, url)
        : null;
    if (canonicalVkTarget) {
      url = canonicalVkTarget.url;
      videoId = canonicalVkTarget.videoId;
      host = "vk";
    }
    if (
      canonicalRutubeTarget &&
      (host === "custom" ||
        /(?:^|\.)bl\.rutube\.ru$/i.test(
          String(new URL(url || pageUrl, pageUrl).hostname || ""),
        ) ||
        /\.m3u8([?#]|$)/i.test(String(url || "")))
    ) {
      url = canonicalRutubeTarget.url;
      videoId = canonicalRutubeTarget.videoId;
      host = "rutube";
    }

    const resolvedFallback = await resolveCustomSiteVideo(hostname, pageUrl);
    const youtubeFallbackVideoId =
      this.videoHandler.site.host === "youtube"
        ? YoutubeHelper.getCurrentVideoId()
        : undefined;
    const youtubeFallbackUrl =
      this.videoHandler.site.host === "youtube" && youtubeFallbackVideoId
        ? YoutubeHelper.getCanonicalVideoUrl(youtubeFallbackVideoId)
        : undefined;
    const shouldUseDomFallback =
      this.videoHandler.site.host !== "cloudmailru" &&
      (this.videoHandler.site.host === "custom" ||
        Boolean(rawVideoDataError) ||
        isUsefulResolvedFallback(url, videoId, resolvedFallback));

    if (shouldUseDomFallback) {
      const shouldPreserveVkSiteRoute =
        this.videoHandler.site.host === "vk" && isVkSupportedPageHost(hostname);
      const shouldPreserveRutubeSiteRoute =
        this.videoHandler.site.host === "rutube" &&
        isRutubeSupportedPageHost(hostname);
      const shouldPreserveBilibiliSiteRoute =
        this.videoHandler.site.host === "bilibili" &&
        isBilibiliSupportedPageHost(hostname);
      const shouldPreserveTikTokSiteRoute =
        this.videoHandler.site.host === "tiktok" &&
        /(^|\.)tiktok\.com$/i.test(hostname);
      const shouldPreserveUdemySiteRoute =
        this.videoHandler.site.host === "udemy" &&
        /^(?:www\.)?udemy\.com$/i.test(hostname);
      // A signed CDN manifest is not a stable Udemy lecture identifier.
      // Preserve helper output if available; otherwise retain page context.
      const udemyHelperUrl = String(url || "").trim();
      const udemyHelperVideoId = String(videoId || "").trim();
      const udemyHelperHasIdentity =
        !rawVideoDataError &&
        !isBadGenericVideoId(udemyHelperVideoId) &&
        !isPageScopedVideoId(udemyHelperVideoId, pageUrl) &&
        !/\.(?:m3u8|mpd)(?:[?#]|$)/i.test(udemyHelperVideoId);
      const fallbackUrl = pickPreferredVideoUrl(
        resolvedFallback?.url,
        sniffedManifestUrl,
        mediaUrl,
        url,
        youtubeFallbackUrl,
        pageUrl,
      );
      const fallbackCanonicalVkTarget = shouldPreserveVkSiteRoute
        ? buildCanonicalVkFallbackTarget(
            pageUrl,
            videoId,
            url,
            fallbackUrl,
            resolvedFallback?.videoId,
            resolvedFallback?.url,
          )
        : null;
      const fallbackCanonicalRutubeTarget = shouldPreserveRutubeSiteRoute
        ? buildCanonicalRutubeFallbackTarget(
            pageUrl,
            videoId,
            url,
            fallbackUrl,
            resolvedFallback?.videoId,
            resolvedFallback?.url,
          )
        : null;

      if (
        fallbackCanonicalVkTarget &&
        !isBadGenericMediaUrl(fallbackCanonicalVkTarget.url)
      ) {
        url = fallbackCanonicalVkTarget.url;
      } else if (
        fallbackCanonicalRutubeTarget &&
        !isBadGenericMediaUrl(fallbackCanonicalRutubeTarget.url)
      ) {
        url = fallbackCanonicalRutubeTarget.url;
      } else if (
        fallbackUrl &&
        !shouldPreserveBilibiliSiteRoute &&
        !shouldPreserveUdemySiteRoute
      ) {
        url = fallbackUrl;
      }

      if (
        !shouldPreserveUdemySiteRoute &&
        (isBadGenericVideoId(videoId) || isPageScopedVideoId(videoId, pageUrl))
      ) {
        const fallbackVideoIdCandidate =
          !isBadGenericVideoId(fallbackUrl) &&
          !isPageScopedVideoId(fallbackUrl, pageUrl)
            ? fallbackUrl
            : "";
        const resolvedVideoIdCandidate =
          !isBadGenericVideoId(youtubeFallbackVideoId) &&
          !isPageScopedVideoId(String(youtubeFallbackVideoId || ""), pageUrl)
            ? String(youtubeFallbackVideoId).trim()
            : "";
        const resolvedFallbackVideoIdCandidate =
          !isBadGenericVideoId(resolvedFallback?.videoId) &&
          !isPageScopedVideoId(String(resolvedFallback?.videoId || ""), pageUrl)
            ? String(resolvedFallback?.videoId).trim()
            : "";

        videoId =
          fallbackVideoIdCandidate ||
          resolvedVideoIdCandidate ||
          resolvedFallbackVideoIdCandidate ||
          pageUrl;
      }

      if (shouldPreserveVkSiteRoute && fallbackCanonicalVkTarget) {
        url = fallbackCanonicalVkTarget.url;
        host = "vk";
        videoId = fallbackCanonicalVkTarget.videoId;
      } else if (
        shouldPreserveRutubeSiteRoute &&
        fallbackCanonicalRutubeTarget
      ) {
        url = fallbackCanonicalRutubeTarget.url;
        host = "rutube";
        videoId = fallbackCanonicalRutubeTarget.videoId;
      } else if (shouldPreserveBilibiliSiteRoute) {
        host = "bilibili";
        videoId = !isBadGenericVideoId(videoId) ? videoId : pageUrl;
      } else if (shouldPreserveUdemySiteRoute) {
        host = "udemy";
        url =
          udemyHelperUrl && !isBadGenericMediaUrl(udemyHelperUrl)
            ? udemyHelperUrl
            : pageUrl;
        videoId = udemyHelperHasIdentity ? udemyHelperVideoId : pageUrl;
        if (!udemyHelperHasIdentity) {
          console.warn(
            "[FORK][udemy] helper did not provide a stable lecture ID",
            {
              helperFailed: Boolean(rawVideoDataError),
              fallbackUsed: "page-url",
            },
          );
        }
      } else if (shouldPreserveTikTokSiteRoute) {
        // Preserve TikTok routing even when a blob: source cannot be resolved.
        // This does not make Short Drama media downloadable by itself.
        host = "tiktok";
        videoId = !isBadGenericVideoId(videoId) ? videoId : pageUrl;
      } else {
        host =
          this.videoHandler.site.host === "youtube" && youtubeFallbackVideoId
            ? "youtube"
            : "custom";
      }

      const fallbackTitle =
        resolvedFallback?.title ||
        (!shouldPreserveUdemySiteRoute
          ? normalizeLocalTitleFromUrl(url)
          : undefined) ||
        (typeof document.title === "string"
          ? document.title.trim()
          : undefined);

      if (fallbackTitle) {
        title = fallbackTitle;
        if (!localizedTitle) {
          localizedTitle = fallbackTitle;
        }
      }

      console.log("[FORK][fallback:getVideoData] using DOM/media fallback", {
        siteHost: this.videoHandler.site.host,
        sniffedManifestUrl,
        mediaUrl,
        pageUrl,
        resolvedFallback,
        finalUrl: url,
        finalVideoId: videoId,
        finalHost: host,
        preservedSiteRoute:
          shouldPreserveVkSiteRoute ||
          shouldPreserveRutubeSiteRoute ||
          shouldPreserveBilibiliSiteRoute ||
          shouldPreserveTikTokSiteRoute ||
          shouldPreserveUdemySiteRoute,
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

      const resolvedGoogleDriveTitle = !isBadGoogleDriveTitle(safeTitle)
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
    const { detectedLanguage } = await resolveDetectedLanguageForVideo({
      isStream,
      host: this.videoHandler.site.host,
      possibleLanguage,
      subtitles,
      userOverrideLanguage: sharedLanguageState.userLanguageOverride,
      title,
      description,
      allowTextLanguageDetection: false,
      detectLanguage: async (text) =>
        await this.detectLanguageSingleFlight(videoId, text),
    });

    if (host === "custom") {
      const localTitle =
        normalizeLocalTitleFromUrl(url) ||
        (typeof document.title === "string"
          ? document.title.trim()
          : undefined);

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
      duration: Math.round(
        duration ||
          this.videoHandler.video?.duration ||
          votConfig.defaultDuration,
      ),
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
          ? (normalizeGoogleDriveTitle(title) ??
            normalizeGoogleDriveTitle(localizedTitle) ??
            normalizeGoogleDriveTitle(getGoogleDrivePageTitle()) ??
            videoId)
          : host === "custom"
            ? (normalizeLocalTitleFromUrl(url) ??
              title ??
              localizedTitle ??
              videoId)
            : (localizedTitle ?? title ?? videoId),
    } satisfies RuntimeVideoData;

    if (sharedLanguageState.lastLoggedDetectedLanguage !== detectedLanguage) {
      console.log("[FORK] Detected language:", detectedLanguage);
      sharedLanguageState.lastLoggedDetectedLanguage = detectedLanguage;
    }

    if (Array.isArray(videoData.subtitles) && videoData.subtitles.length > 0) {
      console.log(
        `[FORK][subtitles] video data contains ${videoData.subtitles.length} subtitle track(s).`,
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
    const sourceLanguage =
      this.videoHandler.translateFromLang === "auto"
        ? this.videoHandler.videoData.detectedLanguage
        : this.videoHandler.translateFromLang;

    // Stop before translateFunc/API/downloader when the real source language
    // is known but Yandex VOT does not support it. In auto mode this preserves
    // YouTube's real language (for example pt) instead of silently changing it
    // to en and uploading the wrong audio.
    const normalizedSourceLanguage =
      this.videoHandler.site.host === "youtube"
        ? normalizeYoutubeSourceLanguage(sourceLanguage)
        : normalizeToRequestLang(sourceLanguage);
    if (
      normalizedSourceLanguage &&
      normalizedSourceLanguage !== "auto" &&
      !SUPPORTED_TRANSLATION_SOURCE_LANGS.has(normalizedSourceLanguage)
    ) {
      if (this.videoHandler.site.host === "youtube") {
        const alternate = findSupportedYoutubeAlternateAudioTrack();
        if (alternate) {
          videoData.detectedLanguage = alternate.language;
          this.videoHandler.translateFromLang = alternate.language;
          debug.log("[language] validator allows supported YouTube alternate", {
            videoId: videoData.videoId,
            originalLanguage: normalizedSourceLanguage,
            selectedLanguage: alternate.language,
            audioTrackId: alternate.trackId,
          });
        } else {
          debug.warn("[language] translation blocked for unsupported source", {
            videoId: videoData.videoId,
            sourceLanguage: normalizedSourceLanguage,
            host: this.videoHandler.site.host,
            reason: "no-supported-concrete-alternate-track",
          });
          throw new VOTLocalizedError("requestTranslationFailed");
        }
      } else {
        debug.warn("[language] translation blocked for unsupported source", {
          videoId: videoData.videoId,
          sourceLanguage: normalizedSourceLanguage,
          host: this.videoHandler.site.host,
        });
        throw new VOTLocalizedError("requestTranslationFailed");
      }
    }

    if (
      this.videoHandler.data.enabledDontTranslateLanguages &&
      this.videoHandler.data.dontTranslateLanguages?.includes(sourceLanguage)
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

    const sourceAudioState = getSourceAudioAvailability(
      this.videoHandler.video,
    );
    if (!sourceAudioState.ready) {
      throw new VOTLocalizedError(sourceAudioState.localizationKey as any);
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
      console.log(`[FORK] Set translation from ${normalizedFrom} to ${to}`);
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
