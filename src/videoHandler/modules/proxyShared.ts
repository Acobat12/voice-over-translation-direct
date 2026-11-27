import { proxyWorkerHost } from "../../config/config";

const AUDIO_SOURCE_PREFIX =
  "https://vtrans.s3-private.mds.yandex.net/tts/prod/";
const AUDIO_PROXY_PATH_PREFIX = "/video-translation/audio-proxy/";

const SUBTITLE_SOURCE_PREFIX =
  "https://brosubs.s3-private.mds.yandex.net/vtrans/";
const SUBTITLE_PROXY_PATH_PREFIX = "/video-subtitles/subtitles-proxy/";

type ProxyConfig = {
  translateProxyEnabled?: number | null;
  proxyWorkerHost?: string | null;
  proxyServerPreset?: string | null;
};

function getProxyHost(host?: string | null, preset?: string | null): string {
  if (preset === "builtin" || !preset) return proxyWorkerHost;
  const clean = (host || proxyWorkerHost)
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
  // Preserve the path entered by the user; never append or strip /vot.
  return clean;
}

function isProxyRoutingEnabled(config: ProxyConfig): boolean {
  return config.translateProxyEnabled === 2;
}

export function proxifyYandexAudioUrl(
  audioUrl: string,
  config: ProxyConfig,
): string {
  if (
    !isProxyRoutingEnabled(config) ||
    !audioUrl.startsWith(AUDIO_SOURCE_PREFIX)
  ) {
    return audioUrl;
  }

  return audioUrl.replace(
    AUDIO_SOURCE_PREFIX,
    `https://${getProxyHost(config.proxyWorkerHost, config.proxyServerPreset)}${AUDIO_PROXY_PATH_PREFIX}`,
  );
}

export function unproxifyYandexAudioUrl(audioUrl: string): string {
  const str = String(audioUrl || "");
  if (!str) return str;

  try {
    const url = new URL(str);
    const marker = `/vot${AUDIO_PROXY_PATH_PREFIX}`;
    if (
      !url.pathname.startsWith(AUDIO_PROXY_PATH_PREFIX) &&
      !url.pathname.startsWith(marker)
    ) {
      return str;
    }

    url.host = "vtrans.s3-private.mds.yandex.net";
    url.pathname = `/tts/prod/${url.pathname
      .slice(
        url.pathname.startsWith(marker)
          ? marker.length
          : AUDIO_PROXY_PATH_PREFIX.length,
      )
      .replace(/^\/+/, "")}`;
    url.protocol = "https:";
    return url.toString();
  } catch {
    return str;
  }
}

export function isYandexAudioUrlOrProxy(
  url: string,
  config: {
    proxyWorkerHost?: string | null;
    proxyServerPreset?: string | null;
  },
): boolean {
  return (
    url.startsWith(AUDIO_SOURCE_PREFIX) ||
    url.startsWith(
      `https://${getProxyHost(config.proxyWorkerHost, config.proxyServerPreset)}${AUDIO_PROXY_PATH_PREFIX}`,
    )
  );
}

export function proxifyYandexSubtitlesUrl(
  subtitlesUrl: string,
  config: ProxyConfig,
): string {
  if (
    !isProxyRoutingEnabled(config) ||
    !subtitlesUrl.startsWith(SUBTITLE_SOURCE_PREFIX)
  ) {
    return subtitlesUrl;
  }

  const subtitlesPath = subtitlesUrl.slice(SUBTITLE_SOURCE_PREFIX.length);
  return `https://${getProxyHost(config.proxyWorkerHost, config.proxyServerPreset)}${SUBTITLE_PROXY_PATH_PREFIX}${subtitlesPath}`;
}
