import { VideoService } from "@vot.js/core/types/service";
import type { ServiceConf } from "@vot.js/ext/types/service";
import { isTunnelPlayerUrl } from "../core/tunnelPlayer";
import { GENERIC_PLAYER_SELECTOR } from "./playerSelectors";

const VK_PLAYER_SELECTOR = ".videoplayer_media, vk-video-player";

const VK_CLIP_SELECTOR =
  'div[data-testid="clipcontainer-video"], [data-testid="clipcontainer-video"]';

export const extraSites: ServiceConf[] = [
  {
    host: VideoService.vk,
    url: "https://vk.com/video?z=",
    additionalData: "mobile",
    match: [/^m\.vk\.(com|ru)$/i, /^m\.vkvideo\.ru$/i],
    selector: VK_PLAYER_SELECTOR,
    shadowRoot: true,
    needExtraData: true,
  },
  {
    host: VideoService.vk,
    url: "https://vk.com/video?z=",
    additionalData: "clips",
    match: /^(www\.|m\.)?vk\.(com|ru)$/i,
    selector: VK_CLIP_SELECTOR,
    needExtraData: true,
  },
  {
    host: VideoService.vk,
    url: "https://vk.com/video?z=",
    match: [/^(www\.|m\.)?vk\.(com|ru)$/i, /^(.*\.)?vkvideo\.ru$/i],
    selector: VK_PLAYER_SELECTOR,
    needExtraData: true,
  },
  {
    host: VideoService.custom,
    url: "stub",
    match: (url: URL) => isTunnelPlayerUrl(url),
    selector: GENERIC_PLAYER_SELECTOR,
    eventSelector: GENERIC_PLAYER_SELECTOR,
    rawResult: true,
  },
  {
    host: VideoService.custom,
    url: "stub",
    match: /(^|\.)kodikplayer\.com$/i,
    selector: GENERIC_PLAYER_SELECTOR,
  },
  {
    host: VideoService.custom,
    url: "stub",
    match: /(^|\.)player\.cdnvideohub\.com$/i,
    selector: GENERIC_PLAYER_SELECTOR,
    rawResult: true,
  },
  {
    host: VideoService.custom,
    url: "stub",
    match: /(^|\.)cdnvideohub\.com$/i,
    selector: GENERIC_PLAYER_SELECTOR,
    rawResult: true,
  },
  {
    host: VideoService.custom,
    url: "stub",
    match: /(^|\.)okcdn\.ru$/i,
    selector: GENERIC_PLAYER_SELECTOR,
    rawResult: true,
  },
{
  host: VideoService.custom,
  url: "stub",
  match: /(^|\.)dailymotion\.com$/i,
  selector: GENERIC_PLAYER_SELECTOR,
  eventSelector: GENERIC_PLAYER_SELECTOR,
  rawResult: true,
},
{
  host: VideoService.custom,
  url: "stub",
  match: /(^|\.)geo\.dailymotion\.com$/i,
  selector: GENERIC_PLAYER_SELECTOR,
  eventSelector: GENERIC_PLAYER_SELECTOR,
  rawResult: true,
},
];
