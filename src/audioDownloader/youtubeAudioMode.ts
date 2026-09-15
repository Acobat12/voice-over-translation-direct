export type YouTubeAudioMode =
  | "auto"
  | "player-mse"
  | "hls"
  | "external"
  | "legacy";

const KEY = "vot.youtubeAudioMode.v1";

export const YOUTUBE_AUDIO_MODES: readonly YouTubeAudioMode[] = [
  "auto",
  "player-mse",
  "hls",
  "external",
  "legacy",
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
    auto: "Авто (обучение)",
    "player-mse": "Player/MSE tap",
    hls: "YouTube HLS",
    external: "External provider",
    legacy: "Legacy ABR / iframe MSE",
  }[mode];
}
