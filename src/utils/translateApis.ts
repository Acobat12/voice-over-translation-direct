import {
  defaultDetectService,
  defaultTranslationService,
  detectRustServerUrl,
  foswlyTranslateUrl,
} from "../config/config";
import { GM_fetch } from "./gm";
import { votStorage } from "./storage";

// Small in-memory caches to avoid repeated async storage reads.
// Settings rarely change during a session, but `translate()`/`detect()` can be
// called from retry/error flows where every call used to hit storage.
const SETTINGS_CACHE_TTL_MS = 5_000;
// Immutable translation/detection results are safe to cache "forever".
const IMMUTABLE_API_CACHE_TTL_MS = Number.MAX_SAFE_INTEGER;

function createServiceReader(
  key: "translationService" | "detectService",
  fallback: string,
) {
  let cachedValue: string | null = null;
  let cachedAt = 0;
  return async (): Promise<string> => {
    const now = Date.now();
    if (!cachedValue || now - cachedAt >= SETTINGS_CACHE_TTL_MS) {
      cachedValue = String(await votStorage.get(key, fallback));
      cachedAt = now;
    }
    return cachedValue;
  };
}

const getTranslationServiceCached = createServiceReader(
  "translationService",
  defaultTranslationService,
);
const getDetectServiceCached = createServiceReader(
  "detectService",
  defaultDetectService,
);

type FOSWLYErrorResponse = {
  error: string;
};

// Services supported by our FOSWLY Translate API wrapper.
const foswlyServices = ["yandexbrowser", "msedge"] as const;
type FoswlyService = (typeof foswlyServices)[number];

/**
 * Limit: 10k symbols for yandex, 50k for msedge
 */
const FOSWLYTranslateAPI = new (class {
  isFOSWLYError<T extends object>(
    data: T | FOSWLYErrorResponse,
  ): data is FOSWLYErrorResponse {
    return Object.hasOwn(data, "error");
  }

  async request<T extends object>(
    path: string,
    opts: Record<string, unknown> = {},
  ) {
    try {
      const res = await GM_fetch(`${foswlyTranslateUrl}${path}`, {
        ...opts,
        timeout: 3000,
        forceGmXhr: true,
        responseCache: {
          ttlMs: IMMUTABLE_API_CACHE_TTL_MS,
          cacheName: "vot-foswly-api-v1",
          allowStaleOnError: true,
        },
      });

      const data = (await res.json()) as T | FOSWLYErrorResponse;
      if (this.isFOSWLYError<T>(data)) {
        throw new Error(data.error);
      }

      return data;
    } catch (err) {
      console.error(
        `[FORK] Failed to get data from FOSWLY Translate API, because ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return undefined;
    }
  }

  async translateMultiple(
    text: string[],
    lang: string,
    service: FoswlyService,
  ) {
    const result = await this.request<{ translations: string[] }>(
      "/translate",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          lang,
          service,
        }),
      },
    );

    return result ? result.translations : text;
  }

  async translate(text: string, lang: string, service: FoswlyService) {
    const result = await this.request<{ translations: string[] }>(
      `/translate?${new URLSearchParams({
        text,
        lang,
        service,
      })}`,
    );

    return result ? result.translations[0] : text;
  }

  async detect(text: string, service: FoswlyService) {
    const result = await this.request<{ lang: string }>(
      `/detect?${new URLSearchParams({
        text,
        service,
      })}`,
    );

    return result ? result.lang : "en";
  }
})();

const RustServerAPI = {
  async detect(text: string) {
    try {
      const response = await GM_fetch(detectRustServerUrl, {
        method: "POST",
        body: text,
        timeout: 3000,
        forceGmXhr: true,
        responseCache: {
          ttlMs: IMMUTABLE_API_CACHE_TTL_MS,
          cacheName: "vot-rust-detect-v1",
          allowStaleOnError: true,
        },
      });

      return await response.text();
    } catch (error) {
      console.error(
        `[FORK] Error getting lang from text, because ${
          (error as Error).message
        }`,
      );
      return "en";
    }
  },
};

async function translate(
  text: string | string[],
  fromLang = "",
  toLang = "ru",
) {
  if (fromLang && toLang && fromLang === toLang) {
    return text;
  }

  const service = await getTranslationServiceCached();
  switch (service) {
    case "yandexbrowser":
    case "msedge": {
      const langPair = fromLang && toLang ? `${fromLang}-${toLang}` : toLang;
      return Array.isArray(text)
        ? await FOSWLYTranslateAPI.translateMultiple(text, langPair, service)
        : await FOSWLYTranslateAPI.translate(text, langPair, service);
    }
    default:
      return text;
  }
}

async function detect(text: string) {
  const service = await getDetectServiceCached();
  switch (service) {
    case "yandexbrowser":
    case "msedge":
      return await FOSWLYTranslateAPI.detect(text, service);
    case "rust-server":
      return await RustServerAPI.detect(text);
    default:
      return "en";
  }
}

const detectServices = [...foswlyServices, "rust-server"] as const;

export {
  detect,
  detectServices,
  foswlyServices as translateServices,
  translate,
};
