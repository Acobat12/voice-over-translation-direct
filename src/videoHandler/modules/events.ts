import { getVideoID } from "@vot.js/ext/utils/videoData";
import { availableLangs } from "@vot.js/shared/consts";
import type { RequestLang } from "@vot.js/shared/types/data";
import { defaultAutoHideDelay } from "../../config/config";
import {
  isDesktopYouTubeLikeSite,
  isMobileYouTubeLikeSite,
  isMuteSyncDisabledHost,
  isYouTubeLikeHost,
} from "../../core/hostPolicies";
import {
  resetAndHideLifecycle,
  resetLifecycleTranslation,
} from "../../core/lifecycleShared";
import { getTunnelPlayerContext } from "../../core/tunnelPlayer";
import YoutubeHelper, {
  isMobileYouTubeAdditionalData,
} from "../../core/youtubeHelper";
import type { VideoHandler } from "../../index";
import debug from "../../utils/debug";
import { containsCrossShadow } from "../../utils/dom";
import { GM_fetch } from "../../utils/gm";
import { getPlatformEventConfig } from "../../utils/platformEvents";
import { clampPercentInt } from "../../utils/volume";

type ScopedAddListener = (
  element: EventTarget,
  event: string,
  handler: EventListenerOrEventListenerObject,
  options?: AddEventListenerOptions,
) => void;
type ScopedAddListeners = (
  element: EventTarget,
  events: Iterable<string>,
  handler: EventListenerOrEventListenerObject,
  options?: AddEventListenerOptions,
) => void;
type ExtraEventsContext = {
  self: VideoHandler;
  overlayView: NonNullable<VideoHandler["uiManager"]["votOverlayView"]>;
  platformConfig: ReturnType<typeof getPlatformEventConfig>;
  add: ScopedAddListener;
  addMany: ScopedAddListeners;
};

const MOBILE_YOUTUBE_LIFECYCLE_GRACE_MS = 2200;
const MOBILE_YOUTUBE_MIN_AUTO_HIDE_DELAY_MS = 2500;

function mergeListenerSignals(
  primary: AbortSignal,
  secondary?: AbortSignal,
): AbortSignal {
  if (!secondary || secondary === primary) {
    return primary;
  }

  if (primary.aborted) {
    return primary;
  }

  if (secondary.aborted) {
    return secondary;
  }

  const canCombine = typeof AbortSignal !== "undefined" && "any" in AbortSignal;
  if (canCombine) {
    return (AbortSignal as any).any([primary, secondary]) as AbortSignal;
  }

  const controller = new AbortController();

  const cleanup = () => {
    primary.removeEventListener("abort", onPrimaryAbort);
    secondary.removeEventListener("abort", onSecondaryAbort);
  };

  const onPrimaryAbort = () => {
    cleanup();
    controller.abort(primary.reason);
  };
  const onSecondaryAbort = () => {
    cleanup();
    controller.abort(secondary.reason);
  };

  primary.addEventListener("abort", onPrimaryAbort, { once: true });
  secondary.addEventListener("abort", onSecondaryAbort, { once: true });

  return controller.signal;
}

function isVkLikeSiteHost(host: string): boolean {
  return (
    host === "vk" ||
    /(?:^|\.)vkvideo\.ru$|(?:^|\.)vk\.(?:com|ru)$/i.test(
      String(globalThis.location?.hostname || ""),
    )
  );
}

function isMobileYouTubeDebugHost(): boolean {
  return /^(m|music)\.youtube\.com$/i.test(
    String(globalThis.location?.hostname || ""),
  );
}

function logMobileOverlay(message: string, details?: unknown): void {
  if (!isMobileYouTubeDebugHost()) {
    return;
  }

  console.log(`[VOT][mobile-overlay][events] ${message}`, details ?? {});
}

function getMobileYouTubePageKey(): string {
  return `${globalThis.location.origin}${globalThis.location.pathname}${globalThis.location.search}`;
}

function clearMobileYouTubeLifecycleDebounce(self: VideoHandler): void {
  if (self.mobileYouTubeLifecycleDebounceTimer === undefined) {
    return;
  }

  clearTimeout(self.mobileYouTubeLifecycleDebounceTimer);
  self.mobileYouTubeLifecycleDebounceTimer = undefined;
}

function closeOverlayMenu(
  overlayView: NonNullable<VideoHandler["uiManager"]["votOverlayView"]>,
): void {
  if (overlayView.votMenu) {
    overlayView.votMenu.hidden = true;
  }
}

function scheduleMobileYouTubeLifecycleRetry(
  self: VideoHandler,
  overlayView: NonNullable<VideoHandler["uiManager"]["votOverlayView"]>,
  reason: string,
  cleanup: () => void,
): void {
  clearMobileYouTubeLifecycleDebounce(self);

  const pageKey = getMobileYouTubePageKey();
  logMobileOverlay("schedule lifecycle retry", {
    reason,
    pageKey,
    delayMs: MOBILE_YOUTUBE_LIFECYCLE_GRACE_MS,
  });

  self.mobileYouTubeLifecycleDebounceTimer = globalThis.setTimeout(() => {
    self.mobileYouTubeLifecycleDebounceTimer = undefined;

    if (self.abortController.signal.aborted) {
      logMobileOverlay("skip lifecycle retry: handler aborted", { reason });
      return;
    }

    const currentPageKey = getMobileYouTubePageKey();
    if (currentPageKey !== pageKey) {
      logMobileOverlay("run lifecycle cleanup after page change", {
        reason,
        pageKey,
        currentPageKey,
      });
      cleanup();
      return;
    }

    const recoveredVideoId = YoutubeHelper.getCurrentVideoId();
    const currentVideoId = self.videoData?.videoId;
    const hasLiveVideoId =
      typeof recoveredVideoId === "string" && recoveredVideoId.length > 0;
    const hasSameVideoId =
      hasLiveVideoId &&
      Boolean(currentVideoId) &&
      recoveredVideoId === currentVideoId;
    const hasSource = Boolean(
      self.video.currentSrc || self.video.src || self.video.srcObject,
    );
    const hasConnectedShell = Boolean(self.container?.isConnected);

    if (hasSameVideoId || hasLiveVideoId || hasSource || hasConnectedShell) {
      logMobileOverlay("keep overlay after lifecycle retry", {
        reason,
        currentVideoId,
        recoveredVideoId,
        hasSource,
        hasConnectedShell,
      });
      closeOverlayMenu(overlayView);
      self.refreshOverlayMount();
      return;
    }

    if (self.site.additionalData === "music") {
      logMobileOverlay("keep overlay for music shell without stable video", {
        reason,
        pageKey,
      });
      closeOverlayMenu(overlayView);
      self.refreshOverlayMount();
      scheduleMobileYouTubeLifecycleRetry(self, overlayView, reason, cleanup);
      return;
    }

    logMobileOverlay("lifecycle retry expired; cleaning up", {
      reason,
      pageKey,
    });
    cleanup();
  }, MOBILE_YOUTUBE_LIFECYCLE_GRACE_MS);
}

function createScopedListeners(signal: AbortSignal): {
  add: ScopedAddListener;
  addMany: ScopedAddListeners;
} {
  const add: ScopedAddListener = (element, event, handler, options) => {
    const mergedSignal = mergeListenerSignals(signal, options?.signal);
    if (!options) {
      element.addEventListener(event, handler, { signal: mergedSignal });
      return;
    }

    const { signal: _ignoredSignal, ...restOptions } = options;
    element.addEventListener(event, handler, {
      ...restOptions,
      signal: mergedSignal,
    });
  };
  const addMany: ScopedAddListeners = (element, events, handler, options) => {
    for (const event of events) {
      add(element, event, handler, options);
    }
  };
  return { add, addMany };
}
function bindOverlayHoverFocusEvents(
  addMany: ScopedAddListeners,
  target: EventTarget,
  overlayVisibility: NonNullable<VideoHandler["overlayVisibility"]>,
): void {
  addMany(target, ["pointerenter", "focusin"], (event) =>
    overlayVisibility.handleOverlayInteraction(event),
  );
  addMany(
    target,
    ["pointermove"],
    (event) => overlayVisibility.handleOverlayInteraction(event),
    { passive: true },
  );
  addMany(target, ["pointerleave", "focusout"], (event) =>
    overlayVisibility.scheduleHide(event),
  );
}
function toPercentInt(value: unknown, fallback = 0): number {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? clampPercentInt(numeric) : fallback;
}
function syncAudioTranslationVolumeFromVideo(
  self: VideoHandler,
  videoPercent: number,
  options: {
    skipYouTubeLikeHosts?: boolean;
  } = {},
): void {
  if (options.skipYouTubeLikeHosts && isYouTubeLikeHost(self.site.host)) {
    return;
  }
  // While smart ducking is active, the script drives video volume itself.
  // Ignore observer-driven sync to avoid feedback loops/jitter.
  if (self.smartVolumeDuckingInterval !== undefined) return;
  if (!self.data?.syncVolume || !self.audioPlayer?.player?.src) return;
  if (self.isLikelyInternalVideoVolumeChange(videoPercent)) return;
  self.syncVolumeWrapper("video", videoPercent);
}
function applyOverlayLayout(
  self: VideoHandler,
  overlayView: NonNullable<VideoHandler["uiManager"]["votOverlayView"]>,
  heightPx?: number,
): void {
  const menu = overlayView.votMenu?.container;
  if (menu) {
    const height = heightPx ?? self.video.getBoundingClientRect().height;
    menu.style.setProperty("--vot-container-height", `${height}px`);
  }
  const { position, direction } = overlayView.calcButtonLayout(
    self.data?.buttonPos ?? "default",
  );
  overlayView.updateButtonLayout(position, direction);
}
type ParsedHotkey = {
  parts: readonly string[];
  partsSet: ReadonlySet<string>;
};
function normalizeHotkeyPart(value: string): string {
  return value.replace("Key", "").replace("Digit", "");
}
function buildPressedHotkeyPartsSet(
  userPressedKeys: Iterable<string>,
): Set<string> {
  const pressedParts = new Set<string>();
  for (const key of userPressedKeys) {
    pressedParts.add(normalizeHotkeyPart(key));
  }
  return pressedParts;
}
function getParsedHotkey(
  hotkey: string | null | undefined,
  cache: Map<string, ParsedHotkey>,
): ParsedHotkey | null {
  if (!hotkey) return null;
  const cached = cache.get(hotkey);
  if (cached) return cached;
  const parts = hotkey.split("+").filter(Boolean).map(normalizeHotkeyPart);
  const parsed: ParsedHotkey = {
    parts,
    partsSet: new Set(parts),
  };
  cache.set(hotkey, parsed);
  return parsed;
}
function isHotkeyMatch(
  pressedParts: ReadonlySet<string>,
  hotkey: ParsedHotkey | null,
): boolean {
  if (!hotkey) return false;
  if (pressedParts.size !== hotkey.parts.length) return false;
  for (const key of hotkey.partsSet) {
    if (!pressedParts.has(key)) return false;
  }
  return true;
}
function bindOverlayLayoutEvents(ctx: ExtraEventsContext): void {
  const { self, overlayView, addMany } = ctx;
  const syncMountAndLayout = () => {
    self.refreshOverlayMount();
    applyOverlayLayout(self, overlayView);
  };
  self.resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      applyOverlayLayout(self, overlayView, entry.contentRect.height);
    }
  });
  self.resizeObserver.observe(self.video);
  syncMountAndLayout();
  addMany(document, ["fullscreenchange", "webkitfullscreenchange"], () =>
    syncMountAndLayout(),
  );
  addMany(self.video, ["webkitbeginfullscreen", "webkitendfullscreen"], () =>
    syncMountAndLayout(),
  );

  if (isMobileYouTubeLikeSite(self.site)) {
    let syncQueued = false;
    const queueSyncMountAndLayout = () => {
      if (syncQueued) {
        return;
      }

      syncQueued = true;
      queueMicrotask(() => {
        syncQueued = false;

        if (self.abortController.signal.aborted) {
          return;
        }

        const containerStale =
          !self.container.isConnected ||
          !self.video.isConnected ||
          (self.video.isConnected &&
            !containsCrossShadow(self.container, self.video));
        if (!containerStale) {
          return;
        }

        logMobileOverlay("sync mount after DOM repaint", {
          containerConnected: self.container.isConnected,
          videoConnected: self.video.isConnected,
        });
        syncMountAndLayout();
      });
    };

    self.overlayMountObserver = new MutationObserver(() => {
      queueSyncMountAndLayout();
    });
    self.overlayMountObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    addMany(document, ["yt-page-data-updated", "yt-navigate-finish"], () =>
      queueSyncMountAndLayout(),
    );
  }
}
function bindYouTubeVolumeSync(ctx: ExtraEventsContext): void {
  const { self } = ctx;
  if (!isDesktopYouTubeLikeSite(self.site)) return;
  self.syncVolumeObserver = new MutationObserver((mutations) => {
    if (!self.audioPlayer?.player?.src) return;
    let hasVolumeMutation = false;
    let lastObservedAriaValue: number | null = null;
    for (const mutation of mutations) {
      if (
        mutation.type !== "attributes" ||
        mutation.attributeName !== "aria-valuenow"
      ) {
        continue;
      }
      hasVolumeMutation = true;
      const ariaValueNow =
        mutation.target instanceof Element
          ? mutation.target.getAttribute("aria-valuenow")
          : null;
      const parsedAriaValue =
        ariaValueNow != null ? Number.parseFloat(ariaValueNow) : Number.NaN;
      if (Number.isFinite(parsedAriaValue)) {
        lastObservedAriaValue = parsedAriaValue;
      }
    }
    if (!hasVolumeMutation) return;
    let videoPercent: number;
    if (lastObservedAriaValue != null) {
      videoPercent = toPercentInt(lastObservedAriaValue);
    } else {
      const fallbackVolume = self.isMuted() ? 0 : self.getVideoVolume();
      videoPercent = toPercentInt(fallbackVolume * 100);
    }
    self.syncVideoVolumeSlider();
    syncAudioTranslationVolumeFromVideo(self, videoPercent);
  });
  const ytpVolumePanel = document.querySelector(".ytp-volume-panel");
  if (!ytpVolumePanel) return;
  self.syncVolumeObserver.observe(ytpVolumePanel, {
    attributes: true,
    subtree: true,
    attributeFilter: ["aria-valuenow"],
  });
}
function bindAudioTrackLanguageSync(ctx: ExtraEventsContext): void {
  const { self } = ctx;
  if (!isDesktopYouTubeLikeSite(self.site)) return;
  const syncAudioTrackLanguage = async () => {
    try {
      if (!self.videoData) return;
      const player = YoutubeHelper.getPlayer();
      const availableTracks = player?.getAvailableAudioTracks?.() ?? null;
      if (!Array.isArray(availableTracks) || availableTracks.length <= 1)
        return;
      const currentTrackInfo = player?.getAudioTrack?.()?.getLanguageInfo?.();
      const currentTrackId = currentTrackInfo?.id;
      const currentLanguageCode =
        currentTrackId && currentTrackId !== "und"
          ? currentTrackId.toLowerCase().split(/[-_.]/)[0]
          : undefined;
      if (!currentLanguageCode) return;
      if (!availableLangs.includes(currentLanguageCode as RequestLang)) return;
      const currentLanguage = currentLanguageCode as RequestLang;
      if (currentLanguage === self.videoData.detectedLanguage) return;
      self.videoManager.rememberDetectedLanguage(
        self.videoData.videoId,
        currentLanguage,
      );
      self.setSelectMenuValues(
        currentLanguage,
        self.videoData.responseLanguage,
      );
      if (
        self.data?.autoTranslate &&
        currentLanguage !== self.videoData.responseLanguage
      ) {
        debug.log(
          `[VOT] Audio track language changed to ${currentLanguage}, triggering auto-translation`,
        );
        try {
          await self.uiManager.handleTranslationBtnClick();
        } catch (error) {
          debug.log(
            "[VOT] Failed to trigger auto-translation on audio track change:",
            error,
          );
        }
      }
    } catch (error) {
      debug.log("[VOT] Failed to sync audio track language", error);
    }
  };
  const player = YoutubeHelper.getPlayer();
  const listeners = ["onApiChange", "onStateChange"] as const;
  if (player?.addEventListener) {
    for (const eventName of listeners) {
      try {
        player.addEventListener(eventName, syncAudioTrackLanguage);
      } catch (error) {
        debug.log(`[VOT] Failed to bind ${eventName}`, error);
      }
    }
  }
  void syncAudioTrackLanguage();
  self.abortController.signal.addEventListener(
    "abort",
    () => {
      if (!player?.removeEventListener) return;
      for (const eventName of listeners) {
        try {
          player.removeEventListener(eventName, syncAudioTrackLanguage);
        } catch (error) {
          debug.log(`[VOT] Failed to unbind ${eventName}`, error);
        }
      }
    },
    { once: true },
  );
}
function bindGlobalDismissAndHotkeys(ctx: ExtraEventsContext): void {
  const { self, overlayView, add, addMany, platformConfig } = ctx;
  add(document, "click", (event) => {
    const target = event.target as Node | null;
    const button = overlayView.votButton?.container;
    const menu = overlayView.votMenu?.container;
    const settings = self.uiManager.votSettingsView?.dialog?.container;
    const isButton = target && button ? button.contains(target) : false;
    const isMenu = target && menu ? menu.contains(target) : false;
    const isVideo = target ? self.container.contains(target) : false;
    const isSettings = target && settings ? settings.contains(target) : false;
    const isTempDialog =
      target instanceof Element &&
      target.closest(".vot-dialog-temp") instanceof Element;
    debug.log(
      `[document click] ${isButton} ${isMenu} ${isVideo} ${isSettings} ${isTempDialog}`,
    );
    if (isButton || isMenu || isSettings || isTempDialog) return;
    if (
      !isVideo &&
      !isVkLikeSiteHost(self.site.host) &&
      !isMobileYouTubeLikeSite(self.site)
    ) {
      overlayView.updateButtonOpacity(0);
    }
    if (menu && !menu.hidden) {
      menu.hidden = true;
      self.overlayVisibility?.queueAutoHide();
    }
  });
  const userPressedKeys = new Set<string>();
  const hotkeyCache = new Map<string, ParsedHotkey>();
  const clearUserPressedKeys = () => userPressedKeys.clear();
  const runHotkeyAction = (
    action: () => Promise<unknown>,
    actionName: string,
  ) => {
    void action().catch((error) => {
      debug.log(`[VOT] ${actionName} hotkey action failed`, error);
    });
  };
  add(document, "keydown", (event) => {
    const keyboardEvent = event as KeyboardEvent;
    if (keyboardEvent.repeat) return;
    userPressedKeys.add(keyboardEvent.code);
    const activeElement = document.activeElement as HTMLElement | null;
    const activeTag = activeElement?.tagName?.toLowerCase?.() ?? "";
    const isInputElement =
      ["input", "textarea"].includes(activeTag) ||
      Boolean(activeElement?.isContentEditable);
    if (isInputElement) return;
    const pressedParts = buildPressedHotkeyPartsSet(userPressedKeys);
    if (
      isHotkeyMatch(
        pressedParts,
        getParsedHotkey(self.data?.translationHotkey, hotkeyCache),
      )
    ) {
      clearUserPressedKeys();
      runHotkeyAction(
        () => self.uiManager.handleTranslationBtnClick(),
        "Translation",
      );
      return;
    }
    if (
      isHotkeyMatch(
        pressedParts,
        getParsedHotkey(self.data?.subtitlesHotkey, hotkeyCache),
      )
    ) {
      clearUserPressedKeys();
      runHotkeyAction(
        () => self.toggleSubtitlesForCurrentLangPair(),
        "Subtitles",
      );
    }
  });
  add(document, "keyup", (event) =>
    userPressedKeys.delete((event as KeyboardEvent).code),
  );
  add(document, "blur", clearUserPressedKeys);
  add(document, "visibilitychange", () => {
    if (document.hidden) clearUserPressedKeys();
  });
  add(globalThis, "blur", clearUserPressedKeys);
  const hostInteractionTargets = new Set<EventTarget>();
  const eventContainer = self.getEventContainer();
  if (eventContainer) {
    hostInteractionTargets.add(eventContainer);
  }
  hostInteractionTargets.add(self.container);
  hostInteractionTargets.add(self.video);
  for (const target of hostInteractionTargets) {
    addMany(target, ["pointerenter", "pointerdown"], (event) =>
      self.overlayVisibility.handleHostInteraction(event),
    );
    if (isMobileYouTubeLikeSite(self.site)) {
      addMany(
        target,
        ["touchstart"],
        (event) => self.overlayVisibility.handleHostInteraction(event),
        { passive: true },
      );
    }
    add(
      target,
      "pointermove",
      (event) => self.overlayVisibility.handleHostInteraction(event),
      { passive: true },
    );
    add(target, "pointerleave", (event) =>
      self.overlayVisibility.scheduleHide(event),
    );
  }
  self.rebindOverlayVisibilityTargets();
  if (platformConfig.allowTouchMoveHandler) {
    add(
      document,
      "touchmove",
      (event) => self.overlayVisibility.handleHostInteraction(event),
      { passive: true },
    );
  }
  if (isMobileYouTubeLikeSite(self.site)) {
    // Mobile/music YouTube can dispatch taps through transient SPA/player shells
    // that fall outside the tracked video container. Listen at document level so
    // a tap can reliably re-show the page-scoped overlay after idle auto-hide.
    add(
      document,
      "touchstart",
      (event) => self.overlayVisibility.handleHostInteraction(event),
      { passive: true, capture: true },
    );
  }
  if (platformConfig.disableContainerDrag) {
    self.container.draggable = false;
  }
}
function bindVideoLifecycleEvents(ctx: ExtraEventsContext): void {
  const { self, overlayView, add } = ctx;
  const safeSetCanPlay = async () => {
    try {
      await self.setCanPlay();
    } catch (err) {
      debug.log("[VOT] setCanPlay() failed", err);
    }
  };
  let setCanPlayQueued = false;
  const queueSetCanPlay = () => {
    if (setCanPlayQueued) return;
    setCanPlayQueued = true;
    queueMicrotask(async () => {
      setCanPlayQueued = false;
      await safeSetCanPlay();
    });
  };
  add(self.video, "canplay", () => {
    if (self.site.host === "rutube" && self.video.src) return;
    queueSetCanPlay();
  });
  for (const eventName of [
    "loadedmetadata",
    "loadeddata",
    "play",
    "playing",
  ] as const) {
    // Some hosts expose audio metadata only after the first user-initiated
    // playback or after a later metadata repaint. Re-run the lifecycle check so
    // the button can move from the temporary disabled state back to normal.
    add(self.video, eventName, () => {
      if (eventName === "play" || eventName === "playing") {
        console.log("[VOT][source-audio] play event received", {
          eventName,
          host: self.site.host,
          paused: self.video.paused,
          currentTime: Number(self.video.currentTime.toFixed(3)),
          readyState: self.video.readyState,
          src: self.video.currentSrc || self.video.src || "",
        });
        const sourceAudioState = self.syncSourceAudioAvailabilityUi({
          forceVisible: true,
        });
        if (
          sourceAudioState.ready &&
          self.data?.autoTranslate &&
          self.firstPlay &&
          !self.hasActiveSource()
        ) {
          console.log(
            "[VOT][source-audio] retry auto-translate after playback",
            {
              eventName,
              kind: sourceAudioState.kind,
              audioDetected: sourceAudioState.audioDetected,
              detectionSource: sourceAudioState.detectionSource,
            },
          );
          void self.translationOrchestrator
            .runAutoTranslationIfEligible()
            .catch((error) => {
              debug.log(
                "[VOT] Failed to retry auto-translate after playback start",
                error,
              );
            });
        }
      }
      queueSetCanPlay();
    });
  }
  const handleVideoEmptied = async () => {
    let videoId: string | undefined;
    try {
      videoId =
        self.site.host === "youtube" &&
        isMobileYouTubeAdditionalData(self.site.additionalData)
          ? YoutubeHelper.getCurrentVideoId()
          : await getVideoID(self.site, {
              fetchFn: GM_fetch,
              video: self.video,
            });
    } catch (error) {
      debug.log("[VOT] Failed to resolve video id on emptied", error);
    }
    if (self.videoData && videoId && videoId === self.videoData.videoId) {
      // Quality changes can trigger media reload (`emptied`) for the same
      // logical video. Keep translation state intact in this case.
      return;
    }
    if (self.site.host === "custom" && getTunnelPlayerContext()) {
      debug.log("[VOT][custom][tunnel] ignore video emptied");
      return;
    }
    debug.log("lipsync mode is emptied");
    if (isMobileYouTubeLikeSite(self.site)) {
      logMobileOverlay("video emptied; start grace period", {
        currentVideoId: self.videoData?.videoId,
        resolvedVideoId: videoId,
        pageKey: getMobileYouTubePageKey(),
      });
      resetLifecycleTranslation(self, {
        clearVideoData: true,
      });
      closeOverlayMenu(overlayView);
      scheduleMobileYouTubeLifecycleRetry(
        self,
        overlayView,
        "video-emptied",
        () => {
          resetAndHideLifecycle(self, overlayView, {
            clearVideoData: true,
            hideMenu: true,
          });
        },
      );
      return;
    }
    resetAndHideLifecycle(self, overlayView, {
      clearVideoData: true,
      hideMenu: true,
    });
  };
  add(self.video, "emptied", () => {
    void handleVideoEmptied().catch((error) => {
      debug.log("[VOT] Failed to handle emptied lifecycle event", error);
    });
  });
  if (!isMuteSyncDisabledHost(self.site.host)) {
    add(self.video, "volumechange", () => {
      self.syncVideoVolumeSlider();
      const activeOverlayView = self.uiManager.votOverlayView;
      if (!activeOverlayView?.isInitialized()) return;
      const videoPercent = toPercentInt(
        activeOverlayView.videoVolumeSlider.value,
      );
      syncAudioTranslationVolumeFromVideo(self, videoPercent, {
        skipYouTubeLikeHosts: true,
      });
    });
  }
  if (self.site.host === "youtube" && !self.site.additionalData) {
    add(document, "yt-page-data-updated", () => {
      debug.log("yt-page-data-updated");
      if (!globalThis.location.pathname.startsWith("/shorts/")) return;
      queueSetCanPlay();
    });
  }
}
export function initExtraEvents(this: VideoHandler) {
  const overlayView = this.uiManager.votOverlayView;
  if (!overlayView?.subtitlesSelect) return;
  const { add, addMany } = createScopedListeners(this.abortController.signal);
  const ctx: ExtraEventsContext = {
    self: this,
    overlayView,
    platformConfig: getPlatformEventConfig(this.site.host),
    add,
    addMany,
  };
  bindOverlayLayoutEvents(ctx);
  bindYouTubeVolumeSync(ctx);
  bindAudioTrackLanguageSync(ctx);
  bindGlobalDismissAndHotkeys(ctx);
  bindVideoLifecycleEvents(ctx);
}
export function rebindOverlayVisibilityTargets(this: VideoHandler) {
  this.overlayVisibilityTargetsAbortController?.abort();
  this.overlayVisibilityTargetsAbortController = new AbortController();
  const { signal } = this.overlayVisibilityTargetsAbortController;
  const overlayButton = this.uiManager?.votOverlayView?.votButton?.container;
  const overlayMenu = this.uiManager?.votOverlayView?.votMenu?.container;
  if (!overlayButton || !overlayMenu || !this.overlayVisibility) return;
  const overlayVisibility = this.overlayVisibility;
  const { addMany } = createScopedListeners(signal);
  bindOverlayHoverFocusEvents(addMany, overlayButton, overlayVisibility);
  bindOverlayHoverFocusEvents(addMany, overlayMenu, overlayVisibility);
}
export function isOverlayInteractiveNode(
  this: VideoHandler,
  node: unknown,
): boolean {
  if (!(node instanceof Node)) return false;
  const overlayView = this.uiManager?.votOverlayView;
  const buttonContainer = overlayView?.votButton?.container;
  const menuContainer = overlayView?.votMenu?.container;
  return (
    (buttonContainer instanceof Node && buttonContainer.contains(node)) ||
    (menuContainer instanceof Node && menuContainer.contains(node))
  );
}
export function getAutoHideDelay(this: VideoHandler): number {
  if (isVkLikeSiteHost(this.site.host)) {
    return 60_000;
  }

  const delay = this.data?.autoHideButtonDelay;
  const resolvedDelay =
    typeof delay === "number" && Number.isFinite(delay)
      ? delay
      : defaultAutoHideDelay;

  if (isMobileYouTubeLikeSite(this.site)) {
    // Mobile/music YouTube has no hover affordance, so a 1s hide deadline feels
    // too abrupt after a tap. Keep the global setting, but enforce a gentler
    // minimum so the page-scoped button remains usable on touch screens.
    return Math.max(resolvedDelay, MOBILE_YOUTUBE_MIN_AUTO_HIDE_DELAY_MS);
  }

  return resolvedDelay;
}
export function releaseExtraEvents(this: VideoHandler) {
  clearMobileYouTubeLifecycleDebounce(this);
  logMobileOverlay("release extra events / disconnect observers", {
    hasResizeObserver: Boolean(this.resizeObserver),
    hasOverlayMountObserver: Boolean(this.overlayMountObserver),
    hasSyncVolumeObserver: Boolean(this.syncVolumeObserver),
  });
  this.resizeObserver?.disconnect();
  this.overlayVisibilityTargetsAbortController?.abort();
  this.overlayVisibilityTargetsAbortController = undefined;
  this.overlayMountObserver?.disconnect();
  this.overlayMountObserver = undefined;
  if (isDesktopYouTubeLikeSite(this.site)) {
    this.syncVolumeObserver?.disconnect();
  }
}
