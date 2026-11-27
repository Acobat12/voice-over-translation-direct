/** YouTube audio metadata only. Transport-specific code belongs to its strategy. */
export type AudioFormat = {
  itag?: number;
  bitrate?: number;
  mimeType?: string;
  audioTrackId?: string;
  audioTrack?: { id?: string; audioIsDefault?: boolean };
};

type PlayerResponse = {
  videoDetails?: { videoId?: string };
  microformat?: {
    playerMicroformatRenderer?: { defaultAudioLanguage?: string };
  };
  captions?: {
    playerCaptionsTracklistRenderer?: {
      audioTracks?: Array<{ audioTrackId?: string }>;
      defaultAudioTrackIndex?: number;
      captionTracks?: Array<{ kind?: string; languageCode?: string }>;
    };
  };
  streamingData?: { adaptiveFormats?: AudioFormat[] };
};

/** Source languages accepted by the VOT translation backend. Shared by detection and downloaders. */
export const YOUTUBE_VOT_SOURCE_LANGUAGES = new Set([
  "ru",
  "en",
  "zh",
  "ko",
  "fr",
  "it",
  "es",
  "de",
  "ja",
]);

export const isSupportedYouTubeSourceLanguage = (value?: string): boolean => {
  const language = youtubeLanguage(value);
  return !!language && YOUTUBE_VOT_SOURCE_LANGUAGES.has(language);
};

export const youtubeLanguage = (id?: string): string | undefined =>
  id
    ?.replace(/\.\d+$/, "")
    .split(/[-_]/)[0]
    ?.toLowerCase() || undefined;

export function getYouTubePlayerResponse(
  videoId: string,
): PlayerResponse | undefined {
  const players = document.querySelectorAll<HTMLElement>(".html5-video-player");
  for (const player of players) {
    const response = (
      player as HTMLElement & {
        getPlayerResponse?: () => PlayerResponse;
      }
    ).getPlayerResponse?.();
    if (response?.videoDetails?.videoId === videoId) return response;
  }
  return undefined;
}

export function getYouTubeAudioMetadata(videoId: string) {
  const response = getYouTubePlayerResponse(videoId);
  if (!response) return undefined;
  const captions = response.captions?.playerCaptionsTracklistRenderer;
  const tracks = captions?.audioTracks ?? [];
  const original =
    tracks.find((t) => t.audioTrackId?.endsWith(".4")) ??
    tracks[captions?.defaultAudioTrackIndex ?? -1];
  const asr = (captions?.captionTracks ?? []).filter((t) => t.kind === "asr");
  const originalLanguage = youtubeLanguage(
    response.microformat?.playerMicroformatRenderer?.defaultAudioLanguage ??
      original?.audioTrackId ??
      (asr.length === 1 ? asr[0].languageCode : undefined),
  );
  // The original language and the media language are different concepts.
  // When the original is unsupported, select a concrete supported alternate.
  const selected = isSupportedYouTubeSourceLanguage(originalLanguage)
    ? (tracks.find(
        (t) =>
          youtubeLanguage(t.audioTrackId) === originalLanguage &&
          t.audioTrackId?.endsWith(".4"),
      ) ??
      tracks.find(
        (t) => youtubeLanguage(t.audioTrackId) === originalLanguage,
      ) ??
      original)
    : tracks.find((t) => isSupportedYouTubeSourceLanguage(t.audioTrackId));
  const trackId = selected?.audioTrackId;
  const language = trackId
    ? youtubeLanguage(trackId)
    : isSupportedYouTubeSourceLanguage(originalLanguage)
      ? originalLanguage
      : undefined;
  const languages = [
    ...new Set(
      tracks
        .map((t) => youtubeLanguage(t.audioTrackId))
        .filter((v): v is string => !!v),
    ),
  ];
  return {
    response,
    originalLanguage,
    language,
    trackId,
    originalTrackId: original?.audioTrackId,
    tracks,
    languages,
    usingAlternative:
      !!trackId && !!originalLanguage && language !== originalLanguage,
  };
}

/** Never substitute an unrelated dubbed track when multiple languages exist. */
export function selectSmallestYouTubeAudio<T extends AudioFormat>(
  formats: T[],
  trackId?: string,
  multilingual = false,
): T | undefined {
  const audio = formats.filter(
    (f) =>
      f.mimeType?.startsWith("audio/") &&
      typeof f.itag === "number" &&
      Number.isFinite(f.bitrate) &&
      (f.bitrate ?? 0) > 0,
  );
  const matching = trackId
    ? audio.filter((f) => (f.audioTrackId ?? f.audioTrack?.id) === trackId)
    : [];
  const candidates = matching.length ? matching : multilingual ? [] : audio;
  return candidates.reduce<T | undefined>(
    (min, f) =>
      !min || (f.bitrate ?? Infinity) < (min.bitrate ?? Infinity) ? f : min,
    undefined,
  );
}
