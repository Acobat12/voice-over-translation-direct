import debug from "../../utils/debug";

const REQUEST_EVENT = "vot:safari-page-po-token:request";
const RESPONSE_EVENT = "vot:safari-page-po-token:response";
const BRIDGE_MARKER = "data-vot-safari-po-token-bridge";

type PoTokenResponse = {
  requestId?: string;
  token?: string;
  error?: string;
};

function isSafariBrowser(): boolean {
  const ua = navigator.userAgent;
  return (
    /Safari\//.test(ua) &&
    !/(?:Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS)\//.test(ua)
  );
}

function installSafariPageBridge(): boolean {
  if (!isSafariBrowser()) return false;
  if (document.documentElement.hasAttribute(BRIDGE_MARKER)) return true;

  const script = document.createElement("script");
  const nonceSource =
    document.querySelector<HTMLScriptElement>("script[nonce]");
  if (nonceSource?.nonce) script.nonce = nonceSource.nonce;

  // This source is intentionally self-contained. The injected script executes
  // in YouTube's real page realm, where bevasrsg/havuokmhhs-* is available.
  script.textContent = `(() => {
    const REQUEST_EVENT = ${JSON.stringify(REQUEST_EVENT)};
    const RESPONSE_EVENT = ${JSON.stringify(RESPONSE_EVENT)};
    const MARKER = ${JSON.stringify(BRIDGE_MARKER)};
    if (document.documentElement.hasAttribute(MARKER)) return;
    document.documentElement.setAttribute(MARKER, "1");

    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    async function mint(binding) {
      const keys = Object.getOwnPropertyNames(globalThis).filter(
        (key) => key === "bevasrsg" || key.startsWith("havuokmhhs-"),
      );
      if (!keys.length) {
        throw new Error("YouTube PO token provider is unavailable in page realm");
      }

      for (const key of keys) {
        let bevasrs;
        try {
          bevasrs = globalThis[key]?.bevasrs;
        } catch {
          continue;
        }
        const wpc = bevasrs?.wpc;
        if (typeof wpc !== "function") continue;

        for (let attempt = 0; attempt < 10; attempt++) {
          try {
            const minter = await wpc.call(bevasrs);
            const token = await minter?.mws?.({
              c: binding,
              mc: false,
              me: false,
            });
            if (typeof token === "string" && token) return token;
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            if (!message.includes("SDF:notready")) break;
          }
          await delay(500);
        }
      }
      throw new Error("YouTube PO token mint failed in page realm");
    }

    addEventListener(REQUEST_EVENT, async (event) => {
      const detail = event?.detail;
      const requestId = detail?.requestId;
      const binding = detail?.binding;
      if (typeof requestId !== "string" || typeof binding !== "string" || !binding) {
        return;
      }

      try {
        const token = await mint(binding);
        dispatchEvent(new CustomEvent(RESPONSE_EVENT, {
          detail: { requestId, token },
        }));
      } catch (error) {
        dispatchEvent(new CustomEvent(RESPONSE_EVENT, {
          detail: {
            requestId,
            error: error instanceof Error ? error.message : String(error),
          },
        }));
      }
    });
  })();`;

  (document.documentElement || document.head).append(script);
  script.remove();
  return document.documentElement.hasAttribute(BRIDGE_MARKER);
}

export async function requestSafariPagePoToken(
  binding: string,
  signal: AbortSignal,
): Promise<string | undefined> {
  if (!isSafariBrowser()) return undefined;
  signal.throwIfAborted();

  if (!installSafariPageBridge()) {
    debug.error("[FORK][PO_TOKEN] Safari page bridge injection failed");
    return undefined;
  }

  const requestId = crypto.randomUUID();
  debug.log("[FORK][PO_TOKEN] trying Safari page-realm bridge", {
    bindingLength: binding.length,
  });

  return await new Promise<string | undefined>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => finish(undefined), 8000);

    const cleanup = () => {
      clearTimeout(timeout);
      removeEventListener(RESPONSE_EVENT, onResponse as EventListener);
      signal.removeEventListener("abort", onAbort);
    };

    const finish = (value: string | undefined) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(signal.reason);
    };

    const onResponse = (event: Event) => {
      const detail = (event as CustomEvent<PoTokenResponse>).detail;
      if (detail?.requestId !== requestId) return;
      if (typeof detail.token === "string" && detail.token) {
        finish(detail.token);
        return;
      }
      if (detail.error) {
        debug.error("[FORK][PO_TOKEN] Safari page-realm mint failed", {
          message: detail.error,
        });
      }
      finish(undefined);
    };

    addEventListener(RESPONSE_EVENT, onResponse as EventListener);
    signal.addEventListener("abort", onAbort, { once: true });
    dispatchEvent(
      new CustomEvent(REQUEST_EVENT, {
        detail: { requestId, binding },
      }),
    );
  });
}
