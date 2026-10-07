import { getAudioFromYtAudio } from "../ytAudio/strategy";
import { getAudioFromDouyin } from "./douyin";
import { getAudioFromLocalFile } from "./localFile";
import { getAudioFromVkVideo } from "./vkVideo";
import {
  getAudioFromWebAbr,
  getAudioFromWebMseProxy,
  WEB_ABR_STRATEGY,
  WEB_MSE_PROXY_STRATEGY,
} from "./webMseProxy";

export const YT_AUDIO_STRATEGY = "ytAudio";
export const VK_AUDIO_STRATEGY = "vkAudio";
export const DOUYIN_AUDIO_STRATEGY = "douyin";

export { WEB_ABR_STRATEGY, WEB_MSE_PROXY_STRATEGY };

export const strategies = {
  [WEB_ABR_STRATEGY]: getAudioFromWebAbr,
  [YT_AUDIO_STRATEGY]: getAudioFromYtAudio,
  [WEB_MSE_PROXY_STRATEGY]: getAudioFromWebMseProxy,
  [VK_AUDIO_STRATEGY]: getAudioFromVkVideo,
  [DOUYIN_AUDIO_STRATEGY]: getAudioFromDouyin,
  localFile: getAudioFromLocalFile,
} as const;

export type AvailableAudioDownloadType = keyof typeof strategies;
