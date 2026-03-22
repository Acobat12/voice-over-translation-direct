import { getAudioFromYtAudio } from "../ytAudio/strategy";
import { getAudioFromYandexDisk } from "./yandexDisk";

export const YT_AUDIO_STRATEGY = "ytAudio";

export const strategies = {
  [YT_AUDIO_STRATEGY]: getAudioFromYtAudio,
  yandexDisk: getAudioFromYandexDisk,
} as const;

export type AvailableAudioDownloadType = keyof typeof strategies;
