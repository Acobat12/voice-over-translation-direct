import ExtYoutubeHelper from "@vot.js/ext/helpers/youtube";
import { normalizeLang } from "@vot.js/shared/utils/utils";

type YoutubeCaptionTrack = {
  baseUrl?: string;
  isTranslatable?: boolean;
  kind?: string;
  languageCode?: string;
};

type YoutubeTranslationLanguage = {
  languageCode?: string;
};

type YoutubePlayerResponse = {
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: YoutubeCaptionTrack[];
      translationLanguages?: YoutubeTranslationLanguage[];
    };
  };
  videoDetails?: {
    isLive?: boolean;
    isLiveContent?: boolean;
    shortDescription?: string;
    title?: string;
    videoId?: string;
  };
};

type YoutubePlayerData = {
  title?: string;
  video_id?: string;
  videoId?: string;
};

type YoutubePlayerLike = Element & {
  addEventListener?: (
    eventName: string,
    handler: (...args: any[]) => void,
  ) => void;
  getAudioTrack?: () => {
    captionTracks?: Array<{ url?: string }>;
    getLanguageInfo?: () => { id?: string };
  };
  getAvailableAudioTracks?: () => unknown[];
  getDuration?: () => number;
  getPlayerResponse?: () => unknown;
  getProgressState?: () => { seekableEnd?: number };
  getVideoData?: () => unknown;
  getVideoUrl?: () => string;
  getVolume?: () => number;
  isMuted?: () => boolean;
  removeEventListener?: (
    eventName: string,
    handler: (...args: any[]) => void,
  ) => void;
  setVolume?: (volume: number) => unknown;
};

const MOBILE_OR_MUSIC_PLAYER_SELECTORS = [
  "#movie_player",
  "ytm-player",
  "ytmusic-player",
  "#player",
  ".player-container",
  "video",
] as const;

function getHostname(): string {
  return String(globalThis.location.hostname || "")
    .trim()
    .toLowerCase();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function parseMaybeJson<T>(value: unknown): T | undefined {
  if (!value) {
    return undefined;
  }

  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return undefined;
    }
  }

  if (typeof value === "object") {
    return value as T;
  }

  return undefined;
}

function isPlayerResponse(value: unknown): value is YoutubePlayerResponse {
  const candidate = asRecord(value);
  return Boolean(
    candidate &&
      (typeof candidate.videoDetails === "object" ||
        typeof candidate.captions === "object"),
  );
}

function isPlayerData(value: unknown): value is YoutubePlayerData {
  const candidate = asRecord(value);
  return Boolean(
    candidate &&
      (typeof candidate.video_id === "string" ||
        typeof candidate.videoId === "string" ||
        typeof candidate.title === "string"),
  );
}

function getPlayerFallback(): YoutubePlayerLike | null {
  for (const selector of MOBILE_OR_MUSIC_PLAYER_SELECTORS) {
    const matched = document.querySelector(selector);
    if (matched) {
      return matched as YoutubePlayerLike;
    }
  }

  return null;
}

function getWindowPlayerResponse(): YoutubePlayerResponse | undefined {
  const win = globalThis as Record<string, unknown>;
  const direct = parseMaybeJson<YoutubePlayerResponse>(
    win.ytInitialPlayerResponse,
  );
  if (isPlayerResponse(direct)) {
    return direct;
  }

  const ytplayer = asRecord(win.ytplayer);
  const config = asRecord(ytplayer?.config);
  const args = asRecord(config?.args);

  const fromArgs = parseMaybeJson<YoutubePlayerResponse>(args?.player_response);
  if (isPlayerResponse(fromArgs)) {
    return fromArgs;
  }

  const fromConfig = parseMaybeJson<YoutubePlayerResponse>(
    config?.player_response,
  );
  return isPlayerResponse(fromConfig) ? fromConfig : undefined;
}

function getWindowPlayerData(): YoutubePlayerData | undefined {
  const win = globalThis as Record<string, unknown>;
  const direct = parseMaybeJson<YoutubePlayerData>(win.ytInitialData);
  if (isPlayerData(direct)) {
    return direct;
  }

  return undefined;
}

function getLocationVideoId(url: URL): string | undefined {
  const searchVideoId = url.searchParams.get("v");
  if (searchVideoId) {
    return searchVideoId;
  }

  const pathSegments = url.pathname.split("/").filter(Boolean);
  for (const marker of ["shorts", "embed", "live"] as const) {
    const markerIndex = pathSegments.indexOf(marker);
    if (markerIndex !== -1) {
      const candidate = pathSegments[markerIndex + 1];
      if (candidate) {
        return candidate;
      }
    }
  }

  if (url.hostname === "youtu.be") {
    return pathSegments[0];
  }

  return undefined;
}

export function isMobileYouTubeAdditionalData(value?: string | null): boolean {
  return value === "mobile" || value === "music";
}

export default class YoutubeHelper {
  static isMobile() {
    return getHostname() === "m.youtube.com";
  }

  static isMusic() {
    return getHostname() === "music.youtube.com";
  }

  static isMobileVariant() {
    return YoutubeHelper.isMobile() || YoutubeHelper.isMusic();
  }

  static getPlayer(): YoutubePlayerLike | null {
    const player = ExtYoutubeHelper.getPlayer() as YoutubePlayerLike | null;
    if (player) {
      return player;
    }

    if (!YoutubeHelper.isMobileVariant()) {
      return null;
    }

    // Firefox Android mobile/music YouTube often exposes player state before a
    // stable desktop-like `#movie_player` is attached, so we probe mobile
    // containers and fall back to `ytInitialPlayerResponse`.
    return getPlayerFallback();
  }

  static getPlayerResponse(): YoutubePlayerResponse | undefined {
    const playerResponse =
      YoutubeHelper.getPlayer()?.getPlayerResponse?.call(undefined);
    if (isPlayerResponse(playerResponse)) {
      return playerResponse;
    }

    const extResponse = ExtYoutubeHelper.getPlayerResponse();
    if (isPlayerResponse(extResponse)) {
      return extResponse;
    }

    return getWindowPlayerResponse();
  }

  static getPlayerData(): YoutubePlayerData | undefined {
    const playerData = YoutubeHelper.getPlayer()?.getVideoData?.call(undefined);
    if (isPlayerData(playerData)) {
      return playerData;
    }

    const extPlayerData = ExtYoutubeHelper.getPlayerData();
    if (isPlayerData(extPlayerData)) {
      return extPlayerData;
    }

    const response = YoutubeHelper.getPlayerResponse();
    if (response?.videoDetails?.title || response?.videoDetails?.videoId) {
      return {
        title: response.videoDetails.title,
        videoId: response.videoDetails.videoId,
      };
    }

    return getWindowPlayerData();
  }

  static getVolume() {
    const player = YoutubeHelper.getPlayer();
    if (player?.getVolume) {
      return player.getVolume() / 100;
    }

    const media = document.querySelector("video");
    return media instanceof HTMLMediaElement ? media.volume : 1;
  }

  static setVolume(volume: number) {
    const player = YoutubeHelper.getPlayer();
    if (player?.setVolume) {
      return player.setVolume(Math.round(volume * 100));
    }

    const media = document.querySelector("video");
    if (media instanceof HTMLMediaElement) {
      media.volume = volume;
      return true;
    }

    return false;
  }

  static isMuted() {
    const player = YoutubeHelper.getPlayer();
    if (player?.isMuted) {
      return player.isMuted();
    }

    const media = document.querySelector("video");
    return media instanceof HTMLMediaElement ? media.muted : false;
  }

  static getVideoDuration(video?: HTMLVideoElement): number | undefined {
    const playerDuration =
      YoutubeHelper.getPlayer()?.getDuration?.call(undefined);
    if (typeof playerDuration === "number" && Number.isFinite(playerDuration)) {
      return playerDuration;
    }

    const media = video ?? document.querySelector("video");
    return media instanceof HTMLMediaElement &&
      Number.isFinite(media.duration) &&
      media.duration > 0
      ? media.duration
      : undefined;
  }

  static getCurrentVideoId(url = new URL(globalThis.location.href)) {
    const playerData = YoutubeHelper.getPlayerData();
    const response = YoutubeHelper.getPlayerResponse();

    const candidates = [
      playerData?.videoId,
      playerData?.video_id,
      response?.videoDetails?.videoId,
      (() => {
        try {
          const playerUrl =
            YoutubeHelper.getPlayer()?.getVideoUrl?.call(undefined);
          return playerUrl ? getLocationVideoId(new URL(playerUrl)) : undefined;
        } catch {
          return undefined;
        }
      })(),
      getLocationVideoId(url),
    ];

    return candidates.find(
      (candidate): candidate is string =>
        typeof candidate === "string" && candidate.trim().length > 0,
    );
  }

  static getCanonicalVideoUrl(videoId?: string): string | undefined {
    const resolvedVideoId = videoId ?? YoutubeHelper.getCurrentVideoId();
    return resolvedVideoId
      ? `https://youtu.be/${encodeURIComponent(resolvedVideoId)}`
      : undefined;
  }

  static getSubtitles(userLang: string) {
    const response = YoutubeHelper.getPlayerResponse();
    const playerCaptions = response?.captions?.playerCaptionsTracklistRenderer;
    if (!playerCaptions) {
      return [];
    }

    const captionTracks = playerCaptions.captionTracks ?? [];
    const translationLanguages = playerCaptions.translationLanguages ?? [];
    const userLangSupported = translationLanguages.find(
      (language) => language.languageCode === userLang,
    );
    const asrSubtitleItem = captionTracks.find(
      (captionTrack) => captionTrack?.kind === "asr",
    );
    const asrLang = asrSubtitleItem?.languageCode ?? "en";

    return captionTracks.reduce<
      Array<{
        format: "json";
        isAutoGenerated: boolean;
        language: string;
        source: "youtube";
        translatedFromLanguage?: string;
        url: string;
      }>
    >((result, captionTrack) => {
      if (!captionTrack.languageCode || !captionTrack.baseUrl) {
        return result;
      }

      const language = normalizeLang(captionTrack.languageCode);
      if (!language) {
        return result;
      }

      const baseUrl = captionTrack.baseUrl;
      const captionUrl = `${baseUrl.startsWith("http") ? baseUrl : `${window.location.origin}/${baseUrl}`}&fmt=json3`;
      result.push({
        source: "youtube",
        format: "json",
        language,
        isAutoGenerated: captionTrack.kind === "asr",
        url: captionUrl,
      });

      if (
        userLangSupported &&
        captionTrack.isTranslatable &&
        captionTrack.languageCode === asrLang &&
        userLang !== language
      ) {
        result.push({
          source: "youtube",
          format: "json",
          language: userLang,
          isAutoGenerated: captionTrack.kind === "asr",
          translatedFromLanguage: language,
          url: `${captionUrl}&tlang=${userLang}`,
        });
      }

      return result;
    }, []);
  }

  static getLanguage() {
    const trackInfo = YoutubeHelper.getPlayer()
      ?.getAudioTrack?.()
      ?.getLanguageInfo?.();
    if (trackInfo?.id && trackInfo.id !== "und") {
      return normalizeLang(trackInfo.id.split(".")[0] ?? trackInfo.id);
    }

    const response = YoutubeHelper.getPlayerResponse();
    const autoCaption =
      response?.captions?.playerCaptionsTracklistRenderer?.captionTracks?.find(
        (caption) => caption.kind === "asr" && caption.languageCode,
      );

    return autoCaption?.languageCode
      ? normalizeLang(autoCaption.languageCode)
      : undefined;
  }
}
