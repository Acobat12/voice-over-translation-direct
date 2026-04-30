import type { RequestLang, ResponseLang } from "@vot.js/shared/types/data";
import { defaultAutoVolume } from "../../config/config";
import { YANDEX_TTL_MS } from "../../core/cacheManager";
import { isTranslationDownloadHost } from "../../core/hostPolicies";
import { isCustomPlaybackTarget } from "../../core/playbackPolicy";
import { getTunnelPlayerContext } from "../../core/tunnelPlayer";
import type { VideoHandler } from "../../index";
import { localizationProvider } from "../../localization/localizationProvider";
import debug from "../../utils/debug";
import { toErrorMessage } from "../../utils/errors";
import { GM_fetch } from "../../utils/gm";
import { clamp } from "../../utils/utils";
import VOTLocalizedError from "../../utils/VOTLocalizedError";
import type { VideoData } from "../shared";
import {
  computeSmartDuckingStep,
  initSmartDuckingRuntime,
  resetSmartDuckingRuntime,
  SMART_DUCKING_DEFAULT_CONFIG,
  type SmartDuckingRuntime,
} from "./ducking";
import {
  isYandexAudioUrlOrProxy,
  proxifyYandexAudioUrl,
  unproxifyYandexAudioUrl,
} from "./proxyShared";
import {
  normalizeTranslationHelp,
  notifyTranslationFailureIfNeeded,
  requestAndApplyTranslation,
  setTranslationCacheValue,
  type TranslationAudioResult,
  updateTranslationAndSchedule,
} from "./translationShared";

type StopSmartVolumeDuckingOptions = {
  /**
   * Restores the video volume to this value (0..1) before resetting state.
   *
   * When omitted, we restore to the last known baseline (but only if we were
   * actively ducked).
   */
  restoreVolume?: number;
};

type ActionContext = { gen: number; videoId: string };

type AutoVolumeMode = "off" | "classic" | "smart";

type PendingAutoplayRecovery = ActionContext & {
  sourceUrl: string;
  createdAt: number;
};

type PvlTranslationReadyPayload = {
  url: string;
  videoSrc: string;
  videoTitle: string;
  suggestedFileName: string;
  subtitlesUrl: string | null;
  suggestedSubtitlesFileName: string | null;
};

type ApplyTranslationSourceResult =
  | {
      status: "success";
      didSetSource: boolean;
      appliedSourceUrl: string | null;
    }
  | {
      status: "stale";
      didSetSource: boolean;
      appliedSourceUrl: string | null;
    }
  | {
      status: "error";
      didSetSource: boolean;
      appliedSourceUrl: string | null;
      error: unknown;
    };

const SMART_DUCKING_TICK_MS = SMART_DUCKING_DEFAULT_CONFIG.tickMs;
const AUDIO_PROBE_TIMEOUT_MS = 1200;
const AUDIO_PROBE_RETRY_DELAY_MS = 100;
const AUDIO_PROBE_MAX_ATTEMPTS = 1;
const TRANSLATED_AUDIO_START_TIMEOUT_MS = 4000;

type AudioPlayerLike = {
  audio?: HTMLMediaElement;
  audioElement?: HTMLMediaElement;
  gainNode?: AudioNode;
  audioSource?: AudioNode;
  mediaElementSource?: AudioNode;
  lipSync?: (mode?: false | string) => unknown;
  play?: () => Promise<unknown>;
  pause?: () => Promise<unknown>;
  clear?: () => Promise<unknown>;
  currentSrc?: string;
  src?: string;
  volume?: number;
};

type GainNodeLike = AudioNode & {
  gain?: AudioParam;
  context?: BaseAudioContext;
};

type SmartDuckingAnalyserState = {
  analyser?: AnalyserNode;
  analyserFloatData?: Float32Array<ArrayBuffer>;
  analyserData?: Uint8Array<ArrayBuffer>;
  connectedInputNode?: AudioNode;
  mediaElement?: HTMLMediaElement;
  audioContext?: AudioContext;
  createdMediaSource?: MediaElementAudioSourceNode;
  mediaSourceCreationFailed?: boolean;
};

const smartDuckingAnalyserState = new WeakMap<
  VideoHandler,
  SmartDuckingAnalyserState
>();

function isMediaAbortError(error: unknown): boolean {
  const name = String((error as { name?: unknown })?.name ?? "");
  const message = String(
    (error as { message?: unknown })?.message ?? error ?? "",
  );

  return (
    name === "AbortError" ||
    message.includes(
      "The fetching process for the media resource was aborted",
    ) ||
    message.includes("media resource was aborted by the user agent")
  );
}

function isAudioNode(node: unknown): node is AudioNode {
  if (!node || typeof node !== "object") return false;
  const candidate = node as { connect?: unknown; disconnect?: unknown };
  return (
    typeof candidate.connect === "function" &&
    typeof candidate.disconnect === "function"
  );
}

function normalizeMediaElementVolume(volume: number): number {
  if (!Number.isFinite(volume)) return 0;
  return Math.max(0, Math.min(1, volume));
}

function normalizeGainVolume(volume: number): number {
  if (!Number.isFinite(volume)) return 0;
  return Math.max(0, volume);
}

function setAudioParamInstant(
  param: AudioParam,
  value: number,
  context?: BaseAudioContext,
): void {
  const now = context?.currentTime;
  if (typeof now === "number" && Number.isFinite(now)) {
    try {
      if (
        typeof (param as AudioParam & { cancelAndHoldAtTime?: unknown })
          .cancelAndHoldAtTime === "function"
      ) {
        (
          param as AudioParam & { cancelAndHoldAtTime: (time: number) => void }
        ).cancelAndHoldAtTime(now);
      } else if (typeof param.cancelScheduledValues === "function") {
        param.cancelScheduledValues(now);
      }
    } catch {
      // ignore
    }

    if (typeof param.setValueAtTime === "function") {
      param.setValueAtTime(value, now);
      return;
    }
  }

  param.value = value;
}

function safeSetPlayerVolume(
  player: AudioPlayerLike | undefined,
  volume: number,
): void {
  if (!player) return;

  const gainNode = player.gainNode as GainNodeLike | undefined;
  if (gainNode?.gain) {
    setAudioParamInstant(
      gainNode.gain,
      normalizeGainVolume(volume),
      gainNode.context,
    );
  }

  if (typeof player.volume === "number") {
    player.volume = normalizeMediaElementVolume(volume);
  }

  const media = getPlayerMediaElement(player);
  if (media) {
    media.volume = normalizeMediaElementVolume(volume);
  }
}

function applyTranslationPlaybackVolume(
  player: AudioPlayerLike | undefined,
  volumePercent: number | undefined,
  fallbackVolumePercent: number | undefined,
): void {
  const nextVolume =
    typeof volumePercent === "number" && Number.isFinite(volumePercent)
      ? volumePercent
      : fallbackVolumePercent;

  if (typeof nextVolume !== "number" || !Number.isFinite(nextVolume)) {
    return;
  }

  safeSetPlayerVolume(player, nextVolume / 100);
}

function getPlayerMediaElement(
  player?: AudioPlayerLike,
): HTMLMediaElement | undefined {
  return player?.audio ?? player?.audioElement;
}

function getAutoplayRecoveryButtonText(): string {
  return localizationProvider.lang === "ru"
    ? "Запустить звук перевода"
    : "Start translated audio";
}

function getExternalTunnelContext(handler: VideoHandler) {
  if (handler.site.host !== "custom") {
    return null;
  }

  const context = getTunnelPlayerContext();
  if (!context?.hasTranslationReadyCallback) {
    return null;
  }

  return context;
}

function getPvlVideoSourceUrl(handler: VideoHandler): string {
  const tunnelContext = getTunnelPlayerContext();
  const candidates = [
    String(tunnelContext?.sourceUrl || "").trim(),
    String((globalThis as Record<string, unknown>).__PVL_VOT_SRC ?? "").trim(),
    String(handler.video?.dataset?.votSrc || "").trim(),
    String(handler.video?.currentSrc || handler.video?.src || "").trim(),
    String(handler.videoData?.url || "").trim(),
  ].filter(Boolean);

  return candidates[0] || globalThis.location.href;
}

function getPvlTranslatedSubtitlesUrl(): string | null {
  const scope = globalThis as Record<string, unknown>;
  const generic = String(scope.__VOT_LAST_EXTERNAL_SUBTITLE_URL__ ?? "").trim();
  if (generic) {
    return generic;
  }

  const direct = String(scope.__PVL_LAST_TRANSLATED_SUBTITLES_URL ?? "").trim();
  if (direct) {
    return direct;
  }

  const lastTrack = scope.__VOT_LAST_SUBTITLE_TRACK__;
  if (lastTrack && typeof lastTrack === "object") {
    const effectiveUrl = String(
      (lastTrack as Record<string, unknown>).effectiveUrl ?? "",
    ).trim();
    if (effectiveUrl) {
      return effectiveUrl;
    }
  }

  return null;
}

function buildPvlTranslationReadyPayload(
  handler: VideoHandler,
  audioUrl: string,
): PvlTranslationReadyPayload {
  const baseName = handler.getDownloadBaseName() || "translation";
  const subtitlesUrl = getPvlTranslatedSubtitlesUrl();

  return {
    url: audioUrl,
    videoSrc: getPvlVideoSourceUrl(handler),
    videoTitle:
      String(
        handler.videoData?.downloadTitle || handler.videoData?.title || "",
      ).trim() || baseName,
    suggestedFileName: `${baseName}.translated.mp3`,
    subtitlesUrl,
    suggestedSubtitlesFileName: subtitlesUrl
      ? `${baseName}.translated.vtt`
      : null,
  };
}

async function _notifyPvlTranslationReady(
  handler: VideoHandler,
  audioUrl: string,
): Promise<boolean> {
  const tunnelContext = getExternalTunnelContext(handler);
  if (!tunnelContext) {
    return false;
  }

  const payload = buildPvlTranslationReadyPayload(handler, audioUrl);

  try {
    const state = globalThis as Record<string, unknown>;
    const dedupeKey = `${handler.videoData?.videoId || ""}|${audioUrl}`;

    if (state.__PVL_LAST_TRANSLATION_READY_KEY__ === dedupeKey) {
      debug.log("[VOT][tunnel] skip duplicate translation-ready", {
        dedupeKey,
      });
      return true;
    }

    state.__PVL_LAST_TRANSLATION_READY_KEY__ = dedupeKey;
    const response = await fetch("/translation-ready", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      mode: "same-origin",
      credentials: "same-origin",
      cache: "no-store",
    });

    if (!response.ok) {
      debug.log("[VOT][tunnel] translation-ready callback failed", {
        kind: tunnelContext.kind,
        status: response.status,
        statusText: response.statusText,
        payload,
      });
      return false;
    }

    debug.log("[VOT][tunnel] translation-ready callback sent", {
      kind: tunnelContext.kind,
      payload,
    });
    return true;
  } catch (error) {
    debug.log("[VOT][tunnel] translation-ready callback error", {
      kind: tunnelContext.kind,
      error,
    });
    return false;
  }
}

function getAutoplayRecoveryHintText(): string {
  return localizationProvider.lang === "ru"
    ? "Браузер заблокировал автозапуск перевода. Нажмите на страницу или на кнопку ещё раз."
    : "Browser autoplay blocked translated audio. Click the page or the button again.";
}

function setPendingAutoplayDebugValue(
  handler: VideoHandler,
  pending: PendingAutoplayRecovery | null,
): void {
  const globalRecord = globalThis as Record<string, unknown>;
  if (!pending) {
    try {
      globalRecord.__VOT_PENDING_AUTOPLAY_RECOVERY__ = null;
    } catch (error) {
      debug.log(
        "[VOT][audio] failed to reset pending autoplay debug value",
        error,
      );
    }
    return;
  }

  try {
    globalRecord.__VOT_PENDING_AUTOPLAY_RECOVERY__ = {
      ...pending,
      siteHost: handler.site.host,
      pageUrl: globalThis.location.href,
    };
  } catch (error) {
    debug.log(
      "[VOT][audio] failed to store pending autoplay debug value",
      error,
    );
  }
}

function clearPendingAutoplayRecoveryState(handler: VideoHandler): void {
  try {
    handler.pendingAutoplayRecoveryAbortController?.abort();
  } catch {
    // ignore
  }

  handler.pendingAutoplayRecoveryAbortController = undefined;
  handler.pendingAutoplayRecovery = null;
  setPendingAutoplayDebugValue(handler, null);
}

function hasPlayableMediaState(media: HTMLMediaElement): boolean {
  return Boolean(
    media.readyState >= HTMLMediaElement.HAVE_METADATA ||
      media.currentTime > 0 ||
      (Number.isFinite(media.duration) && media.duration > 0),
  );
}

function hasManagedAudioGraph(player?: AudioPlayerLike): boolean {
  return Boolean(
    player?.gainNode || player?.audioSource || player?.mediaElementSource,
  );
}

function hasStartedAudiblePlayback(
  handler: VideoHandler,
  media: HTMLMediaElement,
  player?: AudioPlayerLike,
): boolean {
  if (media.paused || media.readyState < 2 || media.error) {
    return false;
  }

  const audioContextState =
    handler.audioPlayer?.audioContext?.state ?? handler.audioContext?.state;

  if (audioContextState === "suspended" && hasManagedAudioGraph(player)) {
    return false;
  }

  return true;
}

function isLikelyAutoplayBlocked(handler: VideoHandler): boolean {
  const player = handler.audioPlayer?.player as unknown as
    | AudioPlayerLike
    | undefined;
  const media = getPlayerMediaElement(player);
  const sourceUrl = String(player?.currentSrc || player?.src || "");
  const audioContextState =
    handler.audioPlayer?.audioContext?.state ?? handler.audioContext?.state;

  if (
    !player ||
    !media ||
    !sourceUrl ||
    !handler.video ||
    handler.video.paused
  ) {
    return false;
  }

  if (media.error) {
    return false;
  }

  if (audioContextState === "suspended" && hasManagedAudioGraph(player)) {
    return true;
  }

  return media.paused && hasPlayableMediaState(media);
}

async function resumePendingAutoplayRecoveryInternal(
  handler: VideoHandler,
  trigger: string,
): Promise<boolean> {
  const pending = handler.pendingAutoplayRecovery;
  if (!pending) {
    return false;
  }

  const actionContext = {
    gen: pending.gen,
    videoId: pending.videoId,
  };

  if (handler.isActionStale(actionContext)) {
    clearPendingAutoplayRecoveryState(handler);
    return false;
  }

  debug.log("[VOT][audio] retrying translated audio after user gesture", {
    trigger,
    sourceUrl: pending.sourceUrl,
    videoId: pending.videoId,
  });

  const player = handler.audioPlayer?.player as unknown as
    | AudioPlayerLike
    | undefined;
  const currentSource = String(player?.currentSrc || player?.src || "");
  const normalizedPendingSource = normalizeManagedAudioUrl(
    handler,
    pending.sourceUrl,
  );
  const normalizedCurrentSource = normalizeManagedAudioUrl(
    handler,
    currentSource,
  );

  if (
    normalizedPendingSource &&
    normalizedCurrentSource !== normalizedPendingSource
  ) {
    const applyResult = await applyTranslationSource(
      handler,
      pending.sourceUrl,
      actionContext,
    );

    if (applyResult.status !== "success") {
      debug.log("[VOT][audio] failed to restore pending translated source", {
        trigger,
        applyResult,
      });
      return false;
    }
  }

  const resumeResult = await resumePlayerAudioContextIfNeeded(handler);
  if (resumeResult === "failed") {
    debug.log(
      "[VOT][audio] AudioContext resume failed during autoplay recovery",
    );
  }

  await attemptTranslatedPlaybackStart(handler, actionContext);

  const started = await ensureTranslatedAudioStarted(
    handler,
    actionContext,
    1800,
  );
  if (!started) {
    debug.log(
      "[VOT][audio] translated audio still did not start after gesture",
      {
        trigger,
        sourceUrl: pending.sourceUrl,
      },
    );
    return false;
  }

  clearPendingAutoplayRecoveryState(handler);
  handler.transformBtn("success", localizationProvider.get("disableTranslate"));
  handler.syncPopupOverlayState({
    hint: handler.downloadTranslationUrl
      ? "Translated audio is ready for download."
      : "Waiting for translated audio.",
  });
  return true;
}

function markAutoplayRecoveryPending(
  handler: VideoHandler,
  sourceUrl: string,
  actionContext?: ActionContext,
): void {
  clearPendingAutoplayRecoveryState(handler);

  const pending: PendingAutoplayRecovery = {
    gen: actionContext?.gen ?? handler.actionsGeneration,
    videoId: actionContext?.videoId ?? handler.videoData?.videoId ?? "",
    sourceUrl,
    createdAt: Date.now(),
  };

  const abortController = new AbortController();
  const gestureEvents = [
    "pointerdown",
    "touchstart",
    "click",
    "keydown",
  ] as const;
  const onUserGesture = (event: Event) => {
    debug.log(
      "[VOT][audio] user gesture detected while autoplay recovery is pending",
      {
        type: event.type,
        sourceUrl,
        videoId: pending.videoId,
      },
    );
    void resumePendingAutoplayRecoveryInternal(
      handler,
      `gesture:${event.type}`,
    );
  };

  handler.pendingAutoplayRecovery = pending;
  handler.pendingAutoplayRecoveryAbortController = abortController;
  setPendingAutoplayDebugValue(handler, pending);

  for (const eventName of gestureEvents) {
    document.addEventListener(eventName, onUserGesture, {
      capture: true,
      passive: eventName !== "keydown",
      signal: abortController.signal,
    });
  }
}

async function attemptTranslatedPlaybackStart(
  handler: VideoHandler,
  actionContext?: ActionContext,
): Promise<void> {
  if (handler.isActionStale(actionContext)) {
    return;
  }

  const player = handler.audioPlayer?.player as unknown as
    | AudioPlayerLike
    | undefined;
  const media = getPlayerMediaElement(player);
  const hostVideo = handler.video;
  const hasSource = Boolean(player?.currentSrc || player?.src);

  if (!player || !hostVideo || hostVideo.paused || !hasSource) {
    return;
  }

  try {
    player.lipSync?.("play");
  } catch (error) {
    debug.log("[updateTranslation] lipSync(play) failed", error);
  }

  try {
    await player.play?.();
  } catch (error) {
    debug.log("[updateTranslation] player.play() failed", error);
  }

  if (!media) {
    return;
  }

  try {
    media.currentTime = hostVideo.currentTime;
  } catch {
    // ignore
  }

  try {
    media.playbackRate = hostVideo.playbackRate;
  } catch {
    // ignore
  }

  try {
    await media.play();
  } catch (error) {
    debug.log("[updateTranslation] media.play() failed", error);
  }
}

export function clearPendingAutoplayRecovery(
  this: VideoHandler,
  resetUi = false,
): void {
  const hadPending = Boolean(this.pendingAutoplayRecovery);
  clearPendingAutoplayRecoveryState(this);

  if (resetUi && hadPending && this.hasActiveSource()) {
    this.transformBtn("success", localizationProvider.get("disableTranslate"));
  }
}

export function isAwaitingAutoplayRecovery(this: VideoHandler): boolean {
  return Boolean(this.pendingAutoplayRecovery);
}

export async function resumePendingAutoplayRecovery(
  this: VideoHandler,
  trigger = "manual",
): Promise<boolean> {
  if (!this.pendingAutoplayRecovery) {
    return false;
  }

  if (this.pendingAutoplayRecoveryPromise) {
    return await this.pendingAutoplayRecoveryPromise;
  }

  const inFlight = resumePendingAutoplayRecoveryInternal(this, trigger).finally(
    () => {
      if (this.pendingAutoplayRecoveryPromise === inFlight) {
        this.pendingAutoplayRecoveryPromise = null;
      }
    },
  );

  this.pendingAutoplayRecoveryPromise = inFlight;
  return await inFlight;
}

export function syncTranslationPlaybackVolume(this: VideoHandler): void {
  const player = this.audioPlayer?.player as unknown as
    | AudioPlayerLike
    | undefined;
  const nextVolume =
    this.uiManager.votOverlayView?.translationVolumeSlider?.value;
  applyTranslationPlaybackVolume(player, nextVolume, this.data?.defaultVolume);
}

export async function primePlaybackByGesture(
  this: VideoHandler,
  trigger = "manual",
): Promise<void> {
  try {
    if (!this.audioPlayer) {
      this.createPlayer();
    }

    const result = await resumePlayerAudioContextIfNeeded(this);
    debug.log("[VOT][audio] primed playback context from user gesture", {
      trigger,
      result,
      player: this.audioPlayer?.player?.constructor?.name ?? "unknown",
    });
  } catch (error) {
    debug.log("[VOT][audio] failed to prime playback context", {
      trigger,
      error,
    });
  }
}

function getNowMs(): number {
  return typeof performance !== "undefined" &&
    typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function getAutoVolumeMode(handler: VideoHandler): AutoVolumeMode {
  if (handler.data?.syncVolume || !handler.data?.enabledAutoVolume) {
    return "off";
  }
  return (handler.data?.enabledSmartDucking ?? true) ? "smart" : "classic";
}

async function resumePlayerAudioContextIfNeeded(
  handler: VideoHandler,
): Promise<"not-needed" | "resumed" | "timeout" | "failed"> {
  const ctx = handler.audioPlayer?.audioContext;
  if (!ctx || ctx.state !== "suspended") return "not-needed";

  const RESUME_TIMEOUT_MS = 1500;

  const resumePromise = (async (): Promise<"resumed" | "failed"> => {
    try {
      await ctx.resume();
      return "resumed";
    } catch (err) {
      debug.log("[updateTranslation] Failed to resume AudioContext", err);
      return "failed";
    }
  })();

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<"timeout">((resolve) => {
    timeoutId = setTimeout(() => resolve("timeout"), RESUME_TIMEOUT_MS);
  });

  const result = await Promise.race([resumePromise, timeoutPromise]);
  if (timeoutId !== undefined) {
    clearTimeout(timeoutId);
  }

  if (result === "resumed") {
    debug.log("[updateTranslation] AudioContext resumed");
  } else if (result === "timeout") {
    debug.log("[updateTranslation] AudioContext resume timeout");
  }

  return result;
}

async function rollbackStaleAppliedSourceIfStillCurrent(
  handler: VideoHandler,
  appliedSourceUrl: string | null,
): Promise<void> {
  if (!appliedSourceUrl || !handler.audioPlayer) return;

  const player = handler.audioPlayer.player;
  const currentSource = String(player.currentSrc || player.src || "");
  const normalizedCurrentUrl = handler.proxifyAudio(
    handler.unproxifyAudio(currentSource),
  );
  const normalizedAppliedUrl = handler.proxifyAudio(
    handler.unproxifyAudio(appliedSourceUrl),
  );
  if (normalizedCurrentUrl !== normalizedAppliedUrl) return;

  try {
    await player.clear();
    player.src = "";
    debug.log("[updateTranslation] cleared stale partially-applied source");
  } catch (err) {
    debug.log("[updateTranslation] failed to clear stale source", err);
  }
}

function getSmartDuckingAudioContext(
  handler: VideoHandler,
): AudioContext | undefined {
  return handler.audioPlayer?.audioContext ?? handler.audioContext;
}

function disconnectSmartDuckingAnalyser(
  state: SmartDuckingAnalyserState,
): void {
  if (state.connectedInputNode && state.analyser) {
    try {
      state.connectedInputNode.disconnect(state.analyser);
    } catch {
      // ignore
    }
  }
  state.connectedInputNode = undefined;

  if (state.createdMediaSource) {
    try {
      state.createdMediaSource.disconnect();
    } catch {
      // ignore
    }
  }
  state.createdMediaSource = undefined;

  if (state.analyser) {
    try {
      state.analyser.disconnect();
    } catch {
      // ignore
    }
  }

  state.analyser = undefined;
  state.analyserFloatData = undefined;
  state.analyserData = undefined;
  state.mediaElement = undefined;
  state.audioContext = undefined;
  state.mediaSourceCreationFailed = false;
}

function releaseSmartDuckingAnalyser(handler: VideoHandler): void {
  const state = smartDuckingAnalyserState.get(handler);
  if (!state) return;

  disconnectSmartDuckingAnalyser(state);
  smartDuckingAnalyserState.delete(handler);
}

function resolveSmartDuckingInputNode(
  player: AudioPlayerLike | undefined,
  media: HTMLMediaElement,
  audioContext: AudioContext,
  state: SmartDuckingAnalyserState,
): AudioNode | undefined {
  if (isAudioNode(player?.gainNode)) return player.gainNode;
  if (isAudioNode(player?.audioSource)) return player.audioSource;
  if (isAudioNode(player?.mediaElementSource)) return player.mediaElementSource;

  if (
    state.mediaSourceCreationFailed &&
    state.mediaElement === media &&
    state.audioContext === audioContext
  ) {
    return undefined;
  }

  if (
    state.createdMediaSource &&
    state.mediaElement === media &&
    state.audioContext === audioContext
  ) {
    return state.createdMediaSource;
  }

  try {
    const source = audioContext.createMediaElementSource(media);
    state.createdMediaSource = source;
    state.mediaSourceCreationFailed = false;
    return source;
  } catch (err) {
    state.mediaSourceCreationFailed = true;
    debug.log("[SmartDucking] failed to create media source", err);
    return undefined;
  }
}

function ensureSmartDuckingAnalyser(
  handler: VideoHandler,
  player: AudioPlayerLike | undefined,
  media: HTMLMediaElement,
): { analyser: AnalyserNode; state: SmartDuckingAnalyserState } | undefined {
  const audioContext = getSmartDuckingAudioContext(handler);
  if (!audioContext) return undefined;

  let state = smartDuckingAnalyserState.get(handler);
  if (!state) {
    state = {};
    smartDuckingAnalyserState.set(handler, state);
  }

  if (
    (state.mediaElement && state.mediaElement !== media) ||
    (state.audioContext && state.audioContext !== audioContext)
  ) {
    disconnectSmartDuckingAnalyser(state);
  }

  state.mediaElement = media;
  state.audioContext = audioContext;

  if (!state.analyser) {
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    state.analyser = analyser;
  }

  const inputNode = resolveSmartDuckingInputNode(
    player,
    media,
    audioContext,
    state,
  );
  const analyser = state.analyser;
  if (!inputNode || !analyser) return undefined;

  if (state.connectedInputNode !== inputNode) {
    if (state.connectedInputNode) {
      try {
        state.connectedInputNode.disconnect(analyser);
      } catch {
        // ignore
      }
    }

    try {
      inputNode.connect(analyser);
      state.connectedInputNode = inputNode;
    } catch (err) {
      debug.log("[SmartDucking] failed to connect analyser", err);
      return undefined;
    }
  }

  return { analyser, state };
}

function readSmartDuckingRuntime(handler: VideoHandler): SmartDuckingRuntime {
  return {
    isDucked: handler.smartVolumeIsDucked,
    speechGateOpen: handler.smartVolumeSpeechGateOpen,
    rmsEnvelope: handler.smartVolumeRmsEnvelope,
    baseline: handler.smartVolumeDuckingBaseline,
    lastApplied: handler.smartVolumeLastApplied,
    lastTickAt: handler.smartVolumeLastTickAt,
    lastSoundAt: handler.smartVolumeLastSoundAt,
    rmsMissingSinceAt: handler.smartVolumeRmsMissingSinceAt,
  };
}

function writeSmartDuckingRuntime(
  handler: VideoHandler,
  runtime: SmartDuckingRuntime,
): void {
  handler.smartVolumeIsDucked = runtime.isDucked;
  handler.smartVolumeSpeechGateOpen = runtime.speechGateOpen;
  handler.smartVolumeRmsEnvelope = runtime.rmsEnvelope;
  handler.smartVolumeDuckingBaseline = runtime.baseline;
  handler.smartVolumeLastApplied = runtime.lastApplied;
  handler.smartVolumeLastTickAt = runtime.lastTickAt;
  handler.smartVolumeLastSoundAt = runtime.lastSoundAt;
  handler.smartVolumeRmsMissingSinceAt = runtime.rmsMissingSinceAt;
}

/**
 * Stops Smart Auto-Volume ducking (if running), optionally restores volume,
 * and resets all ducking-related state.
 */
export function stopSmartVolumeDucking(
  handler: VideoHandler,
  options: StopSmartVolumeDuckingOptions = {},
): void {
  const { restoreVolume } = options;

  if (handler.smartVolumeDuckingInterval !== undefined) {
    clearTimeout(handler.smartVolumeDuckingInterval);
    handler.smartVolumeDuckingInterval = undefined;
  }

  const baseline =
    typeof restoreVolume === "number"
      ? restoreVolume
      : (handler.smartVolumeDuckingBaseline ?? handler.volumeOnStart);

  // Restore only when:
  // - an explicit restoreVolume was requested, OR
  // - we were ducked and have a remembered baseline.
  if (
    typeof baseline === "number" &&
    (typeof restoreVolume === "number" || handler.smartVolumeIsDucked)
  ) {
    try {
      handler.setVideoVolume(baseline);
    } catch {
      // ignore
    }
  }

  releaseSmartDuckingAnalyser(handler);
  writeSmartDuckingRuntime(handler, resetSmartDuckingRuntime());
}

function scheduleNextSmartDuckingTick(handler: VideoHandler): void {
  if (typeof globalThis === "undefined") return;
  if (handler.smartVolumeDuckingInterval === undefined) return;

  handler.smartVolumeDuckingInterval = globalThis.setTimeout(() => {
    if (handler.smartVolumeDuckingInterval === undefined) return;

    try {
      smartDuckingTick(handler);
    } catch (err) {
      debug.log("[SmartDucking] tick failed, stopping smart ducking", err);
      stopSmartVolumeDucking(handler);
      return;
    }

    if (handler.smartVolumeDuckingInterval === undefined) return;
    scheduleNextSmartDuckingTick(handler);
  }, SMART_DUCKING_TICK_MS);
}

function startSmartVolumeDucking(handler: VideoHandler): void {
  if (typeof globalThis === "undefined") return;
  if (handler.smartVolumeDuckingInterval !== undefined) return;
  if (getAutoVolumeMode(handler) !== "smart") return;

  const currentVideoVolume = handler.getVideoVolume();
  const baseline =
    typeof handler.smartVolumeDuckingBaseline === "number"
      ? handler.smartVolumeDuckingBaseline
      : currentVideoVolume;

  const runtime = initSmartDuckingRuntime(baseline);
  if (
    Number.isFinite(currentVideoVolume) &&
    Number.isFinite(baseline) &&
    currentVideoVolume <
      baseline - SMART_DUCKING_DEFAULT_CONFIG.externalBaselineDelta01
  ) {
    // Resuming Smart mode from constant ducking: keep baseline untouched and
    // continue from the already ducked state.
    const now = getNowMs();
    runtime.isDucked = true;
    runtime.speechGateOpen = true;
    runtime.lastApplied = currentVideoVolume;
    runtime.lastSoundAt = now;
  }

  writeSmartDuckingRuntime(handler, runtime);

  handler.smartVolumeDuckingInterval = globalThis.setTimeout(() => {}, 0);
  clearTimeout(handler.smartVolumeDuckingInterval);
  scheduleNextSmartDuckingTick(handler);
}

function getTranslatedAudioRms(
  handler: VideoHandler,
  media: HTMLMediaElement,
): number | undefined {
  const player = handler.audioPlayer?.player as unknown as
    | AudioPlayerLike
    | undefined;
  const analyserBundle = ensureSmartDuckingAnalyser(handler, player, media);
  if (!analyserBundle) return undefined;

  const { analyser, state } = analyserBundle;

  try {
    // Use float time-domain data when available (avoids 8-bit quantization).
    if (typeof analyser.getFloatTimeDomainData === "function") {
      let floatData = state.analyserFloatData;

      if (floatData?.length !== analyser.fftSize) {
        floatData = new Float32Array(analyser.fftSize);
        state.analyserFloatData = floatData;
      }

      analyser.getFloatTimeDomainData(floatData);

      let sum = 0;
      for (const value of floatData) {
        sum += value * value;
      }
      return clamp(Math.sqrt(sum / floatData.length), 0, 1);
    }

    let data = state.analyserData;
    if (data?.length !== analyser.fftSize) {
      data = new Uint8Array(analyser.fftSize);
      state.analyserData = data;
    }

    analyser.getByteTimeDomainData(data);

    let sum = 0;
    for (const rawValue of data) {
      const normalizedValue = (rawValue - 128) / 128;
      sum += normalizedValue * normalizedValue;
    }
    return clamp(Math.sqrt(sum / data.length), 0, 1);
  } catch {
    return undefined;
  }
}

function smartDuckingTick(handler: VideoHandler): void {
  if (getAutoVolumeMode(handler) !== "smart") {
    setupAudioSettings.call(handler);
    return;
  }

  const player = handler.audioPlayer?.player as unknown as
    | AudioPlayerLike
    | undefined;
  const media = getPlayerMediaElement(player);

  const audioIsPlaying =
    !!media &&
    !media.paused &&
    !media.muted &&
    // Treat near-zero volume as inactive.
    (media.volume ?? 1) > 0.001;

  const now = getNowMs();
  const currentVideoVolume = handler.getVideoVolume();

  const hostVideo = handler.video;
  const hostVideoActive = !(hostVideo && (hostVideo.paused || hostVideo.ended));
  const dynamicDuckingTarget =
    clamp(handler.data?.autoVolume ?? defaultAutoVolume, 0, 100) / 100;
  handler.smartVolumeDuckingTarget = dynamicDuckingTarget;
  const rms =
    audioIsPlaying && media ? getTranslatedAudioRms(handler, media) : 0;

  const decision = computeSmartDuckingStep(
    {
      nowMs: now,
      translationActive: handler.hasActiveSource(),
      enabledAutoVolume: true,
      smartEnabled: true,
      audioIsPlaying,
      rms,
      currentVideoVolume,
      hostVideoActive,
      duckingTarget01: dynamicDuckingTarget,
      volumeOnStart: handler.volumeOnStart,
    },
    readSmartDuckingRuntime(handler),
    SMART_DUCKING_DEFAULT_CONFIG,
  );

  switch (decision.kind) {
    case "stop":
      stopSmartVolumeDucking(handler, {
        restoreVolume: decision.restoreVolume,
      });
      return;
    case "apply":
      handler.setVideoVolume(decision.volume01);
      writeSmartDuckingRuntime(handler, decision.runtime);
      return;
    case "noop":
      writeSmartDuckingRuntime(handler, decision.runtime);
      return;
    default:
      throw new TypeError("Unhandled smart ducking decision");
  }
}

function waitForProbeRetry(
  delayMs: number,
  signal: AbortSignal,
): Promise<void> {
  if (delayMs <= 0 || signal.aborted) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);

    const onAbort = () => {
      clearTimeout(timeoutId);
      signal.removeEventListener("abort", onAbort);
      resolve();
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function probeAudioUrl(
  handler: VideoHandler,
  audioUrl: string,
  actionContext?: ActionContext,
): Promise<boolean> {
  const signal = handler.actionsAbortController.signal;
  const fetchOpts = handler.isMultiMethodS3(audioUrl)
    ? {
        method: "HEAD",
        signal,
        timeout: AUDIO_PROBE_TIMEOUT_MS,
      }
    : {
        // Some S3 providers reject HEAD while supporting range probes.
        headers: {
          range: "bytes=0-0",
        },
        signal,
        timeout: AUDIO_PROBE_TIMEOUT_MS,
      };

  for (let attempt = 1; attempt <= AUDIO_PROBE_MAX_ATTEMPTS; attempt++) {
    if (handler.isActionStale(actionContext)) return false;
    try {
      const response = await GM_fetch(audioUrl, fetchOpts);
      if (handler.isActionStale(actionContext)) return false;
      debug.log("[validateAudioUrl] probe response", {
        audioUrl,
        attempt,
        ok: response.ok,
        status: response.status,
      });
      if (response.ok) return true;
    } catch (err: unknown) {
      if (handler.isActionStale(actionContext) || signal.aborted) {
        return false;
      }
      debug.log("[validateAudioUrl] probe error", { audioUrl, attempt, err });
    }

    if (attempt < AUDIO_PROBE_MAX_ATTEMPTS) {
      if (handler.isActionStale(actionContext) || signal.aborted) {
        return false;
      }

      await waitForProbeRetry(AUDIO_PROBE_RETRY_DELAY_MS, signal);

      if (handler.isActionStale(actionContext) || signal.aborted) {
        return false;
      }
    }
  }

  return false;
}

export async function validateAudioUrl(
  this: VideoHandler,
  audioUrl: string,
  actionContext?: ActionContext,
): Promise<string> {
  if (this.isActionStale(actionContext)) {
    return audioUrl;
  }

  const rawUrl = String(audioUrl || "");
  const directUrl = this.unproxifyAudio(rawUrl);
  const normalizedInput = this.proxifyAudio(directUrl);

  const currentSource =
    this.audioPlayer?.player?.currentSrc || this.audioPlayer?.player?.src || "";

  const normalizedCurrent = this.proxifyAudio(
    this.unproxifyAudio(currentSource),
  );

  // Если уже стоит этот же источник — ничего не проверяем.
  if (normalizedInput === normalizedCurrent) {
    return audioUrl;
  }

  // Для Yandex Disk / Google Drive и yandex-tts mp3 не делаем probe вообще.
  // Именно он чаще всего и даёт задержку перед стартом.
  if (
    this.site.host === "yandexdisk" ||
    this.site.host === "googledrive" ||
    this.isMultiMethodS3(rawUrl) ||
    this.isMultiMethodS3(directUrl) ||
    directUrl.includes("vtrans.s3-private.mds.yandex.net") ||
    directUrl.includes("/tts/prod/")
  ) {
    return audioUrl;
  }

  const isPrimaryUrlValid = await probeAudioUrl(this, audioUrl, actionContext);
  if (isPrimaryUrlValid) {
    return audioUrl;
  }

  if (directUrl !== audioUrl) {
    const isDirectUrlValid = await probeAudioUrl(
      this,
      directUrl,
      actionContext,
    );
    if (isDirectUrlValid) {
      debug.log("[validateAudioUrl] switching to direct audio URL after probe");
      return directUrl;
    }
  }

  return audioUrl;
}

export function scheduleTranslationRefresh(this: VideoHandler): void {
  if (!this.videoData || this.videoData.isStream) {
    return;
  }
  if (!this.hasActiveSource()) return;
  clearTimeout(this.translationRefreshTimeout);
  const refreshDelayMs = Math.max(30_000, YANDEX_TTL_MS - 5 * 60 * 1000);
  this.translationRefreshTimeout = setTimeout(() => {
    this.refreshTranslationAudio().catch((error) => {
      debug.log("[scheduleTranslationRefresh] refresh failed", error);
    });
  }, refreshDelayMs);
}

async function requestApplyAndCacheTranslation(
  self: VideoHandler,
  options: {
    videoData: VideoData;
    requestLang: RequestLang;
    responseLang: ResponseLang;
    translationHelp: VideoData["translationHelp"] | undefined;
    actionContext: ActionContext;
    cacheKey: string;
    cacheVideoId: string;
    cacheRequestLang: string;
    cacheResponseLang: string;
    onBeforeCache?: (result: TranslationAudioResult) => Promise<void> | void;
  },
): Promise<TranslationAudioResult | null> {
  const translateRes = await requestAndApplyTranslation({
    requester: self.translationHandler,
    request: {
      videoData: options.videoData,
      requestLang: options.requestLang,
      responseLang: options.responseLang,
      translationHelp: options.translationHelp,
      useAudioDownload: Boolean(self.data?.useAudioDownload),
      signal: self.actionsAbortController.signal,
    },
    actionContext: options.actionContext,
    isActionStale: (ctx) => self.isActionStale(ctx),
    updateTranslation: (url, ctx) => self.updateTranslation(url, ctx),
    scheduleTranslationRefresh: () => self.scheduleTranslationRefresh(),
  });
  if (!translateRes) return null;

  if (options.onBeforeCache) {
    await options.onBeforeCache(translateRes);
  }

  setTranslationCacheValue({
    cacheKey: options.cacheKey,
    setTranslation: (key, value) =>
      self.cacheManager.setTranslation(key, value),
    videoId: options.cacheVideoId,
    requestLang: options.cacheRequestLang,
    responseLang: options.cacheResponseLang,
    fallbackUrl: translateRes.url,
    downloadTranslationUrl: self.downloadTranslationUrl,
    usedLivelyVoice: translateRes.usedLivelyVoice,
  });

  return translateRes;
}

export async function refreshTranslationAudio(
  this: VideoHandler,
): Promise<void> {
  if (!this.videoData || this.videoData.isStream) {
    return;
  }
  if (!this.hasActiveSource()) return;
  if (this.isRefreshingTranslation) return;
  const videoId = this.videoData.videoId;
  if (!videoId) return;
  if (this.actionsAbortController?.signal?.aborted) {
    this.resetActionsAbortController("refreshTranslationAudio");
  }
  this.isRefreshingTranslation = true;
  const actionContext: ActionContext = { gen: this.actionsGeneration, videoId };
  const normalizedTranslationHelp = normalizeTranslationHelp(
    this.videoData.translationHelp,
  );
  try {
    const translateRes = await requestApplyAndCacheTranslation(this, {
      videoData,
      requestLang: resolvedReqLang,
      responseLang: resLang,
      translationHelp: normalizedTranslationHelp,
      actionContext,
      cacheKey,
      cacheVideoId: VIDEO_ID,
      cacheRequestLang: resolvedReqLang,
      cacheResponseLang: responseLang,
      onBeforeCache: async () => {
        const subsCacheKey = this.videoData
          ? this.getSubtitlesCacheKey(
              VIDEO_ID,
              this.videoData.detectedLanguage,
              this.videoData.responseLanguage,
            )
          : null;
        const cachedSubs = subsCacheKey
          ? this.cacheManager.getSubtitles(subsCacheKey)
          : null;

        if (
          !cachedSubs?.some(
            (item) =>
              item.source === "yandex" &&
              item.translatedFromLanguage === videoData.detectedLanguage &&
              item.language === videoData.responseLanguage,
          )
        ) {
          if (subsCacheKey) this.cacheManager.deleteSubtitles(subsCacheKey);
          this.subtitles = [];
          this.subtitlesCacheKey = null;
        }
      },
    });
    if (!translateRes) return;
  } finally {
    this.isRefreshingTranslation = false;
  }
}

export function proxifyAudio(this: VideoHandler, audioUrl: string): string {
  const proxiedAudioUrl = proxifyYandexAudioUrl(audioUrl, {
    translateProxyEnabled: this.data?.translateProxyEnabled,
    proxyWorkerHost: this.data?.proxyWorkerHost,
  });
  if (proxiedAudioUrl !== audioUrl) {
    debug.log(`[VOT] Audio proxied via ${proxiedAudioUrl}`);
  }
  return proxiedAudioUrl;
}

export function unproxifyAudio(this: VideoHandler, audioUrl: string): string {
  return unproxifyYandexAudioUrl(audioUrl);
}

export async function handleProxySettingsChanged(
  this: VideoHandler,
  reason = "proxySettingsChanged",
) {
  debug.log(`[VOT] ${reason}: clearing translation/subtitles cache`);
  try {
    this.cacheManager.clear();
    this.activeTranslation = null;
  } catch {
    // ignore
  }

  // Switching proxy settings should cancel any ongoing translation and leave
  // playback in a clean, disabled state.
  try {
    await this.stopTranslation();
  } catch {
    // ignore
  }

  // Proxy mode/host affects the request target. Recreate client with fresh
  // transport options while keeping normal action resets session-safe.
  await this.initVOTClient();
}

export function isMultiMethodS3(this: VideoHandler, url: string): boolean {
  return isYandexAudioUrlOrProxy(url, {
    proxyWorkerHost: this.data?.proxyWorkerHost,
  });
}

function normalizeManagedAudioUrl(handler: VideoHandler, url: string): string {
  return handler.proxifyAudio(handler.unproxifyAudio(url));
}

async function applyTranslationSource(
  handler: VideoHandler,
  sourceUrl: string,
  actionContext?: ActionContext,
): Promise<ApplyTranslationSourceResult> {
  const didSetSource = handler.audioPlayer.player.src !== sourceUrl;
  let appliedSourceUrl: string | null = null;

  if (didSetSource) {
    handler.audioPlayer.player.src = sourceUrl;
    appliedSourceUrl = sourceUrl;
  }

  try {
    if (didSetSource) {
      try {
        await handler.audioPlayer.init();
      } catch (error) {
        if (!isMediaAbortError(error) || handler.isActionStale(actionContext)) {
          throw error;
        }

        debug.log(
          "[updateTranslation] transient media abort, retrying init once",
          {
            sourceUrl,
            error,
          },
        );

        await new Promise((resolve) => setTimeout(resolve, 200));

        if (handler.isActionStale(actionContext)) {
          await rollbackStaleAppliedSourceIfStillCurrent(
            handler,
            appliedSourceUrl,
          );
          return {
            status: "stale",
            didSetSource,
            appliedSourceUrl,
          };
        }

        const currentSrc = String(
          handler.audioPlayer.player.currentSrc ||
            handler.audioPlayer.player.src ||
            "",
        );

        if (!currentSrc) {
          handler.audioPlayer.player.src = sourceUrl;
        }

        await handler.audioPlayer.init();
      }
    }

    if (handler.isActionStale(actionContext)) {
      await rollbackStaleAppliedSourceIfStillCurrent(handler, appliedSourceUrl);
      return {
        status: "stale",
        didSetSource,
        appliedSourceUrl,
      };
    }

    const resumeResult = await resumePlayerAudioContextIfNeeded(handler);
    if (resumeResult === "timeout") {
      debug.log(
        "[updateTranslation] continuing after AudioContext resume timeout",
      );
    } else if (resumeResult === "failed") {
      debug.log(
        "[updateTranslation] AudioContext resume failed, continue without deferred resume",
      );
    }

    if (handler.isActionStale(actionContext)) {
      await rollbackStaleAppliedSourceIfStillCurrent(handler, appliedSourceUrl);
      return {
        status: "stale",
        didSetSource,
        appliedSourceUrl,
      };
    }

    if (!handler.video.paused && handler.audioPlayer.player.src) {
      await attemptTranslatedPlaybackStart(handler, actionContext);
    }

    return {
      status: "success",
      didSetSource,
      appliedSourceUrl,
    };
  } catch (error: unknown) {
    return {
      status: "error",
      didSetSource,
      appliedSourceUrl,
      error,
    };
  }
}
async function ensureTranslatedAudioStarted(
  handler: VideoHandler,
  actionContext?: ActionContext,
  timeoutMs = TRANSLATED_AUDIO_START_TIMEOUT_MS,
): Promise<boolean> {
  const player = handler.audioPlayer?.player as unknown as
    | AudioPlayerLike
    | undefined;
  const media = getPlayerMediaElement(player);

  if (!player) return false;

  const currentSrc = String(player.currentSrc || player.src || "");
  if (!currentSrc) return false;

  if (!media) {
    return true;
  }

  if (hasStartedAudiblePlayback(handler, media, player)) {
    return true;
  }

  await attemptTranslatedPlaybackStart(handler, actionContext);

  if (hasStartedAudiblePlayback(handler, media, player)) {
    return true;
  }

  return await new Promise<boolean>((resolve) => {
    let done = false;

    const finish = (value: boolean) => {
      if (done) return;
      done = true;
      cleanup();
      resolve(value);
    };

    const onGood = () => {
      void attemptTranslatedPlaybackStart(handler, actionContext);
      finish(true);
    };
    const onBad = () => finish(false);
    const onReady = () => {
      void attemptTranslatedPlaybackStart(handler, actionContext);
      if (hasStartedAudiblePlayback(handler, media, player)) {
        finish(true);
      }
    };

    const timer = setTimeout(() => {
      void attemptTranslatedPlaybackStart(handler, actionContext);
      finish(hasStartedAudiblePlayback(handler, media, player));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      media.removeEventListener("playing", onGood);
      media.removeEventListener("canplay", onReady);
      media.removeEventListener("loadeddata", onReady);
      media.removeEventListener("loadedmetadata", onReady);
      media.removeEventListener("error", onBad);
      //media.removeEventListener("abort", onBad);
    };

    media.addEventListener("playing", onGood, { once: true });
    media.addEventListener("canplay", onReady, { once: true });
    media.addEventListener("loadeddata", onReady, { once: true });
    media.addEventListener("loadedmetadata", onReady, { once: true });
    media.addEventListener("error", onBad, { once: true });
    //media.addEventListener("abort", onBad, { once: true });

    if (handler.isActionStale(actionContext)) {
      finish(false);
    }
  });
}

function shouldRequireImmediateTranslatedStart(handler: VideoHandler): boolean {
  const hostVideo = handler.video;
  return Boolean(hostVideo && !hostVideo.paused && !hostVideo.ended);
}

async function recoverAfterMediaAbort(
  handler: VideoHandler,
  sourceUrl: string,
  actionContext?: ActionContext,
): Promise<boolean> {
  try {
    await handler.audioPlayer?.player?.clear();
  } catch (err) {
    debug.log("[updateTranslation] player.clear failed during recovery", err);
  }

  try {
    if (handler.audioPlayer?.player) {
      handler.audioPlayer.player.src = "";
    }
  } catch {
    // ignore
  }

  try {
    handler.createPlayer();
  } catch (err) {
    debug.log("[updateTranslation] createPlayer failed during recovery", err);
    return false;
  }

  await new Promise((resolve) => setTimeout(resolve, 150));

  if (handler.isActionStale(actionContext)) {
    return false;
  }

  const retryResult = await applyTranslationSource(
    handler,
    sourceUrl,
    actionContext,
  );

  if (retryResult.status !== "success") {
    debug.log("[updateTranslation] recovery retry failed", retryResult);
    return false;
  }

  if (shouldRequireImmediateTranslatedStart(handler)) {
    const started = await ensureTranslatedAudioStarted(
      handler,
      actionContext,
      TRANSLATED_AUDIO_START_TIMEOUT_MS,
    );

    if (!started) {
      debug.log(
        "[updateTranslation] recovery retry attached src but playback did not start",
      );
      return false;
    }
  } else {
    debug.log(
      "[updateTranslation] recovery succeeded while host video is paused; skip immediate start check",
    );
  }

  handler.setupAudioSettings();
  handler.transformBtn("success", localizationProvider.get("disableTranslate"));
  handler.afterUpdateTranslation(sourceUrl);
  if (this.data?.autoSubtitles) {
    setTimeout(() => {
      void this.enableSubtitlesForCurrentLangPair();
    }, 1500);

    setTimeout(() => {
      void this.enableSubtitlesForCurrentLangPair();
    }, 5000);
  }
  return true;
}

export async function updateTranslation(
  this: VideoHandler,
  audioUrl: string,
  actionContext?: ActionContext,
): Promise<void> {
  await this.waitForPendingStopTranslate();
  if (this.isActionStale(actionContext)) return;
  clearPendingAutoplayRecoveryState(this);
  if (!this.audioPlayer) {
    this.createPlayer();
  }
  if (this.audioPlayer.audioContext?.state === "closed") {
    debug.log("[updateTranslation] AudioContext is closed, recreating player");
    this.createPlayer();
  }

  const normalizedTargetUrl = normalizeManagedAudioUrl(this, audioUrl);
  const currentSource =
    this.audioPlayer.player.currentSrc || this.audioPlayer.player.src || "";
  const normalizedCurrentUrl = normalizeManagedAudioUrl(this, currentSource);

  let nextAudioUrl = normalizedTargetUrl;
  if (normalizedTargetUrl !== normalizedCurrentUrl) {
    nextAudioUrl = await this.validateAudioUrl(
      normalizedTargetUrl,
      actionContext,
    );
  }
  if (this.isActionStale(actionContext)) return;
  this.externalTranslationSourceUrl = null;

  let applyResult = await applyTranslationSource(
    this,
    nextAudioUrl,
    actionContext,
  );
  let appliedSourceUrl = applyResult.appliedSourceUrl;

  // Network/proxy hiccup fallback: if proxied URL failed to fetch audio data,
  // retry once with the original direct S3 URL.
  if (
    applyResult.status === "error" &&
    applyResult.didSetSource &&
    !this.isActionStale(actionContext)
  ) {
    const directUrl = this.unproxifyAudio(nextAudioUrl);
    if (directUrl !== nextAudioUrl) {
      try {
        debug.log(
          "[updateTranslation] proxied audio init failed, retrying direct URL",
        );
        const validatedDirectUrl = await this.validateAudioUrl(
          directUrl,
          actionContext,
        );
        if (this.isActionStale(actionContext)) {
          await rollbackStaleAppliedSourceIfStillCurrent(
            this,
            appliedSourceUrl,
          );
          return;
        }
        nextAudioUrl = validatedDirectUrl;
        applyResult = await applyTranslationSource(
          this,
          validatedDirectUrl,
          actionContext,
        );
        appliedSourceUrl = applyResult.appliedSourceUrl;
      } catch (fallbackErr) {
        applyResult = {
          status: "error",
          didSetSource: true,
          appliedSourceUrl,
          error: fallbackErr,
        };
      }
    }
  }

  if (applyResult.status === "stale") return;

  if (applyResult.status === "error") {
    debug.log("this.audioPlayer.init() error", applyResult.error);

    if (isMediaAbortError(applyResult.error)) {
      debug.log(
        "[updateTranslation] media abort detected, recreating player and retrying once",
        applyResult.error,
      );

      const recovered = await recoverAfterMediaAbort(
        this,
        nextAudioUrl,
        actionContext,
      );

      if (recovered) {
        return;
      }
    }

    await rollbackStaleAppliedSourceIfStillCurrent(this, appliedSourceUrl);

    try {
      await this.audioPlayer?.player?.clear();
    } catch (err) {
      debug.log("[updateTranslation] player.clear failed", err);
    }

    try {
      if (this.audioPlayer?.player) {
        this.audioPlayer.player.src = "";
      }
    } catch {
      // ignore
    }

    this.downloadTranslationUrl = null;

    const msg = toErrorMessage(applyResult.error);
    this.transformBtn("error", msg);

    throw applyResult.error instanceof Error
      ? applyResult.error
      : new Error(msg);
  }

  if (shouldRequireImmediateTranslatedStart(this)) {
    const started = await ensureTranslatedAudioStarted(
      this,
      actionContext,
      TRANSLATED_AUDIO_START_TIMEOUT_MS,
    );

    if (!started) {
      debug.log(
        "[updateTranslation] audio source attached but playback did not start",
      );

      if (isCustomPlaybackTarget(this.site.host, this.videoData?.host)) {
        debug.log(
          "[updateTranslation] custom source: translated audio did not auto-start, keeping translation active",
        );

        this.setupAudioSettings();
        this.transformBtn(
          "success",
          localizationProvider.get("disableTranslate"),
        );
        this.afterUpdateTranslation(nextAudioUrl);

        if (this.data?.autoSubtitles) {
          setTimeout(() => {
            void this.enableSubtitlesForCurrentLangPair();
          }, 1500);

          setTimeout(() => {
            void this.enableSubtitlesForCurrentLangPair();
          }, 5000);
        }
        return;
      }

      if (isLikelyAutoplayBlocked(this)) {
        debug.log(
          "[VOT][audio] translated audio is waiting for a user gesture",
          {
            sourceUrl: nextAudioUrl,
            videoId: actionContext?.videoId ?? this.videoData?.videoId,
          },
        );
        markAutoplayRecoveryPending(this, nextAudioUrl, actionContext);
        this.setupAudioSettings();
        this.transformBtn("success", getAutoplayRecoveryButtonText());
        this.afterUpdateTranslation(nextAudioUrl);
        if (this.data?.autoSubtitles) {
          setTimeout(() => {
            void this.enableSubtitlesForCurrentLangPair();
          }, 1500);

          setTimeout(() => {
            void this.enableSubtitlesForCurrentLangPair();
          }, 5000);
        }
        this.syncPopupOverlayState({
          hint: getAutoplayRecoveryHintText(),
        });
        return;
      }

      const recovered = await recoverAfterMediaAbort(
        this,
        nextAudioUrl,
        actionContext,
      );

      if (recovered) {
        return;
      }

      try {
        await this.audioPlayer?.player?.clear();
      } catch (err) {
        debug.log(
          "[updateTranslation] player.clear after no-start failed",
          err,
        );
      }

      try {
        if (this.audioPlayer?.player) {
          this.audioPlayer.player.src = "";
        }
      } catch {
        // ignore
      }

      this.downloadTranslationUrl = null;
      this.transformBtn("error", "Translated audio did not start");
      throw new Error("Translated audio did not start");
    }
  } else {
    debug.log(
      "[updateTranslation] translated source attached while host video is paused; skip immediate start check",
    );
  }

  this.setupAudioSettings();
  this.transformBtn("success", localizationProvider.get("disableTranslate"));
  this.afterUpdateTranslation(nextAudioUrl);
}

export async function translateFunc(
  this: VideoHandler,
  VIDEO_ID: string,
  _isStream: boolean,
  requestLang: string,
  responseLang: string,
  translationHelp?: VideoData["translationHelp"],
): Promise<void> {
  await this.waitForPendingStopTranslate();
  debug.log("Run videoValidator");
  await this.videoValidator();

  if (this.actionsAbortController?.signal?.aborted) {
    this.resetActionsAbortController("translateFunc");
  }

  const overlayView = this.uiManager.votOverlayView;
  if (!overlayView?.votButton) {
    debug.log("[translateFunc] Overlay view missing, skipping translation");
    return;
  }

  overlayView.votButton.loading = true;
  this.hadAsyncWait = false;
  this.volumeOnStart = this.getVideoVolume();

  if (!VIDEO_ID) {
    debug.log("Skip translation - no VIDEO_ID resolved yet");
    await this.updateTranslationErrorMsg(
      new VOTLocalizedError("VOTNoVideoIDFound"),
      this.actionsAbortController.signal,
    );
    return;
  }

  const videoData = this.videoData;
  if (!videoData) {
    await this.updateTranslationErrorMsg(
      new VOTLocalizedError("VOTNoVideoIDFound"),
      this.actionsAbortController.signal,
    );
    return;
  }

  const currentVideoId = VIDEO_ID;

  if (this.lastTranslationVideoId !== currentVideoId) {
    debug.log("[translateFunc] video changed, recreating player", {
      prev: this.lastTranslationVideoId,
      next: currentVideoId,
    });

    this.resetActionsAbortController("translateFunc video changed");

    try {
      await this.audioPlayer?.player?.clear();
    } catch (err) {
      debug.log("[translateFunc] player.clear failed during video switch", err);
    }

    try {
      if (this.audioPlayer?.player) {
        this.audioPlayer.player.src = "";
      }
    } catch {
      // ignore
    }

    try {
      if (this.translationRefreshTimeout !== undefined) {
        clearTimeout(this.translationRefreshTimeout);
        this.translationRefreshTimeout = undefined;
      }
    } catch {
      // ignore
    }

    this.downloadTranslationUrl = null;
    this.activeTranslation = null;
    this.hadAsyncWait = false;

    stopSmartVolumeDucking(this, {
      restoreVolume: this.smartVolumeDuckingBaseline ?? this.volumeOnStart,
    });
    this.smartVolumeDuckingBaseline = undefined;
    try {
      this.createPlayer();
    } catch (err) {
      debug.log("[translateFunc] createPlayer failed during video switch", err);
    }

    this.lastTranslationVideoId = currentVideoId;
  }

  const normalizedTranslationHelp = normalizeTranslationHelp(translationHelp);
  await this.videoManager.ensureDetectedLanguageForTranslation(videoData);
  const resolvedRequestLang =
    requestLang === "auto" && videoData.detectedLanguage !== "auto"
      ? videoData.detectedLanguage
      : requestLang;
  const cacheKey = this.getTranslationCacheKey(
    VIDEO_ID,
    resolvedRequestLang,
    responseLang,
    normalizedTranslationHelp,
  );
  // Stream translations are disabled; keep the cache namespace stable.
  const activeKey = `video_${cacheKey}`;

  if (this.activeTranslation?.key === activeKey) {
    debug.log("[translateFunc] Reusing in-flight translation");
    await this.activeTranslation.promise;
    return;
  }

  const actionContext: ActionContext = {
    gen: this.actionsGeneration,
    videoId: VIDEO_ID,
  };

  const translationPromise = (async () => {
    if (this.isActionStale(actionContext)) {
      debug.log("[translateFunc] Stale translation task - skipping");
      return;
    }
    const reqLang = resolvedRequestLang;
    const resLang = responseLang;
    const applyTranslationUrl = async (url: string) =>
      await updateTranslationAndSchedule({
        url,
        actionContext,
        isActionStale: (ctx) => this.isActionStale(ctx),
        updateTranslation: (nextUrl, ctx) =>
          this.updateTranslation(nextUrl, ctx),
        scheduleTranslationRefresh: () => this.scheduleTranslationRefresh(),
      });
    const cachedEntry = this.cacheManager.getTranslation(cacheKey);
    if (cachedEntry?.url) {
      try {
        const updated = await applyTranslationUrl(cachedEntry.url);
        if (updated && this.hasActiveSource()) {
          debug.log("[translateFunc] Cached translation was received");
          return;
        }

        debug.log(
          "[translateFunc] Cached translation did not activate source, dropping cache and requesting fresh URL",
        );
      } catch (err) {
        debug.log(
          "[translateFunc] Cached translation failed, dropping cache and requesting fresh URL",
          err,
        );
      }

      if (typeof this.cacheManager.deleteTranslation === "function") {
        this.cacheManager.deleteTranslation(cacheKey);
      } else {
        this.cacheManager.clear();
      }
    }
    // Do not short-circuit on cached failures.
    // Users must be able to retry immediately (especially after changing
    // proxy settings or recovering from transient backend issues).

    const translateRes = await requestApplyAndCacheTranslation(this, {
      videoData,
      requestLang: reqLang,
      responseLang: resLang,
      translationHelp: normalizedTranslationHelp,
      actionContext,
      cacheKey,
      cacheVideoId: VIDEO_ID,
      cacheRequestLang: resolvedRequestLang,
      cacheResponseLang: responseLang,
      onBeforeCache: async () => {
        // Invalidate subtitles cache if there is no matching subtitle.
        const subsCacheKey = this.videoData
          ? this.getSubtitlesCacheKey(
              VIDEO_ID,
              this.videoData.detectedLanguage,
              this.videoData.responseLanguage,
            )
          : null;
        const cachedSubs = subsCacheKey
          ? this.cacheManager.getSubtitles(subsCacheKey)
          : null;
        if (
          !cachedSubs?.some(
            (item) =>
              item.source === "yandex" &&
              item.translatedFromLanguage === videoData.detectedLanguage &&
              item.language === videoData.responseLanguage,
          )
        ) {
          if (subsCacheKey) this.cacheManager.deleteSubtitles(subsCacheKey);
          this.subtitles = [];
          this.subtitlesCacheKey = null;
        }
      },
    });

    debug.log("[translateRes]", translateRes);

    if (!translateRes) {
      debug.log("Skip translation");
      return;
    }
  })();

  this.activeTranslation = {
    key: activeKey,
    promise: translationPromise,
  };

  try {
    return await translationPromise;
  } catch (err) {
    debug.log("[translateFunc] transient media abort", err);

    this.hadAsyncWait = notifyTranslationFailureIfNeeded({
      aborted: this.actionsAbortController.signal.aborted,
      translateApiErrorsEnabled: Boolean(this.data?.translateAPIErrors),
      hadAsyncWait: this.hadAsyncWait,
      videoId: VIDEO_ID,
      error: err,
      notify: (params) => this.notifier.translationFailed(params),
    });
    throw err;
  } finally {
    if (this.activeTranslation?.promise === translationPromise) {
      this.activeTranslation = null;
    }
    const overlayBtn = this.uiManager.votOverlayView?.votButton;
    if (
      !this.activeTranslation &&
      overlayBtn?.loading &&
      !this.hasActiveSource()
    ) {
      debug.log("[translateFunc] clearing stale loading state");
      this.transformBtn("none", localizationProvider.get("translateVideo"));
    }
  }
}

export function isYouTubeHosts(this: VideoHandler) {
  return isTranslationDownloadHost(this.site.host);
}

export function setupAudioSettings(this: VideoHandler) {
  applyTranslationPlaybackVolume(
    this.audioPlayer?.player as unknown as AudioPlayerLike | undefined,
    this.uiManager.votOverlayView?.translationVolumeSlider?.value,
    this.data?.defaultVolume,
  );

  const autoVolumeMode = getAutoVolumeMode(this);

  if (autoVolumeMode === "off") {
    // Auto-volume toggled off -> restore baseline and fully reset smart ducking.
    stopSmartVolumeDucking(this, {
      restoreVolume: this.smartVolumeDuckingBaseline ?? this.volumeOnStart,
    });
    return;
  }

  const targetVolume =
    clamp(this.data.autoVolume ?? defaultAutoVolume, 0, 100) / 100;
  this.smartVolumeDuckingTarget = targetVolume;

  if (!this.hasActiveSource()) {
    // No active translation source yet: keep target cached for next setup call.
    return;
  }

  if (autoVolumeMode === "smart") {
    startSmartVolumeDucking(this);
    return;
  }

  // Smart ducking disabled -> fall back to classic constant ducking.
  if (this.smartVolumeDuckingInterval !== undefined) {
    clearTimeout(this.smartVolumeDuckingInterval);
    this.smartVolumeDuckingInterval = undefined;
  }

  if (typeof this.smartVolumeDuckingBaseline !== "number") {
    this.smartVolumeDuckingBaseline = this.getVideoVolume();
  }

  const baseline = this.smartVolumeDuckingBaseline ?? this.getVideoVolume();
  this.setVideoVolume(Math.min(baseline, targetVolume));

  // Keep runtime in a neutral state in constant mode.
  writeSmartDuckingRuntime(
    this,
    initSmartDuckingRuntime(this.smartVolumeDuckingBaseline),
  );
  this.smartVolumeIsDucked = true;
}

export function applyManualVideoVolumeOverride(
  this: VideoHandler,
  volume01: number,
): void {
  if (!this.data?.enabledAutoVolume || !this.hasActiveSource()) return;

  const nextVolume = Math.max(0, Math.min(1, volume01));
  this.smartVolumeDuckingBaseline = nextVolume;
  this.smartVolumeLastApplied = nextVolume;
}
