import path from "node:path";
import { fileURLToPath } from "node:url";
import type { UserConfig } from "vite";
import { defineConfig } from "vite";
import monkey from "vite-plugin-monkey";
import { getSafariUserscriptAliases } from "./vite.browser.alias";
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
  const diagnosticMode = mode === "diagnostic" || mode === "safari-diag";
  const debugMode = isDevCommand || mode === "development" || diagnosticMode;
  const productionOptimize = !debugMode;
  const mainHeaders = getHeaders<Record<string, unknown>>();
  const isBetaVersion = String(mainHeaders.version).includes("beta");
  const repoBranch: UserscriptBranch =
    debugMode || isBetaVersion ? "dev" : "master";
  const repoUpdateBranch: UserscriptBranch = isBetaVersion ? "dev" : "master";
  const availableLocales = await getAvailableLocales();

  const config: UserConfig = {
    define: {
      DEBUG_MODE: JSON.stringify(debugMode),
      IS_EXTENSION: JSON.stringify(false),
      AVAILABLE_LOCALES: JSON.stringify(availableLocales),
      REPO_BRANCH: JSON.stringify(repoBranch),
      VOT_VERSION: JSON.stringify(String(mainHeaders.version || "")),
      VOT_BUILD: JSON.stringify(buildMarker),
      VOT_BUNDLE: JSON.stringify("vot-safari.user.js"),
      VOT_AUTHORS: JSON.stringify(String(mainHeaders.author || "")),
    },
    resolve: {
      alias: getSafariUserscriptAliases(__dirname),
      extensions: [".js", ".ts"],
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
        userscript: buildUserscriptMeta(
          "vot-safari",
          repoBranch,
          repoUpdateBranch,
          { connectToRepository: true },
        ),
        build: {
          fileName: "vot-safari.user.js",
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
