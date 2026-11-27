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
import type { MonkeyUserScript } from "vite-plugin-monkey";
import { contentUrl, repositoryUrl } from "./src/config/config";

const srcDir = fileURLToPath(new URL("./src/", import.meta.url));
const localeHeadersDir = path.resolve(
  srcDir,
  "localization",
  "locales",
  "headers",
);
const priorityLocales = ["auto", "en", "ru"];

export type UserscriptBranch = "dev" | "master";

interface LocaleHeadersFile {
  name: string;
  description: string;
}

export const LOCAL_USERSCRIPT_MATCHES: ReadonlySet<string> = new Set([
  "file://*/*",
  "*://localhost/*",
  "*://127.0.0.1/*",
]);
const productionExcludedMatches = new Set([
  ...LOCAL_USERSCRIPT_MATCHES,
  "*://*.ngrok-free.app/*",
  "*://*.ngrok-free.dev/*",
  "*://*.ngrok.app/*",
]);

interface UserscriptMetaOptions {
  nameSuffix?: string;
  excludedProductionMatches?: ReadonlySet<string>;
  connectToRepository?: boolean;
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

export function getHeaders<T = MonkeyUserScript>(): T {
  return readJsonFile<T>(path.resolve(srcDir, "headers.json"));
}

export async function getAvailableLocales(): Promise<string[]> {
  const hashes = JSON.parse(
    await fs.promises.readFile(
      path.resolve(srcDir, "localization", "hashes.json"),
      "utf8",
    ),
  ) as Record<string, unknown>;
  return [
    ...priorityLocales,
    ...Object.keys(hashes).filter(
      (locale) => !priorityLocales.includes(locale),
    ),
  ];
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
      const isSubdomain = (site.match(/\./g)?.length ?? 0) > 1;
      return `*://${isSubdomain ? "" : "*."}${site}/*`;
    }),
  );
}

export function buildUserscriptMeta(
  filename: string,
  repoBranch: UserscriptBranch,
  repoUpdateBranch: UserscriptBranch,
  {
    nameSuffix = "",
    excludedProductionMatches = productionExcludedMatches,
    connectToRepository = repoBranch === "dev",
  }: UserscriptMetaOptions = {},
): MonkeyUserScript {
  const baseMeta = getHeaders();
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
  for (const file of fs.readdirSync(localeHeadersDir)) {
    const headers = readJsonFile<LocaleHeadersFile>(
      path.resolve(localeHeadersDir, file),
    );
    const locale = file.substring(0, 2);
    nameLocales[locale] = headers.name;
    descriptionLocales[locale] = headers.description;
  }
  for (const locale of Object.keys(nameLocales)) {
    if (nameLocales[locale]) nameLocales[locale] += nameSuffix;
  }

  const baseMatch = (
    Array.isArray(baseMeta.match) ? baseMeta.match : []
  ).filter(
    (pattern) =>
      repoBranch === "dev" ||
      typeof pattern !== "string" ||
      !excludedProductionMatches.has(pattern),
  );
  const finalUrl = `${contentUrl}/${repoUpdateBranch}/dist/${filename}.user.js`;
  const userscript: MonkeyUserScript = {
    ...baseMeta,
    name: nameLocales,
    description: descriptionLocales,
    match: [...new Set([...baseMatch, ...altUrlsToMatch()])],
    homepageURL: repositoryUrl,
    updateURL: finalUrl,
    downloadURL: finalUrl,
    supportURL: `${repositoryUrl}/issues`,
  };
  const localeProps = userscript as Record<string, unknown>;
  for (const [key, values] of Object.entries({
    name: nameLocales,
    description: descriptionLocales,
  })) {
    for (const [locale, value] of Object.entries(values)) {
      if (locale) localeProps[`${key}:${locale}`] = value;
    }
  }
  if (connectToRepository) {
    const baseConnect = Array.isArray(baseMeta.connect) ? baseMeta.connect : [];
    userscript.connect = [
      ...new Set([...baseConnect, "raw.githubusercontent.com"]),
    ];
  }
  return userscript;
}
