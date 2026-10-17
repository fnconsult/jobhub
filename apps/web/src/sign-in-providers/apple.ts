/**
 * Apple's client secret: not a value Apple gives, but a JWT the app signs (ES256) with
 * the .p8 private key downloaded from Apple's developer console, naming the Team ID
 * (`iss`), the Key ID (`kid`) and the Service ID (`sub`). Apple accepts one for 6
 * months at most; the worker signs a new one every APPLE_REGENERATION_DAYS.
 */
import { createPrivateKey, sign, type KeyObject } from "node:crypto";

/** How often the worker signs a new client secret. */
export const APPLE_REGENERATION_DAYS = 30;
/** How long one is valid: two regenerations, far within Apple's 6 months. */
const LIFETIME_DAYS = 60;
const DAY_MS = 24 * 3600 * 1000;
const AUDIENCE = "https://appleid.apple.com";

/** The .p8 key or an id does not make a client secret. Says nothing of the key. */
export class AppleKeyError extends Error {
  override name = "AppleKeyError";
}

export interface AppleSigningKey {
  /** 10 characters, from the developer account's membership page. */
  teamId: string;
  /** 10 characters, the .p8 key's id. */
  keyId: string;
  /** The .p8 file's contents (PKCS#8 PEM). */
  privateKey: string;
  /** The Service ID: the provider's client id. */
  clientId: string;
}

const APPLE_ID = /^[A-Z0-9]{10}$/;

function signingKey(pem: string): KeyObject {
  let key: KeyObject;
  try {
    key = createPrivateKey({ key: pem.replaceAll("\r", "").trim(), format: "pem" });
  } catch {
    throw new AppleKeyError("The Apple key is not a .p8 private key");
  }
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    throw new AppleKeyError("The Apple key is not an EC P-256 (.p8) private key");
  }
  return key;
}

const base64url = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");

/** Signs a client secret valid from `now`. Throws AppleKeyError on a bad key or id. */
export function appleClientSecret(apple: AppleSigningKey, now: Date): { clientSecret: string; expiresAt: Date } {
  const teamId = apple.teamId.trim();
  const keyId = apple.keyId.trim();
  if (!APPLE_ID.test(teamId)) throw new AppleKeyError("The Apple Team ID must be 10 capital letters and digits");
  if (!APPLE_ID.test(keyId)) throw new AppleKeyError("The Apple Key ID must be 10 capital letters and digits");
  const key = signingKey(apple.privateKey);
  const issuedAt = Math.floor(now.getTime() / 1000);
  const expiresAt = new Date((issuedAt + LIFETIME_DAYS * 24 * 3600) * 1000);
  const unsigned = `${base64url({ alg: "ES256", kid: keyId, typ: "JWT" })}.${base64url({
    iss: teamId,
    sub: apple.clientId.trim(),
    aud: AUDIENCE,
    iat: issuedAt,
    exp: expiresAt.getTime() / 1000,
  })}`;
  const signature = sign("sha256", Buffer.from(unsigned), { key, dsaEncoding: "ieee-p1363" });
  return { clientSecret: `${unsigned}.${signature.toString("base64url")}`, expiresAt };
}

/** When the client secret signed at `generatedAt` is due to be signed again. */
export const appleNextRegeneration = (generatedAt: Date): Date => new Date(generatedAt.getTime() + APPLE_REGENERATION_DAYS * DAY_MS);

/** Whether the client secret signed at `generatedAt` (null: never) is due at `now`. */
export const appleRegenerationDue = (generatedAt: Date | null, now: Date): boolean => !generatedAt || appleNextRegeneration(generatedAt) <= now;
