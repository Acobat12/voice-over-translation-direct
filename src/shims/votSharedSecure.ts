import config from "@vot.js/shared/config";
import Logger from "@vot.js/shared/utils/logger";

const { componentVersion } = config;
const utf8Encoder = new TextEncoder();

function getBrowserCrypto(): Crypto {
  const cryptoApi =
    globalThis.crypto ??
    (typeof window !== "undefined" ? window.crypto : undefined);

  if (!cryptoApi?.subtle) {
    throw new Error("Web Crypto API is not available in this browser context");
  }

  return cryptoApi;
}

async function signHMAC(
  hashName: "SHA-1" | "SHA-256",
  hmac: string,
  data: BufferSource,
): Promise<ArrayBuffer> {
  const cryptoApi = getBrowserCrypto();
  const key = await cryptoApi.subtle.importKey(
    "raw",
    utf8Encoder.encode(hmac),
    { name: "HMAC", hash: { name: hashName } },
    false,
    ["sign", "verify"],
  );

  return cryptoApi.subtle.sign("HMAC", key, data);
}

export async function getSignature(body: BufferSource): Promise<string> {
  const signature = await signHMAC("SHA-256", config.hmac, body);
  return new Uint8Array(signature).reduce(
    (result, byte) => result + byte.toString(16).padStart(2, "0"),
    "",
  );
}

export async function getSecYaHeaders(
  secType: string,
  session: { secretKey: string; uuid: string },
  body: BufferSource,
  path: string,
): Promise<Record<string, string>> {
  const { secretKey, uuid } = session;
  const token = `${uuid}:${path}:${componentVersion}`;
  const tokenBody = utf8Encoder.encode(token);
  const tokenSign = await getSignature(tokenBody);

  if (secType === "Ya-Summary") {
    return {
      [`X-${secType}-Sk`]: secretKey,
      [`X-${secType}-Token`]: `${tokenSign}:${token}`,
    };
  }

  const sign = await getSignature(body);
  return {
    [`${secType}-Signature`]: sign,
    [`Sec-${secType}-Sk`]: secretKey,
    [`Sec-${secType}-Token`]: `${tokenSign}:${token}`,
  };
}

export function getUUID(): string {
  const hexDigits = "0123456789ABCDEF";
  let uuid = "";

  for (let index = 0; index < 32; index += 1) {
    uuid += hexDigits[Math.floor(Math.random() * 16)];
  }

  return uuid;
}

export async function getHmacSha1(
  hmacKey: string,
  salt: string,
): Promise<string | false> {
  try {
    const hmacSalt = utf8Encoder.encode(salt);
    const signature = await signHMAC("SHA-1", hmacKey, hmacSalt);
    return btoa(String.fromCharCode(...new Uint8Array(signature)));
  } catch (error) {
    Logger.error(error);
    return false;
  }
}

export const browserSecHeaders = {
  "sec-ch-ua": `"Chromium";v="134", "YaBrowser";v="${componentVersion.slice(0, 5)}", "Not?A_Brand";v="24", "Yowser";v="2.5"`,
  "sec-ch-ua-full-version-list": `"Chromium";v="134.0.6998.543", "YaBrowser";v="${componentVersion}", "Not?A_Brand";v="24.0.0.0", "Yowser";v="2.5"`,
  "Sec-Fetch-Mode": "no-cors",
};
