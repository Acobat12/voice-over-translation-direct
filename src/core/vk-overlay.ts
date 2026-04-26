function isVkLikeHost(): boolean {
  return /(?:^|\.)vkvideo\.ru$|(?:^|\.)vk\.(?:com|ru)$/i.test(
    String(globalThis.location?.hostname || ""),
  );
}

let vkOverlayPatchInstalled = false;

function collectQueryScopes(): ParentNode[] {
  const scopes: ParentNode[] = [document];
  const seen = new Set<Node>([document]);
  const queue: ParentNode[] = [document];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    const elements =
      current instanceof Document || current instanceof ShadowRoot
        ? current.querySelectorAll<HTMLElement>("*")
        : [];

    for (const element of elements) {
      const shadowRoot = element.shadowRoot;
      if (!shadowRoot || seen.has(shadowRoot)) {
        continue;
      }

      seen.add(shadowRoot);
      scopes.push(shadowRoot);
      queue.push(shadowRoot);
    }
  }

  return scopes;
}

function queryAllAcrossShadowRoots<T extends Element>(selector: string): T[] {
  const result: T[] = [];
  const seen = new Set<Element>();

  for (const scope of collectQueryScopes()) {
    for (const element of Array.from(scope.querySelectorAll<T>(selector))) {
      if (seen.has(element)) {
        continue;
      }

      seen.add(element);
      result.push(element);
    }
  }

  return result;
}

function refreshVkOverlayProbe(): number {
  const buttons = queryAllAcrossShadowRoots<HTMLElement>(
    "vot-block.vot-segmented-button, .vot-segmented-button",
  );
  for (const button of buttons) {
    button.hidden = false;
    button.removeAttribute("hidden");
    button.removeAttribute("inert");
    button.classList.remove("vot-segmented-button--hidden");
    button.style.setProperty("display", "flex", "important");
    button.style.setProperty("opacity", "1", "important");
    button.style.setProperty("pointer-events", "auto", "important");
    button.style.setProperty("z-index", "2147483647", "important");
    button.style.setProperty("visibility", "visible", "important");
  }
  const subtitles = queryAllAcrossShadowRoots<HTMLElement>(
    ".vot-subtitles-widget, .vot-subtitles-layer",
  );
  for (const subtitle of subtitles) {
    subtitle.hidden = false;
    subtitle.removeAttribute("hidden");
    subtitle.style.setProperty("display", "block", "important");
    subtitle.style.setProperty("opacity", "1", "important");
    subtitle.style.setProperty("pointer-events", "none", "important");
    subtitle.style.setProperty("z-index", "2147483647", "important");
    subtitle.style.setProperty("visibility", "visible", "important");
  }

  const videos = queryAllAcrossShadowRoots<HTMLVideoElement>("video");
  const probeState = {
    buttons: buttons.length,
    subtitlesWidgets: subtitles.length,
    videos: videos.length,
    visibleVideos: videos.filter((video) => {
      const rect = video.getBoundingClientRect();
      return rect.width > 64 && rect.height > 64;
    }).length,
    href: globalThis.location.href,
  };

  (globalThis as Record<string, unknown>).__VOT_VK_PROBE__ = probeState;
  return buttons.length + subtitles.length;
}

function ensureVkOverlayStyle(): void {
  for (const scope of collectQueryScopes()) {
    const styleHost =
      scope instanceof Document
        ? scope.head || scope.documentElement
        : scope instanceof ShadowRoot
          ? scope
          : null;

    if (!styleHost) {
      continue;
    }

    const root = scope instanceof Document ? scope : scope instanceof ShadowRoot ? scope : null;
    if (!root) {
      continue;
    }

    if (root.querySelector("#vot-vk-overlay-fix-style")) {
      continue;
    }

    try {
      const style = document.createElement("style");
      style.id = "vot-vk-overlay-fix-style";
      style.textContent = `
        .vot-segmented-button {
          display: flex !important;
          opacity: 1 !important;
          pointer-events: auto !important;
          z-index: 2147483647 !important;
          visibility: visible !important;
        }

        .vot-segmented-button.vot-segmented-button--hidden {
          opacity: 1 !important;
          pointer-events: auto !important;
        }

        .vot-subtitles-layer,
        .vot-subtitles-widget {
          display: block !important;
          opacity: 1 !important;
          z-index: 2147483647 !important;
          visibility: visible !important;
        }
      `;
      styleHost.appendChild(style);
    } catch {
      // ignore
    }
  }
}

export function installVkOverlayPatch(): void {
  if (!isVkLikeHost()) {
    return;
  }

  ensureVkOverlayStyle();

  if (vkOverlayPatchInstalled) {
    return;
  }
  vkOverlayPatchInstalled = true;

  try {
    const logProbeState = (message: string) => {
      console.log(
        message,
        (globalThis as Record<string, unknown>).__VOT_VK_PROBE__,
      );
    };
    let lastProbeSignature = "";
    const initialCount = refreshVkOverlayProbe();
    console.log(
      initialCount > 0
        ? "[VOT][VK probe] overlay nodes detected"
        : "[VOT][VK probe] no VOT overlay nodes yet",
      (globalThis as Record<string, unknown>).__VOT_VK_PROBE__,
    );

    const refreshAndLog = () => {
      ensureVkOverlayStyle();
      const count = refreshVkOverlayProbe();
      const currentProbe = (globalThis as Record<string, unknown>).__VOT_VK_PROBE__;
      const signature = JSON.stringify(currentProbe);
      if (count > 0 && signature !== lastProbeSignature) {
        lastProbeSignature = signature;
        logProbeState("[VOT][VK probe] standard overlay refresh");
      }
    };

    let ticks = 0;
    const intervalId = globalThis.setInterval(() => {
      ticks += 1;
      refreshAndLog();
      if (ticks >= 160) {
        globalThis.clearInterval(intervalId);
      }
    }, 500);

    document.addEventListener(
      "visibilitychange",
      () => {
        if (!document.hidden) {
          refreshAndLog();
        }
      },
      { passive: true },
    );
  } catch (error) {
    console.warn("[VOT][VK probe] failed", error);
  }
}
