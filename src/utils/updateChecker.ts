/** Update discovery for manually installed VOT builds. Never installs code automatically. */
import { browserInfo } from "./browserInfo";

const RELEASES_API =
  "https://api.github.com/repos/Acobat12/voice-over-translation-direct/releases/latest";
export const RELEASES_PAGE =
  "https://github.com/Acobat12/voice-over-translation-direct/releases/latest";

export type UpdatePlatform = "chrome" | "firefox" | "safari" | "userscript";
export type UpdateAsset = { name: string; url: string };
export type UpdateResult = {
  version: string;
  assets: UpdateAsset[];
  releaseUrl: string;
  complete: boolean;
};

export function getUpdatePlatform(): UpdatePlatform {
  const handler = typeof GM_info === "undefined" ? "" : GM_info?.scriptHandler;
  if (handler !== "VOT Extension")
    return browserInfo.browser?.name === "Safari" ? "safari" : "userscript";
  return browserInfo.browser?.name === "Firefox" ? "firefox" : "chrome";
}

export function isNewerVersion(remote: string, installed: string): boolean {
  const parse = (value: string) => {
    const match = /^v?(\d+(?:\.\d+)*)$/.exec(value.trim());
    return match ? match[1].split(".").map(Number) : undefined;
  };
  const a = parse(remote);
  const b = parse(installed);
  if (!a || !b) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

export async function checkForUpdate(
  installed: string,
  platform: UpdatePlatform,
): Promise<UpdateResult | undefined> {
  const response = await fetch(RELEASES_API, {
    headers: { Accept: "application/vnd.github+json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`GitHub HTTP ${response.status}`);
  const release: unknown = await response.json();
  if (!release || typeof release !== "object")
    throw new Error("Invalid GitHub release response");
  const data = release as Record<string, unknown>;
  const version = typeof data.tag_name === "string" ? data.tag_name : "";
  if (!isNewerVersion(version, installed)) return;
  const rawAssets = Array.isArray(data.assets) ? data.assets : [];
  const assets: UpdateAsset[] = rawAssets.flatMap((item: unknown) => {
    if (!item || typeof item !== "object") return [];
    const asset = item as Record<string, unknown>;
    if (
      typeof asset.name !== "string" ||
      typeof asset.browser_download_url !== "string"
    )
      return [];
    if (
      !asset.browser_download_url.startsWith(
        "https://github.com/Acobat12/voice-over-translation-direct/releases/download/",
      )
    )
      return [];
    return [{ name: asset.name, url: asset.browser_download_url }];
  });
  const filtered = assets.filter(({ name }) => {
    if (platform === "chrome")
      return /chrome|chromium/i.test(name) && /\.zip$/i.test(name);
    if (platform === "firefox")
      return /firefox/i.test(name) && /\.(?:xpi|zip)$/i.test(name);
    if (platform === "safari") return name === "vot-safari.user.zip";
    return /\.user\.js$/i.test(name);
  });
  return {
    version,
    assets: filtered,
    releaseUrl:
      typeof data.html_url === "string" &&
      data.html_url.startsWith(
        "https://github.com/Acobat12/voice-over-translation-direct/releases/",
      )
        ? data.html_url
        : RELEASES_PAGE,
    complete: filtered.length >= 1,
  };
}
