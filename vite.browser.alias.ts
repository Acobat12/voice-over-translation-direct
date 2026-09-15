import path from "node:path";
import type { Alias } from "vite";

export function getBrowserSecureAliases(rootDir: string): Alias[] {
  return [
    {
      // Keep the synthetic Yandex Browser version used by `@vot.js/core`
      // consistent across browser/userscript bundles.
      find: "@vot.js/shared/config",
      replacement: path.join(rootDir, "src", "shims", "votSharedConfig.ts"),
    },
    {
      // `@vot.js/shared/secure` falls back to `import("node:crypto")`, which
      // makes Vite emit `__vite-browser-external-*` helper chunks. Browser
      // builds only need Web Crypto, so route the import to a browser-safe shim.
      find: "@vot.js/shared/secure",
      replacement: path.join(rootDir, "src", "shims", "votSharedSecure.ts"),
    },
  ];
}

export function getSafariUserscriptAliases(rootDir: string): Alias[] {
  return getBrowserSecureAliases(rootDir);
}

export function getSafariMainUserscriptAliases(rootDir: string): Alias[] {
  return [
    {
      find: "@vot.js/ext/utils/videoData",
      replacement: path.join(rootDir, "src", "runtime", "videoData.ts"),
    },
    ...getSafariUserscriptAliases(rootDir),
  ];
}
