import { getAudioFromYtAudio } from "../ytAudio/strategy";
import { getAudioFromLocalFile } from "./localFile";
import { getAudioFromVkVideo } from "./vkVideo";
import {
  getAudioFromSabr,
  getAudioFromWebAbr,
  getAudioFromWebMseProxy,
  SABR_STRATEGY,
  WEB_ABR_STRATEGY,
  WEB_MSE_PROXY_STRATEGY,
} from "./webMseProxy";

export const YT_AUDIO_STRATEGY = "ytAudio";
export const VK_AUDIO_STRATEGY = "vkAudio";

export { SABR_STRATEGY, WEB_ABR_STRATEGY, WEB_MSE_PROXY_STRATEGY };

export const strategies = {
  [WEB_ABR_STRATEGY]: getAudioFromWebAbr,
  [SABR_STRATEGY]: getAudioFromSabr,
  [YT_AUDIO_STRATEGY]: getAudioFromYtAudio,
  [WEB_MSE_PROXY_STRATEGY]: getAudioFromWebMseProxy,
  [VK_AUDIO_STRATEGY]: getAudioFromVkVideo,
  localFile: getAudioFromLocalFile,
} as const;

export type AvailableAudioDownloadType = keyof typeof strategies;
