export type StructuredVideoData = {
  contentUrl?: string;
  embedUrl?: string;
  pageUrl?: string;
  title?: string;
};

export function getStructuredVideoData(): StructuredVideoData | null {
  const scripts = Array.from(
    document.querySelectorAll('script[type="application/ld+json"]'),
  );

  for (const script of scripts) {
    const raw = script.textContent?.trim();
    if (!raw) continue;

    try {
      const parsed = JSON.parse(raw);
      const items = Array.isArray(parsed) ? parsed : [parsed];

      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        if (item["@type"] !== "VideoObject") continue;

        return {
          contentUrl:
            typeof item.contentUrl === "string" ? item.contentUrl : undefined,
          embedUrl:
            typeof item.embedUrl === "string" ? item.embedUrl : undefined,
          pageUrl:
            typeof item.url === "string" ? item.url : undefined,
          title:
            typeof item.name === "string" ? item.name : undefined,
        };
      }
    } catch {
      // ignore broken JSON-LD
    }
  }

  return null;
}