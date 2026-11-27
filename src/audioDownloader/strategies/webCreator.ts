import { config } from "@vot.js/shared";
import { createAbortableDelay } from "../../utils/abort";
import { type AudioChunk, concatBuffers } from "./audioChunks";
import {
  buildMediaRanges,
  buildWebCreatorPlayerRequest,
  getConfigValue,
  getPageExperimentFlags,
  getPlayerUrl,
  getYouTubeAuthorization,
  mintPagePoToken,
  postInnertubePlayer,
  resolveFormatUrl,
  resolveYtcfg,
  selectAudioFormat,
  selectGvsPoTokenBinding,
  type WebAbrWindow,
} from "./youtubePlayer";

async function probeContentLength(
  targetWindow: Window,
  streamUrl: string,
  signal: AbortSignal,
  authenticated: boolean,
): Promise<number> {
  const url = new URL(streamUrl);
  url.searchParams.set("range", "0-0");
  url.searchParams.delete("ump");
  const response = await targetWindow.fetch(url, {
    signal,
    credentials: authenticated ? "include" : "omit",
  });
  if (!response.ok) {
    throw new Error(
      `Audio downloader. web ABR media probe failed (${response.status})`,
    );
  }
  const total = Number(
    /\/(\d+)\s*$/.exec(response.headers.get("content-range") ?? "")?.[1],
  );
  if (!(total > 0)) {
    throw new Error("Audio downloader. web ABR content length unknown");
  }
  return total;
}

type MediaRange = { start: number; end: number };
type MediaUrlState = {
  value: string;
};
type RequestNumberRef = { value: number };
const RANGE_SIZES = {
  "2mb": 2 * 1024 * 1024,
  "4mb": 4 * 1024 * 1024,
  "8mb": 8 * 1024 * 1024,
} as const;
type WebAbrTransport = keyof typeof RANGE_SIZES | "stream" | "original";

const WEB_ABR_TRANSPORTS: readonly WebAbrTransport[] = [
  "4mb",
  "2mb",
  "stream",
  "original",
  "8mb",
  "stream",
];

function makeFixedRanges(
  contentLength: number,
  chunkSize: number,
): MediaRange[] {
  const ranges: MediaRange[] = [];
  for (let start = 0; start < contentLength; start += chunkSize) {
    ranges.push({
      start,
      end: Math.min(contentLength - 1, start + chunkSize - 1),
    });
  }
  return ranges;
}

const WEB_ABR_RANGE_MAX_ATTEMPTS = 10;
const WEB_ABR_RANGE_REFRESH_EVERY_FAILURES = 2;
const WEB_ABR_RANGE_RETRY_BASE_DELAY_MS = 250;
const WEB_ABR_RANGE_RETRY_MAX_DELAY_MS = 1500;

// Permanent media HTTP statuses should not be retried repeatedly by the same
// range request. After one signed URL refresh, fail the current transport and
// let the transport matrix try the remaining alternatives.
// 408/425/429/5xx and network errors stay retryable.
const WEB_ABR_FATAL_MEDIA_STATUSES = new Set([401, 403, 404, 410]);

class MediaHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "MediaHttpError";
  }
}

function isFatalMediaError(error: unknown): boolean {
  return (
    error instanceof MediaHttpError &&
    WEB_ABR_FATAL_MEDIA_STATUSES.has(error.status)
  );
}

async function fetchMediaRange(
  targetWindow: Window,
  urlState: MediaUrlState,
  start: number,
  end: number,
  signal: AbortSignal,
  refreshUrl: () => Promise<string>,
  requestNumberRef: RequestNumberRef,
  authenticated: boolean,
): Promise<Uint8Array> {
  let lastError: unknown;
  let refreshedFatal = false;
  for (let attempt = 0; attempt < WEB_ABR_RANGE_MAX_ATTEMPTS; attempt++) {
    signal.throwIfAborted();
    try {
      const url = new URL(urlState.value);
      url.searchParams.set("range", `${start}-${end}`);
      url.searchParams.set("rn", String(++requestNumberRef.value));
      url.searchParams.delete("ump");
      const response = await targetWindow.fetch(url, {
        signal,
        cache: "no-store",
        credentials: authenticated ? "include" : "omit",
      });
      if (!response.ok) {
        throw new MediaHttpError(
          response.status,
          `Audio downloader. Media request failed (${response.status}, range ${start}-${end})`,
        );
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      signal.throwIfAborted();
      if (bytes.byteLength === end - start + 1) {
        return bytes;
      }
      const redirect = new TextDecoder("ascii")
        .decode(bytes)
        .match(/^\s*(https:\/\/\S+)\s*$/)?.[1];
      if (redirect) {
        const next = new URL(redirect);
        if (!/(?:^|\.)googlevideo\.com$/.test(next.hostname))
          throw new Error("Audio downloader. Invalid media redirect");
        urlState.value = next.toString();
        if (attempt + 1 < WEB_ABR_RANGE_MAX_ATTEMPTS) continue;
      }
      throw new Error(
        `Audio downloader. Incomplete web ABR chunk (${bytes.byteLength}/${end - start + 1}, range ${start}-${end})`,
      );
    } catch (error) {
      signal.throwIfAborted();
      lastError = error;
      const failedAttempt = attempt + 1;
      const fatal = isFatalMediaError(error);
      const hasMoreAttempts = failedAttempt < WEB_ABR_RANGE_MAX_ATTEMPTS;
      // A permanent status still gets one URL refresh (expired signatures look
      // like 403), but a second fatal failure or a failed refresh ends this
      // range so the current transport can fail and the matrix can continue.
      const shouldRefreshUrl =
        hasMoreAttempts &&
        (fatal || failedAttempt % WEB_ABR_RANGE_REFRESH_EVERY_FAILURES === 0);

      if (!hasMoreAttempts) break;
      if (fatal && refreshedFatal) break;

      await createAbortableDelay(
        Math.min(
          WEB_ABR_RANGE_RETRY_BASE_DELAY_MS * failedAttempt,
          WEB_ABR_RANGE_RETRY_MAX_DELAY_MS,
        ),
        signal,
      );

      if (shouldRefreshUrl) {
        try {
          const nextUrl = await refreshUrl();
          if (typeof nextUrl !== "string" || !nextUrl) {
            throw new Error("Audio downloader. Failed to refresh media URL");
          }
          urlState.value = nextUrl;
          if (fatal) refreshedFatal = true;
        } catch (refreshError) {
          signal.throwIfAborted();
          // Keep the fatal HTTP error as lastError so the current transport
          // stops instead of retrying the same permanent failure.
          if (fatal) break;
          lastError = refreshError;
        }
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Audio downloader. Media range failed");
}

async function* downloadRanges(
  targetWindow: Window,
  streamUrl: string,
  signal: AbortSignal,
  refreshUrl: () => Promise<string>,
  ranges: MediaRange[],
  authenticated: boolean,
): AsyncGenerator<AudioChunk> {
  const urlState: MediaUrlState = {
    value: streamUrl,
  };
  const requestNumberRef: RequestNumberRef = { value: 0 };
  const pending: Uint8Array[] = [];
  let pendingSize = 0;
  for (let index = 0; index < ranges.length; index++) {
    const { start, end } = ranges[index];
    const buffer = await fetchMediaRange(
      targetWindow,
      urlState,
      start,
      end,
      signal,
      refreshUrl,
      requestNumberRef,
      authenticated,
    );
    pending.push(buffer);
    pendingSize += buffer.byteLength;
    const isLastChunk = index === ranges.length - 1;
    if (pendingSize < config.minChunkSize && !isLastChunk) continue;
    if (pendingSize < 1) {
      throw new Error("Audio downloader. Final web ABR chunk is empty");
    }
    yield { buffer: concatBuffers(pending), isLastChunk };
    pending.length = 0;
    pendingSize = 0;
  }
}

async function* downloadStream(
  targetWindow: Window,
  streamUrl: string,
  signal: AbortSignal,
  authenticated: boolean,
): AsyncGenerator<AudioChunk> {
  const url = new URL(streamUrl);
  url.searchParams.delete("range");
  url.searchParams.delete("rn");
  url.searchParams.delete("ump");
  const response = await targetWindow.fetch(url, {
    signal,
    credentials: authenticated ? "include" : "omit",
  });
  if (!response.ok)
    throw new Error(
      `Audio downloader. Stream request failed (${response.status})`,
    );
  if (!response.body)
    throw new Error("Audio downloader. Stream body is unavailable");

  const reader = response.body.getReader();
  const pending: Uint8Array[] = [];
  let pendingSize = 0;
  let readyChunk: Uint8Array | null = null;
  try {
    for (;;) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
      pending.push(bytes);
      pendingSize += bytes.byteLength;
      if (pendingSize >= config.minChunkSize) {
        const nextChunk = concatBuffers(pending);
        pending.length = 0;
        pendingSize = 0;

        if (readyChunk) {
          yield {
            buffer: readyChunk,
            isLastChunk: false,
          };
        }
        readyChunk = nextChunk;
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {}
  }

  if (pendingSize > 0) {
    if (readyChunk) {
      yield {
        buffer: readyChunk,
        isLastChunk: false,
      };
    }
    yield {
      buffer: concatBuffers(pending),
      isLastChunk: true,
    };
    return;
  }

  if (!readyChunk?.byteLength) {
    throw new Error("Audio downloader. Stream ended without audio data");
  }
  yield {
    buffer: readyChunk,
    isLastChunk: true,
  };
}

async function* downloadWithTransport(
  targetWindow: Window,
  transport: WebAbrTransport,
  streamUrl: string,
  contentLength: number,
  signal: AbortSignal,
  refreshUrl: () => Promise<string>,
  authenticated: boolean,
): AsyncGenerator<AudioChunk> {
  if (transport === "stream") {
    yield* downloadStream(targetWindow, streamUrl, signal, authenticated);
    return;
  }
  const ranges =
    transport === "original"
      ? buildMediaRanges(contentLength)
      : makeFixedRanges(contentLength, RANGE_SIZES[transport]);
  yield* downloadRanges(
    targetWindow,
    streamUrl,
    signal,
    refreshUrl,
    ranges,
    authenticated,
  );
}

export async function* downloadMediaRanges(
  targetWindow: Window,
  streamUrl: string,
  contentLength: number,
  signal: AbortSignal,
  refreshUrl: () => Promise<string>,
  authenticated: boolean,
): AsyncGenerator<AudioChunk> {
  if (!Number.isSafeInteger(contentLength) || contentLength < 1)
    throw new Error("Audio downloader. Invalid media content length");

  let lastError: unknown;
  for (const transport of WEB_ABR_TRANSPORTS) {
    signal.throwIfAborted();
    try {
      // Do not expose any audio to the outer uploader until the selected
      // transport has downloaded the complete source audio successfully.
      // This makes fallback safe even if a transport fails near the end.
      const bufferedChunks: AudioChunk[] = [];
      let downloadedBytes = 0;
      for await (const chunk of downloadWithTransport(
        targetWindow,
        transport,
        streamUrl,
        contentLength,
        signal,
        refreshUrl,
        authenticated,
      )) {
        if (!chunk?.buffer?.byteLength) {
          throw new Error(
            "Audio downloader. Web ABR transport produced an empty chunk",
          );
        }
        bufferedChunks.push(chunk);
        downloadedBytes += chunk.buffer.byteLength;
      }

      if (downloadedBytes !== contentLength) {
        throw new Error(
          `Audio downloader. Incomplete web ABR download (${downloadedBytes}/${contentLength} bytes)`,
        );
      }
      if (bufferedChunks.length < 1) {
        throw new Error(
          "Audio downloader. Web ABR transport returned no audio chunks",
        );
      }

      // Normalize finalization after the full download is verified.
      for (let index = 0; index < bufferedChunks.length; index++) {
        bufferedChunks[index] = {
          ...bufferedChunks[index],
          isLastChunk: index === bufferedChunks.length - 1,
        };
      }

      // Only now make the chunks visible to AudioDownloader/Yandex upload.
      for (const chunk of bufferedChunks) yield chunk;

      return;
    } catch (error) {
      signal.throwIfAborted();
      lastError = error;
      // A fatal media status only ends the current transport. Other transports
      // use different request shapes and may still succeed with the same media.
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Audio downloader. All web ABR transports failed");
}

export async function* getWebCreatorAudioChunks(
  targetWindow: WebAbrWindow,
  videoId: string,
  signal: AbortSignal,
  sourceLanguage?: string,
): AsyncGenerator<AudioChunk> {
  // Legacy web_embedded / tv_downgraded / web clients were removed. Keep a
  // single WEB_CREATOR fallback so SABR remains the primary transport and the
  // fallback path stays deterministic.
  const config = await resolveYtcfg(targetWindow, signal);
  const apiKey = getConfigValue(config, "INNERTUBE_API_KEY");
  if (typeof apiKey !== "string") {
    throw new Error("Audio downloader. web ABR config is unavailable");
  }

  const playerCodes = new Map<string, Promise<string>>();
  const fetchPlayerCode = (url = getPlayerUrl(config)) => {
    if (!url) return Promise.resolve(undefined);
    let code = playerCodes.get(url);
    if (!code) {
      code = targetWindow.fetch(url, { signal }).then((response) => {
        if (!response.ok) {
          throw new Error(
            `Audio downloader. YouTube player request failed (${response.status})`,
          );
        }
        return response.text();
      });
      playerCodes.set(url, code);
    }
    return code;
  };

  let sts = Number(getConfigValue(config, "STS"));
  if (!(sts > 0)) {
    sts = Number(
      (await fetchPlayerCode())?.match(
        /(?:signatureTimestamp|sts)\s*:\s*([0-9]{5})/,
      )?.[1],
    );
  }

  const visitorData = getConfigValue(config, "VISITOR_DATA");
  const dataSyncId = getConfigValue(config, "DATASYNC_ID");
  const [firstSyncId, secondSyncId] =
    typeof dataSyncId === "string" ? dataSyncId.split("||") : [];
  const delegatedSessionId =
    getConfigValue(config, "DELEGATED_SESSION_ID") ??
    (secondSyncId ? firstSyncId : undefined);
  const authorization = await getYouTubeAuthorization(
    targetWindow,
    String(
      getConfigValue(config, "USER_SESSION_ID") ??
        (secondSyncId || firstSyncId) ??
        "",
    ) || undefined,
  );
  const sessionIndex = getConfigValue(config, "SESSION_INDEX");
  // The regular SAPISIDHASH request is known to work with WEB_CREATOR.
  // An account-scoped hash is retained as a fallback for delegated sessions.
  const standardAuthorization = await getYouTubeAuthorization(targetWindow);
  const authenticatedAuth = {
    authorization: standardAuthorization || authorization,
    sessionIndex,
    delegatedSessionId,
  };
  const delegatedAuth = { authorization, sessionIndex, delegatedSessionId };
  const pageExperimentFlags = getPageExperimentFlags(config);

  const candidateBody = buildWebCreatorPlayerRequest(videoId, {
    visitorData,
    signatureTimestamp: sts,
  });
  const candidateContext = candidateBody.context as {
    client: Record<string, unknown>;
  };
  const clientVersion = String(candidateContext.client.clientVersion ?? "");
  const postPlayer = (auth: typeof authenticatedAuth | undefined) =>
    postInnertubePlayer(
      targetWindow,
      signal,
      apiKey,
      candidateBody,
      "62",
      clientVersion,
      auth ?? {},
    );
  const requiresLogin = (response: Awaited<ReturnType<typeof postPlayer>>) =>
    /LOGIN_REQUIRED|AGE_CHECK_REQUIRED|CONTENT_CHECK_REQUIRED/.test(
      response.playabilityStatus?.status ?? "",
    );
  const requestPlayer = async (authenticated = false) => {
    const primaryAuth =
      authenticated && authenticatedAuth.authorization
        ? authenticatedAuth
        : undefined;
    let response = await postPlayer(primaryAuth);
    if (
      requiresLogin(response) &&
      !primaryAuth &&
      authenticatedAuth.authorization
    ) {
      response = await postPlayer(authenticatedAuth);
    }
    // Some delegated accounts require the session-scoped hash, whereas
    // ordinary signed-in playback works with the standard SAPISIDHASH.
    if (
      requiresLogin(response) &&
      delegatedAuth.authorization &&
      delegatedAuth.authorization !== authenticatedAuth.authorization
    ) {
      response = await postPlayer(delegatedAuth);
    }
    return {
      response,
      authenticated: Boolean(authenticatedAuth.authorization),
    };
  };

  const sessionAuthenticated = Boolean(authenticatedAuth.authorization);
  const initialPlayer = await requestPlayer(sessionAuthenticated);
  const playerResponse = initialPlayer.response;
  const requestAuthenticated = initialPlayer.authenticated;
  const formats = [
    ...(playerResponse.streamingData?.adaptiveFormats ?? []),
    ...(playerResponse.streamingData?.formats ?? []),
  ];
  if (!formats.length) {
    const status = playerResponse.playabilityStatus;
    if (status?.status === "LOGIN_REQUIRED" && !authorization) {
      throw new Error("YOUTUBE_SIGN_IN_SUGGESTED");
    }
    throw new Error(
      `Audio downloader. web_creator ${status?.status ?? "failed"}: ${
        status?.reason ?? status?.messages?.join(" ") ?? "no streaming data"
      }`,
    );
  }

  const format = selectAudioFormat(formats, sourceLanguage);
  const poTokenBinding = selectGvsPoTokenBinding(videoId, {
    loggedIn: sessionAuthenticated,
    dataSyncId:
      playerResponse.responseContext?.mainAppWebResponseContext?.datasyncId ||
      dataSyncId,
    visitorData: candidateContext.client.visitorData ?? visitorData,
    experimentFlags: pageExperimentFlags,
  });
  let poToken: Promise<string | undefined> | undefined;
  const authorizeUrl = async (streamUrl: string) => {
    const url = new URL(streamUrl);
    if (!url.searchParams.has("pot") && poTokenBinding) {
      poToken ??= mintPagePoToken(targetWindow, poTokenBinding.value, signal);
      const token = await poToken;
      if (token) {
        url.searchParams.set("pot", token);
      } else {
        // Never knowingly send a protected GVS request without its selected
        // PO token. The same authorization step is used by refreshed URLs, so
        // retries cannot silently lose `pot=` either.
        poToken = undefined;
        throw new Error(
          `Audio downloader. GVS PO token unavailable (${poTokenBinding.kind})`,
        );
      }
    }
    return url.toString();
  };
  const getCode = () => fetchPlayerCode();
  let lastError: unknown;

  for await (const solvedUrl of resolveFormatUrl(
    targetWindow,
    format,
    getCode,
    signal,
  )) {
    try {
      const streamUrl = await authorizeUrl(solvedUrl);
      const contentLength =
        Number(format.contentLength) ||
        (await probeContentLength(
          targetWindow,
          streamUrl,
          signal,
          sessionAuthenticated,
        ));
      const refreshUrl = async () => {
        const refreshedPlayer = await requestPlayer(requestAuthenticated);
        const response = refreshedPlayer.response;
        const refreshed = [
          ...(response.streamingData?.adaptiveFormats ?? []),
          ...(response.streamingData?.formats ?? []),
        ].find(
          (entry) =>
            entry.itag === format.itag &&
            entry.mimeType === format.mimeType &&
            Number(entry.contentLength) === contentLength &&
            entry.lastModified === format.lastModified,
        );
        if (!refreshed) {
          throw new Error("Audio downloader. Refreshed audio format changed");
        }
        for await (const url of resolveFormatUrl(
          targetWindow,
          refreshed,
          getCode,
          signal,
        )) {
          return await authorizeUrl(url);
        }
        throw new Error("Audio downloader. Refreshed audio URL unavailable");
      };
      try {
        yield* downloadMediaRanges(
          targetWindow,
          streamUrl,
          contentLength,
          signal,
          refreshUrl,
          sessionAuthenticated,
        );
      } catch (error) {
        if (error instanceof MediaHttpError && error.status === 403) {
          const url = new URL(streamUrl);
          throw new Error(
            `Audio downloader. GVS rejected media (403; pot=${url.searchParams.has("pot")}; n=${url.searchParams.has("n")}; track=${format.audioTrackId ?? format.audioTrack?.id ?? "unknown"}). ` +
              `Check PO token binding and player n-transform.`,
            { cause: error },
          );
        }
        throw error;
      }
      return;
    } catch (error) {
      signal.throwIfAborted();
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Audio downloader. web_creator has no playable audio URL");
}
