import { proxyWorkerHost, umpApiHost, workerHost } from "./config";

export type ProxyPreset = "builtin" | "ump-media" | "ump-protobuf" | "custom";

export function normalizeProxyHost(value: string): string {
  const url = new URL(
    /^https?:\/\//i.test(value.trim())
      ? value.trim()
      : `https://${value.trim()}`,
  );
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "Proxy must be an HTTPS address without credentials, query or fragment",
    );
  }
  return `${url.host}${url.pathname.replace(/\/+$/, "")}`;
}

export function resolveProxyRouting(
  mode: number,
  preset: ProxyPreset,
  customHost?: string | null,
) {
  if (mode === 0 || preset === "ump-media") {
    return { host: workerHost, client: "direct" as const };
  }
  if (preset === "ump-protobuf") {
    return { host: umpApiHost, client: "envelope" as const };
  }
  if (preset === "custom") {
    return {
      host: normalizeProxyHost(customHost || umpApiHost),
      client: "envelope" as const,
    };
  }
  return { host: proxyWorkerHost, client: "worker" as const };
}
