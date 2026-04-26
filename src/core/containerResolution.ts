import { closestCrossShadow, containsCrossShadow } from "../utils/dom";

function promoteVideoElementContainer(
  matched: HTMLElement,
  video: HTMLVideoElement,
): HTMLElement {
  if (matched !== video) {
    return matched;
  }

  let parent = video.parentElement;
  while (parent) {
    if (parent !== document.body && parent !== document.documentElement) {
      return parent;
    }
    parent = parent.parentElement;
  }

  return matched;
}

export function findConnectedContainerBySelector(
  video: HTMLVideoElement,
  selector?: string,
): HTMLElement | null {
  if (!selector) {
    return null;
  }

  const matched = closestCrossShadow(video, selector);
  if (
    matched instanceof HTMLElement &&
    matched.isConnected &&
    containsCrossShadow(matched, video)
  ) {
    return promoteVideoElementContainer(matched, video);
  }

  return null;
}
