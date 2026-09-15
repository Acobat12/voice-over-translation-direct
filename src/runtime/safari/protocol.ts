import type { VideoData } from "@vot.js/core/types/client";
import type { ServiceConf } from "@vot.js/ext/types/service";

export const SAFARI_PAGE_RUNTIME_REQUEST =
  "__vot_safari_page_runtime_request__";
export const SAFARI_PAGE_RUNTIME_RESPONSE =
  "__vot_safari_page_runtime_response__";
export const SAFARI_PAGE_RUNTIME_READY = "__vot_safari_page_runtime_ready__";
export const SAFARI_PAGE_RUNTIME_READY_DATASET = "votSafariPageRuntimeReady";

export const SAFARI_GM_REQUEST = "__vot_safari_gm_request__";
export const SAFARI_GM_RESPONSE = "__vot_safari_gm_response__";
export const SAFARI_GM_ABORT = "__vot_safari_gm_abort__";

export type SafariGmBody =
  | { type: "text"; value: string }
  | { type: "base64"; value: string; mimeType?: string };

export type SafariGmRequest = {
  id: string;
  kind: "fetch" | "xhr";
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: SafariGmBody;
  timeout?: number;
  responseType?: "text" | "json" | "blob" | "arraybuffer";
  anonymous?: boolean;
  forceGmXhr?: boolean;
};

export type SafariGmResponse = {
  id: string;
  ok: boolean;
  phase: "load" | "error" | "timeout" | "abort";
  status?: number;
  statusText?: string;
  finalUrl?: string;
  responseURL?: string;
  headers?: Record<string, string>;
  responseHeadersRaw?: string;
  body?: SafariGmBody;
  error?: string;
};

export type SafariPageRuntimeAction = "ping" | "getVideoID" | "getVideoData";

export type SafariPageRuntimeService = Pick<
  ServiceConf,
  | "host"
  | "url"
  | "selector"
  | "eventSelector"
  | "additionalData"
  | "needExtraData"
  | "rawResult"
  | "needBypassCSP"
  | "shadowRoot"
  | "priority"
>;

export type SafariPageRuntimeRequest = {
  id: string;
  action: SafariPageRuntimeAction;
  serviceHost?: string;
  service?: SafariPageRuntimeService;
  language?: string;
};

export type SafariPageRuntimeResponse<T = unknown> = {
  id: string;
  ok: boolean;
  result?: T;
  error?: string;
};

export type SafariPageRuntimeVideoData = VideoData<string>;
