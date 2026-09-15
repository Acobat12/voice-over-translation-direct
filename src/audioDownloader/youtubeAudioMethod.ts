export type YoutubeAudioMethod = "auto" | "player_mse_tap" | "hls" | "external";

let currentMethod: YoutubeAudioMethod = "auto";

export function setYoutubeAudioMethod(value: unknown): YoutubeAudioMethod {
  currentMethod =
    value === "player_mse_tap" || value === "hls" || value === "external"
      ? value
      : "auto";
  return currentMethod;
}

export function getYoutubeAudioMethod(): YoutubeAudioMethod {
  return currentMethod;
}

export const YOUTUBE_AUDIO_METHOD_LABELS: Record<YoutubeAudioMethod, string> = {
  auto: "Авто (Tap → HLS → External → Direct → MSE)",
  player_mse_tap: "Player/MSE tap",
  hls: "HLS (web_safari)",
  external: "External provider",
};
