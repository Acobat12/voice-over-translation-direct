import type { SafariGmBody } from "./protocol";

export function makeRequestId(): string {
  return `${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

export function parseBridgeDetail<T>(detail: unknown): T | undefined {
  if (typeof detail === "string") {
    try {
      return JSON.parse(detail) as T;
    } catch {
      return undefined;
    }
  }

  return detail && typeof detail === "object" ? (detail as T) : undefined;
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary);
}

export function base64ToArrayBuffer(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes.buffer;
}

export async function serializeBody(
  body: unknown,
): Promise<SafariGmBody | undefined> {
  if (body == null) return undefined;
  if (typeof body === "string") return { type: "text", value: body };

  if (body instanceof URLSearchParams) {
    return { type: "text", value: body.toString() };
  }

  if (body instanceof Blob) {
    return {
      type: "base64",
      value: arrayBufferToBase64(await body.arrayBuffer()),
      mimeType: body.type || undefined,
    };
  }

  if (body instanceof ArrayBuffer) {
    return { type: "base64", value: arrayBufferToBase64(body) };
  }

  if (ArrayBuffer.isView(body)) {
    const bytes = new Uint8Array(body.byteLength);
    bytes.set(new Uint8Array(body.buffer, body.byteOffset, body.byteLength));
    return { type: "base64", value: arrayBufferToBase64(bytes.buffer) };
  }

  return { type: "text", value: String(body) };
}

export function deserializeBody(body?: SafariGmBody): BodyInit | undefined {
  if (!body) return undefined;
  if (body.type === "text") return body.value;

  const buffer = base64ToArrayBuffer(body.value);
  return body.mimeType ? new Blob([buffer], { type: body.mimeType }) : buffer;
}

export function parseRawResponseHeaders(
  rawHeaders?: string,
): Record<string, string> {
  if (!rawHeaders) return {};

  return rawHeaders
    .split(/\r?\n/)
    .reduce<Record<string, string>>((acc, line) => {
      const match = /^([\w-]+):\s*(.+)$/.exec(line);
      if (match) acc[match[1]] = match[2];
      return acc;
    }, {});
}
