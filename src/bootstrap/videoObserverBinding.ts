import type { ServiceConf } from "@vot.js/ext/types/service";
import type { VideoObserver } from "../utils/VideoObserver";

type VideoHandlerLike = {
  init(): Promise<void>;
  setCanPlay(): Promise<void>;
  getVideoData(): Promise<unknown>;
  videoData?: unknown;
  release(): Promise<void> | void;
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

function isVkProbeHost(): boolean {
  return /(?:^|\.)vkvideo\.ru$|(?:^|\.)vk\.(?:com|ru)$/i.test(
    String(globalThis.location.hostname || ""),
  );
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
      const rawUrl = String(track.src || track.getAttribute("src") || "").trim();
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
          track.srclang || track.track?.language || track.getAttribute("srclang") || "",
        ).trim(),
        label: String(track.label || track.getAttribute("label") || "").trim(),
        url,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

  const signature = trackEntries
    .map((entry) =>
      [entry.index, entry.kind, entry.srclang, entry.label, entry.url].join("|"),
    )
    .join("||");

  if (loggedNativeSubtitleSignatures.get(video) === signature) {
    return;
  }

  loggedNativeSubtitleSignatures.set(video, signature);
  (globalThis as Record<string, unknown>).__VOT_DETECTED_NATIVE_SUBTITLE_TRACKS__ =
    trackEntries;

  if (!trackEntries.length) {
    console.log("[VOT][subtitles][native] no <track> subtitle URLs detected for video");
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
  const pendingVideoByContainer = new WeakMap<HTMLElement, HTMLVideoElement>();

  const clearContainerOwner = (
    video: HTMLVideoElement,
  ): HTMLElement | undefined => {
    const container = videoContainers.get(video);
    if (container && containerOwners.get(container) === video) {
      containerOwners.delete(container);
    }
    videoContainers.delete(video);
    return container ?? undefined;
  };

  const clearPendingVideo = (container?: HTMLElement): void => {
    if (!container) {
      return;
    }
    pendingVideoByContainer.delete(container);
  };

  const releaseVideoHandler = async (
    video: HTMLVideoElement,
    reason: string,
  ): Promise<void> => {
    const videoHandler = videosWrappers.get(video);
    if (!videoHandler) {
      return;
    }

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
    if (videosWrappers.has(video) || initializingVideos.has(video)) return;
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
          console.warn("[VOT][VK probe] video detected but no site/container match", {
            src: video.currentSrc || video.src || "",
            w: rect.width,
            h: rect.height,
            path: globalThis.location.pathname,
          });
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
            await releaseVideoHandler(activeVideoForContainer, "smaller duplicate");
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
      containerOwners.set(container, video);

      try {
        await videoHandler.init();
        if (videosWrappers.get(video) !== videoHandler) {
          return;
        }
        try {
          await videoHandler.setCanPlay();
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
    const container = clearContainerOwner(video);
    await releaseVideoHandler(video, "video removed");
    initializingVideos.delete(video);
    if (container && pendingVideoByContainer.get(container) === video) {
      clearPendingVideo(container);
    }
    await promotePendingVideo(container);
  });
}
