import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  sitesCoursehunterLike,
  sitesInvidious,
  sitesPeertube,
  sitesPiped,
  sitesProxiTok,
} from "@vot.js/shared/alternativeUrls";
import type { Plugin, UserConfig } from "vite";
import { defineConfig, build as viteBuild } from "vite";
import type { MonkeyUserScript } from "vite-plugin-monkey";
import monkey from "vite-plugin-monkey";
import { contentUrl, repositoryUrl } from "./src/config/config";
import {
  getSafariMainUserscriptAliases,
  getSafariUserscriptAliases,
} from "./vite.browser.alias";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const srcDir = path.resolve(__dirname, "src");
const distDir = path.resolve(__dirname, "dist");
const localesDir = path.resolve(srcDir, "localization", "locales");
const localeHeadersDir = path.resolve(localesDir, "headers");
const hashesPath = path.resolve(srcDir, "localization", "hashes.json");
const metaHeadersPath = path.resolve(srcDir, "headers.json");
const priorityLocales = ["auto", "en", "ru"] as const;

type PriorityLocale = (typeof priorityLocales)[number];
type HashesJSON = Record<string, unknown>;
type UserscriptBranch = "dev" | "master";

interface LocaleHeadersFile {
  name: string;
  description: string;
}

type UserscriptMetaObject = Record<string, unknown>;

const USERSCRIPT_ALWAYS_EXCLUDED_MATCHES = new Set<string>();
const USERSCRIPT_PROD_EXCLUDED_MATCHES = new Set([
  "file://*/*",
  "*://localhost/*",
  "*://127.0.0.1/*",
]);

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function readFileUtf8(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

function writeFileUtf8(filePath: string, content: string): void {
  fs.writeFileSync(filePath, content, "utf8");
}

function getHeaders<T = MonkeyUserScript>(lang?: string): T {
  const headersPath = lang
    ? path.resolve(localeHeadersDir, `${lang}.json`)
    : metaHeadersPath;
  return readJsonFile<T>(headersPath);
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

function _appendSuffixLocalized(
  value: unknown,
  suffix: string,
): Record<string, string> {
  const localized = getMetaLocalizedValue(value);
  const baseEntries = {
    ...(localized.root ? { "": localized.root } : {}),
    ...localized.locales,
  };

  return Object.fromEntries(
    Object.entries(baseEntries).map(([locale, localeValue]) => [
      locale,
      localeValue.endsWith(suffix) ? localeValue : `${localeValue}${suffix}`,
    ]),
  );
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

async function getAvailableLocales(): Promise<string[]> {
  const hashesRaw = await fs.promises.readFile(hashesPath, "utf8");
  const hashes = JSON.parse(hashesRaw) as HashesJSON;
  const locales = Object.keys(hashes).filter(
    (locale) => !priorityLocales.includes(locale as PriorityLocale),
  );
  return [...priorityLocales, ...locales];
}

function altUrlsToMatch(): string[] {
  return [
    sitesInvidious,
    sitesPiped,
    sitesProxiTok,
    sitesPeertube,
    sitesCoursehunterLike,
  ].flatMap((sites) =>
    sites.map((site) => {
      const dotCount = site.match(/\./g)?.length ?? 0;
      const isSubdomain = dotCount > 1;
      return `*://${isSubdomain ? "" : "*."}${site}/*`;
    }),
  );
}

function filterUserscriptBaseMatches(
  matches: string[],
  repoBranch: UserscriptBranch,
): string[] {
  return matches.filter((pattern) => {
    if (USERSCRIPT_ALWAYS_EXCLUDED_MATCHES.has(pattern)) return false;
    if (repoBranch !== "dev" && USERSCRIPT_PROD_EXCLUDED_MATCHES.has(pattern)) {
      return false;
    }
    return true;
  });
}

function buildLocalizedMetaBase(repoBranch: UserscriptBranch): Pick<
  MonkeyUserScript,
  "name" | "description" | "match"
> & {
  localeProps: Record<string, string>;
} {
  const baseMeta = getHeaders<MonkeyUserScript>();
  const files = fs.readdirSync(localeHeadersDir);
  const baseName =
    typeof baseMeta.name === "string"
      ? baseMeta.name
      : (baseMeta.name?.default ?? "");
  const baseDescription =
    typeof baseMeta.description === "string"
      ? baseMeta.description
      : (baseMeta.description?.default ?? "");
  const nameLocales: Record<string, string> = { "": baseName };
  const descriptionLocales: Record<string, string> = { "": baseDescription };

  for (const file of files) {
    const localeHeaders = readJsonFile<LocaleHeadersFile>(
      path.resolve(localeHeadersDir, file),
    );
    const locale = file.substring(0, 2);
    nameLocales[locale] = localeHeaders.name;
    descriptionLocales[locale] = localeHeaders.description;
  }

  const baseMatch = filterUserscriptBaseMatches(
    Array.isArray(baseMeta.match) ? (baseMeta.match as string[]) : [],
    repoBranch,
  );
  const match = Array.from(new Set([...baseMatch, ...altUrlsToMatch()]));

  const localeProps: Record<string, string> = {};
  for (const [locale, value] of Object.entries(nameLocales)) {
    if (!locale) continue;
    localeProps[`name:${locale}`] = value;
  }
  for (const [locale, value] of Object.entries(descriptionLocales)) {
    if (!locale) continue;
    localeProps[`description:${locale}`] = value;
  }

  return {
    name: nameLocales,
    description: descriptionLocales,
    match,
    localeProps,
  };
}

function buildMainUserscriptMeta(
  filename: string,
  repoBranch: UserscriptBranch,
  repoUpdateBranch: UserscriptBranch,
): MonkeyUserScript {
  const baseMeta = getHeaders<MonkeyUserScript>();
  const localized = buildLocalizedMetaBase(repoBranch);
  const finalUrl = `${contentUrl}/${repoUpdateBranch}/dist/${filename}.user.js`;
  const baseConnect = Array.isArray(baseMeta.connect) ? baseMeta.connect : [];
  const safariNameLocales = Object.fromEntries(
    Object.entries(localized.name).map(([locale, value]) => [
      locale,
      value ? `${value} Safari` : value,
    ]),
  );

  const userscript: MonkeyUserScript = {
    ...baseMeta,
    name: safariNameLocales,
    description: localized.description,
    match: localized.match,
    homepageURL: repositoryUrl,
    updateURL: finalUrl,
    downloadURL: finalUrl,
    supportURL: `${repositoryUrl}/issues`,
    connect: Array.from(new Set([...baseConnect, "raw.githubusercontent.com"])),
  };

  Object.assign(userscript as Record<string, unknown>, localized.localeProps);
  for (const [locale, value] of Object.entries(safariNameLocales)) {
    if (!locale) continue;
    (userscript as Record<string, unknown>)[`name:${locale}`] = value;
  }
  return userscript;
}

function buildPageUserscriptMeta(
  repoBranch: UserscriptBranch,
  repoUpdateBranch: UserscriptBranch,
): MonkeyUserScript {
  const baseMeta = getHeaders<MonkeyUserScript>();
  const localized = buildLocalizedMetaBase(repoBranch);
  const finalUrl = `${contentUrl}/${repoUpdateBranch}/dist/vot-safari-page.user.js`;
  const pageNameLocales = Object.fromEntries(
    Object.entries(localized.name).map(([locale, value]) => [
      locale,
      value ? `${value} Safari Page Runtime` : value,
    ]),
  );
  const baseConnect = Array.isArray(baseMeta.connect) ? baseMeta.connect : [];

  const userscript: MonkeyUserScript = {
    ...baseMeta,
    name: pageNameLocales,
    description: localized.description,
    license: "MIT",
    match: localized.match,
    homepageURL: repositoryUrl,
    source: `${repositoryUrl}.git`,
    updateURL: finalUrl,
    downloadURL: finalUrl,
    supportURL: `${repositoryUrl}/issues`,
    connect: Array.from(new Set([...baseConnect, "raw.githubusercontent.com"])),
    grant: "none",
    runAt: "document-start",
    "inject-into": "page",
  } as MonkeyUserScript;

  Object.assign(userscript as Record<string, unknown>, localized.localeProps);
  for (const [locale, value] of Object.entries(pageNameLocales)) {
    if (!locale) continue;
    (userscript as Record<string, unknown>)[`name:${locale}`] = value;
  }

  return userscript;
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
        userscript: buildPageUserscriptMeta(repoBranch, repoUpdateBranch),
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
        userscript: buildMainUserscriptMeta(
          "vot-safari",
          repoBranch,
          repoUpdateBranch,
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
  const productionOptimize = false;
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
