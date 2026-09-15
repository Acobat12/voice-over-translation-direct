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
import type { UserConfig } from "vite";
import { defineConfig } from "vite";
import type { MonkeyUserScript } from "vite-plugin-monkey";
import monkey from "vite-plugin-monkey";
import { contentUrl, repositoryUrl } from "./src/config/config";
import { getSafariUserscriptAliases } from "./vite.browser.alias";

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

const USERSCRIPT_ALWAYS_EXCLUDED_MATCHES = new Set<string>();
const USERSCRIPT_PROD_EXCLUDED_MATCHES = new Set([
  "file://*/*",
  "*://localhost/*",
  "*://127.0.0.1/*",
  "*://*.ngrok-free.app/*",
  "*://*.ngrok-free.dev/*",
  "*://*.ngrok.app/*",
]);

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function getHeaders<T = MonkeyUserScript>(lang?: string): T {
  const headersPath = lang
    ? path.resolve(localeHeadersDir, `${lang}.json`)
    : metaHeadersPath;
  return readJsonFile<T>(headersPath);
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

function buildUserscriptMeta(
  filename: string,
  repoBranch: UserscriptBranch,
  repoUpdateBranch: UserscriptBranch,
): MonkeyUserScript {
  const baseMeta = getHeaders<MonkeyUserScript>();
  const files = fs.readdirSync(localeHeadersDir);
  const nameLocales: Record<string, string> = {
    "":
      typeof baseMeta.name === "string"
        ? baseMeta.name
        : (baseMeta.name?.default ?? ""),
  };
  const descriptionLocales: Record<string, string> = {
    "":
      typeof baseMeta.description === "string"
        ? baseMeta.description
        : (baseMeta.description?.default ?? ""),
  };

  for (const file of files) {
    const localeHeaders = readJsonFile<LocaleHeadersFile>(
      path.resolve(localeHeadersDir, file),
    );
    const locale = file.substring(0, 2);
    nameLocales[locale] = localeHeaders.name;
    descriptionLocales[locale] = localeHeaders.description;
  }

  const finalUrl = `${contentUrl}/${repoUpdateBranch}/dist/${filename}.user.js`;
  const baseMatch = filterUserscriptBaseMatches(
    Array.isArray(baseMeta.match) ? (baseMeta.match as string[]) : [],
    repoBranch,
  );
  const match = Array.from(new Set([...baseMatch, ...altUrlsToMatch()]));

  const userscript: MonkeyUserScript = {
    ...baseMeta,
    name: nameLocales,
    description: descriptionLocales,
    match,
    homepageURL: repositoryUrl,
    updateURL: finalUrl,
    downloadURL: finalUrl,
    supportURL: `${repositoryUrl}/issues`,
  };

  const localeProps = userscript as Record<string, unknown>;
  for (const [locale, value] of Object.entries(nameLocales)) {
    if (!locale) continue;
    localeProps[`name:${locale}`] = value;
  }
  for (const [locale, value] of Object.entries(descriptionLocales)) {
    if (!locale) continue;
    localeProps[`description:${locale}`] = value;
  }

  const baseConnect = Array.isArray(userscript.connect)
    ? userscript.connect
    : [];
  userscript.connect = Array.from(
    new Set([...baseConnect, "raw.githubusercontent.com"]),
  );

  return userscript;
}

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
