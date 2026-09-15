import {
  SAFARI_GM_ABORT,
  SAFARI_GM_REQUEST,
  SAFARI_GM_RESPONSE,
  type SafariGmBody,
  type SafariGmRequest,
  type SafariGmResponse,
} from "./protocol";

const CLIENT_FLAG = "__votSafariGmBridgeClientInstalled__";

function makeRequestId(): string {
  return `${Date.now()}:${Math.random().toString(36).slice(2)}`;
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

async function serializeBody(body: unknown): Promise<SafariGmBody | undefined> {
  if (body == null) return undefined;
  if (typeof body === "string") return { type: "text", value: body };

  if (body instanceof URLSearchParams) {
    return { type: "text", value: body.toString() };
  }

  if (body instanceof Blob) {
    return {
      type: "base64",
      value: arrayBufferToBase64(await body.arrayBuffer()),
      mimeType: body.type || undefined,
    };
  }

  if (body instanceof ArrayBuffer) {
    return { type: "base64", value: arrayBufferToBase64(body) };
  }

  if (ArrayBuffer.isView(body)) {
    const view = body as ArrayBufferView;
    const bytes = new Uint8Array(view.byteLength);
    bytes.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
    return {
      type: "base64",
      value: arrayBufferToBase64(bytes.buffer),
    };
  }

  return { type: "text", value: String(body) };
}

function deserializeBody(body?: SafariGmBody): BodyInit | null {
  if (!body) return null;
  if (body.type === "text") return body.value;

  const buffer = base64ToArrayBuffer(body.value);
  if (body.mimeType) {
    return new Blob([buffer], { type: body.mimeType });
  }

  return buffer;
}

function headersToRecord(
  headers?: HeadersInit,
): Record<string, string> | undefined {
  if (!headers) return undefined;
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return headers as Record<string, string>;
}

function parseRawResponseHeaders(rawHeaders?: string): Record<string, string> {
  if (!rawHeaders) return {};

  return rawHeaders
    .split(/\r?\n/)
    .reduce<Record<string, string>>((acc, line) => {
      const match = /^([\w-]+):\s*(.+)$/.exec(line);
      if (match) acc[match[1]] = match[2];
      return acc;
    }, {});
}

function parseBridgeResponse(detail: unknown): SafariGmResponse | undefined {
  if (typeof detail === "string") {
    try {
      return JSON.parse(detail) as SafariGmResponse;
    } catch {
      return undefined;
    }
  }

  if (detail && typeof detail === "object") {
    return detail as SafariGmResponse;
  }

  return undefined;
}

async function requestViaMain(
  request: Omit<SafariGmRequest, "id">,
): Promise<SafariGmResponse> {
  const id = makeRequestId();

  return await new Promise((resolve) => {
    const timeout = window.setTimeout(
      () => {
        document.removeEventListener(
          SAFARI_GM_RESPONSE,
          onResponse as EventListener,
        );
        resolve({
          id,
          ok: false,
          phase: "timeout",
          error: "GM bridge timeout",
        });
      },
      Math.max(Number(request.timeout || 0), 0) + 5000,
    );

    function onResponse(event: Event): void {
      const response = parseBridgeResponse(
        (event as CustomEvent<SafariGmResponse | string>).detail,
      );
      if (!response || response.id !== id) return;

      window.clearTimeout(timeout);
      document.removeEventListener(
        SAFARI_GM_RESPONSE,
        onResponse as EventListener,
      );
      resolve(response);
    }

    document.addEventListener(SAFARI_GM_RESPONSE, onResponse as EventListener);
    document.dispatchEvent(
      new CustomEvent(SAFARI_GM_REQUEST, {
        detail: JSON.stringify({
          ...request,
          id,
        } satisfies SafariGmRequest),
      }),
    );
  });
}

async function requestToBridgeRequest(
  input: string | URL | Request,
  init: RequestInit & { timeout?: number; forceGmXhr?: boolean } = {},
): Promise<Omit<SafariGmRequest, "id">> {
  const request = input instanceof Request ? input : undefined;
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  const method = (init.method || request?.method || "GET").toUpperCase();
  const headers = headersToRecord(init.headers || request?.headers);
  const body = await serializeBody(init.body ?? undefined);

  return {
    kind: "fetch",
    url,
    method,
    headers,
    body,
    timeout: init.timeout,
    forceGmXhr: init.forceGmXhr,
    responseType: "arraybuffer",
  };
}

export async function safariProxyFetch(
  input: string | URL | Request,
  init: RequestInit & { timeout?: number; forceGmXhr?: boolean } = {},
): Promise<Response> {
  const bridgeRequest = await requestToBridgeRequest(input, init);
  const response = await requestViaMain(bridgeRequest);

  if (!response.ok) {
    throw new TypeError(response.error || `Safari GM bridge ${response.phase}`);
  }

  const body = deserializeBody(response.body);
  const fetchResponse = new Response(body, {
    status: response.status || 200,
    statusText: response.statusText || "",
    headers: response.headers,
  });

  Object.defineProperty(fetchResponse, "url", {
    value: response.finalUrl || response.responseURL || bridgeRequest.url,
  });

  return fetchResponse;
}

export function safariProxyGMXmlHttpRequest(details: {
  method?: string;
  url: string;
  headers?: Record<string, string>;
  data?: string | Blob | ArrayBuffer;
  timeout?: number;
  anonymous?: boolean;
  responseType?: string;
  onload?: (response: any) => void;
  onerror?: (error: any) => void;
  ontimeout?: () => void;
  onabort?: () => void;
}): { abort(): void } {
  const id = makeRequestId();
  let settled = false;

  const cleanup = () => {
    document.removeEventListener(
      SAFARI_GM_RESPONSE,
      onResponse as EventListener,
    );
  };

  function finish(callback: (() => void) | undefined): void {
    if (settled) return;
    settled = true;
    cleanup();
    callback?.();
  }

  function onResponse(event: Event): void {
    const response = parseBridgeResponse(
      (event as CustomEvent<SafariGmResponse | string>).detail,
    );
    if (!response || response.id !== id) return;

    if (response.phase === "timeout") {
      finish(details.ontimeout);
      return;
    }

    if (response.phase === "abort") {
      finish(details.onabort);
      return;
    }

    if (!response.ok) {
      finish(() => details.onerror?.(response));
      return;
    }

    const responseBody = deserializeBody(response.body);
    const rawHeaders = response.responseHeadersRaw || "";
    const textBody = response.body?.type === "text" ? response.body.value : "";

    const xhrResponse = {
      status: response.status || 0,
      statusText: response.statusText || "",
      finalUrl: response.finalUrl,
      responseURL: response.responseURL || response.finalUrl,
      responseHeaders: rawHeaders,
      responseText: textBody,
      response:
        details.responseType === "arraybuffer"
          ? response.body?.type === "base64"
            ? base64ToArrayBuffer(response.body.value)
            : textBody
          : details.responseType === "blob"
            ? responseBody
            : textBody,
      getAllResponseHeaders: () => rawHeaders,
      responseHeadersObject:
        response.headers || parseRawResponseHeaders(rawHeaders),
    };

    finish(() => details.onload?.(xhrResponse));
  }

  document.addEventListener(SAFARI_GM_RESPONSE, onResponse as EventListener);

  void serializeBody(details.data).then((body) => {
    if (settled) return;

    document.dispatchEvent(
      new CustomEvent(SAFARI_GM_REQUEST, {
        detail: JSON.stringify({
          id,
          kind: "xhr",
          url: details.url,
          method: details.method || "GET",
          headers: details.headers,
          body,
          timeout: details.timeout,
          anonymous: details.anonymous,
          responseType:
            details.responseType === "arraybuffer" ||
            details.responseType === "blob"
              ? details.responseType
              : "text",
        } satisfies SafariGmRequest),
      }),
    );
  });

  return {
    abort() {
      if (settled) return;
      document.dispatchEvent(
        new CustomEvent(SAFARI_GM_ABORT, {
          detail: JSON.stringify({ id }),
        }),
      );
      finish(details.onabort);
    },
  };
}

export function installSafariGmBridgeClient(): void {
  const state = globalThis as Record<string, unknown>;
  if (state[CLIENT_FLAG]) return;
  state[CLIENT_FLAG] = true;
  (globalThis as any).GM_xmlhttpRequest = safariProxyGMXmlHttpRequest;
}
