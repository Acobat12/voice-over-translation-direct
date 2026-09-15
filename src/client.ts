import { YandexSessionProtobuf } from "@vot.js/core";
import { VOTJSError } from "@vot.js/core/client";
import ExtVOTClient, { VOTWorkerClient } from "@vot.js/ext/client";
import { getSignature, getUUID } from "@vot.js/shared/secure";
import type { SessionModule } from "@vot.js/shared/types/secure";

import { isAbortError, makeAbortError } from "./utils/errors";

type ClientResponse<T = ArrayBuffer> = {
  success: boolean;
  status?: number;
  headers?: Record<string, string>;
  responseText?: string;
  responseJson?: unknown;
  errorCode?: string;
  errorMessage?: string;
  data?: T | string;
};

function getResponseHeadersObject(
  headers: Headers,
): Record<string, string> | undefined {
  try {
    return Object.fromEntries(headers.entries());
  } catch {
    return undefined;
  }
}

function parseJsonText(text: string | undefined): unknown {
  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

async function buildBinaryResponseResult<T = ArrayBuffer>(
  res: Response,
): Promise<ClientResponse<T>> {
  const responseTextPromise = res
    .clone()
    .text()
    .catch(() => undefined);
  const data = (await res.arrayBuffer()) as T;
  const responseText = await responseTextPromise;

  return {
    success: res.status === 200,
    status: res.status,
    headers: getResponseHeadersObject(res.headers),
    responseText,
    responseJson: parseJsonText(responseText),
    data,
  };
}

function buildRequestErrorResult(error: unknown): ClientResponse {
  const err = error as {
    name?: unknown;
    message?: unknown;
  };

  return {
    success: false,
    status: undefined,
    headers: undefined,
    responseText: undefined,
    responseJson: undefined,
    errorCode: typeof err?.name === "string" ? err.name : undefined,
    errorMessage:
      typeof err?.message === "string" ? err.message : String(error ?? ""),
    data: typeof err?.message === "string" ? err.message : String(error ?? ""),
  };
}

export default class VOTClient extends ExtVOTClient {
  override async request<T = ArrayBuffer>(
    path: string,
    body: Uint8Array,
    headers: Record<string, string> = {},
    method = "POST",
  ): Promise<ClientResponse<T>> {
    const options = this.getOpts(new Blob([body]), headers, method);

    try {
      const res = await this.fetch(
        `${this.schema}://${this.host}${path}`,
        options,
      );
      return await buildBinaryResponseResult<T>(res);
    } catch (error) {
      if (isAbortError(error)) {
        throw makeAbortError();
      }

      console.error("[VOT] request failed:", error);
      return buildRequestErrorResult(error) as ClientResponse<T>;
    }
  }

  override async createSession(module: SessionModule) {
    const uuid = getUUID();
    const body = YandexSessionProtobuf.encodeSessionRequest(uuid, module);
    const res = await this.request("/session/create", body, {
      "Vtrans-Signature": await getSignature(body),
    });

    if (!res.success) {
      console.error("[VOT] createSession failed:", res);
      throw new VOTJSError("Failed to request create session", res);
    }

    const sessionResponse = YandexSessionProtobuf.decodeSessionResponse(
      res.data as ArrayBuffer,
    );

    return {
      ...sessionResponse,
      uuid,
    };
  }
}

export { VOTWorkerClient };
