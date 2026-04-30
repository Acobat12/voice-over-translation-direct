type StartLightweightVideoProbeOptions = {
  onVideoDetected: (reason: string, video?: HTMLVideoElement) => void;
  selectors?: string[];
  strategy?: "mutation" | "poll";
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
};

function asMatchedVideo(
  candidate: Element | HTMLVideoElement | null | undefined,
): HTMLVideoElement | null {
  return candidate instanceof HTMLVideoElement ? candidate : null;
}

function findMatchingVideoInRoot(
  root: ParentNode,
  selectors: readonly string[],
): HTMLVideoElement | null {
  for (const selector of selectors) {
    try {
      const directMatch = asMatchedVideo(root.querySelector(selector));
      if (directMatch) {
        return directMatch;
      }
    } catch {
      // Ignore invalid selectors.
    }
  }

  return null;
}

function querySelectorExists(root: ParentNode, selector: string): boolean {
  if (typeof root.querySelector !== "function") {
    return false;
  }
  try {
    return Boolean(root.querySelector(selector));
  } catch {
    return false;
  }
}

function nodeMatchesSelectors(
  node: Node,
  selectors: readonly string[],
): boolean {
  if (
    node.nodeType !== Node.ELEMENT_NODE &&
    node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE &&
    node.nodeType !== Node.DOCUMENT_NODE
  ) {
    return false;
  }

  const root = node as ParentNode;
  for (const selector of selectors) {
    if (node instanceof Element) {
      try {
        if (node.matches(selector)) {
          return true;
        }
      } catch {
        // Ignore invalid selectors.
      }
    }

    if (querySelectorExists(root, selector)) {
      return true;
    }

    if (node instanceof Element && node.shadowRoot) {
      if (querySelectorExists(node.shadowRoot, selector)) {
        return true;
      }
    }
  }

  return false;
}

export function startLightweightVideoProbe(
  options: StartLightweightVideoProbeOptions,
): () => void {
  let active = true;
  let observedRoot: Node | null = null;
  let observer: MutationObserver | null = null;
  let readyListener: (() => void) | null = null;
  let pollTimer: number | null = null;
  const selectors =
    options.selectors?.filter((selector) => String(selector || "").trim()) ??
    [];
  const probeSelectors = selectors.length > 0 ? selectors : ["video"];
  const strategy = options.strategy ?? "mutation";
  const pollIntervalMs = Math.max(25, Math.trunc(options.pollIntervalMs ?? 75));
  const pollTimeoutMs = Math.max(
    250,
    Math.trunc(options.pollTimeoutMs ?? 4000),
  );
  const pollDeadlineAt = Date.now() + pollTimeoutMs;

  const cleanup = () => {
    if (!active) {
      return;
    }
    active = false;
    observer?.disconnect();
    observer = null;
    observedRoot = null;
    if (pollTimer !== null) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    if (readyListener) {
      document.removeEventListener("readystatechange", readyListener);
      readyListener = null;
    }
  };

  const activate = (reason: string, video?: HTMLVideoElement) => {
    if (!active) {
      return;
    }
    cleanup();
    options.onVideoDetected(reason, video);
  };

  const inspectExistingTree = () => {
    const matchedVideo = findMatchingVideoInRoot(document, probeSelectors);
    if (matchedVideo) {
      activate("probe-existing-video", matchedVideo);
      return true;
    }

    if (nodeMatchesSelectors(document, probeSelectors)) {
      activate("probe-existing-video");
      return true;
    }
    return false;
  };

  const schedulePoll = () => {
    if (!active) {
      return;
    }

    if (inspectExistingTree()) {
      return;
    }

    if (Date.now() >= pollDeadlineAt) {
      return;
    }

    pollTimer = globalThis.setTimeout(schedulePoll, pollIntervalMs);
  };

  const ensureObserver = () => {
    if (!active || observer) {
      return;
    }

    observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type !== "childList") {
          continue;
        }

        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLVideoElement) {
            activate("probe-video-added", node);
            return;
          }

          if (
            node instanceof Document ||
            node instanceof DocumentFragment ||
            node instanceof Element
          ) {
            const matchedVideo = findMatchingVideoInRoot(node, probeSelectors);
            if (matchedVideo) {
              activate("probe-video-added", matchedVideo);
              return;
            }
          }

          if (nodeMatchesSelectors(node, probeSelectors)) {
            activate("probe-video-added");
            return;
          }
        }
      }
    });

    const root = document.documentElement;
    if (!root) {
      readyListener = () => {
        if (!active || observedRoot) {
          return;
        }
        const nextRoot = document.documentElement;
        if (!nextRoot) {
          return;
        }
        if (readyListener) {
          document.removeEventListener("readystatechange", readyListener);
        }
        readyListener = null;
        observedRoot = nextRoot;
        if (strategy === "mutation") {
          observer?.observe(nextRoot, { childList: true, subtree: true });
          inspectExistingTree();
          return;
        }
        schedulePoll();
      };
      document.addEventListener("readystatechange", readyListener);
      return;
    }

    observedRoot = root;
    if (strategy === "mutation") {
      observer.observe(root, { childList: true, subtree: true });
      return;
    }
    schedulePoll();
  };

  if (!inspectExistingTree()) {
    ensureObserver();
  }

  return cleanup;
}
