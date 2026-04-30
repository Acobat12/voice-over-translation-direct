import {
  authCallbackOrigin,
  authCallbackPath,
  authCallbackUrl,
  yandexOauthClientId,
} from "../config/config";
import type { Account } from "../types/storage";
import { votStorage } from "../utils/storage";

type AuthProfilePayload = {
  avatar_id: string;
  username: string;
};

type OAuthPopupSuccessMessage = {
  source: "vot-auth";
  type: "code";
  code: string;
  state?: string;
};

type OAuthPopupErrorMessage = {
  source: "vot-auth";
  type: "error";
  error: string;
  error_description?: string;
  state?: string;
};

function getProfilePayload(): AuthProfilePayload | null {
  const payload = (globalThis as { _userData?: unknown })._userData;
  if (!payload || typeof payload !== "object") return null;

  const candidate = payload as {
    avatar_id?: unknown;
    username?: unknown;
  };

  if (
    typeof candidate.avatar_id !== "string" ||
    typeof candidate.username !== "string" ||
    !candidate.avatar_id ||
    !candidate.username
  ) {
    return null;
  }

  return {
    avatar_id: candidate.avatar_id,
    username: candidate.username,
  };
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function sha256Base64Url(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(digest));
}

function randomString(length = 64): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let result = "";
  for (let i = 0; i < length; i += 1) {
    result += alphabet[bytes[i] % alphabet.length];
  }
  return result;
}

export async function createPkceAuthUrl(): Promise<string> {
  const state = randomString(32);
  const codeVerifier = randomString(64);
  const codeChallenge = await sha256Base64Url(codeVerifier);

  sessionStorage.setItem("vot-yandex-oauth-state", state);
  sessionStorage.setItem("vot-yandex-oauth-code-verifier", codeVerifier);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: yandexOauthClientId,
    redirect_uri: authCallbackUrl,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  return `https://oauth.yandex.ru/authorize?${params.toString()}`;
}

function gmPostForm(
  url: string,
  body: string,
): Promise<{ status: number; responseText: string }> {
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method: "POST",
      url,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      },
      data: body,
      onload: (res) => {
        resolve({
          status: res.status,
          responseText: res.responseText || "",
        });
      },
      onerror: (err) => {
        console.error("[VOT] GM OAuth request failed:", err);
        reject(new Error("[VOT] GM OAuth request network error"));
      },
      ontimeout: () => {
        reject(new Error("[VOT] GM OAuth request timeout"));
      },
    });
  });
}

export async function exchangeCodeForToken(code: string): Promise<{
  access_token: string;
  expires_in: number;
  refresh_token?: string;
}> {
  const codeVerifier = sessionStorage.getItem("vot-yandex-oauth-code-verifier");
  if (!codeVerifier) {
    throw new Error("[VOT] Missing PKCE code_verifier in opener");
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: yandexOauthClientId,
    code_verifier: codeVerifier,
    redirect_uri: authCallbackUrl,
  }).toString();

  const res = await gmPostForm("https://oauth.yandex.ru/token", body);

  const rawText = res.responseText || "";
  let data: any = {};

  try {
    data = rawText ? JSON.parse(rawText) : {};
  } catch {
    data = {};
  }

  if (res.status < 200 || res.status >= 300 || data?.error) {
    const err = data?.error ?? `http_${res.status}`;
    const desc = data?.error_description ? ` (${data.error_description})` : "";
    throw new Error(
      `[VOT] Failed to exchange verification code: ${err}${desc}. Response: ${rawText}`,
    );
  }

  if (!data?.access_token) {
    throw new Error(
      `[VOT] access_token was not returned by Yandex. Response: ${rawText}`,
    );
  }

  if (typeof data.expires_in !== "number") {
    throw new Error(
      `[VOT] expires_in was not returned or invalid. Response: ${rawText}`,
    );
  }

  return {
    access_token: data.access_token,
    expires_in: data.expires_in,
    refresh_token: data.refresh_token,
  };
}

export async function saveOAuthAccount(tokenData: {
  access_token: string;
  expires_in: number;
}) {
  await votStorage.set<Account>("account", {
    token: tokenData.access_token,
    expires: Date.now() + tokenData.expires_in * 1000,
    username: undefined,
    avatarId: undefined,
  });

  sessionStorage.removeItem("vot-yandex-oauth-state");
  sessionStorage.removeItem("vot-yandex-oauth-code-verifier");
}

async function postResultToOpener(
  message: OAuthPopupSuccessMessage | OAuthPopupErrorMessage,
) {
  if (globalThis.opener && !globalThis.opener.closed) {
    globalThis.opener.postMessage(message, "*");
  }
}

async function handleAuthCallbackPage() {
  const params = new URLSearchParams(globalThis.location.search);

  const code = params.get("code");
  const state = params.get("state") ?? undefined;
  const error = params.get("error");
  const errorDescription = params.get("error_description") ?? undefined;

  if (error) {
    await postResultToOpener({
      source: "vot-auth",
      type: "error",
      error,
      error_description: errorDescription,
      state,
    });
    globalThis.close();
    return;
  }

  if (!code) {
    await postResultToOpener({
      source: "vot-auth",
      type: "error",
      error: "missing_code",
      state,
    });
    globalThis.close();
    return;
  }

  await postResultToOpener({
    source: "vot-auth",
    type: "code",
    code,
    state,
  });

  globalThis.close();
}

async function handleProfilePage() {
  const payload = getProfilePayload();
  if (!payload) {
    throw new Error("[VOT] Invalid user data");
  }

  const data = await votStorage.get<Account>("account");
  if (!data) {
    throw new Error("[VOT] No account data found");
  }

  await votStorage.set<Account>("account", {
    ...data,
    username: payload.username,
    avatarId: payload.avatar_id,
  });
}

export async function initAuth() {
  if (
    globalThis.location.origin === authCallbackOrigin &&
    globalThis.location.pathname === authCallbackPath
  ) {
    return handleAuthCallbackPage();
  }

  if (globalThis.location.pathname === "/my/profile") {
    return handleProfilePage();
  }
}
