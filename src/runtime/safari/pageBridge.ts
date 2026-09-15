import type { ServiceConf } from "@vot.js/ext/types/service";
import { installSafariGmBridgeHost } from "./gmBridgeHost";
import {
  SAFARI_PAGE_RUNTIME_READY,
  SAFARI_PAGE_RUNTIME_READY_DATASET,
  SAFARI_PAGE_RUNTIME_REQUEST,
  SAFARI_PAGE_RUNTIME_RESPONSE,
  type SafariPageRuntimeAction,
  type SafariPageRuntimeRequest,
  type SafariPageRuntimeResponse,
  type SafariPageRuntimeService,
  type SafariPageRuntimeVideoData,
} from "./protocol";

let runtimeReadyPromise: Promise<boolean> | null = null;

export function shouldUseSafariPageBridge(): boolean {
  const handler = String(globalThis.GM_info?.scriptHandler || "");
  return /^UserScripts$/i.test(handler);
}

function serializeService(service: ServiceConf): SafariPageRuntimeService {
  return {
    host: service.host,
    url: service.url,
    selector: service.selector,
    eventSelector: service.eventSelector,
    additionalData: service.additionalData,
    needExtraData: service.needExtraData,
    rawResult: service.rawResult,
    needBypassCSP: service.needBypassCSP,
    shadowRoot: service.shadowRoot,
    priority: service.priority,
  };
}

function makeRequestId(): string {
  return `${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function parseResponseDetail<T>(
  detail: unknown,
): SafariPageRuntimeResponse<T> | undefined {
  if (typeof detail === "string") {
    try {
      return JSON.parse(detail) as SafariPageRuntimeResponse<T>;
    } catch {
      return undefined;
    }
  }

  if (detail && typeof detail === "object") {
    return detail as SafariPageRuntimeResponse<T>;
  }

  return undefined;
}

function isRuntimeMarkedReady(): boolean {
  try {
    return (
      document.documentElement?.dataset?.[SAFARI_PAGE_RUNTIME_READY_DATASET] ===
      "1"
    );
  } catch {
    return false;
  }
}

function waitForReadyEvent(timeoutMs = 1500): Promise<boolean> {
  if (isRuntimeMarkedReady()) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const timer = globalThis.setTimeout(() => {
      document.removeEventListener(SAFARI_PAGE_RUNTIME_READY, onReady);
      resolve(isRuntimeMarkedReady());
    }, timeoutMs);

    function onReady(): void {
      globalThis.clearTimeout(timer);
      document.removeEventListener(SAFARI_PAGE_RUNTIME_READY, onReady);
      resolve(true);
    }

    document.addEventListener(SAFARI_PAGE_RUNTIME_READY, onReady, {
      once: true,
    });
  });
}

function requestPageRuntime<T>(
  action: SafariPageRuntimeAction,
  service?: ServiceConf,
  language?: string,
  timeoutMs = 3500,
): Promise<T | undefined> {
  if (!shouldUseSafariPageBridge()) {
    return Promise.resolve(undefined);
  }

  const id = makeRequestId();

  return new Promise((resolve) => {
    const timer = globalThis.setTimeout(() => {
      document.removeEventListener(
        SAFARI_PAGE_RUNTIME_RESPONSE,
        onResponse as EventListener,
      );
      resolve(undefined);
    }, timeoutMs);

    function onResponse(event: Event): void {
      const response = parseResponseDetail<T>(
        (event as CustomEvent<SafariPageRuntimeResponse<T> | string>).detail,
      );
      if (!response || response.id !== id) return;

      globalThis.clearTimeout(timer);
      document.removeEventListener(
        SAFARI_PAGE_RUNTIME_RESPONSE,
        onResponse as EventListener,
      );
      resolve(response.ok ? response.result : undefined);
    }

    document.addEventListener(
      SAFARI_PAGE_RUNTIME_RESPONSE,
      onResponse as EventListener,
    );

    const request: SafariPageRuntimeRequest = {
      id,
      action,
      serviceHost: service ? String(service.host) : undefined,
      service: service ? serializeService(service) : undefined,
      language,
    };

    document.dispatchEvent(
      new CustomEvent(SAFARI_PAGE_RUNTIME_REQUEST, {
        detail: JSON.stringify(request),
      }),
    );
  });
}

async function pingSafariPageRuntime(): Promise<boolean> {
  return Boolean(
    await requestPageRuntime<boolean>("ping", undefined, undefined, 1500),
  );
}

export async function ensureSafariPageRuntimeReady(): Promise<boolean> {
  if (!shouldUseSafariPageBridge()) {
    return false;
  }

  installSafariGmBridgeHost();

  if (!runtimeReadyPromise) {
    runtimeReadyPromise = (async () => {
      const eventReady = await waitForReadyEvent();
      if (eventReady) {
        return true;
      }

      return await pingSafariPageRuntime();
    })();
  }

  return await runtimeReadyPromise;
}

export async function requestSafariPageVideoID(
  service: ServiceConf,
): Promise<string | undefined> {
  const ready = await ensureSafariPageRuntimeReady();
  if (!ready) return undefined;
  return await requestPageRuntime<string>(
    "getVideoID",
    service,
    undefined,
    8000,
  );
}

export async function requestSafariPageVideoData(
  service: ServiceConf,
  language?: string,
): Promise<SafariPageRuntimeVideoData | undefined> {
  const ready = await ensureSafariPageRuntimeReady();
  if (!ready) return undefined;
  return await requestPageRuntime<SafariPageRuntimeVideoData>(
    "getVideoData",
    service,
    language,
    12000,
  );
}
