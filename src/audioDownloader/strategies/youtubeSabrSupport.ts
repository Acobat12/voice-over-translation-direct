import type { SabrFormat } from "googlevideo/shared-types";
import { concatBuffers } from "./audioChunks";
import {
  getYouTubeAudioMetadata,
  isSupportedYouTubeSourceLanguage,
} from "./youtubeAudioMetadata";
import {
  audioLanguageMatches,
  getAudioFormatLanguage,
  isDrcAudioFormat,
  normalizeAudioLanguage,
  type WebAbrWindow,
  type WebEmbeddedFormat,
} from "./youtubePlayer";

export function toSabrFormat(
  format: WebEmbeddedFormat,
): SabrFormat | undefined {
  const itag = Number(format.itag);
  const bitrate = Number(format.bitrate ?? format.averageBitrate);
  const approxDurationMs = Number(format.approxDurationMs);
  const lastModified = String(format.lastModified ?? "");
  if (!(itag > 0) || !(bitrate > 0) || !(approxDurationMs > 0) || !lastModified)
    return;
  const language = getAudioFormatLanguage(format) || undefined;
  return {
    itag,
    lastModified,
    xtags: format.xtags,
    width: format.width,
    height: format.height,
    contentLength: Number(format.contentLength) || undefined,
    audioTrackId: format.audioTrackId ?? format.audioTrack?.id,
    mimeType: format.mimeType,
    isDrc: isDrcAudioFormat(format),
    quality: format.quality,
    qualityLabel: format.qualityLabel,
    averageBitrate: Number(format.averageBitrate) || undefined,
    bitrate,
    audioQuality: format.audioQuality,
    approxDurationMs,
    language,
    isOriginal: format.audioTrack?.audioIsDefault === true,
  };
}

function encodeProtoVarint(value: number): Uint8Array {
  const out: number[] = [];
  let current = Math.max(0, Math.floor(value));
  do {
    let byte = current % 128;
    current = Math.floor(current / 128);
    if (current > 0) byte |= 0x80;
    out.push(byte);
  } while (current > 0);
  return new Uint8Array(out);
}

function readProtoVarintAt(
  bytes: Uint8Array,
  offset: number,
): { value: number; next: number } {
  let value = 0;
  let shift = 0;
  let cursor = offset;
  while (cursor < bytes.length && shift <= 49) {
    const byte = bytes[cursor++];
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return { value, next: cursor };
    shift += 7;
  }
  throw new Error("invalid protobuf varint");
}

function splitTopLevelProto(
  bytes: Uint8Array,
): Array<{ field: number; start: number; end: number }> {
  const parts: Array<{ field: number; start: number; end: number }> = [];
  let offset = 0;
  while (offset < bytes.length) {
    const start = offset;
    const tag = readProtoVarintAt(bytes, offset);
    offset = tag.next;
    const field = Math.floor(tag.value / 8);
    const wire = tag.value & 7;
    if (wire === 0) offset = readProtoVarintAt(bytes, offset).next;
    else if (wire === 1) offset += 8;
    else if (wire === 5) offset += 4;
    else if (wire === 2) {
      const length = readProtoVarintAt(bytes, offset);
      offset = length.next + length.value;
    } else throw new Error(`unsupported protobuf wire type ${wire}`);
    if (offset > bytes.length) throw new Error("truncated protobuf field");
    parts.push({ field, start, end: offset });
  }
  return parts;
}

/**
 * SABR-only: set ClientAbrState.audioTrackId (nested field 69 inside
 * VideoPlaybackAbrRequest field 1). We keep SabrStream's generated ABR state
 * authoritative and only add/replace the concrete YouTube audio track id.
 *
 * Native requests observed on multi-audio videos carry values such as
 * "ar.10", "de-DE.10" and "en-US.4" in this field.
 */
export function setGeneratedSabrAudioTrackId(
  generated: Uint8Array,
  trackId: string,
): Uint8Array {
  const topLevel = splitTopLevelProto(generated);
  const encodedTrackId = new TextEncoder().encode(trackId);
  const trackField = concatBuffers([
    encodeProtoVarint((69 << 3) | 2),
    encodeProtoVarint(encodedTrackId.byteLength),
    encodedTrackId,
  ]);

  const chunks: Uint8Array[] = [];
  let replacedClientAbrState = false;

  for (const part of topLevel) {
    if (part.field !== 1 || replacedClientAbrState) {
      chunks.push(generated.slice(part.start, part.end));
      continue;
    }

    const tag = readProtoVarintAt(generated, part.start);
    const length = readProtoVarintAt(generated, tag.next);
    const payloadStart = length.next;
    const payloadEnd = payloadStart + length.value;
    if (payloadEnd > part.end) throw new Error("truncated ClientAbrState");

    const payload = generated.slice(payloadStart, payloadEnd);
    const fields = splitTopLevelProto(payload);
    const payloadChunks: Uint8Array[] = fields
      .filter((field) => field.field !== 69)
      .map((field) => payload.slice(field.start, field.end));
    payloadChunks.push(trackField);
    const patchedPayload = concatBuffers(payloadChunks);

    chunks.push(
      concatBuffers([
        encodeProtoVarint((1 << 3) | 2),
        encodeProtoVarint(patchedPayload.byteLength),
        patchedPayload,
      ]),
    );
    replacedClientAbrState = true;
  }

  if (!replacedClientAbrState) {
    throw new Error("SABR ClientAbrState field is unavailable");
  }
  return concatBuffers(chunks);
}

/** Validate the source language from the active video PlayerResponse. */
export function assertYouTubeAudioIsUsefulForVot(
  _targetWindow: WebAbrWindow,
  videoId: string,
  requestedLanguage?: string,
): void {
  const metadata = getYouTubeAudioMetadata(videoId);
  const actual = metadata?.language;
  // Validate the selected downloadable track, not the unsupported original.
  const requested = normalizeAudioLanguage(requestedLanguage);
  if (
    requested &&
    requested !== "auto" &&
    !isSupportedYouTubeSourceLanguage(requested)
  ) {
    throw new Error(
      `Audio downloader. unsupported requested audio language: ${requested}`,
    );
  }
  // The strategy still verifies the actual selected SABR media before uploading.
  if (!actual || ["unknown", "auto", "und"].includes(actual.toLowerCase()))
    return;
  if (!isSupportedYouTubeSourceLanguage(actual)) {
    throw new Error(
      `Audio downloader. unsupported YouTube source language: ${actual}`,
    );
  }
  if (
    requested &&
    requested !== "auto" &&
    !audioLanguageMatches(actual, requested)
  ) {
    throw new Error(
      `Audio downloader. requested ${requested}, metadata identifies ${actual}`,
    );
  }
}

export type WebAbrResolvedAudioLanguage = {
  videoId: string;
  requestedLanguage?: string;
  actualLanguage?: string;
  trackId?: string;
  selection:
    | "player-response"
    | "ui-language"
    | "supported-alternative"
    | "native-only"
    | "native-auto";
};

export const WEB_ABR_RESOLVED_AUDIO_LANGUAGES = new Map<
  string,
  WebAbrResolvedAudioLanguage
>();

export function getWebAbrResolvedAudioLanguage(
  videoId: string,
): WebAbrResolvedAudioLanguage | undefined {
  return WEB_ABR_RESOLVED_AUDIO_LANGUAGES.get(videoId);
}

type VotNativeProtoContext = {
  videoId: string;
  sabrAudioTrackId?: string;
  buildIndex: number;
  pageWindow: WebAbrWindow;
};

// Context must belong to a SabrStream INSTANCE, not SabrStream.prototype.
// YouTube SPA navigation can leave the previous stream alive briefly.
export const VOT_SABR_INSTANCE_CONTEXT = new WeakMap<
  object,
  VotNativeProtoContext
>();
