export type BootstrapMode = "skip" | "auth-eager" | "lazy";

export type BootstrapPolicyInput = {
  isIframe: boolean;
  href: string;
  origin: string;
  authOrigin: string;
};

function isCloudflareChallengeFrame(href: string): boolean {
  try {
    const url = new URL(href);

    return (
      url.hostname === "challenges.cloudflare.com" ||
      url.pathname.includes("/cdn-cgi/challenge-platform/")
    );
  } catch {
    return false;
  }
}

export function shouldSkipIframeBootstrap(
  input: BootstrapPolicyInput,
): boolean {
  if (!input.isIframe) return false;

  // Many embedded players are rendered inside same-origin `about:blank` /
  // `about:srcdoc` wrapper iframes. Skipping bootstrap there prevents the
  // generic observer from ever seeing the real <video>. Only skip truly
  // opaque/null-origin frames where we have no stable runtime context.
  if (input.origin === "null") {
    return true;
  }

  return isCloudflareChallengeFrame(input.href);
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
