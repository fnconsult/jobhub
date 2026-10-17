/**
 * How a Provider Secret is kept encrypted at rest (ADR-0020): AES-256-GCM in the
 * app (never pgcrypto: the value would travel in the SQL text), under a master
 * key from SECRETS_MASTER_KEYS, the keyring, which never enters the database.
 *
 *   const cipher = secretCipherFromEnv(process.env); // null: no keyring, Provider Secrets come from env only
 *   const sealed = cipher.seal(value, { provider, name, row });
 *   cipher.open(sealed, { provider, name, row }); // the value, or a SecretDecryptionError
 *
 * Each seal takes a random 12-byte IV and gives a 16-byte tag. The additional
 * authenticated data binds the value to its row: provider|name|row|key version,
 * so a value copied onto another row, or a row whose key version was changed,
 * does not open. A `SecretCipher` backed by a KMS could replace this one later
 * without a schema change.
 */
import { createCipheriv, createDecipheriv, createSecretKey, randomBytes, type KeyObject } from "node:crypto";

type Env = Record<string, string | undefined>;

/** Where a sealed value belongs: it opens only there. */
export interface SecretPlace {
  provider: string;
  /** The env variable it stands for, e.g. MISTRAL_API_KEY. */
  name: string;
  /** Its row's id. */
  row: string;
}

/** A value as stored: never readable without the master key of `keyVersion`. */
export interface SealedSecret {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
  keyVersion: number;
}

export interface SecretCipher {
  /** The master key versions it holds, oldest first. */
  readonly versions: readonly number[];
  /** The version new seals use: the newest. */
  readonly activeVersion: number;
  seal(value: string, place: SecretPlace): SealedSecret;
  /** Throws SecretDecryptionError on a tampered row, the wrong place, or a master key no longer held. */
  open(sealed: SealedSecret, place: SecretPlace): string;
}

/** A sealed value would not open. Says nothing of the value. */
export class SecretDecryptionError extends Error {
  override name = "SecretDecryptionError";
}

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

const aad = (place: SecretPlace, keyVersion: number) => Buffer.from([place.provider, place.name, place.row, keyVersion].join("|"), "utf8");

/** A cipher over `keyring`: master key version → 32-byte key. */
export function createAesGcmCipher(keyring: ReadonlyMap<number, KeyObject>): SecretCipher {
  const versions = [...keyring.keys()].sort((a, b) => a - b);
  const activeVersion = versions.at(-1);
  if (activeVersion === undefined) throw new Error("A Provider Secrets keyring needs at least one master key");

  return {
    versions,
    activeVersion,
    seal(value, place) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv(ALGORITHM, keyring.get(activeVersion)!, iv, { authTagLength: TAG_BYTES });
      cipher.setAAD(aad(place, activeVersion));
      const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
      return { ciphertext, iv, tag: cipher.getAuthTag(), keyVersion: activeVersion };
    },
    open(sealed, place) {
      const key = keyring.get(sealed.keyVersion);
      if (!key) throw new SecretDecryptionError(`No master key of version ${sealed.keyVersion} in SECRETS_MASTER_KEYS`);
      try {
        const decipher = createDecipheriv(ALGORITHM, key, sealed.iv, { authTagLength: TAG_BYTES });
        decipher.setAAD(aad(place, sealed.keyVersion));
        decipher.setAuthTag(sealed.tag);
        // Nothing is used before final() has checked the tag.
        return Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]).toString("utf8");
      } catch {
        throw new SecretDecryptionError(`The ${place.name} row does not open: tampered, moved, or sealed under another master key`);
      }
    },
  };
}

/**
 * The cipher over SECRETS_MASTER_KEYS: `<version>:<base64 of 32 random bytes>`, comma
 * separated (e.g. `1:…,2:…`); the highest version seals. Null when it is empty.
 * Throws on a malformed keyring, never quoting a key.
 */
export function secretCipherFromEnv(env: Env): SecretCipher | null {
  const listed = env.SECRETS_MASTER_KEYS?.trim();
  if (!listed) return null;
  const keyring = new Map<number, KeyObject>();
  listed.split(",").forEach((entry, index) => {
    const position = `SECRETS_MASTER_KEYS entry ${index + 1}`;
    const separator = entry.indexOf(":");
    if (separator < 0) throw new Error(`${position} has no version: write <version>:<base64 key>`);
    const version = entry.slice(0, separator).trim();
    if (!/^[1-9]\d*$/.test(version)) throw new Error(`${position}: the version must be a positive whole number`);
    if (keyring.has(Number(version))) throw new Error(`${position}: version ${version} is listed twice`);
    const key = Buffer.from(entry.slice(separator + 1).trim(), "base64");
    if (key.length !== KEY_BYTES) throw new Error(`${position}: the key must be ${KEY_BYTES} bytes, base64 encoded (openssl rand -base64 32)`);
    keyring.set(Number(version), createSecretKey(key));
  });
  return createAesGcmCipher(keyring);
}
