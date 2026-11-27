import { localizationProvider } from "../localization/localizationProvider";
export type YouTubeAudioMode =
  | "auto"
  | "player-mse"
  | "hls"
  | "external"
  | "legacy"
  | "sabr"
  | "web-abr";

const KEY = "vot.youtubeAudioMode.v1";

export const YOUTUBE_AUDIO_MODES: readonly YouTubeAudioMode[] = [
  "auto",
  "player-mse",
  "hls",
  "external",
  "legacy",
  "sabr",
  "web-abr",
];

export function getYouTubeAudioMode(): YouTubeAudioMode {
  try {
    const value = localStorage.getItem(KEY) as YouTubeAudioMode | null;
    return value && YOUTUBE_AUDIO_MODES.includes(value) ? value : "auto";
  } catch {
    return "auto";
  }
}

export function setYouTubeAudioMode(mode: YouTubeAudioMode): void {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    // Selection remains best-effort in restricted storage contexts.
  }
  globalThis.dispatchEvent(
    new CustomEvent("vot:youtube-audio-mode", { detail: mode }),
  );
}

export function getYouTubeAudioModeLabel(mode: YouTubeAudioMode): string {
  return {
    auto: localizationProvider.get("VOTAudioAutoLearning"),
    "player-mse": "Player/MSE tap",
    hls: "YouTube HLS",
    external: localizationProvider.get("VOTAudioExternal"),
    legacy: "Legacy ABR / iframe MSE",
    sabr: localizationProvider.get("VOTAudioSabr"),
    "web-abr": localizationProvider.get("VOTAudioWebAbr"),
  }[mode];
}
