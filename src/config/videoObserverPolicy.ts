import type { ServiceConf } from "@vot.js/ext/types/service";

export type VideoObserverPolicy = {
  preferProbeBootstrap: boolean;
  startDomObservationOnEnable: boolean;
  probeStrategy: "mutation" | "poll";
  probeSelectors: string[];
  probePollIntervalMs: number;
  probePollTimeoutMs: number;
  stopAfterFirstVideoDetected: boolean;
  keepWatchingAfterVideoDetected: boolean;
  observeShadowRoots: boolean;
  shadowHostSelectors: string[];
};

const SCAN_ONLY_BOOTSTRAP_SITE_HOSTS = new Set(["youtube"]);
const POLL_PROBE_SITE_HOSTS = new Set(["youtube"]);
const SINGLE_SHOT_SITE_HOSTS = new Set(["youtube"]);

const EAGER_BOOTSTRAP_SITE_HOSTS = new Set(["vk", "googledrive", "yandexdisk"]);

const EAGER_BOOTSTRAP_HOSTNAME_PATTERNS = [
  /(?:^|\.)vkvideo\.ru$/i,
  /(?:^|\.)vk\.(?:com|ru)$/i,
  /^youtube\.googleapis\.com$/i,
  /^disk\.yandex\./i,
];

const PERSISTENT_OBSERVER_SITE_HOSTS = new Set([
  "vk",
  "googledrive",
  "yandexdisk",
]);

const PERSISTENT_OBSERVER_HOSTNAME_PATTERNS = [
  /(?:^|\.)vkvideo\.ru$/i,
  /(?:^|\.)vk\.(?:com|ru)$/i,
  /^youtube\.googleapis\.com$/i,
  /^disk\.yandex\./i,
];

function normalizeSelectorList(services: readonly ServiceConf[]): string[] {
  const deduped = new Set<string>();

  for (const site of services) {
    if (site.shadowRoot !== true) {
      continue;
    }

    const selector =
      typeof site.selector === "string" ? site.selector.trim() : "";
    if (!selector) {
      continue;
    }

    deduped.add(selector);
  }

  return Array.from(deduped);
}

function resolveProbeSelectors(
  hostname: string,
  services: readonly ServiceConf[],
): string[] {
  const hosts = new Set(services.map((site) => String(site.host || "").trim()));

  if (
    hosts.has("youtube") ||
    /(?:^|\.)youtube(?:-nocookie|kids)?\.com$/i.test(hostname)
  ) {
    return [
      "video.html5-main-video, .html5-video-container video, .player-container video, video",
    ];
  }

  return ["video"];
}

export function resolveVideoObserverPolicy(input: {
  hostname: string;
  services: readonly ServiceConf[];
}): VideoObserverPolicy {
  const hostname = String(input.hostname || "")
    .trim()
    .toLowerCase();
  const services = input.services;
  const isScanOnlyBootstrap = services.some((site) =>
    SCAN_ONLY_BOOTSTRAP_SITE_HOSTS.has(String(site.host || "").trim()),
  );
  const startDomObservationOnEnable = !isScanOnlyBootstrap;
  const probeStrategy = services.some((site) =>
    POLL_PROBE_SITE_HOSTS.has(String(site.host || "").trim()),
  )
    ? "poll"
    : "mutation";
  const stopAfterFirstVideoDetected = services.some((site) =>
    SINGLE_SHOT_SITE_HOSTS.has(String(site.host || "").trim()),
  );
  const probeSelectors = resolveProbeSelectors(hostname, services);
  const preferProbeBootstrap =
    !services.some((site) =>
      EAGER_BOOTSTRAP_SITE_HOSTS.has(String(site.host || "").trim()),
    ) &&
    !EAGER_BOOTSTRAP_HOSTNAME_PATTERNS.some((pattern) =>
      pattern.test(hostname),
    );
  const shadowHostSelectors = startDomObservationOnEnable
    ? normalizeSelectorList(services)
    : [];
  const observeShadowRoots = shadowHostSelectors.length > 0;

  const keepWatchingAfterVideoDetected =
    services.some((site) =>
      PERSISTENT_OBSERVER_SITE_HOSTS.has(String(site.host || "").trim()),
    ) ||
    PERSISTENT_OBSERVER_HOSTNAME_PATTERNS.some((pattern) =>
      pattern.test(hostname),
    );

  return {
    preferProbeBootstrap,
    startDomObservationOnEnable,
    probeStrategy,
    probeSelectors,
    probePollIntervalMs: probeStrategy === "poll" ? 120 : 0,
    probePollTimeoutMs: probeStrategy === "poll" ? 4000 : 0,
    stopAfterFirstVideoDetected,
    keepWatchingAfterVideoDetected,
    observeShadowRoots,
    shadowHostSelectors,
  };
}
