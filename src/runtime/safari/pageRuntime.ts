import type { ServiceConf } from "@vot.js/ext/types/service";
import {
  getService,
  getVideoData,
  getVideoID,
} from "@vot.js/ext/utils/videoData";
import {
  installSafariGmBridgeClient,
  safariProxyFetch,
} from "./gmBridgeClient";
import {
  SAFARI_PAGE_RUNTIME_READY,
  SAFARI_PAGE_RUNTIME_READY_DATASET,
  SAFARI_PAGE_RUNTIME_REQUEST,
  SAFARI_PAGE_RUNTIME_RESPONSE,
  type SafariPageRuntimeRequest,
  type SafariPageRuntimeResponse,
} from "./protocol";

const RUNTIME_FLAG = "__votSafariPageRuntimeInstalled__";

function parseRequestDetail(
  detail: unknown,
): SafariPageRuntimeRequest | undefined {
  if (typeof detail === "string") {
    try {
      return JSON.parse(detail) as SafariPageRuntimeRequest;
    } catch {
      return undefined;
    }
  }

  if (detail && typeof detail === "object") {
    return detail as SafariPageRuntimeRequest;
  }

  return undefined;
}

function dispatchResponse<T>(response: SafariPageRuntimeResponse<T>): void {
  document.dispatchEvent(
    new CustomEvent(SAFARI_PAGE_RUNTIME_RESPONSE, {
      detail: JSON.stringify(response),
    }),
  );
}

function findService(serviceHost?: string): ServiceConf | undefined {
  if (!serviceHost) return undefined;
  return getService().find((service) => String(service.host) === serviceHost);
}

async function handleRequest(
  request: SafariPageRuntimeRequest,
): Promise<unknown> {
  if (request.action === "ping") {
    return true;
  }

  const service =
    (request.service as ServiceConf | undefined) ??
    findService(request.serviceHost);
  if (!service) {
    return undefined;
  }

  const opts = {
    fetchFn: safariProxyFetch,
    service,
    origin: globalThis.location.origin,
    language: request.language ?? "en",
  };

  if (request.action === "getVideoID") {
    return await getVideoID(service, opts);
  }

  if (request.action === "getVideoData") {
    return await getVideoData(service, opts);
  }

  return undefined;
}

function installSafariPageRuntime(): void {
  const state = globalThis as Record<string, unknown>;
  if (state[RUNTIME_FLAG]) return;
  state[RUNTIME_FLAG] = true;

  installSafariGmBridgeClient();

  try {
    if (document.documentElement?.dataset) {
      document.documentElement.dataset[SAFARI_PAGE_RUNTIME_READY_DATASET] = "1";
    }
  } catch {
    // ignore dataset errors
  }

  document.addEventListener(SAFARI_PAGE_RUNTIME_REQUEST, (event) => {
    const request = parseRequestDetail(
      (event as CustomEvent<SafariPageRuntimeRequest | string>).detail,
    );
    if (!request?.id || !request.action) return;

    void handleRequest(request)
      .then((result) => {
        dispatchResponse({
          id: request.id,
          ok: true,
          result,
        });
      })
      .catch((error) => {
        dispatchResponse({
          id: request.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  });

  document.dispatchEvent(
    new CustomEvent(SAFARI_PAGE_RUNTIME_READY, {
      detail: JSON.stringify({
        ready: true,
        href: globalThis.location.href,
      }),
    }),
  );

  dispatchResponse({
    id: "ready",
    ok: true,
    result: true,
  });
}

installSafariPageRuntime();
