import { getAudioFromYtAudio } from "../ytAudio/strategy";
import { getAudioFromYandexDisk } from "./yandexDisk";
import { getAudioFromLocalFile } from "./localFile";

export const YT_AUDIO_STRATEGY = "ytAudio";

export const strategies = {
  [YT_AUDIO_STRATEGY]: getAudioFromYtAudio,
  yandexDisk: getAudioFromYandexDisk,
  localFile: getAudioFromLocalFile,
} as const;

export type AvailableAudioDownloadType = keyof typeof strategies;
