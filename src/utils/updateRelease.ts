import { isNewerVersion } from "./updateVersion";
export type UpdatePlatform = "chrome" | "firefox" | "safari" | "userscript";
export type UpdateAsset = { name: string; url: string };
export type UpdateResult = {
  version: string;
  assets: UpdateAsset[];
  releaseUrl: string;
  complete: boolean;
};

export function parseUpdateRelease(
  release: unknown,
  installed: string,
  platform: UpdatePlatform,
  RELEASES_PAGE: string,
): UpdateResult | undefined {
  if (!release || typeof release !== "object" || Array.isArray(release))
    throw new Error("Invalid GitHub release response");
  const data = release as Record<string, unknown>;
  const version = typeof data.tag_name === "string" ? data.tag_name : "";
  if (!isNewerVersion(version, installed)) return;
  if (!Array.isArray(data.assets))
    throw new Error("Invalid GitHub release assets");
  const rawAssets = data.assets;
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
      return /chrome|chromium|edge/i.test(name) && /\.zip$/i.test(name);
    if (platform === "firefox")
      return /firefox/i.test(name) && /\.(?:xpi|zip)$/i.test(name);
    if (platform === "safari") return name === "vot-safari.user.zip";
    return /\.user\.js$/i.test(name) && !/safari/i.test(name);
  });
  if (platform === "chrome") {
    filtered.sort(
      (a, b) => Number(/edge/i.test(a.name)) - Number(/edge/i.test(b.name)),
    );
  }
  if (platform === "firefox") {
    filtered.sort(
      (a, b) => Number(/\.xpi$/i.test(b.name)) - Number(/\.xpi$/i.test(a.name)),
    );
  }
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
