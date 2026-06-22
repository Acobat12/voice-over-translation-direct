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
    match: [/^(www\.|m\.)?vk\.(com|ru)$/i, /^(.*\.)?vkvideo\.ru$/i],
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
    host: "douyin",
    url: "https://www.douyin.com/",
    match: /(^|\.)douyin\.com$/i,
    selector: "video",
    eventSelector: "video",
    needExtraData: true,
    needBypassCSP: true,
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
  // Rutube: fallback selector more stable than library's nth-child pattern
  {
    host: VideoService.rutube,
    url: "https://rutube.ru/video/",
    match: /(^|\.)rutube\.ru$/i,
    selector:
      ".video-player, [class*='VideoPlayer'], [class*='video-player'], #app > div > div",
    rawResult: true,
  },
  // Bunny CDN embedded players
  {
    host: VideoService.custom,
    url: "stub",
    match: /(^|\.)iframe\.mediadelivery\.net$/i,
    selector: GENERIC_PLAYER_SELECTOR,
    eventSelector: GENERIC_PLAYER_SELECTOR,
    rawResult: true,
  },
  {
    host: VideoService.custom,
    url: "stub",
    match: /(^|\.)video\.bunnycdn\.com$/i,
    selector: GENERIC_PLAYER_SELECTOR,
    eventSelector: GENERIC_PLAYER_SELECTOR,
    rawResult: true,
  },
  // Russian streaming platforms
  {
    host: VideoService.custom,
    url: "stub",
    match: /(^|\.)ivi\.ru$/i,
    selector:
      ".iv-player-container, .player-container, .vjs-v7, " +
      GENERIC_PLAYER_SELECTOR,
    rawResult: true,
  },
  {
    host: VideoService.custom,
    url: "stub",
    match: /(^|\.)kinopoisk\.ru$/i,
    selector:
      ".ott-player, [class*='player'], .yp-player, " + GENERIC_PLAYER_SELECTOR,
    rawResult: true,
  },
  {
    host: VideoService.custom,
    url: "stub",
    match: [/(^|\.)okko\.tv$/i, /(^|\.)okko\.ru$/i],
    selector: GENERIC_PLAYER_SELECTOR,
    rawResult: true,
  },
  {
    host: VideoService.custom,
    url: "stub",
    match: [/(^|\.)kion\.ru$/i],
    selector: GENERIC_PLAYER_SELECTOR,
    rawResult: true,
  },
  // Kodik player subdomains (kodik.info/biz/cc already matched by library,
  // but kodik.fun, kodik.pw and others may appear)
  {
    host: VideoService.custom,
    url: "stub",
    match: /(^|\.)kodik\.(fun|pw|io|online|me)$/i,
    selector: ".fp-player, " + GENERIC_PLAYER_SELECTOR,
    rawResult: true,
  },
  // Wink (Rostelecom streaming)
  {
    host: VideoService.custom,
    url: "stub",
    match: /(^|\.)wink\.ru$/i,
    selector: GENERIC_PLAYER_SELECTOR,
    rawResult: true,
  },
  // Seasonvar and similar Russian series sites that embed video
  {
    host: VideoService.custom,
    url: "stub",
    match: /(^|\.)seasonvar\.ru$/i,
    selector: GENERIC_PLAYER_SELECTOR,
    rawResult: true,
  },
  // solodcdn (already in @match but not in extraSites)
  {
    host: VideoService.custom,
    url: "stub",
    match: /(^|\.)solodcdn\.com$/i,
    selector: GENERIC_PLAYER_SELECTOR,
    rawResult: true,
  },
  // wikianimex.ru — embeds player.cdnvideohub.com; this entry covers the case
  // where the player is rendered on the main page rather than in a cross-origin iframe
  {
    host: VideoService.custom,
    url: "stub",
    match: [/^wikianimex\.ru$/i, /(?:^|\.)wikianimex\.ru$/i],
    selector: GENERIC_PLAYER_SELECTOR,
    eventSelector: GENERIC_PLAYER_SELECTOR,
    rawResult: true,
  },
  // m.ok.ru — mobile OK.ru; vot.js only matches ok.ru exactly
  {
    host: VideoService.okru,
    url: "https://ok.ru/video/",
    match: /^m\.ok\.ru$/i,
    selector: "vk-video-player",
    shadowRoot: true,
  },
  // m.youtube.com — mobile YouTube; vot.js has a .player-container selector
  // that may not exist on some page variants; extend it with fallback selectors
  {
    host: VideoService.youtube,
    url: "https://youtu.be/",
    match: /^m\.youtube\.com$/i,
    selector: ".player-container, #movie_player, ytm-player, #player, video",
    needExtraData: true,
    additionalData: "mobile",
  },
  // music.youtube.com uses the same video IDs, but the player shell differs
  // enough that it should not fall back to the desktop-only YouTube helper.
  {
    host: VideoService.youtube,
    url: "https://youtu.be/",
    match: /^music\.youtube\.com$/i,
    selector:
      "ytmusic-player-page, ytmusic-player, ytm-player, #player, .player-container, video",
    needExtraData: true,
    additionalData: "music",
  },
];
