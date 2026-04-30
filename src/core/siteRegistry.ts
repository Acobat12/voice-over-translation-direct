import type { ServiceConf } from "@vot.js/ext/types/service";
import { getService as baseGetService } from "@vot.js/ext/utils/videoData";

type ExtraServiceConf = ServiceConf & {
  name?: string;
  priority?: number;
};

const customSites: ExtraServiceConf[] = [
  {
    host: "custom",
    url: "stub",
    match: /^odysee\.com$/,
    selector:
      ".video-js, video-js, [data-vjs-player], .vjs-player, .vjs-v7, video",
    eventSelector:
      ".video-js, video-js, [data-vjs-player], .vjs-player, .vjs-v7, video",
    needExtraData: true,
    rawResult: true,
    needBypassCSP: true,
    name: "odysee",
    priority: 100,
  },
];

export function registerCustomSite(site: ExtraServiceConf): void {
  customSites.push(site);
}

export function getCustomSites(): ExtraServiceConf[] {
  return [...customSites];
}

export function getService(): ServiceConf[] {
  const builtIn = baseGetService();
  const hostname = window.location.hostname;
  const enteredURL = new URL(window.location.href);

  const isMatches = (match: any) => {
    if (match instanceof RegExp) return match.test(hostname);
    if (typeof match === "string") return hostname.includes(match);
    if (typeof match === "function") return match(enteredURL);
    return false;
  };

  const matchedCustom = customSites
    .filter((e) => {
      return (
        (Array.isArray(e.match)
          ? e.match.some(isMatches)
          : isMatches(e.match)) &&
        e.host &&
        e.url
      );
    })
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  if (matchedCustom.length > 0) {
    return matchedCustom;
  }

  return builtIn;
}
