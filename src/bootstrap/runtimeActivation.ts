import { installYandexDiskOverlayPatch } from "../core/yandex-disk-overlay";
import { authCallbackOrigin, authCallbackPath } from "../config/config";
import { initAuth } from "../core/auth";
import {
  ensureLocalizationProviderReady,
  localizationProvider,
} from "../localization/localizationProvider";
import debug from "../utils/debug";
import { isIframe } from "../utils/iframeConnector";
import { initIframeInteractor } from "./iframeInteractor";

type LogBootstrap = (
  message: string,
  details?: Record<string, unknown>,
) => void;

let runtimeActivated = false;
let runtimeActivationPromise: Promise<void> | null = null;
let iframeInteractorBound = false;

function isAuthPage(): boolean {
  return (
    globalThis.location.origin === authCallbackOrigin &&
    globalThis.location.pathname === authCallbackPath
  );
}

export async function ensureRuntimeActivated(
  reason: string,
  logBootstrap: LogBootstrap,
): Promise<void> {
  if (runtimeActivated) return;
  if (runtimeActivationPromise !== null) {
    await runtimeActivationPromise;
    return;
  }

  runtimeActivationPromise = (async () => {
    logBootstrap("Activating runtime", { reason });

    if (isAuthPage()) {
      await initAuth();
      runtimeActivated = true;
      return;
    }

    if (!isIframe()) {
      await ensureLocalizationProviderReady();
      await localizationProvider.update();
      debug.log(`Selected menu language: ${localizationProvider.lang}`);
    } else {
      debug.log("[VOT] iframe mode: skip localization init");
    }

    if (!iframeInteractorBound) {
      iframeInteractorBound = true;
      initIframeInteractor();
    }
    installYandexDiskOverlayPatch();
    runtimeActivated = true;
  })();

  try {
    await runtimeActivationPromise;
  } finally {
    runtimeActivationPromise = null;
  }
}