type PageExtractor<T> = (...args: unknown[]) => T | Promise<T>;

export type PagePathSegment = string | number;
export type PagePath = readonly PagePathSegment[];

type GMPageDataLike = <T>(
  extractor: PageExtractor<T>,
  ...args: unknown[]
) => Promise<T>;

type GMLike = {
  addStyle?: (css: string) => HTMLElement | HTMLStyleElement | undefined;
  deleteValue?: (key: string) => Promise<void>;
  getPageData?: GMPageDataLike;
  getValue?<T>(key: string, defaultValue?: T): Promise<T>;
  getValues?<T extends Record<string, unknown>>(defaults: T): Promise<T>;
  info?: {
    script?: {
      grant?: unknown;
      name?: string;
      version?: string;
    };
    scriptHandler?: string;
    version?: string;
  };
  listValues?<T extends string = string>(): Promise<T[]>;
  page?: {
    call?: (operation: string, ...args: unknown[]) => Promise<unknown>;
  };
  registerMenuCommand?: (
    name: string,
    callback: (...args: unknown[]) => unknown,
  ) => unknown;
  setValue?<T>(key: string, value: T): Promise<void>;
  unsafePage?: unknown;
  xmlHttpRequest?: (details: any) => { abort?: () => void } | undefined;
};

export type PageAccessBackend =
  | "unsafeWindow"
  | "wrappedJSObject"
  | "gm.getPageData"
  | "GM_getPageData"
  | "gm.unsafePage"
  | "none";

export type RuntimeCapabilities = {
  gmPresent: boolean;
  gmXmlHttpRequest: boolean;
  legacyGmXmlHttpRequest: boolean;
  managerName: string;
  pageAccessBackend: PageAccessBackend;
};

const RESERVED_OBJECT_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_SANITIZE_DEPTH = 6;
const MAX_SANITIZE_KEYS = 64;
const MAX_SANITIZE_ARRAY = 40;

function getGMObject(): GMLike | undefined {
  if (typeof GM === "object" && GM !== null) {
    return GM as GMLike;
  }

  const runtimeGM = (globalThis as { GM?: GMLike }).GM;
  return typeof runtimeGM === "object" && runtimeGM !== null
    ? runtimeGM
    : undefined;
}

function getLegacyFunction<T extends (...args: any[]) => unknown>(
  name: string,
): T | undefined {
  const candidate = (globalThis as Record<string, unknown>)[name];
  return typeof candidate === "function" ? (candidate as T) : undefined;
}

function getManagerName(): string {
  const gm = getGMObject();
  const gmInfo =
    typeof GM_info !== "undefined" && GM_info ? GM_info : undefined;

  return String(
    gmInfo?.scriptHandler ||
      gm?.info?.scriptHandler ||
      gm?.info?.script?.name ||
      "",
  ).trim();
}

function getUnsafeWindowCandidate(): unknown {
  if (typeof unsafeWindow !== "undefined" && unsafeWindow) {
    return unsafeWindow;
  }

  const gmUnsafeWindow = (getGMObject() as Record<string, unknown> | undefined)
    ?.unsafeWindow;
  if (gmUnsafeWindow) {
    return gmUnsafeWindow;
  }

  return undefined;
}

function getUnsafePageApi():
  | {
      get: (path: PagePath) => Promise<unknown>;
      call: (
        path: PagePath,
        args?: unknown[],
        options?: unknown,
      ) => Promise<unknown>;
      has?: (path: PagePath) => Promise<boolean>;
      keys?: (path: PagePath) => Promise<unknown>;
    }
  | undefined {
  const unsafePage = getGMObject()?.unsafePage as
    | Record<string, unknown>
    | undefined;
  if (!unsafePage) {
    return undefined;
  }

  return typeof unsafePage.get === "function" &&
    typeof unsafePage.call === "function"
    ? {
        get: unsafePage.get as (path: PagePath) => Promise<unknown>,
        call: unsafePage.call as (
          path: PagePath,
          args?: unknown[],
          options?: unknown,
        ) => Promise<unknown>,
        has:
          typeof unsafePage.has === "function"
            ? (unsafePage.has as (path: PagePath) => Promise<boolean>)
            : undefined,
        keys:
          typeof unsafePage.keys === "function"
            ? (unsafePage.keys as (path: PagePath) => Promise<unknown>)
            : undefined,
      }
    : undefined;
}

function unwrapFirefoxValue(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return value;
  }

  try {
    if ("wrappedJSObject" in (value as Record<string, unknown>)) {
      const unwrapped = (value as Record<string, unknown>).wrappedJSObject;
      if (unwrapped !== undefined) {
        return unwrapped;
      }
    }
  } catch {
    // Ignore cross-compartment unwrap failures.
  }

  return value;
}

function isNodeLike(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  if (typeof Node !== "undefined" && value instanceof Node) {
    return true;
  }

  if (typeof Window !== "undefined" && value instanceof Window) {
    return true;
  }

  if (typeof Document !== "undefined" && value instanceof Document) {
    return true;
  }

  return false;
}

function isPlainObjectLike(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = unwrapFirefoxValue(value);
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return false;
  }

  try {
    const proto = Object.getPrototypeOf(candidate);
    return proto === Object.prototype || proto === null;
  } catch {
    return false;
  }
}

export function sanitizePageValue(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  if (value == null) {
    return value;
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "bigint") {
    return String(value);
  }

  if (typeof value === "function" || typeof value === "symbol") {
    return undefined;
  }

  if (depth >= MAX_SANITIZE_DEPTH) {
    return undefined;
  }

  const unwrapped = unwrapFirefoxValue(value);
  if (!unwrapped || typeof unwrapped !== "object") {
    return undefined;
  }

  if (isNodeLike(unwrapped)) {
    return undefined;
  }

  if (Array.isArray(unwrapped)) {
    const next: unknown[] = [];
    for (const item of unwrapped.slice(0, MAX_SANITIZE_ARRAY)) {
      const sanitized = sanitizePageValue(item, depth + 1, seen);
      if (sanitized !== undefined) {
        next.push(sanitized);
      }
    }
    return next;
  }

  if (!isPlainObjectLike(unwrapped)) {
    return undefined;
  }

  if (seen.has(unwrapped)) {
    return undefined;
  }
  seen.add(unwrapped);

  const next: Record<string, unknown> = {};
  for (const key of Object.keys(unwrapped).slice(0, MAX_SANITIZE_KEYS)) {
    if (RESERVED_OBJECT_KEYS.has(key)) {
      continue;
    }

    const sanitized = sanitizePageValue(
      (unwrapped as Record<string, unknown>)[key],
      depth + 1,
      seen,
    );
    if (sanitized !== undefined) {
      next[key] = sanitized;
    }
  }

  return next;
}

function normalizePagePath(path: PagePath | string): PagePath {
  if (typeof path !== "string") {
    return path;
  }

  return path
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function resolvePathValue(root: unknown, path: PagePath): unknown {
  let current: unknown = unwrapFirefoxValue(root);

  for (const segment of path) {
    if (current == null) {
      return undefined;
    }

    const container = unwrapFirefoxValue(current);
    if (container == null) {
      return undefined;
    }

    current = (container as Record<PagePathSegment, unknown>)[segment];
  }

  return unwrapFirefoxValue(current);
}

function resolveDirectPageRoot():
  | { backend: "unsafeWindow" | "wrappedJSObject"; root: unknown }
  | undefined {
  const unsafeCandidate = getUnsafeWindowCandidate();
  if (unsafeCandidate && unsafeCandidate !== globalThis) {
    return {
      backend: "unsafeWindow",
      root: unsafeCandidate,
    };
  }

  const wrappedCandidate = unwrapFirefoxValue(
    (globalThis as Record<string, unknown>).wrappedJSObject,
  );
  if (wrappedCandidate && wrappedCandidate !== globalThis) {
    return {
      backend: "wrappedJSObject",
      root: wrappedCandidate,
    };
  }
  return undefined;
}

function getRemotePageExecutor():
  | {
      backend: "gm.getPageData" | "GM_getPageData";
      call: GMPageDataLike;
      receiver?: unknown;
    }
  | undefined {
  const gm = getGMObject();
  if (typeof gm?.getPageData === "function") {
    return {
      backend: "gm.getPageData",
      call: gm.getPageData,
      receiver: gm,
    };
  }

  const gmGetPageData = getLegacyFunction<GMPageDataLike>("GM_getPageData");
  if (gmGetPageData) {
    return {
      backend: "GM_getPageData",
      call: gmGetPageData,
    };
  }

  return undefined;
}

export function getRuntimeCapabilities(): RuntimeCapabilities {
  const gm = getGMObject();
  const unsafePage = getUnsafePageApi();
  const directRoot = resolveDirectPageRoot();
  const remoteExecutor = getRemotePageExecutor();

  return {
    gmPresent: Boolean(gm),
    gmXmlHttpRequest: typeof gm?.xmlHttpRequest === "function",
    legacyGmXmlHttpRequest:
      typeof getLegacyFunction("GM_xmlhttpRequest") === "function",
    managerName: getManagerName(),
    pageAccessBackend:
      (unsafePage ? "gm.unsafePage" : undefined) ||
      directRoot?.backend ||
      remoteExecutor?.backend ||
      "none",
  };
}

export async function runPageExtractor<T>(
  extractor: PageExtractor<T>,
  ...args: unknown[]
): Promise<{ backend: "gm.getPageData" | "GM_getPageData"; value: T }> {
  const remoteExecutor = getRemotePageExecutor();
  if (!remoteExecutor) {
    throw new Error("No remote page extractor backend is available");
  }

  const value = await remoteExecutor.call.call(
    remoteExecutor.receiver,
    extractor,
    ...args.map((arg) => sanitizePageValue(arg)),
  );

  return {
    backend: remoteExecutor.backend,
    value,
  };
}

export async function getPageGlobal(path: PagePath | string): Promise<unknown> {
  const normalizedPath = normalizePagePath(path);
  const unsafePage = getUnsafePageApi();
  if (unsafePage) {
    return sanitizePageValue(await unsafePage.get(normalizedPath));
  }

  const directRoot = resolveDirectPageRoot();
  if (directRoot) {
    return sanitizePageValue(resolvePathValue(directRoot.root, normalizedPath));
  }

  const remoteExecutor = getRemotePageExecutor();
  if (!remoteExecutor) {
    throw new Error("No page-global access capability is available");
  }

  const result = await remoteExecutor.call.call(
    remoteExecutor.receiver,
    (segments: PagePathSegment[]) => {
      let current: unknown = window;
      for (const segment of segments) {
        if (current == null) {
          return undefined;
        }
        current = (current as Record<PagePathSegment, unknown>)[segment];
      }
      return current;
    },
    normalizedPath,
  );

  return sanitizePageValue(result);
}

export async function callPageFunction(
  path: PagePath | string,
  args: unknown[] = [],
): Promise<unknown> {
  const normalizedPath = normalizePagePath(path);
  const normalizedArgs = args.map((arg) => sanitizePageValue(arg));
  const unsafePage = getUnsafePageApi();
  if (unsafePage) {
    return sanitizePageValue(
      await unsafePage.call(normalizedPath, normalizedArgs),
    );
  }

  const directRoot = resolveDirectPageRoot();
  if (directRoot) {
    const parentPath = normalizedPath.slice(0, -1);
    const methodName = normalizedPath[normalizedPath.length - 1];
    const target = parentPath.length
      ? resolvePathValue(directRoot.root, parentPath)
      : directRoot.root;
    const method =
      methodName !== undefined
        ? resolvePathValue(target, [methodName])
        : undefined;
    if (typeof method !== "function") {
      return undefined;
    }
    return sanitizePageValue(
      (method as (...fnArgs: unknown[]) => unknown).apply(
        unwrapFirefoxValue(target),
        normalizedArgs,
      ),
    );
  }

  const remoteExecutor = getRemotePageExecutor();
  if (!remoteExecutor) {
    throw new Error("No page-function access capability is available");
  }

  const result = await remoteExecutor.call.call(
    remoteExecutor.receiver,
    (segments: PagePathSegment[], fnArgs: unknown[]) => {
      const parentPath = segments.slice(0, -1);
      const methodName = segments[segments.length - 1];
      let target: unknown = window;
      for (const segment of parentPath) {
        if (target == null) {
          return undefined;
        }
        target = (target as Record<PagePathSegment, unknown>)[segment];
      }
      if (target == null || methodName == null) {
        return undefined;
      }

      const maybeMethod = (target as Record<PagePathSegment, unknown>)[
        methodName
      ];
      if (typeof maybeMethod !== "function") {
        return undefined;
      }

      return maybeMethod.apply(target, fnArgs);
    },
    normalizedPath,
    normalizedArgs,
  );

  return sanitizePageValue(result);
}

export async function gmPageCall(
  operation: string,
  ...args: unknown[]
): Promise<unknown> {
  const gm = getGMObject();
  if (typeof gm?.page?.call !== "function") {
    throw new Error("GM.page.call is not available");
  }

  return await gm.page.call(
    operation,
    ...args.map((arg) => sanitizePageValue(arg)),
  );
}

export function gmXmlHttpRequest(
  details: any,
): { abort?: () => void } | undefined {
  const gm = getGMObject();
  if (typeof gm?.xmlHttpRequest === "function") {
    return gm.xmlHttpRequest(details);
  }

  const legacy =
    getLegacyFunction<(details: any) => { abort?: () => void } | undefined>(
      "GM_xmlhttpRequest",
    );
  if (legacy) {
    return legacy(details);
  }

  throw new TypeError("GM_xmlhttpRequest is not available");
}

export async function gmGetValue<T>(key: string, defaultValue?: T): Promise<T> {
  const gm = getGMObject();
  if (typeof gm?.getValue === "function") {
    return await gm.getValue(key, defaultValue);
  }

  const legacy =
    getLegacyFunction<(key: string, defaultValue?: T) => T>("GM_getValue");
  if (legacy) {
    return legacy(key, defaultValue);
  }

  return defaultValue as T;
}

export async function gmSetValue<T>(key: string, value: T): Promise<void> {
  const gm = getGMObject();
  if (typeof gm?.setValue === "function") {
    await gm.setValue(key, value);
    return;
  }

  const legacy =
    getLegacyFunction<(key: string, value: T) => void>("GM_setValue");
  if (legacy) {
    legacy(key, value);
  }
}

export async function gmDeleteValue(key: string): Promise<void> {
  const gm = getGMObject();
  if (typeof gm?.deleteValue === "function") {
    await gm.deleteValue(key);
    return;
  }

  const legacy = getLegacyFunction<(key: string) => void>("GM_deleteValue");
  legacy?.(key);
}

export async function gmListValues<T extends string = string>(): Promise<T[]> {
  const gm = getGMObject();
  if (typeof gm?.listValues === "function") {
    return await gm.listValues<T>();
  }

  const legacy = getLegacyFunction<() => T[]>("GM_listValues");
  return legacy ? legacy() : [];
}

export async function gmGetValues<T extends Record<string, unknown>>(
  defaults: T,
): Promise<T> {
  const gm = getGMObject();
  if (typeof gm?.getValues === "function") {
    return await gm.getValues(defaults);
  }

  const result = { ...defaults };
  for (const [key, value] of Object.entries(defaults)) {
    result[key as keyof T] = (await gmGetValue(key, value)) as T[keyof T];
  }
  return result;
}

export function gmAddStyle(
  css: string,
): HTMLElement | HTMLStyleElement | undefined {
  const isStyleNode = (
    value: unknown,
  ): value is HTMLElement | HTMLStyleElement =>
    Boolean(
      value &&
        typeof value === "object" &&
        ((typeof HTMLElement !== "undefined" &&
          value instanceof (HTMLElement as any)) ||
          (typeof HTMLStyleElement !== "undefined" &&
            value instanceof (HTMLStyleElement as any))),
    );

  const gm = getGMObject();
  if (typeof gm?.addStyle === "function") {
    const result = gm.addStyle(css);
    return isStyleNode(result) ? result : undefined;
  }

  const legacy =
    getLegacyFunction<
      (styleCss: string) => HTMLElement | HTMLStyleElement | undefined
    >("GM_addStyle");
  if (legacy) {
    const result = legacy(css);
    return isStyleNode(result) ? result : undefined;
  }

  const style = document.createElement("style");
  style.textContent = css;
  (document.head || document.documentElement).appendChild(style);
  return style;
}

export function gmRegisterMenuCommand(
  name: string,
  callback: (...args: unknown[]) => unknown,
): unknown {
  const gm = getGMObject();
  if (typeof gm?.registerMenuCommand === "function") {
    return gm.registerMenuCommand(name, callback);
  }

  const legacy = getLegacyFunction<
    (
      commandName: string,
      commandCallback: (...args: unknown[]) => unknown,
    ) => unknown
  >("GM_registerMenuCommand");
  return legacy?.(name, callback);
}
