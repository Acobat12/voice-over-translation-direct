import { VideoDataError } from "@vot.js/core/utils/videoData";
import type { ServiceConf } from "@vot.js/ext/types/service";
import VideoHelper, {
  availableHelpers,
} from "../../node_modules/@vot.js/ext/dist/helpers/index.js";
import { getService as baseGetService } from "../../node_modules/@vot.js/ext/dist/utils/videoData.js";
import {
  installRuntimeHelperOverrides,
  withRuntimeHelperSiteBridge,
} from "../core/runtimeHelperOverrides";
import {
  requestSafariPageVideoData,
  requestSafariPageVideoID,
  shouldUseSafariPageBridge,
} from "./safari/pageBridge";

type RuntimeSiteBridge = ServiceConf & {
  getVideoData?: () => Promise<Record<string, unknown> | undefined>;
  getVideoId?: () => Promise<string | undefined>;
};

let runtimeHelperOverridesInstalled = false;

function ensureRuntimeHelperOverrides(): void {
  if (runtimeHelperOverridesInstalled) {
    return;
  }

  installRuntimeHelperOverrides();
  runtimeHelperOverridesInstalled = true;
}

function getBridgedSite(service: ServiceConf): RuntimeSiteBridge {
  ensureRuntimeHelperOverrides();
  return withRuntimeHelperSiteBridge(service) as RuntimeSiteBridge;
}

export function getService(): ServiceConf[] {
  ensureRuntimeHelperOverrides();
  return baseGetService().map((service) =>
    withRuntimeHelperSiteBridge(service),
  );
}

export async function getVideoID(
  service: ServiceConf,
  opts: Record<string, unknown> = {},
): Promise<string | undefined> {
  const runtimeSite = getBridgedSite(service);
  const serviceHost = String(runtimeSite.host);

  if (shouldUseSafariPageBridge()) {
    const bridgedId = await requestSafariPageVideoID(runtimeSite);
    if (bridgedId) {
      return bridgedId;
    }
  }

  if (typeof runtimeSite.getVideoId === "function") {
    const bridgedRuntimeId = await runtimeSite.getVideoId();
    if (bridgedRuntimeId) {
      return bridgedRuntimeId;
    }
  }

  const url = new URL(globalThis.location.href);

  if (Object.hasOwn(availableHelpers, serviceHost)) {
    const helper = new VideoHelper({
      ...opts,
      service: runtimeSite,
    }).getHelper(serviceHost);
    return await helper.getVideoId(url);
  }

  return serviceHost === "custom" ? url.href : undefined;
}

export async function getVideoData(
  service: ServiceConf,
  opts: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const runtimeSite = getBridgedSite(service);
  const serviceHost = String(runtimeSite.host);

  if (shouldUseSafariPageBridge()) {
    const pageData = await requestSafariPageVideoData(
      runtimeSite,
      typeof opts.language === "string" ? opts.language : undefined,
    );
    if (pageData?.videoId && pageData.url) {
      return {
        ...pageData,
        host: runtimeSite.host,
      };
    }
  }

  if (typeof runtimeSite.getVideoData === "function") {
    const runtimeData = await runtimeSite.getVideoData();
    if (runtimeData) {
      return {
        ...runtimeData,
        host: runtimeSite.host,
      };
    }
  }

  const videoId = await getVideoID(runtimeSite, opts);
  if (!videoId) {
    throw new VideoDataError(`Entered unsupported link: "${runtimeSite.host}"`);
  }

  const origin = globalThis.location.origin;
  if (
    ["peertube", "coursehunterLike", "cloudflarestream"].includes(serviceHost)
  ) {
    runtimeSite.url = origin;
  }

  if (runtimeSite.rawResult) {
    return {
      url: videoId,
      videoId,
      host: runtimeSite.host,
      duration: undefined,
    };
  }

  if (!runtimeSite.needExtraData) {
    return {
      url: `${runtimeSite.url}${videoId}`,
      videoId,
      host: runtimeSite.host,
      duration: undefined,
    };
  }

  const helper = new VideoHelper({
    ...opts,
    service: runtimeSite,
    origin,
  }).getHelper(serviceHost);
  const result = await helper.getVideoData(videoId);

  if (!result) {
    throw new VideoDataError(
      `Failed to get video raw url for ${runtimeSite.host}`,
    );
  }

  return {
    ...result,
    videoId,
    host: runtimeSite.host,
  };
}
