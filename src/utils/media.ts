/** Optional client capability; upstream versions can omit this method. */
export function isDirectMediaUrl(client: object, url: string): boolean {
  try {
    const check = Reflect.get(client, "isDirectMediaUrl");
    return typeof check === "function" && Boolean(check.call(client, url));
  } catch {
    return false;
  }
}

export function hasResolvableMediaSource(video: HTMLVideoElement): boolean {
  if (video.currentSrc || video.src || video.srcObject) {
    return true;
  }

  const source = video.querySelector("source");
  return Boolean(source?.getAttribute("src") || source?.src);
}

/** Find the largest visible video that is already playing in the viewport. */
export function findActivePlaybackVideo(): HTMLVideoElement | undefined {
  return Array.from(
    document.querySelectorAll<HTMLVideoElement>(
      "video.html5-main-video, .html5-video-container video, video",
    ),
  )
    .filter((candidate) => {
      if (candidate.paused || candidate.ended) return false;
      if (candidate.readyState < HTMLMediaElement.HAVE_CURRENT_DATA)
        return false;

      const rect = candidate.getBoundingClientRect();
      return (
        rect.width > 80 &&
        rect.height > 80 &&
        rect.bottom > 0 &&
        rect.top < globalThis.innerHeight
      );
    })
    .sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return br.width * br.height - ar.width * ar.height;
    })[0];
}
