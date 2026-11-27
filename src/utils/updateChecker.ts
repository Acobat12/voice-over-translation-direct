/** Update discovery for manually installed VOT builds. Never installs code automatically. */
import { browserInfo } from "./browserInfo";
import { GM_fetch, isSupportGMXhr } from "./gm";

const RELEASES_API =
  "https://api.github.com/repos/Acobat12/voice-over-translation-direct/releases/latest";
export const RELEASES_PAGE =
  "https://github.com/Acobat12/voice-over-translation-direct/releases/latest";

export type {
  UpdateAsset,
  UpdatePlatform,
  UpdateResult,
} from "./updateRelease";

import {
  parseUpdateRelease,
  type UpdatePlatform,
  type UpdateResult,
} from "./updateRelease";
export function getUpdatePlatform(): UpdatePlatform {
  const handler = typeof GM_info === "undefined" ? "" : GM_info?.scriptHandler;
  if (handler !== "VOT Extension")
    return browserInfo.browser?.name === "Safari" ? "safari" : "userscript";
  return browserInfo.browser?.name === "Firefox" ? "firefox" : "chrome";
}

export { isNewerVersion } from "./updateVersion";

let retryAfter = 0;
const cache = new Map<
  string,
  { expires: number; result: UpdateResult | undefined }
>();
const pending = new Map<string, Promise<UpdateResult | undefined>>();
export async function checkForUpdate(
  installed: string,
  platform: UpdatePlatform,
  force = false,
): Promise<UpdateResult | undefined> {
  const key = `${platform}:${installed}`;
  const active = pending.get(key);
  if (active) return active;
  const saved = cache.get(key);
  if (!force && saved && saved.expires > Date.now()) return saved.result;
  if (Date.now() < retryAfter)
    throw new Error("GitHub rate limit: retry later");
  const request = fetchUpdate(installed, platform)
    .then((result) => {
      cache.set(key, { expires: Date.now() + 15 * 60 * 1000, result });
      return result;
    })
    .finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
}

async function fetchUpdate(
  installed: string,
  platform: UpdatePlatform,
): Promise<UpdateResult | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  const signal = controller.signal;
  try {
    const options = {
      headers: { Accept: "application/vnd.github+json" },
      cache: "no-store" as const,
      credentials: "omit" as const,
      signal,
    };
    let response: Response;
    try {
      response = await GM_fetch(RELEASES_API, {
        ...options,
        timeout: 12_000,
        forceGmXhr: isSupportGMXhr,
      });
    } catch (error) {
      if (signal.aborted || !isSupportGMXhr) throw error;
      response = await fetch(RELEASES_API, options);
    }
    if (
      response.status === 429 ||
      (response.status === 403 &&
        (response.headers.get("x-ratelimit-remaining") === "0" ||
          response.headers.has("retry-after")))
    ) {
      const raw = response.headers.get("retry-after");
      const reset = Number(response.headers.get("x-ratelimit-reset")) * 1000;
      const delay =
        raw && /^\d+$/.test(raw)
          ? Number(raw) * 1000
          : raw
            ? Date.parse(raw) - Date.now()
            : 0;
      retryAfter = Math.max(
        Date.now() + 60_000,
        reset || 0,
        Date.now() + (delay || 0),
      );
      throw new Error("GitHub rate limit: retry later");
    }
    if (!response.ok) throw new Error(`GitHub HTTP ${response.status}`);
    const release: unknown = await response.json();
    return parseUpdateRelease(release, installed, platform, RELEASES_PAGE);
  } finally {
    clearTimeout(timer);
  }
}
