export type BootstrapMode = "skip" | "auth-eager" | "lazy";

export type BootstrapPolicyInput = {
  isIframe: boolean;
  href: string;
  origin: string;
  authOrigin: string;
};

export function shouldSkipIframeBootstrap(
  input: BootstrapPolicyInput,
): boolean {
  if (!input.isIframe) return false;

  // Many embedded players are rendered inside same-origin `about:blank` /
  // `about:srcdoc` wrapper iframes. Skipping bootstrap there prevents the
  // generic observer from ever seeing the real <video>. Only skip truly
  // opaque/null-origin frames where we have no stable runtime context.
  return input.origin === "null";
}

export function resolveBootstrapMode(
  input: BootstrapPolicyInput,
): BootstrapMode {
  if (shouldSkipIframeBootstrap(input)) {
    return "skip";
  }
  if (!input.isIframe && input.origin === input.authOrigin) {
    return "auth-eager";
  }
  return "lazy";
}
