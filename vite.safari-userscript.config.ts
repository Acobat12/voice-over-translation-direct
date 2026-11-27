import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin, UserConfig } from "vite";
import { defineConfig, build as viteBuild } from "vite";
import type { MonkeyUserScript } from "vite-plugin-monkey";
import monkey from "vite-plugin-monkey";
import { repositoryUrl } from "./src/config/config";
import {
  getSafariMainUserscriptAliases,
  getSafariUserscriptAliases,
} from "./vite.browser.alias";
import {
  buildUserscriptMeta,
  getAvailableLocales,
  getHeaders,
  LOCAL_USERSCRIPT_MATCHES,
  type UserscriptBranch,
} from "./vite.userscript.shared";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const srcDir = path.resolve(__dirname, "src");
const distDir = path.resolve(__dirname, "dist");
type UserscriptMetaObject = Record<string, unknown>;

const safariMetaOptions = {
  excludedProductionMatches: LOCAL_USERSCRIPT_MATCHES,
  connectToRepository: true,
};

function readFileUtf8(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

function writeFileUtf8(filePath: string, content: string): void {
  fs.writeFileSync(filePath, content, "utf8");
}

function formatMetaLine(key: string, value: string): string {
  return `// @${key.padEnd(15)} ${value}`;
}

function getMetaLocalizedValue(value: unknown): {
  root?: string;
  locales: Record<string, string>;
} {
  if (typeof value === "string") {
    return { root: value, locales: {} };
  }

  if (!value || typeof value !== "object") {
    return { locales: {} };
  }

  const record = value as Record<string, unknown>;
  const locales = Object.fromEntries(
    Object.entries(record)
      .filter(([key, localeValue]) => key && typeof localeValue === "string")
      .map(([key, localeValue]) => [key, localeValue as string]),
  );

  const root =
    typeof record[""] === "string"
      ? (record[""] as string)
      : typeof record.default === "string"
        ? (record.default as string)
        : undefined;

  return { root, locales };
}

function renderUserscriptHeader(meta: UserscriptMetaObject): string {
  const lines: string[] = ["// ==UserScript=="];

  const pushLocalized = (key: string, value: unknown) => {
    const localized = getMetaLocalizedValue(value);
    if (localized.root) {
      lines.push(formatMetaLine(key, localized.root));
    }
    for (const [locale, localeValue] of Object.entries(localized.locales)) {
      lines.push(formatMetaLine(`${key}:${locale}`, localeValue));
    }
  };

  const pushSingle = (key: string, value: unknown) => {
    if (value == null) return;
    lines.push(formatMetaLine(key, String(value)));
  };

  const pushMany = (key: string, value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item != null) lines.push(formatMetaLine(key, String(item)));
      }
      return;
    }
    if (value != null) {
      lines.push(formatMetaLine(key, String(value)));
    }
  };

  pushLocalized("name", meta.name);
  pushSingle("namespace", meta.namespace);
  pushSingle("version", meta.version);
  pushSingle("author", meta.author);
  pushLocalized("description", meta.description);
  pushSingle("license", meta.license);
  pushSingle("icon", meta.icon);
  pushSingle("homepageURL", meta.homepageURL);
  pushSingle("source", meta.source);
  pushSingle("supportURL", meta.supportURL);
  pushSingle("downloadURL", meta.downloadURL);
  pushSingle("updateURL", meta.updateURL);
  pushMany("match", meta.match);
  pushMany("exclude", meta.exclude);
  pushMany("require", meta.require);
  pushMany("connect", meta.connect);
  pushMany("grant", meta.grant);
  pushSingle("inject-into", meta["inject-into"]);
  pushSingle("run-at", meta.runAt);

  lines.push("// ==/UserScript==");
  return `${lines.join("\n")}\n`;
}

function replaceUserscriptHeader(filePath: string, nextHeader: string): void {
  const content = readFileUtf8(filePath);
  const nextContent = content.replace(
    /^\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==\s*/u,
    nextHeader,
  );
  writeFileUtf8(filePath, nextContent);
}

function patchSafariMainHeader(filePath: string): void {
  const content = readFileUtf8(filePath);
  const nextContent = content.replace(
    /^\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/u,
    (header) =>
      header.replace(
        /^\/\/ @name(?::[^\s]+)?\s+(.+)$/gmu,
        (_match, nameValue: string) => {
          const trimmed = nameValue.trimEnd();
          const nextValue = trimmed.endsWith(" Safari")
            ? trimmed
            : `${trimmed} Safari`;
          return _match.replace(nameValue, nextValue);
        },
      ),
  );
  writeFileUtf8(filePath, nextContent);
}

function createDefineMeta({
  debugMode,
  availableLocales,
  repoBranch,
  version,
  authors,
}: {
  debugMode: boolean;
  availableLocales: string[];
  repoBranch: UserscriptBranch;
  version: string;
  authors: string;
}): Record<string, string> {
  return {
    DEBUG_MODE: JSON.stringify(debugMode),
    IS_EXTENSION: JSON.stringify(false),
    AVAILABLE_LOCALES: JSON.stringify(availableLocales),
    REPO_BRANCH: JSON.stringify(repoBranch),
    VOT_VERSION: JSON.stringify(version),
    VOT_AUTHORS: JSON.stringify(authors),
  };
}

async function buildSafariBundle({
  entry,
  fileName,
  userscript,
  define,
  debugMode,
  productionOptimize,
  postprocess,
  aliases,
}: {
  entry: string;
  fileName: string;
  userscript: MonkeyUserScript;
  define: Record<string, string>;
  debugMode: boolean;
  productionOptimize: boolean;
  postprocess?: (filePath: string, userscript: MonkeyUserScript) => void;
  aliases?: UserConfig["resolve"] extends { alias?: infer T } ? T : never;
}): Promise<void> {
  await viteBuild({
    root: __dirname,
    configFile: false,
    define,
    resolve: {
      alias: aliases,
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
        entry,
        userscript,
        build: {
          fileName,
          metaFileName: false,
          cssSideEffects: "(css)=>GM_addStyle(css)",
          autoGrant: true,
          systemjs: "inline",
        },
      }),
    ],
  });

  const outputPath = path.resolve(distDir, fileName);
  if (typeof postprocess === "function" && fs.existsSync(outputPath)) {
    postprocess(outputPath, userscript);
  }
}

function safariUserscriptPipelinePlugin({
  debugMode,
  productionOptimize,
  repoBranch,
  repoUpdateBranch,
  availableLocales,
  version,
  authors,
}: {
  debugMode: boolean;
  productionOptimize: boolean;
  repoBranch: UserscriptBranch;
  repoUpdateBranch: UserscriptBranch;
  availableLocales: string[];
  version: string;
  authors: string;
}): Plugin {
  return {
    name: "vot-safari-userscript-pipeline",
    apply: "build",
    async closeBundle() {
      const defineMeta = createDefineMeta({
        debugMode,
        availableLocales,
        repoBranch,
        version,
        authors,
      });

      await buildSafariBundle({
        entry: path.resolve(srcDir, "runtime", "safari", "pageRuntime.ts"),
        fileName: "vot-safari-page.user.js",
        userscript: {
          ...buildUserscriptMeta(
            "vot-safari-page",
            repoBranch,
            repoUpdateBranch,
            {
              ...safariMetaOptions,
              nameSuffix: " Safari Page Runtime",
            },
          ),
          license: "MIT",
          source: `${repositoryUrl}.git`,
          grant: "none",
          runAt: "document-start",
          "inject-into": "page",
        } as MonkeyUserScript,
        define: defineMeta,
        debugMode,
        productionOptimize,
        aliases: getSafariUserscriptAliases(__dirname),
        postprocess(filePath, userscript) {
          replaceUserscriptHeader(
            filePath,
            renderUserscriptHeader({
              ...userscript,
              "inject-into": "page",
              grant: "none",
              runAt: undefined,
            }),
          );
        },
      });

      await buildSafariBundle({
        entry: path.resolve(srcDir, "index.ts"),
        fileName: "vot-safari.user.js",
        userscript: buildUserscriptMeta(
          "vot-safari",
          repoBranch,
          repoUpdateBranch,
          { ...safariMetaOptions, nameSuffix: " Safari" },
        ),
        define: defineMeta,
        debugMode,
        productionOptimize,
        aliases: getSafariMainUserscriptAliases(__dirname),
        postprocess(filePath) {
          patchSafariMainHeader(filePath);
        },
      });
    },
  };
}

const virtualEntry = "virtual:vot-safari-userscript-pipeline";
const resolvedVirtualEntry = "\0virtual:vot-safari-userscript-pipeline";

function virtualEntryPlugin(): Plugin {
  return {
    name: "vot-safari-userscript-pipeline-entry",
    resolveId(source) {
      if (source === virtualEntry) return resolvedVirtualEntry;
      return null;
    },
    load(id) {
      if (id !== resolvedVirtualEntry) return null;
      return "globalThis.__VOT_SAFARI_USERSCRIPT_PIPELINE__ = true;";
    },
  };
}

export default defineConfig(async ({ command, mode }) => {
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
    root: __dirname,
    plugins: [
      virtualEntryPlugin(),
      safariUserscriptPipelinePlugin({
        debugMode,
        productionOptimize,
        repoBranch,
        repoUpdateBranch,
        availableLocales,
        version: String(mainHeaders.version || ""),
        authors: String(mainHeaders.author || ""),
      }),
    ],
    build: {
      outDir: distDir,
      emptyOutDir: false,
      write: false,
      minify: false,
      rollupOptions: {
        input: virtualEntry,
      },
    },
  };

  return config;
});
