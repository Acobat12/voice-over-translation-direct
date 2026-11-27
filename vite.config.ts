import path from "node:path";
import { fileURLToPath } from "node:url";
import type { UserConfig } from "vite";
import { defineConfig } from "vite";
import monkey from "vite-plugin-monkey";
import { getBrowserSecureAliases } from "./vite.browser.alias";
import {
  buildUserscriptMeta,
  getAvailableLocales,
  getHeaders,
  type UserscriptBranch,
} from "./vite.userscript.shared";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const srcDir = path.resolve(__dirname, "src");
const distDir = path.resolve(__dirname, "dist");

export default defineConfig(async ({ command, mode }) => {
  const buildMarker = new Date().toISOString();
  const isDevCommand = command === "serve";
  const diagnosticMode = mode === "diagnostic";
  const debugMode = isDevCommand || mode === "development" || diagnosticMode;
  const explicitMinifiedVariant = mode === "minify";
  const productionOptimize = !debugMode;
  const mainHeaders = getHeaders();
  const isBetaVersion = String(mainHeaders.version).includes("beta");
  const repoBranch: UserscriptBranch =
    debugMode || isBetaVersion ? "dev" : "master";
  const repoUpdateBranch: UserscriptBranch = isBetaVersion ? "dev" : "master";
  const filename = explicitMinifiedVariant ? "vot-min" : "vot";
  const availableLocales = await getAvailableLocales();

  const config: UserConfig = {
    define: {
      DEBUG_MODE: JSON.stringify(debugMode),
      IS_EXTENSION: JSON.stringify(false),
      AVAILABLE_LOCALES: JSON.stringify(availableLocales),
      REPO_BRANCH: JSON.stringify(repoBranch),
      VOT_VERSION: JSON.stringify(String((mainHeaders as any).version || "")),
      VOT_BUILD: JSON.stringify(buildMarker),
      VOT_BUNDLE: JSON.stringify(`${filename}.user.js`),
      // Expose a tiny piece of metadata to runtime UI (Settings → About).
      // This avoids relying on GM_info.script.author which isn't present in
      // the extension build.
      VOT_AUTHORS: JSON.stringify(String((mainHeaders as any).author || "")),
    },
    resolve: {
      extensions: [".js", ".ts"],
      alias: getBrowserSecureAliases(__dirname),
    },
    css: {
      transformer: "lightningcss",
    },
    build: {
      outDir: distDir,
      emptyOutDir: false,
      minify: productionOptimize ? "oxc" : false,
      sourcemap: debugMode,
      rollupOptions: {
        onwarn(warning, warn) {
          if (warning.code === "CIRCULAR_DEPENDENCY") return;
          warn(warning);
        },
      },
    },
    plugins: [
      ...monkey({
        entry: path.resolve(srcDir, "index.ts"),
        userscript: buildUserscriptMeta(filename, repoBranch, repoUpdateBranch),
        build: {
          fileName: `${filename}.user.js`,
          metaFileName: false,
          cssSideEffects: "(css)=>GM_addStyle(css)",
          autoGrant: true,
          systemjs: "inline",
        },
      }),
    ],
  };
  return config;
});
