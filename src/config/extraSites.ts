import { type ServiceConf, VideoService } from "@vot.js/ext/types/service";
import { isTunnelPlayerUrl } from "../core/tunnelPlayer";
import { GENERIC_PLAYER_SELECTOR } from "./playerSelectors";

const VK_PLAYER_SELECTOR = ".videoplayer_media, vk-video-player";

const VK_CLIP_SELECTOR =
  'div[data-testid="clipcontainer-video"], [data-testid="clipcontainer-video"]';

export const extraSites: ServiceConf[] = [
  {
    // Udemy: preserve dedicated helper routing
    host: VideoService.udemy,
    url: "https://www.udemy.com/",
    match: /^(?:www\.)?udemy\.com$/i,
    selector:
      ".shaka-video-container, " +
      '[id^="shaka-video-container-"], ' +
      '[data-purpose="media-player-container"], ' +
      "video",
    eventSelector: "video",
    needExtraData: true,
  },

  {
    host: VideoService.anthropicskilljar,
    url: "https://anthropic-partners.skilljar.com/",
    match: /^anthropic-partners\.skilljar\.com$/i,
    selector: "video",
    eventSelector: "video",
    needExtraData: true,
  },
  // TikTok: keep its dedicated helper route, including Short Drama pages.
  {
    host: VideoService.tiktok,
    url: "https://www.tiktok.com/",
    match: /(^|\.)tiktok\.com$/i,
    selector: "video",
    eventSelector: "video",
    needExtraData: true,
  },
  // Cloud Mail.ru (not my.mail.ru)
  {
    host: VideoService.cloudmailru,
    url: "https://cloud.mail.ru/",
    match: /^(www\.)?cloud\.mail\.ru$/i,
    selector: "video.vjs-tech, video",
    eventSelector: "video",
    needExtraData: true,
  },
  // NHK World Japan — dedicated NHKHelper route
  {
    host: VideoService.NHK,
    url: "https://www3.nhk.or.jp/",
    match: /^www3\.nhk\.or\.jp$/i,
    selector: "video",
    eventSelector: "video",
    needExtraData: true,
  },
  {
    host: VideoService.NHKJapan,
    url: "https://www.web.nhk/",
    match: /^(?:[a-z0-9-]+\.)*web\.nhk$/i,
    selector: "video",
    eventSelector: "video",
    needExtraData: true,
  },
  {
    host: VideoService.deeplearningai,
    url: "https://learn.deeplearning.ai/courses/",
    match: /^learn(-dev|-staging)?\.deeplearning\.ai/,
    selector: ".lesson-video-player",
    needExtraData: true,
  },
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
    host: VideoService.douyin,
    url: "https://www.douyin.com/",
    match: /(^|\.)douyin\.com$/i,
    selector: "video",
    eventSelector: "video",
    needExtraData: true,
    needBypassCSP: true,
  },
  {
    host: VideoService.bilibili,
    url: "https://www.bilibili.com/video/",
    match: /(^|\.)bilibili\.com$/i,
    selector: "video",
    eventSelector: "video",
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
    selector: `.ott-player, [class*='player'], .yp-player, ${GENERIC_PLAYER_SELECTOR}`,
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
    selector: `.fp-player, ${GENERIC_PLAYER_SELECTOR}`,
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
