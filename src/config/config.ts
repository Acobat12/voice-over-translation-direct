// CONFIGURATION

export const workerHost = "api.browser.yandex.ru";

/**
 * used for streaming
 */
export const m3u8ProxyHost = "media-proxy.toil.cc/v1/proxy/m3u8";

/**
 * @see https://github.com/FOSWLY/vot-worker
 */
export const proxyWorkerHost = "vot-worker.kload.workers.dev";

export const votBackendUrl = "https://vot.toil.cc/v1";

/**
 * @see https://github.com/FOSWLY/translate-backend
 */
export const foswlyTranslateUrl =
  "https://translate-backend.transly.workers.dev/v2";

export const detectRustServerUrl =
  "https://rust-server-531j.onrender.com/detect";

// Direct Yandex OAuth with PKCE, no client_secret.
export const yandexOauthClientId = "b4dd2893e5ec40bf835cc0615b2992e3";

// ВАЖНО: этот URI должен быть добавлен в Redirect URI приложения в Yandex OAuth.
export const authCallbackOrigin = "https://oauth.yandex.ru";
export const authCallbackPath = "/verification_code";
export const authCallbackUrl = `${authCallbackOrigin}${authCallbackPath}`;

export const avatarServerUrl = "https://avatars.mds.yandex.net/get-yapic";

const repoPath = "Acobat12/voice-over-translation-direct";
export const contentUrl = `https://raw.githubusercontent.com/${repoPath}`;
export const repositoryUrl = `https://github.com/${repoPath}`;

export const defaultAutoVolume = 15;
export const maxAudioVolume = 900;
export const minLongWaitingCount = 5;

export const defaultTranslationService: "yandexbrowser" | "msedge" =
  "yandexbrowser";
export const defaultDetectService: "yandexbrowser" | "msedge" | "rust-server" =
  "yandexbrowser";

export const nonProxyExtensions: string[] = ["Tampermonkey", "Violentmonkey"];
export const proxyOnlyCountries: string[] = ["UA", "LV", "LT"];

export const defaultAutoHideDelay = 1000;
export const actualCompatVersion = "2025-05-09";
