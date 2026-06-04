import type { ServiceConf } from "@vot.js/ext/types/service";
import {
  isDesktopYouTubeLikeSite,
  isMobileYouTubeLikeSite,
} from "./hostPolicies";

export type OverlayMountTargets = {
  base: HTMLElement;
  root: HTMLElement;
  portalContainer: HTMLElement;
  subtitlesMountContainer: HTMLElement;
};

const MOBILE_YOUTUBE_OVERLAY_ROOT_ATTR = "data-vot-mobile-youtube-overlay-root";

function getPersistentOverlayHost(): HTMLElement {
  return document.body ?? document.documentElement;
}

function getPersistentMobileYouTubeOverlayRoot(site: ServiceConf): HTMLElement {
  const attrValue = site.additionalData === "music" ? "music" : "mobile";
  const host = getPersistentOverlayHost();
  let root = document.querySelector<HTMLElement>(
    `[${MOBILE_YOUTUBE_OVERLAY_ROOT_ATTR}="${attrValue}"]`,
  );

  if (!root) {
    root = document.createElement("vot-block");
    root.setAttribute(MOBILE_YOUTUBE_OVERLAY_ROOT_ATTR, attrValue);
    root.style.position = "fixed";
    root.style.left = "0";
    root.style.top = "0";
    root.style.width = "100vw";
    root.style.height = "100vh";
    root.style.margin = "0";
    root.style.padding = "0";
    root.style.border = "0";
    root.style.background = "transparent";
    root.style.overflow = "visible";
    root.style.pointerEvents = "none";
    root.style.zIndex = "2147483645";
    host.appendChild(root);
  } else if (root.parentElement !== host) {
    host.appendChild(root);
  }

  // Firefox Android mobile/music YouTube rebuilds the `ytm-*` player shell and
  // can temporarily report zero-sized player containers during route updates.
  // Keep the widget in a page-scoped fixed root, similar to popup/yandexdisk
  // behavior, so button/menu visibility does not depend on player DOM stability.
  return root;
}

export function resolveOverlayBaseContainer(
  container: HTMLElement,
  site: ServiceConf,
): HTMLElement {
  if (container instanceof HTMLVideoElement) {
    return container.parentElement ?? container;
  }

  return isDesktopYouTubeLikeSite(site)
    ? (container.parentElement ?? container)
    : container;
}

export function resolveOverlayMountTargets(input: {
  container: HTMLElement;
  site: ServiceConf;
  fullscreenRoot: HTMLElement | null;
}): OverlayMountTargets {
  const base = resolveOverlayBaseContainer(input.container, input.site);
  const stableMobileYouTubeRoot =
    !input.fullscreenRoot && isMobileYouTubeLikeSite(input.site)
      ? getPersistentMobileYouTubeOverlayRoot(input.site)
      : null;
  const root = input.fullscreenRoot ?? stableMobileYouTubeRoot ?? base;
  const shouldUseViewportSubtitlesMount =
    input.site.host === "youtube" && input.site.additionalData === "music";
  const subtitlesMountContainer =
    input.site.host === "googledrive"
      ? (input.fullscreenRoot ?? document.body)
      : input.site.host === "vk"
        ? (input.fullscreenRoot ?? document.documentElement)
        : shouldUseViewportSubtitlesMount
          ? root
          : stableMobileYouTubeRoot
            ? base
            : root;

  return {
    base,
    root,
    portalContainer: stableMobileYouTubeRoot ?? base,
    subtitlesMountContainer,
  };
}
