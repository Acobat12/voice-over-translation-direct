export type LifecycleTranslationResetHost = {
  videoData?: unknown;
  stopTranslation(): void | Promise<void>;
  resetSubtitlesWidget(): void;
};

export type LifecycleOverlayViewLike = {
  votButton?: {
    container?: {
      hidden: boolean;
    };
  };
  votMenu?: {
    hidden: boolean;
  };
};

function isMobileYouTubeDebugHost(): boolean {
  return /^(m|music)\.youtube\.com$/i.test(
    String(globalThis.location.hostname || ""),
  );
}

function logMobileOverlayLifecycle(message: string, details?: unknown): void {
  if (!isMobileYouTubeDebugHost()) {
    return;
  }

  console.log(`[VOT][mobile-overlay][lifecycle] ${message}`, details ?? {});
}

export function resetLifecycleTranslation(
  host: LifecycleTranslationResetHost,
  options: {
    requireVideoData?: boolean;
    clearVideoData?: boolean;
  } = {},
): void {
  const { requireVideoData = false, clearVideoData = false } = options;

  if (requireVideoData && !host.videoData) {
    logMobileOverlayLifecycle("skip translation reset: no videoData", {
      requireVideoData,
      clearVideoData,
    });
    return;
  }

  logMobileOverlayLifecycle("reset translation state", {
    requireVideoData,
    clearVideoData,
    hadVideoData: Boolean(host.videoData),
  });

  if (clearVideoData) {
    host.videoData = undefined;
  }

  host.stopTranslation();
  host.resetSubtitlesWidget();
}

export function hideLifecycleOverlay(
  overlayView: LifecycleOverlayViewLike | null | undefined,
  options: {
    hideMenu?: boolean;
  } = {},
): void {
  const { hideMenu = false } = options;

  logMobileOverlayLifecycle("hide overlay", {
    hideMenu,
  });

  if (overlayView?.votButton?.container) {
    overlayView.votButton.container.hidden = true;
  }

  if (hideMenu && overlayView?.votMenu) {
    overlayView.votMenu.hidden = true;
  }
}

export function resetAndHideLifecycle(
  host: LifecycleTranslationResetHost,
  overlayView: LifecycleOverlayViewLike | null | undefined,
  options: {
    requireVideoData?: boolean;
    clearVideoData?: boolean;
    hideMenu?: boolean;
  } = {},
): void {
  const { requireVideoData, clearVideoData, hideMenu } = options;
  logMobileOverlayLifecycle("reset and hide lifecycle", {
    requireVideoData,
    clearVideoData,
    hideMenu,
  });
  resetLifecycleTranslation(host, {
    requireVideoData,
    clearVideoData,
  });
  hideLifecycleOverlay(overlayView, { hideMenu });
}
