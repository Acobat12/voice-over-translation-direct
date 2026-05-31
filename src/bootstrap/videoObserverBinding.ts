import type { ServiceConf } from "@vot.js/ext/types/service";
import type { VideoObserver } from "../utils/VideoObserver";

type VideoHandlerLike = {
  init(): Promise<void>;
  setCanPlay(): Promise<void>;
  getVideoData(): Promise<unknown>;
  videoData?: unknown;
  release(): Promise<void> | void;
  onPrimaryAttachReady?: () => void;
};

type BindObserverListenersOptions = {
  videoObserver: VideoObserver;
  videosWrappers: WeakMap<HTMLVideoElement, VideoHandlerLike>;
  ensureRuntimeActivated: (reason: string) => Promise<void>;
  getServicesCached: () => ServiceConf[];
  findContainer: (
    site: ServiceConf,
    video: HTMLVideoElement,
  ) => HTMLElement | null;
  createVideoHandler: (
    video: HTMLVideoElement,
    container: HTMLElement,
    site: ServiceConf,
  ) => VideoHandlerLike;
};

type SiteContainerMatch = {
  site: ServiceConf;
  container: HTMLElement;
};

const boundObservers = new WeakSet<VideoObserver>();
const loggedNativeSubtitleSignatures = new WeakMap<HTMLVideoElement, string>();
const MOBILE_YOUTUBE_RELEASE_GRACE_MS = 2200;

type PendingGraceRelease = {
  pageKey: string;
  reason: string;
  site: ServiceConf;
  timer: ReturnType<typeof setTimeout>;
};

function isVkProbeHost(): boolean {
  return /(?:^|\.)vkvideo\.ru$|(?:^|\.)vk\.(?:com|ru)$/i.test(
    String(globalThis.location.hostname || ""),
  );
}

function isMobileYouTubeDebugHost(): boolean {
  return /^(m|music)\.youtube\.com$/i.test(
    String(globalThis.location.hostname || ""),
  );
}

function logMobileOverlay(message: string, details?: unknown): void {
  if (!isMobileYouTubeDebugHost()) {
    return;
  }

  console.log(`[VOT][mobile-overlay][observer] ${message}`, details ?? {});
}

function isGracefulMobileYouTubeSite(site: ServiceConf): boolean {
  return (
    String(site.host || "") === "youtube" &&
    (site.additionalData === "mobile" || site.additionalData === "music")
  );
}

function getMobileYouTubePageKey(): string {
  return `${globalThis.location.origin}${globalThis.location.pathname}${globalThis.location.search}`;
}

function isRenderableVideo(video: HTMLVideoElement): boolean {
  if (!video.isConnected) {
    return false;
  }

  const rect = video.getBoundingClientRect();
  if (rect.width < 64 || rect.height < 64) {
    return false;
  }

  const style = globalThis.getComputedStyle(video);
  if (
    style.display === "none" ||
    style.visibility === "hidden" ||
    Number(style.opacity || "1") === 0
  ) {
    return false;
  }

  return true;
}

function getVideoArea(video: HTMLVideoElement): number {
  const rect = video.getBoundingClientRect();
  return Math.max(0, rect.width) * Math.max(0, rect.height);
}

function hasResolvableMediaSource(video: HTMLVideoElement): boolean {
  if (video.currentSrc || video.src || video.srcObject) {
    return true;
  }

  const source = video.querySelector("source");
  return Boolean(source?.getAttribute("src") || source?.src);
}

function logNativeSubtitleTracks(video: HTMLVideoElement): void {
  const trackEntries = Array.from(video.querySelectorAll("track"))
    .map((track, index) => {
      const rawUrl = String(
        track.src || track.getAttribute("src") || "",
      ).trim();
      if (!rawUrl) {
        return null;
      }

      let url = rawUrl;
      try {
        url = new URL(rawUrl, document.baseURI).href;
      } catch {
        // Keep raw URL.
      }

      return {
        index,
        kind: String(track.kind || track.getAttribute("kind") || "").trim(),
        srclang: String(
          track.srclang ||
            track.track?.language ||
            track.getAttribute("srclang") ||
            "",
        ).trim(),
        label: String(track.label || track.getAttribute("label") || "").trim(),
        url,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

  const signature = trackEntries
    .map((entry) =>
      [entry.index, entry.kind, entry.srclang, entry.label, entry.url].join(
        "|",
      ),
    )
    .join("||");

  if (loggedNativeSubtitleSignatures.get(video) === signature) {
    return;
  }

  loggedNativeSubtitleSignatures.set(video, signature);
  (
    globalThis as Record<string, unknown>
  ).__VOT_DETECTED_NATIVE_SUBTITLE_TRACKS__ = trackEntries;

  if (!trackEntries.length) {
    console.log(
      "[VOT][subtitles][native] no <track> subtitle URLs detected for video",
    );
    return;
  }

  console.log(
    `[VOT][subtitles][native] detected ${trackEntries.length} <track> subtitle URL(s). Inspect window.__VOT_DETECTED_NATIVE_SUBTITLE_TRACKS__.`,
  );
  console.table(trackEntries);
}

function shouldReplaceActiveVideo(
  activeVideo: HTMLVideoElement,
  nextVideo: HTMLVideoElement,
): boolean {
  if (!activeVideo.isConnected) {
    return true;
  }

  const activeArea = getVideoArea(activeVideo);
  const nextArea = getVideoArea(nextVideo);
  const activeRenderable = isRenderableVideo(activeVideo);
  const nextRenderable = isRenderableVideo(nextVideo);
  const activeHasSource = hasResolvableMediaSource(activeVideo);
  const nextHasSource = hasResolvableMediaSource(nextVideo);

  if (!activeRenderable && nextRenderable) {
    return true;
  }

  if (!activeHasSource && nextHasSource) {
    return true;
  }

  if (nextArea > activeArea * 1.1) {
    return true;
  }

  return false;
}

export function bindObserverListeners(
  options: BindObserverListenersOptions,
): void {
  const {
    videoObserver,
    videosWrappers,
    ensureRuntimeActivated,
    getServicesCached,
    findContainer,
    createVideoHandler,
  } = options;

  if (boundObservers.has(videoObserver)) return;
  boundObservers.add(videoObserver);

  const initializingVideos = new WeakSet<HTMLVideoElement>();
  const containerOwners = new WeakMap<HTMLElement, HTMLVideoElement>();
  const videoContainers = new WeakMap<HTMLVideoElement, HTMLElement>();
  const videoSites = new WeakMap<HTMLVideoElement, ServiceConf>();
  const pendingVideoByContainer = new WeakMap<HTMLElement, HTMLVideoElement>();
  const pendingGraceReleases = new Map<HTMLVideoElement, PendingGraceRelease>();
  let youtubeObserverStoppedAfterPrimaryAttach = false;

  const clearContainerOwner = (
    video: HTMLVideoElement,
  ): HTMLElement | undefined => {
    const container = videoContainers.get(video);
    if (container && containerOwners.get(container) === video) {
      containerOwners.delete(container);
    }
    videoContainers.delete(video);
    videoSites.delete(video);
    return container ?? undefined;
  };

  const clearPendingVideo = (container?: HTMLElement): void => {
    if (!container) {
      return;
    }
    pendingVideoByContainer.delete(container);
  };

  const findBestMatchingVideo = (
    site: ServiceConf,
  ): HTMLVideoElement | null => {
    let bestVideo: HTMLVideoElement | null = null;
    let bestScore = -1;

    for (const candidate of document.querySelectorAll("video")) {
      if (!(candidate instanceof HTMLVideoElement) || !candidate.isConnected) {
        continue;
      }

      if (!findContainer(site, candidate)) {
        continue;
      }

      let score = getVideoArea(candidate);
      if (hasResolvableMediaSource(candidate)) {
        score += 10_000_000;
      }
      if (isRenderableVideo(candidate)) {
        score += 1_000_000;
      }

      if (score > bestScore) {
        bestVideo = candidate;
        bestScore = score;
      }
    }

    return bestVideo;
  };

  const cancelPendingGraceRelease = (
    video: HTMLVideoElement,
    reason: string,
  ): PendingGraceRelease | undefined => {
    const state = pendingGraceReleases.get(video);
    if (!state) {
      return undefined;
    }

    clearTimeout(state.timer);
    pendingGraceReleases.delete(video);
    logMobileOverlay("cancel delayed cleanup", {
      reason,
      scheduledReason: state.reason,
      pageKey: state.pageKey,
    });
    return state;
  };

  const releaseVideoHandler = async (
    video: HTMLVideoElement,
    reason: string,
  ): Promise<void> => {
    cancelPendingGraceRelease(video, `release:${reason}`);
    const videoHandler = videosWrappers.get(video);
    if (!videoHandler) {
      return;
    }

    logMobileOverlay("release video handler", {
      reason,
      videoConnected: video.isConnected,
      src: video.currentSrc || video.src || "",
    });
    try {
      await videoHandler.release();
    } catch (error) {
      console.error(`[VOT] Failed to release videoHandler (${reason})`, error);
    } finally {
      videosWrappers.delete(video);
    }
  };

  const getMatchedSiteAndContainer = (
    video: HTMLVideoElement,
  ): SiteContainerMatch | null => {
    for (const candidate of getServicesCached()) {
      const container = findContainer(candidate, video);
      if (container) {
        return { site: candidate, container };
      }
    }

    return null;
  };

  const withRuntimeSiteUrl = (site: ServiceConf): ServiceConf => {
    const host = String(site.host);
    return host === "peertube" || host === "directlink"
      ? { ...site, url: globalThis.location.origin }
      : site;
  };

  const shouldStopObserverAfterSuccessfulAttach = (
    site: ServiceConf,
  ): boolean => site.host === "youtube" && !site.additionalData;

  const stopYouTubeVideoDiscovery = (site: ServiceConf): void => {
    if (
      youtubeObserverStoppedAfterPrimaryAttach ||
      !shouldStopObserverAfterSuccessfulAttach(site)
    ) {
      return;
    }

    youtubeObserverStoppedAfterPrimaryAttach = true;
    console.log(
      "[VOT][observer] disabling video discovery after first successful YouTube attach",
      {
        host: globalThis.location.hostname,
        path: globalThis.location.pathname,
      },
    );
    videoObserver.disable();
  };

  const scheduleGracefulRelease = async (
    video: HTMLVideoElement,
    site: ServiceConf,
    reason: string,
    container?: HTMLElement,
  ): Promise<void> => {
    cancelPendingGraceRelease(video, `reschedule:${reason}`);

    const pageKey = getMobileYouTubePageKey();
    logMobileOverlay("schedule delayed cleanup", {
      reason,
      pageKey,
      delayMs: MOBILE_YOUTUBE_RELEASE_GRACE_MS,
      videoConnected: video.isConnected,
      hasSource: hasResolvableMediaSource(video),
    });

    const timer = globalThis.setTimeout(async () => {
      const currentState = pendingGraceReleases.get(video);
      if (!currentState || currentState.timer !== timer) {
        return;
      }

      pendingGraceReleases.delete(video);

      if (video.isConnected) {
        logMobileOverlay("skip delayed cleanup: video reconnected", {
          reason,
          pageKey,
        });
        const match = getMatchedSiteAndContainer(video);
        if (match) {
          videoContainers.set(video, match.container);
          containerOwners.set(match.container, video);
        }
        try {
          await videosWrappers.get(video)?.setCanPlay();
        } catch (error) {
          console.error(
            "[VOT] Failed to restore reconnected mobile YouTube video",
            error,
          );
        }
        return;
      }

      const replacementVideo = findBestMatchingVideo(site);
      if (replacementVideo && replacementVideo !== video) {
        logMobileOverlay(
          "cleanup stale handler after replacement video found",
          {
            reason,
            pageKey,
            replacementSrc:
              replacementVideo.currentSrc || replacementVideo.src || "",
          },
        );
        await releaseVideoHandler(video, `${reason}:replacement-video-found`);
        await promotePendingVideo(container);
        return;
      }

      const currentPageKey = getMobileYouTubePageKey();
      if (currentPageKey === pageKey) {
        logMobileOverlay("keep overlay alive on same page during repaint", {
          reason,
          pageKey,
          currentPageKey,
          mode: site.additionalData,
        });
        await scheduleGracefulRelease(
          video,
          site,
          `${reason}:same-page-retry`,
          container,
        );
        return;
      }

      logMobileOverlay("delayed cleanup expired after page change", {
        reason,
        pageKey,
        currentPageKey,
      });
      await releaseVideoHandler(video, `${reason}:page-changed`);
      await promotePendingVideo(container);
    }, MOBILE_YOUTUBE_RELEASE_GRACE_MS);

    pendingGraceReleases.set(video, {
      pageKey,
      reason,
      site,
      timer,
    });
  };

  const promotePendingVideo = async (
    container?: HTMLElement,
  ): Promise<void> => {
    if (!container) {
      return;
    }

    const pendingVideo = pendingVideoByContainer.get(container);
    if (!pendingVideo) {
      return;
    }
    pendingVideoByContainer.delete(container);
    if (
      !pendingVideo.isConnected ||
      videosWrappers.has(pendingVideo) ||
      initializingVideos.has(pendingVideo)
    ) {
      return;
    }
    await handleVideoAdded(pendingVideo);
  };

  const handleVideoAdded = async (video: HTMLVideoElement) => {
    const canceledRelease = cancelPendingGraceRelease(
      video,
      "video-added-again",
    );
    if (videosWrappers.has(video)) {
      const match = getMatchedSiteAndContainer(video);
      if (match) {
        videoContainers.set(video, match.container);
        videoSites.set(video, match.site);
        containerOwners.set(match.container, video);
      }
      if (canceledRelease) {
        try {
          await videosWrappers.get(video)?.setCanPlay();
        } catch (error) {
          console.error(
            "[VOT] Failed to refresh reattached mobile YouTube handler",
            error,
          );
        }
      }
      return;
    }
    if (initializingVideos.has(video)) return;
    initializingVideos.add(video);

    try {
      try {
        await ensureRuntimeActivated("video-detected");
      } catch (err) {
        console.error("[VOT] Failed to activate runtime", err);
        return;
      }

      logNativeSubtitleTracks(video);

      const match = getMatchedSiteAndContainer(video);
      if (!match) {
        if (isVkProbeHost()) {
          const rect = video.getBoundingClientRect();
          console.warn(
            "[VOT][VK probe] video detected but no site/container match",
            {
              src: video.currentSrc || video.src || "",
              w: rect.width,
              h: rect.height,
              path: globalThis.location.pathname,
            },
          );
        }
        return;
      }
      const { site, container } = match;
      if (isVkProbeHost()) {
        const rect = video.getBoundingClientRect();
        console.log("[VOT][VK probe] matched video", {
          site: site.host,
          selector: site.selector,
          container: container?.tagName,
          classes: container?.className,
          w: rect.width,
          h: rect.height,
          src: video.currentSrc || video.src || "",
        });
      }
      if (
        (site.host === "googledrive" ||
          globalThis.location.hostname === "youtube.googleapis.com") &&
        !isRenderableVideo(video)
      ) {
        return;
      }
      const activeVideoForContainer = containerOwners.get(container);
      if (activeVideoForContainer && activeVideoForContainer !== video) {
        if (activeVideoForContainer.isConnected) {
          if (shouldReplaceActiveVideo(activeVideoForContainer, video)) {
            await releaseVideoHandler(
              activeVideoForContainer,
              "smaller duplicate",
            );
            clearContainerOwner(activeVideoForContainer);
          } else {
            pendingVideoByContainer.set(container, video);
            return;
          }
        } else {
          await releaseVideoHandler(activeVideoForContainer, "stale container");
          clearContainerOwner(activeVideoForContainer);
        }
      }

      const videoHandler = createVideoHandler(
        video,
        container,
        withRuntimeSiteUrl(site),
      );
      // Register before async init to prevent duplicate in-flight handlers.
      videosWrappers.set(video, videoHandler);
      videoContainers.set(video, container);
      videoSites.set(video, site);
      containerOwners.set(container, video);
      videoHandler.onPrimaryAttachReady = () => {
        if (videosWrappers.get(video) !== videoHandler) {
          return;
        }

        stopYouTubeVideoDiscovery(site);
      };

      try {
        await videoHandler.init();
        if (videosWrappers.get(video) !== videoHandler) {
          return;
        }
        try {
          await videoHandler.setCanPlay();
          if (videosWrappers.get(video) === videoHandler) {
            stopYouTubeVideoDiscovery(site);
          }
        } catch (err) {
          console.error("[VOT] Failed to get video data", err);
        }
      } catch (err) {
        if (videosWrappers.get(video) === videoHandler) {
          await releaseVideoHandler(video, "init failed");
          const container = clearContainerOwner(video);
          clearPendingVideo(container);
          await promotePendingVideo(container);
        }
        console.error("[VOT] Failed to initialize videoHandler", err);
      }
    } finally {
      initializingVideos.delete(video);
    }
  };

  videoObserver.onVideoAdded.addListener(handleVideoAdded);

  videoObserver.onVideoRemoved.addListener(async (video) => {
    const site = videoSites.get(video);
    const container = clearContainerOwner(video);
    const pendingReplacement = container
      ? pendingVideoByContainer.get(container)
      : undefined;
    const shouldDelayCleanup =
      site &&
      isGracefulMobileYouTubeSite(site) &&
      (!pendingReplacement || pendingReplacement === video);

    logMobileOverlay("video removed", {
      shouldDelayCleanup,
      hasContainer: Boolean(container),
      pendingReplacement: Boolean(
        pendingReplacement && pendingReplacement !== video,
      ),
      videoConnected: video.isConnected,
      src: video.currentSrc || video.src || "",
    });

    if (shouldDelayCleanup && site) {
      await scheduleGracefulRelease(video, site, "video-removed", container);
    } else {
      await releaseVideoHandler(video, "video removed");
    }
    initializingVideos.delete(video);
    if (container && pendingVideoByContainer.get(container) === video) {
      clearPendingVideo(container);
    }
    if (!shouldDelayCleanup) {
      await promotePendingVideo(container);
    }
  });
}
