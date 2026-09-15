import upstreamConfig from "../../node_modules/@vot.js/shared/dist/data/config.js";

export const yandexBrowserComponentVersion = "26.8.1.1024";
export const yandexBrowserMajorMinorVersion = "26.8";
export const chromiumUserAgentVersion = "150.0.0.0";
export const chromiumFullVersion = "150.0.7871.1024";
export const chromiumMajorVersion = "150";

export function normalizeUserAgent(
  rawUserAgent: string,
  browserVersion: string,
): string {
  return String(rawUserAgent || "")
    .replace(/Chrome\/[\d.]+/i, `Chrome/${chromiumUserAgentVersion}`)
    .replace(/YaBrowser\/[\d.]+/i, `YaBrowser/${browserVersion}`);
}

export const normalizedBrowserUserAgent = normalizeUserAgent(
  String(upstreamConfig.userAgent || ""),
  yandexBrowserComponentVersion,
);

const config = {
  ...upstreamConfig,
  componentVersion: yandexBrowserComponentVersion,
  userAgent: normalizedBrowserUserAgent,
};

export default config;
