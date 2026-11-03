/**
 * An authenticator app's codes (TOTP, RFC 6238 over RFC 4226): SHA-1, 6 digits, a new code every 30 seconds, the
 * defaults every authenticator app reads from a QR code. The secret travels in base32 (RFC 4648), as the app asks it.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const DIGITS = 6;
const PERIOD_SECONDS = 30;
/** The periods before and after the current one whose code is still accepted: a phone's clock may drift. */
const WINDOW = 1;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** A new secret: 20 random bytes (160 bits, RFC 4226's recommendation), in base32. */
export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** Reads base32, whatever its case, spaces and padding. */
export function base32Decode(text: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of text.toUpperCase().replace(/[\s=]/g, "")) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error("Not base32");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** The period `at` falls in. */
export const totpStep = (at: Date): number => Math.floor(at.getTime() / 1000 / PERIOD_SECONDS);

function codeOfStep(key: Buffer, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hash = createHmac("sha1", key).update(counter).digest();
  const offset = hash[hash.length - 1]! & 0xf;
  const binary = hash.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

/** The code an authenticator app shows at `at`. */
export function totpAt(secret: string, at: Date): string {
  return codeOfStep(base32Decode(secret), totpStep(at));
}

/**
 * The period whose code `code` is, among the current one and those just before and after; null when it is none of
 * them, or not six digits. Spaces typed in the code are ignored.
 */
export function verifyTotp(secret: string, code: string, at: Date): number | null {
  const typed = code.replace(/\s/g, "");
  if (!new RegExp(`^\\d{${DIGITS}}$`).test(typed)) return null;
  const key = base32Decode(secret);
  const now = totpStep(at);
  for (let step = now - WINDOW; step <= now + WINDOW; step++) {
    if (timingSafeEqual(Buffer.from(codeOfStep(key, step)), Buffer.from(typed))) return step;
  }
  return null;
}

/** The `otpauth://` address an authenticator app reads from the QR code: it holds the secret, so it is one. */
export function totpUri(secret: string, { issuer, account }: { issuer: string; account: string }): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: String(DIGITS), period: String(PERIOD_SECONDS) });
  return `otpauth://totp/${label}?${params}`;
}
