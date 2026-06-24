import { getAudioFromYtAudio } from "../ytAudio/strategy";
import { getAudioFromDouyin } from "./douyin";
import { getAudioFromLocalFile } from "./localFile";
import { getAudioFromVkVideo } from "./vkVideo";
import { getAudioFromYandexDisk } from "./yandexDisk";

export const YT_AUDIO_STRATEGY = "ytAudio";
export const VK_AUDIO_STRATEGY = "vkAudio";
export const DOUYIN_AUDIO_STRATEGY = "douyin";

export const strategies = {
  [YT_AUDIO_STRATEGY]: getAudioFromYtAudio,
  [VK_AUDIO_STRATEGY]: getAudioFromVkVideo,
  [DOUYIN_AUDIO_STRATEGY]: getAudioFromDouyin,
  yandexDisk: getAudioFromYandexDisk,
  localFile: getAudioFromLocalFile,
} as const;

export type AvailableAudioDownloadType = keyof typeof strategies;
