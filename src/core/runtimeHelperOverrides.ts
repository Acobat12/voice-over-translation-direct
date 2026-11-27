import { availableHelpers } from "@vot.js/ext/helpers";
import type { ServiceConf } from "@vot.js/ext/types/service";
import { requestPageContextSnapshot } from "../utils/pageContextBridge";

type HelperInstance = {
  video?: HTMLVideoElement;
  service?: ServiceConf;
  language?: string;
  getVideoId?(url: URL): Promise<string | undefined> | string | undefined;
  getVideoData?(videoId: string): Promise<unknown> | unknown;
};

type HelperCtor = new (opts?: unknown) => HelperInstance;

type RuntimeHelperResolverContext = {
  helper: HelperInstance;
  snapshot: Awaited<ReturnType<typeof requestPageContextSnapshot>>;
  locationUrl: URL;
};

type RuntimeHelperResolver = {
  getVideoId?(
    context: RuntimeHelperResolverContext,
  ): Promise<string | undefined> | string | undefined;
  getVideoData?(
    videoId: string,
    context: RuntimeHelperResolverContext,
  ):
    | Promise<Record<string, unknown> | undefined>
    | Record<string, unknown>
    | undefined;
};

type RuntimeSiteBridge = ServiceConf & {
  getVideoId?: () => Promise<string | undefined>;
  getVideoData?: () => Promise<Record<string, unknown> | undefined>;
};

const installedHelperHosts = new Set<string>();

function getScriptHandlerName(): string {
  const scopedGMInfo =
    typeof GM_info !== "undefined" && GM_info ? GM_info : undefined;
  const scopedGM =
    typeof GM === "object" && GM !== null
      ? GM
      : ((globalThis as { GM?: typeof GM }).GM ?? undefined);

  return String(
    scopedGMInfo?.scriptHandler || scopedGM?.info?.scriptHandler || "",
  ).toLowerCase();
}

function isUserscriptsRuntime(): boolean {
  return getScriptHandlerName().includes("userscripts");
}

function normalizeHttpUrl(url: string): string {
  try {
    const parsed = new URL(url, globalThis.location.href);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return String(url || "").split("#")[0] || "";
  }
}

function extractGoogleDriveFileId(value: string): string | undefined {
  try {
    const parsed = new URL(value, globalThis.location.href);
    const pathname = parsed.pathname || "";
    return (
      /\/embed\/([^/?#]+)/.exec(pathname)?.[1] ||
      /\/file\/d\/([^/?#]+)/.exec(pathname)?.[1] ||
      /\/videos\/d\/([^/?#]+)/.exec(pathname)?.[1] ||
      /\/d\/([^/?#]+)/.exec(pathname)?.[1] ||
      undefined
    );
  } catch {
    return undefined;
  }
}

const runtimeHelperResolvers: Record<string, RuntimeHelperResolver> = {
  googledrive: {
    getVideoId({ snapshot, locationUrl }) {
      return (
        String(
          (
            snapshot?.moviePlayerVideoData as
              | Record<string, unknown>
              | undefined
          )?.video_id || "",
        ).trim() ||
        extractGoogleDriveFileId(locationUrl.toString()) ||
        extractGoogleDriveFileId(document.referrer) ||
        undefined
      );
    },
  },
};

export function hasRuntimeHelperResolver(host: string): boolean {
  return Object.hasOwn(runtimeHelperResolvers, host);
}

function buildResolverContext(
  helper: HelperInstance,
  snapshot: Awaited<ReturnType<typeof requestPageContextSnapshot>> | null,
): RuntimeHelperResolverContext {
  return {
    helper,
    snapshot,
    locationUrl: new URL(globalThis.location.href),
  };
}

function buildBaseRuntimeVideoData(
  site: ServiceConf,
  videoId: string,
): Record<string, unknown> {
  const siteUrl = String(site.url || "").trim();
  const url =
    siteUrl && siteUrl !== "stub"
      ? normalizeHttpUrl(`${siteUrl}${videoId}`)
      : normalizeHttpUrl(globalThis.location.href);

  return {
    url,
    videoId,
    host: site.host,
    duration: undefined,
  };
}

function isValidHelperVideoData(
  value: unknown,
): value is Record<string, unknown> {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  const url = String(candidate.url || "").trim();
  return Boolean(url);
}

function createRuntimeHelperClass(
  host: string,
  OriginalHelper: HelperCtor,
): HelperCtor {
  const resolver = runtimeHelperResolvers[host];

  return class RuntimeHelperOverride extends OriginalHelper {
    async getVideoId(url: URL): Promise<string | undefined> {
      let originalResult: string | undefined;
      let originalError: unknown;
      try {
        originalResult =
          typeof super.getVideoId === "function"
            ? await super.getVideoId(url)
            : undefined;
      } catch (error) {
        originalError = error;
      }

      if (originalResult) {
        return originalResult;
      }

      const snapshot = await requestPageContextSnapshot(500);
      const resolved = await resolver.getVideoId?.(
        buildResolverContext(this, snapshot),
      );

      console.log("[FORK][runtime-helper] getVideoId fallback", {
        host,
        originalResult,
        originalError,
        resolved,
        href: globalThis.location.href,
      });

      return resolved;
    }

    async getVideoData(videoId: string): Promise<unknown> {
      let originalResult: unknown;
      let originalError: unknown;
      try {
        originalResult =
          typeof super.getVideoData === "function"
            ? await super.getVideoData(videoId)
            : undefined;
      } catch (error) {
        originalError = error;
      }

      if (isValidHelperVideoData(originalResult)) {
        return originalResult;
      }

      const snapshot = await requestPageContextSnapshot(500);
      const resolved =
        (await resolver.getVideoData?.(
          videoId,
          buildResolverContext(this, snapshot),
        )) ||
        buildBaseRuntimeVideoData(
          (this.service as ServiceConf | undefined) || {
            host: host as ServiceConf["host"],
            url: globalThis.location.href,
          },
          videoId,
        );

      console.log("[FORK][runtime-helper] getVideoData fallback", {
        host,
        videoId,
        originalResult,
        originalError,
        resolved,
        href: globalThis.location.href,
      });

      return resolved;
    }
  };
}

export function installRuntimeHelperOverrides(): void {
  if (!isUserscriptsRuntime()) {
    return;
  }

  for (const [host, resolver] of Object.entries(runtimeHelperResolvers)) {
    if (!resolver || installedHelperHosts.has(host)) {
      continue;
    }

    const OriginalHelper = availableHelpers[
      host as keyof typeof availableHelpers
    ] as HelperCtor | undefined;
    if (!OriginalHelper) {
      continue;
    }

    availableHelpers[host as keyof typeof availableHelpers] =
      createRuntimeHelperClass(host, OriginalHelper) as never;
    installedHelperHosts.add(host);

    console.log("[FORK][runtime-helper] override installed", {
      host,
      runtime: getScriptHandlerName(),
    });
  }
}

async function buildRuntimeSiteVideoData(
  site: ServiceConf,
): Promise<Record<string, unknown> | undefined> {
  const host = String(site.host || "");
  const resolver = runtimeHelperResolvers[host];
  if (!resolver) {
    return undefined;
  }

  const snapshot = await requestPageContextSnapshot(500);
  const helperContext = buildResolverContext({}, snapshot);
  const videoId = await resolver.getVideoId?.(helperContext);
  if (!videoId) {
    return undefined;
  }

  const resolved = await resolver.getVideoData?.(videoId, helperContext);
  const data = resolved || buildBaseRuntimeVideoData(site, videoId);

  return {
    ...data,
    videoId,
    host,
  };
}

export async function resolveRuntimeHelperVideoData(
  site: ServiceConf,
): Promise<Record<string, unknown> | undefined> {
  return await buildRuntimeSiteVideoData(site);
}

export function withRuntimeHelperSiteBridge(site: ServiceConf): ServiceConf {
  if (!isUserscriptsRuntime()) {
    return site;
  }

  const host = String(site.host || "");
  if (!runtimeHelperResolvers[host]) {
    return site;
  }

  const bridgedSite = { ...site } as RuntimeSiteBridge;
  bridgedSite.getVideoId = async () => {
    const snapshot = await requestPageContextSnapshot(500);
    return await runtimeHelperResolvers[host].getVideoId?.(
      buildResolverContext({}, snapshot),
    );
  };
  bridgedSite.getVideoData = async () => {
    return await buildRuntimeSiteVideoData(bridgedSite);
  };

  return bridgedSite;
}
