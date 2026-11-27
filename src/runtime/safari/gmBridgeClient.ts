import {
  SAFARI_GM_ABORT,
  SAFARI_GM_REQUEST,
  SAFARI_GM_RESPONSE,
  type SafariGmRequest,
  type SafariGmResponse,
} from "./protocol";
import {
  base64ToArrayBuffer,
  deserializeBody,
  makeRequestId,
  parseBridgeDetail,
  parseRawResponseHeaders,
  serializeBody,
} from "./serialization";

const CLIENT_FLAG = "__votSafariGmBridgeClientInstalled__";

function headersToRecord(
  headers?: HeadersInit,
): Record<string, string> | undefined {
  if (!headers) return undefined;
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return headers as Record<string, string>;
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
      const response = parseBridgeDetail<SafariGmResponse>(
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

  const body = deserializeBody(response.body) ?? null;
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
    const response = parseBridgeDetail<SafariGmResponse>(
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

    const responseBody = deserializeBody(response.body) ?? null;
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
