export type AudioChunk = {
  buffer: Uint8Array;
  isLastChunk: boolean;
};

export async function* splitAudioBuffer(
  bytes: Uint8Array,
  chunkSize: number,
): AsyncGenerator<Uint8Array> {
  for (let start = 0; start < bytes.byteLength; start += chunkSize) {
    yield bytes.subarray(start, Math.min(start + chunkSize, bytes.byteLength));
  }
}

export function concatBuffers(buffers: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(
    buffers.reduce((length, buffer) => length + buffer.byteLength, 0),
  );
  let offset = 0;
  for (const buffer of buffers) {
    result.set(buffer, offset);
    offset += buffer.byteLength;
  }
  return result;
}
