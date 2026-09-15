const DATASET_KEY = "votPageContextSnapshot";
const REQUEST_EVENT = "vot:page-context-request";
const READY_EVENT = "vot:page-context-ready";
const BRIDGE_SCRIPT_ID = "vot-page-context-bridge";

const SNAPSHOT_GLOBAL_KEYS = [
  "player",
  "__NEXT_DATA__",
  "__INITIAL_STATE__",
  "__PRELOADED_STATE__",
  "__NUXT__",
  "__playinfo__",
  "ytInitialData",
  "ytInitialPlayerResponse",
  "udemyData",
  "course_id",
  "lessons",
  "flashvars",
  "playerConfig",
  "appMediaViewer",
  "Videoview",
  "SENTRY_RELEASE",
];

export type PageContextMoviePlayerSnapshot = {
  videoData?: unknown;
  playerResponse?: unknown;
  audioTrack?: unknown;
  duration?: number;
  videoUrl?: string;
  progressState?: unknown;
  volume?: number;
  muted?: boolean;
};

export type PageContextSnapshot = {
  href?: string;
  hostname?: string;
  title?: string;
  timestamp?: number;
  awemeInfo?: unknown;
  moviePlayer?: PageContextMoviePlayerSnapshot;
  moviePlayerVideoData?: unknown;
  vkPlayerObject?: unknown;
  player?: unknown;
  globals?: Record<string, unknown>;
};

let bridgeInstallRequested = false;

function getDatasetSnapshotRaw(): string {
  try {
    return String(document.documentElement?.dataset?.[DATASET_KEY] || "");
  } catch {
    return "";
  }
}

function parseSnapshot(raw: string): PageContextSnapshot | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as PageContextSnapshot)
      : null;
  } catch (error) {
    console.warn("[VOT][page-context] failed to parse snapshot", error);
    return null;
  }
}

export function extractPageContextSnapshot(
  snapshotGlobalKeys: string[] = SNAPSHOT_GLOBAL_KEYS,
): PageContextSnapshot {
  const MAX_DEPTH = 4;
  const MAX_KEYS = 40;
  const MAX_ARRAY = 20;
  const reservedObjectKeys = new Set(["__proto__", "constructor", "prototype"]);

  const sanitize = (
    value: unknown,
    depth = 0,
    seen = new WeakSet<object>(),
  ): unknown => {
    if (value == null) {
      return value;
    }

    const valueType = typeof value;
    if (
      valueType === "string" ||
      valueType === "number" ||
      valueType === "boolean"
    ) {
      return value;
    }

    if (valueType === "bigint") {
      return String(value);
    }

    if (valueType === "function" || valueType === "symbol") {
      return undefined;
    }

    if (depth >= MAX_DEPTH) {
      return undefined;
    }

    if (value instanceof Node || value === window || value === document) {
      return undefined;
    }

    if (Array.isArray(value)) {
      const next: unknown[] = [];
      for (const item of value.slice(0, MAX_ARRAY)) {
        const sanitized = sanitize(item, depth + 1, seen);
        if (sanitized !== undefined) {
          next.push(sanitized);
        }
      }
      return next;
    }

    if (valueType === "object") {
      const objectValue = value as Record<string, unknown>;
      if (seen.has(objectValue)) {
        return undefined;
      }
      seen.add(objectValue);

      const next: Record<string, unknown> = {};
      const keys = Object.keys(objectValue).slice(0, MAX_KEYS);
      for (const key of keys) {
        if (reservedObjectKeys.has(key)) {
          continue;
        }
        const sanitized = sanitize(objectValue[key], depth + 1, seen);
        if (sanitized !== undefined) {
          next[key] = sanitized;
        }
      }
      return next;
    }

    return undefined;
  };

  const callMoviePlayerMethod = (
    moviePlayer: Element | null,
    methodName: string,
  ): unknown => {
    try {
      const maybeMethod = (moviePlayer as Record<string, unknown> | null)?.[
        methodName
      ];
      if (typeof maybeMethod === "function") {
        return sanitize(
          (maybeMethod as (this: unknown) => unknown).call(moviePlayer),
        );
      }
    } catch {
      return undefined;
    }

    return undefined;
  };

  const getMoviePlayerSnapshot = ():
    | PageContextMoviePlayerSnapshot
    | undefined => {
    const moviePlayer = document.querySelector("#movie_player");
    if (!moviePlayer) {
      return undefined;
    }

    const moviePlayerSnapshot: PageContextMoviePlayerSnapshot = {
      videoData: callMoviePlayerMethod(moviePlayer, "getVideoData"),
      playerResponse: callMoviePlayerMethod(moviePlayer, "getPlayerResponse"),
      audioTrack: callMoviePlayerMethod(moviePlayer, "getAudioTrack"),
      progressState: callMoviePlayerMethod(moviePlayer, "getProgressState"),
    };

    const duration = callMoviePlayerMethod(moviePlayer, "getDuration");
    if (typeof duration === "number" && Number.isFinite(duration)) {
      moviePlayerSnapshot.duration = duration;
    }

    const videoUrl = callMoviePlayerMethod(moviePlayer, "getVideoUrl");
    if (typeof videoUrl === "string") {
      moviePlayerSnapshot.videoUrl = videoUrl;
    }

    const volume = callMoviePlayerMethod(moviePlayer, "getVolume");
    if (typeof volume === "number" && Number.isFinite(volume)) {
      moviePlayerSnapshot.volume = volume;
    }

    const muted = callMoviePlayerMethod(moviePlayer, "isMuted");
    if (typeof muted === "boolean") {
      moviePlayerSnapshot.muted = muted;
    }

    return Object.values(moviePlayerSnapshot).some(
      (value) => value !== undefined,
    )
      ? moviePlayerSnapshot
      : undefined;
  };

  const getVkPlayerObject = (): unknown => {
    try {
      const pageWindow = window as Record<string, unknown>;
      const videoview = pageWindow.Videoview as
        | { getPlayerObject?: () => unknown }
        | undefined;
      if (
        typeof videoview !== "undefined" &&
        typeof videoview?.getPlayerObject === "function"
      ) {
        return sanitize(videoview.getPlayerObject.call(undefined));
      }
    } catch {
      return undefined;
    }

    return undefined;
  };

  const globals: Record<string, unknown> = {};
  for (const key of snapshotGlobalKeys) {
    if (reservedObjectKeys.has(key)) {
      continue;
    }

    try {
      if (key in window) {
        const sanitized = sanitize((window as Record<string, unknown>)[key]);
        if (sanitized !== undefined) {
          globals[key] = sanitized;
        }
      }
    } catch {
      // Ignore cross-context read failures.
    }
  }

  let player: unknown;
  let awemeInfo: unknown;
  try {
    const pageWindow = window as Record<string, unknown>;
    const playerObject = pageWindow.player as
      | { config?: { awemeInfo?: unknown } }
      | undefined;
    player = sanitize(playerObject);
    awemeInfo = sanitize(playerObject?.config?.awemeInfo);
  } catch {
    // Ignore player access failures.
  }

  const moviePlayer = getMoviePlayerSnapshot();

  return {
    href: location.href,
    hostname: location.hostname,
    title: document.title,
    timestamp: Date.now(),
    globals,
    player,
    awemeInfo,
    moviePlayer,
    moviePlayerVideoData: moviePlayer?.videoData,
    vkPlayerObject: getVkPlayerObject(),
  };
}

function buildBridgeSource(): string {
  return `(() => {
    try {
      const DATASET_KEY = ${JSON.stringify(DATASET_KEY)};
      const REQUEST_EVENT = ${JSON.stringify(REQUEST_EVENT)};
      const READY_EVENT = ${JSON.stringify(READY_EVENT)};
      const SNAPSHOT_GLOBAL_KEYS = ${JSON.stringify(SNAPSHOT_GLOBAL_KEYS)};
      const MAX_SERIALIZED_LENGTH = 180000;
      const installKey = "__VOT_PAGE_CONTEXT_BRIDGE_INSTALLED__";
      const extractSnapshot = ${extractPageContextSnapshot.toString()};

      if (window[installKey]) {
        return;
      }
      window[installKey] = true;

      const collectSnapshot = () => {
        return extractSnapshot(SNAPSHOT_GLOBAL_KEYS);
      };

      const publishSnapshot = () => {
        try {
          const snapshot = collectSnapshot();
          const serialized = JSON.stringify(snapshot);
          if (serialized.length <= MAX_SERIALIZED_LENGTH) {
            document.documentElement.dataset[DATASET_KEY] = serialized;
          }
          document.dispatchEvent(
            new CustomEvent(READY_EVENT, {
              detail: {
                size: serialized.length,
                hasPlayer: Boolean(snapshot.player),
                hasMoviePlayerVideoData: Boolean(snapshot.moviePlayerVideoData),
                hasMoviePlayer: Boolean(snapshot.moviePlayer),
                hasAwemeInfo: Boolean(snapshot.awemeInfo),
                hasVkPlayerObject: Boolean(snapshot.vkPlayerObject),
              },
            }),
          );
        } catch (error) {
          try {
            document.dispatchEvent(
              new CustomEvent(READY_EVENT, {
                detail: {
                  error:
                    error && typeof error === "object" && "message" in error
                      ? String(error.message)
                      : String(error),
                },
              }),
            );
          } catch {
            // Ignore bridge publication failures.
          }
        }
      };

      document.addEventListener(REQUEST_EVENT, publishSnapshot, false);
      document.addEventListener("readystatechange", publishSnapshot, false);
      window.addEventListener("hashchange", publishSnapshot, false);
      window.addEventListener("popstate", publishSnapshot, false);
      publishSnapshot();
    } catch {
      // Ignore bridge install failures.
    }
  })();`;
}

function installPageContextBridge(): void {
  if (bridgeInstallRequested) {
    return;
  }

  bridgeInstallRequested = true;

  const parent = document.head || document.documentElement;
  if (!parent) {
    return;
  }

  const script = document.createElement("script");
  script.id = BRIDGE_SCRIPT_ID;
  script.textContent = buildBridgeSource();
  parent.appendChild(script);
  script.remove();

  console.log("[VOT][page-context] bridge install requested", {
    href: globalThis.location.href,
  });
}

export async function requestPageContextSnapshot(
  timeoutMs = 180,
): Promise<PageContextSnapshot | null> {
  installPageContextBridge();

  return await new Promise((resolve) => {
    let settled = false;

    const finish = () => {
      if (settled) {
        return;
      }

      settled = true;
      document.removeEventListener(READY_EVENT, onReady as EventListener);
      resolve(parseSnapshot(getDatasetSnapshotRaw()));
    };

    const onReady = () => {
      finish();
    };

    document.addEventListener(READY_EVENT, onReady as EventListener, {
      once: true,
    });

    try {
      document.dispatchEvent(new CustomEvent(REQUEST_EVENT));
    } catch {
      // Ignore sync request failures and fall back to the last snapshot.
    }

    globalThis.setTimeout(finish, timeoutMs);
  });
}
