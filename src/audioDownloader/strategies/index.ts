import { getAudioFromYtAudio } from "../ytAudio/strategy";
import { getAudioFromLocalFile } from "./localFile";
import { getAudioFromVkVideo } from "./vkVideo";
import { getAudioFromYandexDisk } from "./yandexDisk";

export const YT_AUDIO_STRATEGY = "ytAudio";
export const VK_AUDIO_STRATEGY = "vkAudio";

export const strategies = {
  [YT_AUDIO_STRATEGY]: getAudioFromYtAudio,
  [VK_AUDIO_STRATEGY]: getAudioFromVkVideo,
  yandexDisk: getAudioFromYandexDisk,
  localFile: getAudioFromLocalFile,
} as const;

export type AvailableAudioDownloadType = keyof typeof strategies;
