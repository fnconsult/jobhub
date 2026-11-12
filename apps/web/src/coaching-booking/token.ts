import { createHmac, timingSafeEqual } from "node:crypto";
export interface BookingToken {
  sessionId: string;
  nonce: string;
  expires: number;
}
export function signBookingToken(value: BookingToken, secret: string) {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(`coaching-booking:${payload}`).digest("base64url")}`;
}
/** Expiry is enforced when claiming a first booking; an established UID may be rescheduled after token expiry. */
export function readBookingToken(token: unknown, secret: string): BookingToken | null {
  if (typeof token !== "string" || token.length > 1000) return null;
  const [payload, signature, ...rest] = token.split(".");
  if (!payload || !signature || rest.length) return null;
  const expected = createHmac("sha256", secret).update(`coaching-booking:${payload}`).digest(),
    provided = Buffer.from(signature, "base64url");
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null;
  try {
    const v = JSON.parse(Buffer.from(payload, "base64url").toString());
    return typeof v.sessionId === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v.sessionId) &&
      typeof v.nonce === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v.nonce) &&
      Number.isSafeInteger(v.expires)
      ? v
      : null;
  } catch {
    return null;
  }
}
export function validCalSignature(body: string, signature: string | null, secret: string) {
  if (!signature || !secret || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(body).digest(),
    provided = Buffer.from(signature, "hex");
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}
