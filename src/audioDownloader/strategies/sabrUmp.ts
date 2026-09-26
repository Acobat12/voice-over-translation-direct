import { concatBuffers } from "./audioChunks";

export enum UmpPartType {
  MEDIA_HEADER = 20,
  MEDIA = 21,
  MEDIA_END = 22,
  NEXT_REQUEST_POLICY = 35,
  FORMAT_INITIALIZATION_METADATA = 42,
  SABR_REDIRECT = 43,
  SABR_ERROR = 44,
  SABR_SEEK = 45,
  RELOAD_PLAYER_RESPONSE = 46,
  PLAYBACK_START_POLICY = 47,
  REQUEST_IDENTIFIER = 52,
  REQUEST_CANCELLATION_POLICY = 53,
  SABR_CONTEXT_UPDATE = 57,
  STREAM_PROTECTION_STATUS = 58,
  SABR_CONTEXT_SENDING_POLICY = 59,
  END_OF_TRACK = 62,
}

export type UmpPart = {
  type: number;
  data: Uint8Array;
};

export type SabrMediaHeader = {
  headerId: number;
  videoId?: string;
  itag?: number;
  lastModified?: number;
  startDataRange?: number;
  contentLength?: number;
};

type VarInt = { value: number; bytes: number };

export function readUmpVarInt(
  data: Uint8Array,
  offset = 0,
): VarInt | undefined {
  if (offset >= data.byteLength) return;
  const first = data[offset]!;
  let size = 0;
  for (let shift = 1; shift <= 5; shift++) {
    if ((first & (128 >> (shift - 1))) === 0) {
      size = shift;
      break;
    }
  }
  if (size < 1 || offset + size > data.byteLength) return;

  let value: number;
  if (size === 1) value = first;
  else if (size === 2) value = (data[offset + 1]! << 6) | (first & 0x3f);
  else if (size === 3)
    value = data[offset + 1]! | (data[offset + 2]! << 8) | (first & 0x1f);
  else if (size === 4)
    value =
      data[offset + 1]! |
      (data[offset + 2]! << 8) |
      (data[offset + 3]! << 16) |
      (first & 0x0f);
  else
    value =
      (data[offset + 1]! |
        (data[offset + 2]! << 8) |
        (data[offset + 3]! << 16) |
        (data[offset + 4]! << 24)) >>>
      0;

  return { value, bytes: size };
}

function readProtoVarInt(data: Uint8Array, offset: number): VarInt | undefined {
  let value = 0;
  let shift = 0;
  for (let pos = offset; pos < data.byteLength && shift < 53; pos++) {
    const byte = data[pos]!;
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return { value, bytes: pos - offset + 1 };
    shift += 7;
  }
}

function readProtoFields(data: Uint8Array): Map<number, number | Uint8Array> {
  const fields = new Map<number, number | Uint8Array>();
  let pos = 0;
  while (pos < data.byteLength) {
    const key = readProtoVarInt(data, pos);
    if (!key) break;
    pos += key.bytes;
    const field = Math.floor(key.value / 8);
    const wire = key.value & 7;
    if (wire === 0) {
      const value = readProtoVarInt(data, pos);
      if (!value) break;
      pos += value.bytes;
      fields.set(field, value.value);
    } else if (wire === 2) {
      const length = readProtoVarInt(data, pos);
      if (!length) break;
      pos += length.bytes;
      if (pos + length.value > data.byteLength) break;
      fields.set(field, data.slice(pos, pos + length.value));
      pos += length.value;
    } else if (wire === 1) {
      pos += 8;
    } else if (wire === 5) {
      pos += 4;
    } else {
      break;
    }
  }
  return fields;
}

export function decodeSabrMediaHeader(data: Uint8Array): SabrMediaHeader {
  const fields = readProtoFields(data);
  const text = new TextDecoder();
  const bytes = (field: number) => {
    const value = fields.get(field);
    return value instanceof Uint8Array ? value : undefined;
  };
  const number = (field: number) => {
    const value = fields.get(field);
    return typeof value === "number" ? value : undefined;
  };

  return {
    headerId: number(1) ?? 0,
    videoId: bytes(2) ? text.decode(bytes(2)) : undefined,
    itag: number(3),
    lastModified: number(4),
    startDataRange: number(6),
    contentLength: number(14),
  };
}

/**
 * Parses all complete UMP parts in one HTTP response.
 *
 * A trailing partial part is deliberately retained as remainder rather than
 * guessed/concatenated. The SABR session layer must carry that state into the
 * following HTTP response.
 */
export function parseCompleteUmpParts(data: Uint8Array): {
  parts: UmpPart[];
  remainder: Uint8Array;
} {
  const parts: UmpPart[] = [];
  let pos = 0;
  while (pos < data.byteLength) {
    const partStart = pos;
    const type = readUmpVarInt(data, pos);
    if (!type) break;
    pos += type.bytes;
    const length = readUmpVarInt(data, pos);
    if (!length) {
      pos = partStart;
      break;
    }
    pos += length.bytes;
    if (pos + length.value > data.byteLength) {
      pos = partStart;
      break;
    }
    parts.push({
      type: type.value,
      data: data.slice(pos, pos + length.value),
    });
    pos += length.value;
  }
  return { parts, remainder: data.slice(pos) };
}

type MediaRange = {
  start: number;
  data: Uint8Array;
};

export class SabrAudioAssembler {
  private readonly headers = new Map<number, SabrMediaHeader>();
  private readonly ranges: MediaRange[] = [];
  private expectedLength?: number;

  constructor(readonly targetItag: number) {}

  pushPart(part: UmpPart): void {
    if (part.type === UmpPartType.MEDIA_HEADER) {
      const header = decodeSabrMediaHeader(part.data);
      this.headers.set(header.headerId, header);
      return;
    }
    if (part.type !== UmpPartType.MEDIA || !part.data.byteLength) return;

    // Current SABR MEDIA payloads prefix raw media bytes with a UMP varint
    // headerId. This is verified against the captured YouTube WEB session.
    const id = readUmpVarInt(part.data, 0);
    if (!id) return;
    const header = this.headers.get(id.value);
    if (!header || header.itag !== this.targetItag) return;

    const raw = part.data.slice(id.bytes);
    if (!raw.byteLength) return;
    const start = header.startDataRange;
    if (!Number.isSafeInteger(start) || start! < 0) return;

    this.ranges.push({ start: start!, data: raw });

    if (
      Number.isSafeInteger(header.contentLength) &&
      header.contentLength! > 0
    ) {
      const candidate = start! + header.contentLength!;
      this.expectedLength = Math.max(this.expectedLength ?? 0, candidate);
    }
  }

  getCoverage(): {
    coveredPrefix: number;
    highestByte: number;
    expectedLength?: number;
    ranges: number;
  } {
    const sorted = [...this.ranges].sort((a, b) => a.start - b.start);
    let prefix = 0;
    let highest = 0;
    for (const range of sorted) {
      highest = Math.max(highest, range.start + range.data.byteLength);
      if (range.start > prefix) continue;
      prefix = Math.max(prefix, range.start + range.data.byteLength);
    }
    return {
      coveredPrefix: prefix,
      highestByte: highest,
      expectedLength: this.expectedLength,
      ranges: sorted.length,
    };
  }

  /**
   * Returns bytes only when [0, expectedLength) is completely covered.
   * Overlapping retransmissions are accepted; holes are rejected.
   */
  finish(): Uint8Array {
    const expected = this.expectedLength;
    if (!Number.isSafeInteger(expected) || !expected || expected < 1)
      throw new Error("SABR audio length is unknown");

    const sorted = [...this.ranges].sort((a, b) => a.start - b.start);
    const output = new Uint8Array(expected);
    let covered = 0;

    for (const range of sorted) {
      if (range.start > covered)
        throw new Error(
          `SABR audio has a gap at ${covered}..${range.start - 1}`,
        );
      const end = Math.min(expected, range.start + range.data.byteLength);
      if (end <= range.start) continue;
      output.set(range.data.subarray(0, end - range.start), range.start);
      covered = Math.max(covered, end);
      if (covered >= expected) break;
    }

    if (covered !== expected)
      throw new Error(`Incomplete SABR audio (${covered}/${expected} bytes)`);
    return output;
  }
}

export function looksLikeWebm(data: Uint8Array): boolean {
  return (
    data.byteLength >= 4 &&
    data[0] === 0x1a &&
    data[1] === 0x45 &&
    data[2] === 0xdf &&
    data[3] === 0xa3
  );
}
