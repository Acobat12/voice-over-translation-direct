import { localizationProvider } from "../localization/localizationProvider";
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
  get auto() {
    return localizationProvider.get("VOTAudioAutoMethod");
  },
  player_mse_tap: "Player/MSE tap",
  hls: "HLS (web_safari)",
  get external() {
    return localizationProvider.get("VOTAudioExternal");
  },
};
