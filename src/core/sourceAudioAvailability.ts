type HTMLVideoWithAudioMetadata = HTMLVideoElement & {
  audioTracks?: { length: number };
  mozHasAudio?: boolean;
  webkitAudioDecodedByteCount?: number;
};

type HTMLVideoWithCaptureStream = HTMLVideoElement & {
  captureStream?: () => MediaStream;
  mozCaptureStream?: () => MediaStream;
};

type AudioPresenceInspection = {
  presence: boolean | null;
  source: string;
  signals: string[];
};

export type SourceAudioAvailabilityKind =
  | "ready"
  | "needsPlayback"
  | "missing"
  | "pending";

export type SourceAudioAvailabilityState = {
  kind: SourceAudioAvailabilityKind;
  ready: boolean;
  audioDetected: boolean | null;
  detectionSource: string;
  localizationKey?:
    | "VOTStartVideoForTranslation"
    | "VOTAudioNotDetected"
    | "VOTAudioNotYetAvailable";
};

const lastLoggedAudioSignatureByVideo = new WeakMap<HTMLVideoElement, string>();
const lastLoggedStatusSignatureByVideo = new WeakMap<
  HTMLVideoElement,
  string
>();

function hasResolvableMediaSource(video: HTMLVideoElement): boolean {
  if (video.currentSrc || video.src || video.srcObject) {
    return true;
  }

  const source = video.querySelector("source");
  return Boolean(source?.getAttribute("src") || source?.src);
}

function hasPlaybackStarted(video: HTMLVideoElement): boolean {
  return (
    !video.paused ||
    video.currentTime > 0.01 ||
    video.ended ||
    video.played.length > 0
  );
}

function getCapturedAudioTrackCount(video: HTMLVideoElement): number | null {
  const candidate = video as HTMLVideoWithCaptureStream;
  const captureStream = candidate.captureStream ?? candidate.mozCaptureStream;

  if (typeof captureStream !== "function") {
    return null;
  }

  try {
    const stream = captureStream.call(video);
    return stream.getAudioTracks().length;
  } catch {
    return null;
  }
}

function inspectAudioPresence(
  video: HTMLVideoElement,
  playbackStarted: boolean,
): AudioPresenceInspection {
  const candidate = video as HTMLVideoWithAudioMetadata;
  const signals: string[] = [];
  const readyForNegativeInference =
    playbackStarted && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;

  if (video.srcObject instanceof MediaStream) {
    const trackCount = video.srcObject.getAudioTracks().length;
    signals.push(`srcObject:${trackCount}`);
    return {
      presence: trackCount > 0,
      source: "srcObject",
      signals,
    };
  }

  if (typeof candidate.mozHasAudio === "boolean") {
    signals.push(`mozHasAudio:${candidate.mozHasAudio}`);
    if (candidate.mozHasAudio) {
      return {
        presence: true,
        source: "mozHasAudio",
        signals,
      };
    }
  }

  if (
    typeof candidate.webkitAudioDecodedByteCount === "number" &&
    candidate.webkitAudioDecodedByteCount > 0
  ) {
    signals.push(
      `webkitAudioDecodedByteCount:${candidate.webkitAudioDecodedByteCount}`,
    );
    return {
      presence: true,
      source: "webkitAudioDecodedByteCount",
      signals,
    };
  }

  let negativeSignals = 0;

  if (
    "audioTracks" in candidate &&
    typeof candidate.audioTracks?.length === "number"
  ) {
    signals.push(`audioTracks:${candidate.audioTracks.length}`);
    if (candidate.audioTracks.length > 0) {
      return {
        presence: true,
        source: "audioTracks",
        signals,
      };
    }
    if (readyForNegativeInference) {
      negativeSignals += 1;
    }
  }

  const capturedAudioTrackCount = getCapturedAudioTrackCount(video);
  if (capturedAudioTrackCount !== null) {
    signals.push(`captureStream:${capturedAudioTrackCount}`);
    if (capturedAudioTrackCount > 0) {
      return {
        presence: true,
        source: "captureStream",
        signals,
      };
    }
    if (readyForNegativeInference) {
      negativeSignals += 1;
    }
  }

  if (
    readyForNegativeInference &&
    typeof candidate.mozHasAudio === "boolean" &&
    candidate.mozHasAudio === false
  ) {
    negativeSignals += 1;
  }

  if (readyForNegativeInference && negativeSignals >= 2) {
    return {
      presence: false,
      source: "negative-signals",
      signals,
    };
  }

  return {
    presence: null,
    source: "unknown",
    signals,
  };
}

function maybeLogSourceAudioState(
  video: HTMLVideoElement,
  state: SourceAudioAvailabilityState,
  details: {
    playbackStarted: boolean;
    hasMediaSource: boolean;
    readyState: number;
    paused: boolean;
    currentTime: number;
    playedRanges: number;
    signals: string[];
  },
): void {
  const audioSignature = JSON.stringify({
    audioDetected: state.audioDetected,
    detectionSource: state.detectionSource,
    signals: details.signals,
  });
  if (lastLoggedAudioSignatureByVideo.get(video) !== audioSignature) {
    lastLoggedAudioSignatureByVideo.set(video, audioSignature);
    console.log("[VOT][source-audio] audio detected", {
      audioDetected: state.audioDetected,
      detectionSource: state.detectionSource,
      signals: details.signals,
      paused: details.paused,
      currentTime: Number(details.currentTime.toFixed(3)),
      readyState: details.readyState,
    });
  }

  const statusSignature = JSON.stringify({
    kind: state.kind,
    ready: state.ready,
    localizationKey: state.localizationKey ?? null,
    audioDetected: state.audioDetected,
    detectionSource: state.detectionSource,
    playbackStarted: details.playbackStarted,
    hasMediaSource: details.hasMediaSource,
    readyState: details.readyState,
  });
  if (lastLoggedStatusSignatureByVideo.get(video) !== statusSignature) {
    lastLoggedStatusSignatureByVideo.set(video, statusSignature);
    console.log("[VOT][source-audio] status selected", {
      kind: state.kind,
      ready: state.ready,
      localizationKey: state.localizationKey ?? null,
      audioDetected: state.audioDetected,
      detectionSource: state.detectionSource,
      playbackStarted: details.playbackStarted,
      hasMediaSource: details.hasMediaSource,
      paused: details.paused,
      currentTime: Number(details.currentTime.toFixed(3)),
      playedRanges: details.playedRanges,
      readyState: details.readyState,
    });
  }
}

export function getSourceAudioAvailability(
  video: HTMLVideoElement,
): SourceAudioAvailabilityState {
  const playbackStarted = hasPlaybackStarted(video);
  const hasMediaSource = hasResolvableMediaSource(video);
  const audioInspection = inspectAudioPresence(video, playbackStarted);

  let state: SourceAudioAvailabilityState;

  if (!playbackStarted) {
    state = {
      kind: "needsPlayback",
      ready: false,
      audioDetected: audioInspection.presence,
      detectionSource: audioInspection.source,
      localizationKey: "VOTStartVideoForTranslation",
    };
  } else if (audioInspection.presence === true) {
    state = {
      kind: "ready",
      ready: true,
      audioDetected: true,
      detectionSource: audioInspection.source,
    };
  } else if (audioInspection.presence === false) {
    state = {
      kind: "missing",
      ready: false,
      audioDetected: false,
      detectionSource: audioInspection.source,
      localizationKey: "VOTAudioNotDetected",
    };
  } else if (!hasMediaSource) {
    state = {
      kind: "pending",
      ready: false,
      audioDetected: null,
      detectionSource: audioInspection.source,
      localizationKey: "VOTAudioNotYetAvailable",
    };
  } else if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
    state = {
      kind: "pending",
      ready: false,
      audioDetected: null,
      detectionSource: audioInspection.source,
      localizationKey: "VOTAudioNotYetAvailable",
    };
  } else if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    state = {
      kind: "pending",
      ready: false,
      audioDetected: null,
      detectionSource: audioInspection.source,
      localizationKey: "VOTAudioNotYetAvailable",
    };
  } else {
    state = {
      kind: "ready",
      ready: true,
      audioDetected: audioInspection.presence,
      detectionSource: audioInspection.source,
    };
  }

  maybeLogSourceAudioState(video, state, {
    playbackStarted,
    hasMediaSource,
    readyState: video.readyState,
    paused: video.paused,
    currentTime: video.currentTime,
    playedRanges: video.played.length,
    signals: audioInspection.signals,
  });

  return state;
}
