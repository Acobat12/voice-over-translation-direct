import { GM_fetch } from "../../utils/gm";
import {
  SAFARI_GM_ABORT,
  SAFARI_GM_REQUEST,
  SAFARI_GM_RESPONSE,
  type SafariGmBody,
  type SafariGmRequest,
  type SafariGmResponse,
} from "./protocol";
import {
  arrayBufferToBase64,
  deserializeBody,
  parseBridgeDetail,
  parseRawResponseHeaders,
} from "./serialization";

const HOST_FLAG = "__votSafariGmBridgeHostInstalled__";
const activeXhr = new Map<string, { abort?: () => void }>();

async function serializeResponseBody(
  response: Response,
  responseType?: SafariGmRequest["responseType"],
): Promise<SafariGmBody> {
  if (responseType === "text" || responseType === "json") {
    return { type: "text", value: await response.text() };
  }

  const buffer = await response.arrayBuffer();
  return {
    type: "base64",
    value: arrayBufferToBase64(buffer),
    mimeType: response.headers.get("content-type") || undefined,
  };
}

function dispatchResponse(response: SafariGmResponse): void {
  document.dispatchEvent(
    new CustomEvent(SAFARI_GM_RESPONSE, {
      detail: JSON.stringify(response),
    }),
  );
}

async function handleFetchRequest(request: SafariGmRequest): Promise<void> {
  try {
    const response = await GM_fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: deserializeBody(request.body),
      timeout: request.timeout,
      forceGmXhr: request.forceGmXhr,
    });

    dispatchResponse({
      id: request.id,
      ok: true,
      phase: "load",
      status: response.status,
      statusText: response.statusText,
      finalUrl: response.url,
      responseURL: response.url,
      headers: Object.fromEntries(response.headers.entries()),
      body: await serializeResponseBody(response, request.responseType),
    });
  } catch (error) {
    dispatchResponse({
      id: request.id,
      ok: false,
      phase: "error",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function handleXhrRequest(request: SafariGmRequest): void {
  const gmXhr =
    typeof GM_xmlhttpRequest === "function"
      ? GM_xmlhttpRequest
      : (globalThis as any).GM_xmlhttpRequest;

  if (typeof gmXhr !== "function") {
    dispatchResponse({
      id: request.id,
      ok: false,
      phase: "error",
      error: "GM_xmlhttpRequest is not available",
    });
    return;
  }

  try {
    const handle = gmXhr({
      method: request.method || "GET",
      url: request.url,
      headers: request.headers,
      data: deserializeBody(request.body),
      timeout: request.timeout,
      anonymous: request.anonymous,
      responseType:
        request.responseType === "arraybuffer" ||
        request.responseType === "blob"
          ? request.responseType
          : undefined,
      onload: async (response: any) => {
        activeXhr.delete(request.id);
        const rawHeaders = String(response.responseHeaders || "");
        let body: SafariGmBody;

        if (
          request.responseType === "arraybuffer" &&
          response.response instanceof ArrayBuffer
        ) {
          body = {
            type: "base64",
            value: arrayBufferToBase64(response.response),
          };
        } else if (
          request.responseType === "blob" &&
          response.response instanceof Blob
        ) {
          body = {
            type: "base64",
            value: arrayBufferToBase64(await response.response.arrayBuffer()),
            mimeType: response.response.type || undefined,
          };
        } else {
          body = {
            type: "text",
            value: String(response.responseText ?? response.response ?? ""),
          };
        }

        dispatchResponse({
          id: request.id,
          ok: true,
          phase: "load",
          status: Number(response.status || 0),
          statusText: String(response.statusText || ""),
          finalUrl: response.finalUrl || response.responseURL,
          responseURL: response.responseURL || response.finalUrl,
          headers: parseRawResponseHeaders(rawHeaders),
          responseHeadersRaw: rawHeaders,
          body,
        });
      },
      onerror: (error: unknown) => {
        activeXhr.delete(request.id);
        dispatchResponse({
          id: request.id,
          ok: false,
          phase: "error",
          error: error instanceof Error ? error.message : String(error),
        });
      },
      ontimeout: () => {
        activeXhr.delete(request.id);
        dispatchResponse({ id: request.id, ok: false, phase: "timeout" });
      },
      onabort: () => {
        activeXhr.delete(request.id);
        dispatchResponse({ id: request.id, ok: false, phase: "abort" });
      },
    });

    activeXhr.set(request.id, handle || {});
  } catch (error) {
    activeXhr.delete(request.id);
    dispatchResponse({
      id: request.id,
      ok: false,
      phase: "error",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function installSafariGmBridgeHost(): void {
  const state = globalThis as Record<string, unknown>;
  if (state[HOST_FLAG]) return;
  state[HOST_FLAG] = true;

  document.addEventListener(SAFARI_GM_REQUEST, (event) => {
    const request = parseBridgeDetail<SafariGmRequest>(
      (event as CustomEvent<SafariGmRequest | string>).detail,
    );
    if (!request?.id || !request.url) return;

    if (request.kind === "xhr") {
      handleXhrRequest(request);
      return;
    }

    void handleFetchRequest(request);
  });

  document.addEventListener(SAFARI_GM_ABORT, (event) => {
    const abortRequest = parseBridgeDetail<{ id?: string }>(
      (event as CustomEvent<{ id?: string } | string>).detail,
    );
    const id = abortRequest?.id;
    if (!id) return;

    const handle = activeXhr.get(id);
    activeXhr.delete(id);

    try {
      handle?.abort?.();
    } catch {
      // ignore abort races
    }
  });
}
