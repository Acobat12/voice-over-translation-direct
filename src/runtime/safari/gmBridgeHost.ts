import { GM_fetch } from "../../utils/gm";
import {
  SAFARI_GM_ABORT,
  SAFARI_GM_REQUEST,
  SAFARI_GM_RESPONSE,
  type SafariGmBody,
  type SafariGmRequest,
  type SafariGmResponse,
} from "./protocol";

const HOST_FLAG = "__votSafariGmBridgeHostInstalled__";
const activeXhr = new Map<string, { abort?: () => void }>();

function parseRequestDetail<T>(detail: unknown): T | undefined {
  if (typeof detail === "string") {
    try {
      return JSON.parse(detail) as T;
    } catch {
      return undefined;
    }
  }

  if (detail && typeof detail === "object") {
    return detail as T;
  }

  return undefined;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary);
}

function base64ToArrayBuffer(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes.buffer;
}

function deserializeRequestBody(body?: SafariGmBody): BodyInit | undefined {
  if (!body) return undefined;
  if (body.type === "text") return body.value;

  const buffer = base64ToArrayBuffer(body.value);
  if (body.mimeType) {
    return new Blob([buffer], { type: body.mimeType });
  }

  return buffer;
}

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

function parseRawResponseHeaders(rawHeaders: string): Record<string, string> {
  if (!rawHeaders) return {};

  return rawHeaders
    .split(/\r?\n/)
    .reduce<Record<string, string>>((acc, line) => {
      const match = /^([\w-]+):\s*(.+)$/.exec(line);
      if (match) acc[match[1]] = match[2];
      return acc;
    }, {});
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
      body: deserializeRequestBody(request.body),
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
      data: deserializeRequestBody(request.body),
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
    const request = parseRequestDetail<SafariGmRequest>(
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
    const abortRequest = parseRequestDetail<{ id?: string }>(
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
