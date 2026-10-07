// Minimal HTTP method type for GM_xmlhttpRequest compatibility.
// (Avoid pulling external typings just for this union.)
type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS"
  | "CONNECT"
  | "TRACE";

import { nonProxyExtensions } from "../config/config";
import { executeWithResponseCache } from "../core/cacheManager";
import type { FetchOpts } from "../types/utils/gm";
import { createTimeoutSignal } from "./abort";
import { browserInfo } from "./browserInfo";
import debug from "./debug";
import { getErrorMessage, isAbortError, makeAbortError } from "./errors";
import { getHeaders } from "./utils";

const YANDEX_API_HOST = "api.browser.yandex.ru";
const GOOGLEVIDEO_HOST_SUFFIX = "googlevideo.com";
const VOT_BACKEND_HOST_SUFFIX = "toil.cc";
const WORKERS_DEV_HOST_SUFFIX = "workers.dev";
const ONRENDER_HOST_SUFFIX = "onrender.com";
const CLOUDFLARE_DNS_HOST = "cloudflare-dns.com";
const HEADER_LINE_RE = /^([\w-]+):\s*(.+)$/;
const URL_SCHEME_RE = /^[a-zA-Z][a-zA-Z\d+.-]*:/;

const scriptHandler =
  typeof GM_info === "undefined" ? undefined : GM_info?.scriptHandler;

function getCallbackGmXhr(): ((details: any) => any) | undefined {
  const gmXhr =
    typeof GM_xmlhttpRequest === "undefined"
      ? (globalThis as any).GM_xmlhttpRequest
      : GM_xmlhttpRequest;
  return typeof gmXhr === "function" ? (gmXhr as any) : undefined;
}

function getPromiseGmXhr(): ((details: any) => Promise<any>) | undefined {
  const gm = typeof GM === "undefined" ? (globalThis as any).GM : (GM as any);
  const gmXhr = gm?.xmlHttpRequest ?? gm?.xmlhttpRequest;
  return typeof gmXhr === "function" ? gmXhr.bind(gm) : undefined;
}

function hasSupportedGmXhr(): boolean {
  return !!(getCallbackGmXhr() || getPromiseGmXhr());
}

export const isProxyOnlyExtension =
  browserInfo.browser?.name === "Safari" ||
  (!!scriptHandler && !nonProxyExtensions.includes(scriptHandler));

export const isSupportGM4 =
  typeof GM !== "undefined" || (globalThis as any).GM !== undefined;
export const isSupportGMXhr = hasSupportedGmXhr();

function getRequestHost(url: string): string | undefined {
  const normalizedUrl = url.trim();
  try {
    return new URL(normalizedUrl).hostname.toLowerCase();
  } catch {
    if (!URL_SCHEME_RE.test(normalizedUrl)) {
      try {
        return new URL(`https://${normalizedUrl}`).hostname.toLowerCase();
      } catch {
        // fall through
      }
    }
    return undefined;
  }
}
function serializeGmBody(
  body: unknown,
): string | Blob | ArrayBuffer | FormData | undefined {
  if (body == null) return undefined;

  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof FormData) return body;
  if (body instanceof Blob) return body;
  if (body instanceof ArrayBuffer) return body;

  return body as any;
}
function isHostOrSubdomain(host: string, targetHost: string): boolean {
  return host === targetHost || host.endsWith(`.${targetHost}`);
}

function shouldUseGmXhr(
  host: string | undefined,
  url: string,
  forceGmXhr = false,
): boolean {
  if (forceGmXhr) {
    return true;
  }

  if (!host) {
    const lowerUrl = url.toLowerCase();
    return (
      lowerUrl.includes(YANDEX_API_HOST) ||
      lowerUrl.includes(GOOGLEVIDEO_HOST_SUFFIX) ||
      lowerUrl.includes(VOT_BACKEND_HOST_SUFFIX) ||
      lowerUrl.includes(WORKERS_DEV_HOST_SUFFIX) ||
      lowerUrl.includes(ONRENDER_HOST_SUFFIX) ||
      lowerUrl.includes(CLOUDFLARE_DNS_HOST)
    );
  }

  return (
    isHostOrSubdomain(host, YANDEX_API_HOST) ||
    isHostOrSubdomain(host, GOOGLEVIDEO_HOST_SUFFIX) ||
    isHostOrSubdomain(host, VOT_BACKEND_HOST_SUFFIX) ||
    isHostOrSubdomain(host, WORKERS_DEV_HOST_SUFFIX) ||
    isHostOrSubdomain(host, ONRENDER_HOST_SUFFIX) ||
    isHostOrSubdomain(host, CLOUDFLARE_DNS_HOST)
  );
}

function toRequestUrl(url: string | URL | Request): string {
  if (typeof url === "string") {
    return url;
  }
  if (url instanceof URL) {
    return url.href;
  }
  return url.url;
}

function resolveRequestMethod(
  url: string | URL | Request,
  method?: string,
): string {
  if (method) {
    return method.toUpperCase();
  }
  if (url instanceof Request) {
    return (url.method || "GET").toUpperCase();
  }
  return "GET";
}

function parseResponseHeaders(rawHeaders: unknown): Record<string, string> {
  if (typeof rawHeaders !== "string" || rawHeaders.length === 0) {
    return {};
  }

  return rawHeaders
    .split(/\r?\n/)
    .reduce<Record<string, string>>((acc, line) => {
      const headerMatch = HEADER_LINE_RE.exec(line);
      if (!headerMatch) {
        return acc;
      }
      const [, key, value] = headerMatch;
      acc[key] = value;
      return acc;
    }, {});
}

function getGmXhrErrorMessage(error: unknown): string {
  const maybeError = error as {
    error?: unknown;
    statusText?: unknown;
  };
  if (typeof maybeError?.error === "string") {
    return maybeError.error;
  }
  if (typeof maybeError?.statusText === "string") {
    return maybeError.statusText;
  }

  return getErrorMessage(error) || "Unknown error";
}

function buildResponse(resp: any, urlStr: string): Response {
  const responseHeaders = parseResponseHeaders(resp.responseHeaders);
  const body =
    resp.response instanceof Blob
      ? resp.response
      : resp.response instanceof ArrayBuffer
        ? new Blob([resp.response])
        : resp.response == null
          ? null
          : new Blob([resp.response]);

  const response = new Response(body, {
    status: Number(resp.status) || 200,
    statusText: typeof resp.statusText === "string" ? resp.statusText : "",
    headers: responseHeaders,
  });

  Object.defineProperty(response, "url", {
    value: resp.finalUrl ?? urlStr,
  });
  return response;
}

async function executeCallbackGmXhr(
  gmXhr: (details: any) => any,
  urlStr: string,
  timeout: number,
  fetchOptions: Omit<FetchOpts, "timeout">,
  method: string,
  headers: Record<string, string>,
): Promise<Response> {
  return await new Promise((resolve, reject) => {
    let settled = false;
    let onAbort: (() => void) | undefined;

    const cleanupAbort = () => {
      if (onAbort) fetchOptions.signal?.removeEventListener("abort", onAbort);
    };
    const failOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanupAbort();
      reject(error);
    };

    const redirectMode = fetchOptions.redirect;
    const request = gmXhr({
      method,
      url: urlStr,
      responseType: "blob",
      data: serializeGmBody(fetchOptions.body),
      timeout,
      headers,
      ...(redirectMode ? { redirect: redirectMode } : {}),
      onload: (resp: any) => {
        if (settled) return;
        settled = true;
        cleanupAbort();
        try {
          resolve(buildResponse(resp, urlStr));
        } catch (error) {
          reject(
            error instanceof Error
              ? error
              : new Error(
                  getErrorMessage(error) || "Failed to build GM response",
                ),
          );
        }
      },
      ontimeout: () => failOnce(new Error("Timeout")),
      onerror: (error: unknown) =>
        failOnce(new Error(getGmXhrErrorMessage(error))),
      onabort: () => failOnce(makeAbortError()),
    });

    onAbort = () => {
      try {
        request?.abort?.();
      } catch {
        // ignore abort races
      }
      failOnce(makeAbortError());
    };

    if (fetchOptions.signal) {
      fetchOptions.signal.addEventListener("abort", onAbort, { once: true });
      if (fetchOptions.signal.aborted) onAbort();
    }
  });
}

async function executePromiseGmXhr(
  gmXhr: (details: any) => Promise<any>,
  urlStr: string,
  timeout: number,
  fetchOptions: Omit<FetchOpts, "timeout">,
  method: string,
  headers: Record<string, string>,
): Promise<Response> {
  const redirectMode = fetchOptions.redirect;
  const request: any = gmXhr({
    method,
    url: urlStr,
    responseType: "blob",
    data: serializeGmBody(fetchOptions.body),
    timeout,
    headers,
    ...(redirectMode ? { redirect: redirectMode } : {}),
  });

  let abortHandler: (() => void) | undefined;
  try {
    const abortPromise = new Promise<never>((_, reject) => {
      if (!fetchOptions.signal) return;
      abortHandler = () => {
        try {
          request?.abort?.();
        } catch {
          // ignore abort races
        }
        reject(makeAbortError());
      };
      fetchOptions.signal.addEventListener("abort", abortHandler, {
        once: true,
      });
      if (fetchOptions.signal.aborted) abortHandler();
    });

    const resp = await Promise.race([request, abortPromise]);
    return buildResponse(resp, urlStr);
  } finally {
    if (abortHandler) {
      fetchOptions.signal?.removeEventListener("abort", abortHandler);
    }
  }
}

async function gmXhrFetch(
  urlStr: string,
  timeout: number,
  fetchOptions: Omit<FetchOpts, "timeout">,
): Promise<Response> {
  const headers = getHeaders(fetchOptions.headers);
  const method = (fetchOptions.method || "GET").toUpperCase();

  const callbackGmXhr = getCallbackGmXhr();
  if (callbackGmXhr) {
    try {
      return await executeCallbackGmXhr(
        callbackGmXhr,
        urlStr,
        timeout,
        fetchOptions,
        method,
        headers,
      );
    } catch (error) {
      if (isAbortError(error)) throw error;
      debug.warn("[GM_fetch] callback GM_xmlhttpRequest failed", {
        url: urlStr,
        method,
        error: getGmXhrErrorMessage(error),
      });
    }
  }

  const promiseGmXhr = getPromiseGmXhr();
  if (promiseGmXhr) {
    try {
      return await executePromiseGmXhr(
        promiseGmXhr,
        urlStr,
        timeout,
        fetchOptions,
        method,
        headers,
      );
    } catch (error) {
      if (isAbortError(error)) throw error;
      debug.warn("[GM_fetch] promise GM.xmlHttpRequest failed", {
        url: urlStr,
        method,
        error: getGmXhrErrorMessage(error),
      });
    }
  }

  throw new Error("All GM approaches failed");
}

export async function GM_fetch(
  url: string | URL | Request,
  opts: FetchOpts = {},
): Promise<Response> {
  const {
    timeout = 15_000,
    forceGmXhr = false,
    responseCache,
    ...fetchOptions
  } = opts;
  const urlStr = toRequestUrl(url);
  const host = getRequestHost(urlStr);
  const method = resolveRequestMethod(url, fetchOptions.method);
  const effectiveTimeout =
    host === YANDEX_API_HOST &&
    method === "PUT" &&
    urlStr.includes("/video-translation/audio")
      ? 120_000
      : timeout;

  const performRequest = async (): Promise<Response> => {
    if (shouldUseGmXhr(host, urlStr, forceGmXhr)) {
      debug.log("GM_fetch: routing request via GM_xmlhttpRequest", {
        host: host ?? "unknown",
        reason: forceGmXhr ? "forced" : "host-policy",
        url: urlStr,
      });
      return await gmXhrFetch(urlStr, effectiveTimeout, fetchOptions);
    }

    const { signal, cleanup } = createTimeoutSignal(
      effectiveTimeout,
      fetchOptions.signal,
    );
    try {
      return await fetch(url, {
        ...fetchOptions,
        signal,
      });
    } catch (err) {
      if (signal.aborted || isAbortError(err)) {
        throw err;
      }
      // If fetch fails, retry via GM_xmlhttpRequest.
      debug.log(
        "GM_fetch preventing CORS by GM_xmlhttpRequest",
        getErrorMessage(err) || "Unknown error",
      );
      return await gmXhrFetch(urlStr, effectiveTimeout, fetchOptions);
    } finally {
      cleanup();
    }
  };

  if (!responseCache) {
    return await performRequest();
  }

  return await executeWithResponseCache(
    {
      url: urlStr,
      method,
      body: fetchOptions.body as BodyInit | null | undefined,
    },
    responseCache,
    performRequest,
  );
}
