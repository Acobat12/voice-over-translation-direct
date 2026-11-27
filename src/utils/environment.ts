import { browserInfo } from "./browserInfo";

export type EnvironmentInfo = {
  os: string;
  browser: string;
  loader: string;
  scriptVersion: string;
  scriptName: string;
  url: string;
};

const UNKNOWN_VALUE = "unknown";

const joinParts = (...parts: Array<string | undefined | null>) => {
  const value = parts.filter(Boolean).join(" ").trim();
  return value || UNKNOWN_VALUE;
};

export function getEnvironmentInfo(): EnvironmentInfo {
  const os = joinParts(browserInfo.os?.name, browserInfo.os?.version);
  const browser = joinParts(
    browserInfo.browser?.name,
    browserInfo.browser?.version,
  );
  const info = typeof GM_info === "undefined" ? undefined : GM_info;
  const loader = (() => {
    const handler = info?.scriptHandler;
    const version = info?.version;
    if (handler && version) return `${handler} v${version}`;
    return handler || version || UNKNOWN_VALUE;
  })();

  const scriptVersion = info?.script?.version ?? UNKNOWN_VALUE;
  const scriptName = info?.script?.name ?? UNKNOWN_VALUE;
  const url = globalThis?.location?.href ?? UNKNOWN_VALUE;

  return {
    os,
    browser,
    loader,
    scriptVersion,
    scriptName,
    url,
  };
}
