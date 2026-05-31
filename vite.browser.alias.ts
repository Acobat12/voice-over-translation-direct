import path from "node:path";
import type { Alias } from "vite";

export function getBrowserSafeAliases(rootDir: string): Alias[] {
  return [
    {
      // `@vot.js/shared/secure` falls back to `import("node:crypto")`, which
      // makes Vite emit `__vite-browser-external-*` helper chunks. Browser
      // builds only need Web Crypto, so route the import to a browser-safe shim.
      find: "@vot.js/shared/secure",
      replacement: path.join(rootDir, "src", "shims", "votSharedSecure.ts"),
    },
  ];
}
