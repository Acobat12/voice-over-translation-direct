export function installYandexDiskOverlayPatch(): void {
  let patchedHost: Element | null = null;
  let hideTimer: number | null = null;
  const IDLE_TIME = 3000;

  const clearHideTimer = () => {
    if (hideTimer !== null) {
      window.clearTimeout(hideTimer);
      hideTimer = null;
    }
  };

  const showButton = () => {
    const overlay = document.querySelector<HTMLElement>(
      ".vot-segmented-button",
    );
    if (!overlay) return;

    overlay.hidden = false;
    overlay.removeAttribute("hidden");
    overlay.style.opacity = "1";
    overlay.classList.remove("vot-segmented-button--hidden");

    clearHideTimer();
    hideTimer = window.setTimeout(() => {
      const currentOverlay = document.querySelector<HTMLElement>(
        ".vot-segmented-button",
      );
      if (!currentOverlay) return;

      currentOverlay.style.opacity = "0";
      currentOverlay.classList.add("vot-segmented-button--hidden");
    }, IDLE_TIME);
  };

  const patchHost = () => {
    const video = document.querySelector("video");
    if (!video) return;

    const host =
      video.closest('[class*="player"], [class*="video"], main, article') ||
      video.parentElement ||
      video;

    if (!host || host === patchedHost) return;

    patchedHost = host;

    const activityHandler = () => showButton();

    host.addEventListener("mouseenter", activityHandler, { passive: true });
    host.addEventListener("mousemove", activityHandler, { passive: true });
    host.addEventListener("pointerenter", activityHandler, { passive: true });
    host.addEventListener("pointermove", activityHandler, { passive: true });

    showButton();
  };

  patchHost();

  const observer = new MutationObserver(() => {
    patchHost();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
}
