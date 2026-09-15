import { availableHelpers } from "@vot.js/ext/helpers";
import type { ServiceConf } from "@vot.js/ext/types/service";
import { availableLangs } from "@vot.js/shared/consts";
import type { RequestLang } from "@vot.js/shared/types/data";
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

function pickActiveVideoElement(): HTMLVideoElement | null {
  const candidates = Array.from(document.querySelectorAll("video")).filter(
    (node): node is HTMLVideoElement => node instanceof HTMLVideoElement,
  );

  const scored = candidates
    .map((video) => {
      const rect = video.getBoundingClientRect();
      return {
        video,
        area: Math.max(0, rect.width) * Math.max(0, rect.height),
        visible:
          rect.width > 80 &&
          rect.height > 80 &&
          rect.bottom > 0 &&
          rect.top < globalThis.innerHeight,
        paused: video.paused,
        readyState: video.readyState,
      };
    })
    .filter((entry) => entry.visible)
    .sort((left, right) => {
      if (left.paused !== right.paused) {
        return left.paused ? 1 : -1;
      }
      if (left.readyState !== right.readyState) {
        return right.readyState - left.readyState;
      }
      return right.area - left.area;
    });

  return scored[0]?.video ?? candidates[0] ?? null;
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

function extractDouyinModalId(
  snapshot: Awaited<ReturnType<typeof requestPageContextSnapshot>> | null,
): string | undefined {
  const href = String(globalThis.location.href || "");
  return (
    /[?&]modal_id=(\d{16,22})/.exec(href)?.[1] ||
    /\/video\/(\d{16,22})(?:[/?#]|$)/.exec(href)?.[1] ||
    /\/note\/(\d{16,22})(?:[/?#]|$)/.exec(href)?.[1] ||
    String(
      (snapshot?.awemeInfo as Record<string, unknown> | undefined)?.awemeId ||
        (snapshot?.awemeInfo as Record<string, unknown> | undefined)
          ?.aweme_id ||
        (snapshot?.awemeInfo as Record<string, unknown> | undefined)?.groupId ||
        (snapshot?.awemeInfo as Record<string, unknown> | undefined)
          ?.group_id ||
        "",
    ).trim() ||
    undefined
  );
}

function normalizeDouyinTranslationUrl(rawUrl: string): string {
  const normalized = normalizeHttpUrl(rawUrl);
  const marker = "media-audio-und-mp4a/";
  const markerIndex = normalized.indexOf(marker);
  if (markerIndex === -1) {
    return normalized;
  }
  return `${normalized.slice(0, markerIndex + marker.length)}?`;
}

function pickDouyinAudioMediaUrl(): string {
  const entries = performance.getEntriesByType("resource");

  for (const entry of entries) {
    const url = String(entry.name || "").trim();
    if (!url) {
      continue;
    }
    if (
      /zjcdn\.com/i.test(url) &&
      /\/video\/tos\//i.test(url) &&
      /media-audio-und-mp4a\//i.test(url)
    ) {
      const selectedUrl = normalizeDouyinTranslationUrl(url);
      console.log("[VOT][douyin] FINAL TRANSLATION URL", {
        selectedUrl,
        source: "performance-resource",
        originalUrl: url,
      });
      return selectedUrl;
    }
  }

  console.warn("[VOT][douyin] no media-audio-und-mp4a candidate found", {
    href: globalThis.location.href,
    entries: entries.length,
  });
  return "";
}

function normalizeRequestLang(value: unknown): RequestLang | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.toLowerCase().split(/[-_]/u)[0] as RequestLang;
  return (availableLangs as readonly string[]).includes(normalized)
    ? normalized
    : undefined;
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
  douyin: {
    getVideoId({ snapshot }) {
      const modalId = extractDouyinModalId(snapshot);
      return modalId ? `douyin/${modalId}` : undefined;
    },
    getVideoData(videoId, { helper, snapshot }) {
      const modalId =
        String(videoId || "")
          .split("/")
          .pop()
          ?.trim() ||
        extractDouyinModalId(snapshot) ||
        "";
      if (!modalId) {
        return undefined;
      }

      const url = pickDouyinAudioMediaUrl();
      if (!url?.includes("media-audio-und-mp4a/")) {
        throw new Error("Douyin translation requires media-audio-und-mp4a URL");
      }

      const activeVideo = helper.video || pickActiveVideoElement();
      const playerConfig = (
        snapshot?.player as Record<string, unknown> | undefined
      )?.config as Record<string, unknown> | undefined;
      const title =
        String(playerConfig?.title || "").trim() ||
        String(document.title || "").trim();
      const description = String(
        (
          (snapshot?.player as Record<string, unknown> | undefined)?.config as
            | Record<string, unknown>
            | undefined
        )?.desc || "",
      ).trim();
      const detectedLanguage = normalizeRequestLang(
        (
          (snapshot?.player as Record<string, unknown> | undefined)?.config as
            | Record<string, unknown>
            | undefined
        )?.lang,
      );

      return {
        url,
        title,
        localizedTitle: title,
        description: description || undefined,
        duration:
          Number(activeVideo?.duration || 0) ||
          Number(
            (
              (snapshot?.player as Record<string, unknown> | undefined)
                ?.config as Record<string, unknown> | undefined
            )?.duration || 0,
          ) ||
          undefined,
        isStream: false,
        ...(detectedLanguage ? { detectedLanguage } : {}),
      };
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

      const snapshot = await requestPageContextSnapshot({
        timeoutMs: 500,
        allowLegacyFallback: true,
        reason: `runtime-helper-override:getVideoId:${host}`,
      });
      const resolved = await resolver.getVideoId?.(
        buildResolverContext(this, snapshot),
      );

      console.log("[VOT][runtime-helper] getVideoId fallback", {
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

      const snapshot = await requestPageContextSnapshot({
        timeoutMs: 500,
        allowLegacyFallback: true,
        reason: `runtime-helper-override:getVideoData:${host}`,
      });
      const resolved =
        (await resolver.getVideoData?.(
          videoId,
          buildResolverContext(this, snapshot),
        )) ||
        buildBaseRuntimeVideoData(
          (this.service as ServiceConf | undefined) || {
            host,
            url: globalThis.location.href,
          },
          videoId,
        );

      console.log("[VOT][runtime-helper] getVideoData fallback", {
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

    console.log("[VOT][runtime-helper] override installed", {
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

  const data =
    (await resolver.getVideoData?.(videoId, helperContext)) ||
    buildBaseRuntimeVideoData(site, videoId);

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
    const snapshot = await requestPageContextSnapshot({
      timeoutMs: 500,
      allowLegacyFallback: true,
      reason: `runtime-helper-override:siteBridgeGetVideoId:${host}`,
    });
    return await runtimeHelperResolvers[host].getVideoId?.(
      buildResolverContext({}, snapshot),
    );
  };
  bridgedSite.getVideoData = async () => {
    return await buildRuntimeSiteVideoData(bridgedSite);
  };

  return bridgedSite;
}
