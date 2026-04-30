export function isTopPageFloatingOverlayHost(): boolean {
  if (globalThis !== globalThis.top) return false;

  return [...document.querySelectorAll("iframe")].some((iframe) => {
    const src = iframe.getAttribute("src") ?? "";
    return src.includes("youtube.googleapis.com/embed");
  });
}

export function isYoutubeEmbedIframeContext(): boolean {
  return (
    globalThis !== globalThis.top &&
    globalThis.location.host === "youtube.googleapis.com" &&
    globalThis.location.pathname.startsWith("/embed")
  );
}
