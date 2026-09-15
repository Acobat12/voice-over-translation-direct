import debug from "../../utils/debug";
import { GM_fetch } from "../../utils/gm";

export type DirectMediaChunk =
  | Uint8Array
  | { buffer: Uint8Array; isLastChunk: boolean };

export type DirectMediaData = {
  fileId: string;
  mediaPartsLength: number | null;
  getMediaBuffers(): AsyncGenerator<DirectMediaChunk>;
};

export type DirectMediaOptions = {
  url: string;
  signal: AbortSignal;
  fileIdPrefix: string;
  referer?: string;
};

const RANGE_SIZE = 4 * 1024 * 1024;
const STREAM_CHUNK_TARGET = 1024 * 1024;
const DIRECT_TRANSPORTS = [
  "parallel_4",
  "range_4mb",
  "parallel_2",
  "stream",
] as const;

type Range = { start: number; end: number };

function concatBuffers(buffers: Uint8Array[]): Uint8Array {
  const size = buffers.reduce((sum, item) => sum + item.byteLength, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const item of buffers) {
    result.set(item, offset);
    offset += item.byteLength;
  }
  return result;
}

function makeRanges(contentLength: number, chunkSize = RANGE_SIZE): Range[] {
  const result: Range[] = [];
  for (let start = 0; start < contentLength; start += chunkSize) {
    result.push({
      start,
      end: Math.min(contentLength - 1, start + chunkSize - 1),
    });
  }
  return result;
}

function makeHeaders(range: Range | null, referer?: string): HeadersInit {
  const headers: Record<string, string> = {};
  if (range) headers.Range = `bytes=${range.start}-${range.end}`;
  if (referer) headers.Referer = referer;
  return headers;
}

async function requestMedia(
  url: string,
  signal: AbortSignal,
  range: Range | null,
  referer?: string,
): Promise<Response> {
  const headers = makeHeaders(range, referer);

  try {
    const response = await fetch(url, {
      signal,
      headers,
      credentials: "include",
    });
    if (response.ok) return response;
  } catch (error) {
    signal.throwIfAborted();
    debug.log("Audio downloader. direct media fetch failed; trying GM", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const response = await GM_fetch(url, {
    signal,
    timeout: 0,
    forceGmXhr: true,
    headers,
  });
  if (!response.ok) {
    throw new Error(
      `Audio downloader. direct media request failed (${response.status})`,
    );
  }
  return response;
}

function parseContentRangeTotal(value: string | null): number | null {
  const match = /\/([0-9]+)\s*$/.exec(value ?? "");
  if (!match) return null;
  const total = Number(match[1]);
  return Number.isSafeInteger(total) && total > 0 ? total : null;
}

async function probeContentLength(
  url: string,
  signal: AbortSignal,
  referer?: string,
): Promise<number | null> {
  try {
    const response = await requestMedia(
      url,
      signal,
      { start: 0, end: 0 },
      referer,
    );
    const fromRange = parseContentRangeTotal(
      response.headers.get("content-range"),
    );
    if (fromRange) return fromRange;

    // A server may ignore Range and answer 200. Content-Length is still useful,
    // but range transports are not safe unless the server confirms 206.
    if (response.status === 206) {
      const length = Number(response.headers.get("content-length"));
      if (Number.isSafeInteger(length) && length > 0) return length;
    }
  } catch (error) {
    signal.throwIfAborted();
    debug.log("Audio downloader. direct media probe failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return null;
}

async function fetchRange(
  url: string,
  signal: AbortSignal,
  range: Range,
  referer?: string,
): Promise<Uint8Array> {
  const response = await requestMedia(url, signal, range, referer);
  if (response.status !== 206) {
    throw new Error(
      `Audio downloader. direct media range unsupported (${response.status})`,
    );
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  const expected = range.end - range.start + 1;
  if (bytes.byteLength !== expected) {
    throw new Error(
      `Audio downloader. direct media short range (${bytes.byteLength}/${expected})`,
    );
  }
  return bytes;
}

async function* downloadRanges(
  url: string,
  contentLength: number,
  signal: AbortSignal,
  referer: string | undefined,
  concurrency: number,
): AsyncGenerator<Uint8Array> {
  const ranges = makeRanges(contentLength);
  for (let index = 0; index < ranges.length; index += concurrency) {
    signal.throwIfAborted();
    const batch = ranges.slice(index, index + concurrency);
    const buffers = await Promise.all(
      batch.map((range) => fetchRange(url, signal, range, referer)),
    );
    for (const buffer of buffers) yield buffer;
  }
}

async function* downloadStream(
  url: string,
  signal: AbortSignal,
  referer?: string,
): AsyncGenerator<{ buffer: Uint8Array; isLastChunk: boolean }> {
  const response = await requestMedia(url, signal, null, referer);
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.byteLength)
      throw new Error("Audio downloader. direct media is empty");
    yield { buffer: bytes, isLastChunk: true };
    return;
  }

  const reader = response.body.getReader();
  const pending: Uint8Array[] = [];
  let pendingSize = 0;
  let ready: Uint8Array | null = null;

  try {
    for (;;) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
      pending.push(bytes);
      pendingSize += bytes.byteLength;

      if (pendingSize >= STREAM_CHUNK_TARGET) {
        const next = concatBuffers(pending);
        pending.length = 0;
        pendingSize = 0;
        if (ready) yield { buffer: ready, isLastChunk: false };
        ready = next;
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {}
  }

  if (pendingSize > 0) {
    if (ready) yield { buffer: ready, isLastChunk: false };
    yield { buffer: concatBuffers(pending), isLastChunk: true };
    return;
  }

  if (!ready?.byteLength) {
    throw new Error("Audio downloader. direct media stream ended empty");
  }
  yield { buffer: ready, isLastChunk: true };
}

export async function getDirectMedia({
  url,
  signal,
  fileIdPrefix,
  referer,
}: DirectMediaOptions): Promise<DirectMediaData> {
  const contentLength = await probeContentLength(url, signal, referer);
  const safePrefix = fileIdPrefix
    .replace(/[^a-zA-Z0-9_.-]+/g, "_")
    .slice(0, 96);

  if (contentLength) {
    const ranges = makeRanges(contentLength);
    const fileId = `${safePrefix}_${contentLength}_${RANGE_SIZE}`;

    return {
      fileId,
      mediaPartsLength: ranges.length,
      async *getMediaBuffers() {
        let lastError: unknown;
        for (const transport of DIRECT_TRANSPORTS) {
          if (transport === "stream") break;
          let emitted = false;
          const concurrency =
            transport === "parallel_4" ? 4 : transport === "parallel_2" ? 2 : 1;
          try {
            debug.log("Audio downloader. direct media transport started", {
              transport,
              contentLength,
            });
            for await (const buffer of downloadRanges(
              url,
              contentLength,
              signal,
              referer,
              concurrency,
            )) {
              emitted = true;
              yield buffer;
            }
            return;
          } catch (error) {
            signal.throwIfAborted();
            lastError = error;
            debug.log("Audio downloader. direct media transport failed", {
              transport,
              emitted,
              error: error instanceof Error ? error.message : String(error),
            });
            if (emitted) throw error;
          }
        }

        // We cannot switch to unknown-length streaming after exposing a fixed
        // mediaPartsLength. Throw and let the caller retry using stream mode.
        throw lastError instanceof Error
          ? lastError
          : new Error("Audio downloader. direct media range transports failed");
      },
    };
  }

  const fileId = `${safePrefix}_stream`;
  return {
    fileId,
    mediaPartsLength: null,
    async *getMediaBuffers() {
      yield* downloadStream(url, signal, referer);
    },
  };
}
