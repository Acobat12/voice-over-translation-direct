import { isVkSupportedPageHost } from "../core/vkVideoTarget";

export function isMobileYouTubePage(
  hostname = globalThis.location?.hostname ?? "",
): boolean {
  return /^(m|music)\.youtube\.com$/i.test(String(hostname));
}

export function isVkPage(
  hostname = globalThis.location?.hostname ?? "",
): boolean {
  return isVkSupportedPageHost(hostname);
}

export function getPageKey(
  page: Pick<Location, "origin" | "pathname" | "search"> = globalThis.location,
): string {
  return `${page.origin}${page.pathname}${page.search}`;
}

export function normalizePageUrl(input: string, baseUrl?: string): string {
  try {
    return new URL(input, baseUrl ?? globalThis.location.href).href;
  } catch {
    return input;
  }
}
