import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AppleKeyError, appleClientSecret, appleRegenerationDue, APPLE_REGENERATION_DAYS } from "./apple";

const keys = generateKeyPairSync("ec", { namedCurve: "P-256" });
/** A .p8 file as Apple's developer console gives it. */
const p8 = keys.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
const now = new Date("2026-10-17T08:00:00Z");
const apple = { teamId: "ABCDE12345", keyId: "KEY1234567", privateKey: p8, clientId: "fr.jobbbox.signin" };

const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));

describe("Apple's client secret", () => {
  it("is an ES256 JWT signed with the .p8 key, from the Team ID, Key ID and Service ID", () => {
    const { clientSecret } = appleClientSecret(apple, now);

    const [header, payload, signature] = clientSecret.split(".");
    expect(decode(header!)).toEqual({ alg: "ES256", kid: "KEY1234567", typ: "JWT" });
    expect(decode(payload!)).toEqual({
      iss: "ABCDE12345",
      sub: "fr.jobbbox.signin",
      aud: "https://appleid.apple.com",
      iat: now.getTime() / 1000,
      exp: now.getTime() / 1000 + 60 * 24 * 3600,
    });
    const signed = verify("sha256", Buffer.from(`${header}.${payload}`), { key: keys.publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature!, "base64url"));
    expect(signed).toBe(true);
  });

  it("expires well within Apple's 6-month limit, and is due again after a month", () => {
    const { expiresAt } = appleClientSecret(apple, now);

    expect(expiresAt).toEqual(new Date("2026-12-16T08:00:00Z"));
    expect(APPLE_REGENERATION_DAYS).toBe(30);
    expect(appleRegenerationDue(new Date("2026-11-15T08:00:00Z"), now)).toBe(false);
    expect(appleRegenerationDue(new Date("2026-09-17T07:00:00Z"), now)).toBe(true);
    expect(appleRegenerationDue(null, now)).toBe(true);
  });

  it("accepts a key pasted with blank lines or carriage returns around it", () => {
    expect(() => appleClientSecret({ ...apple, privateKey: `\r\n${p8.replaceAll("\n", "\r\n")}\n\n` }, now)).not.toThrow();
  });

  it("refuses a key that is not an EC P-256 private key, without quoting it", () => {
    const pasted = "-----BEGIN PRIVATE KEY-----\nnot-a-key-at-all\n-----END PRIVATE KEY-----";

    expect(() => appleClientSecret({ ...apple, privateKey: pasted }, now)).toThrow(AppleKeyError);
    try {
      appleClientSecret({ ...apple, privateKey: pasted }, now);
    } catch (error) {
      expect(String(error)).not.toContain("not-a-key-at-all");
    }
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    expect(() => appleClientSecret({ ...apple, privateKey: rsa }, now)).toThrow(AppleKeyError);
  });

  it("refuses a Team ID or Key ID that is not 10 letters and digits", () => {
    expect(() => appleClientSecret({ ...apple, teamId: "team" }, now)).toThrow(AppleKeyError);
    expect(() => appleClientSecret({ ...apple, keyId: "" }, now)).toThrow(AppleKeyError);
  });
});
