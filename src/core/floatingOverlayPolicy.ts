export function isTopPageFloatingOverlayHost(): boolean {
  if (globalThis.window !== globalThis.top) return false;

  const visited = new Set<Document>();
  const containsPlayer = (doc: Document, depth: number): boolean => {
    if (depth > 5 || visited.has(doc)) return false;
    visited.add(doc);
    return [...doc.querySelectorAll("iframe")].some((iframe) => {
      const src = iframe.getAttribute("src") ?? "";
      if (src.includes("youtube.googleapis.com/embed")) return true;
      try {
        const child = iframe.contentDocument;
        return child ? containsPlayer(child, depth + 1) : false;
      } catch {
        return false;
      }
    });
  };
  return containsPlayer(document, 0);
}

export function isYoutubeEmbedIframeContext(): boolean {
  return (
    globalThis.window !== globalThis.top &&
    globalThis.location.host === "youtube.googleapis.com" &&
    globalThis.location.pathname.startsWith("/embed")
  );
}
