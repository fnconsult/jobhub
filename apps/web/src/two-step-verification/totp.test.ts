import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, totpAt, totpUri, verifyTotp } from "./totp";

// RFC 6238, appendix B: the SHA-1 secret is the ASCII "12345678901234567890". Its 8-digit codes end with the 6 digits used here.
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890", "ascii"));

describe("an authenticator app's code (TOTP, RFC 6238: SHA-1, 6 digits, 30 seconds)", () => {
  it("matches the RFC's test vectors", () => {
    expect(totpAt(RFC_SECRET, new Date(59_000))).toBe("287082");
    expect(totpAt(RFC_SECRET, new Date(1_111_111_109_000))).toBe("081804");
    expect(totpAt(RFC_SECRET, new Date(1_234_567_890_000))).toBe("005924");
    expect(totpAt(RFC_SECRET, new Date(2_000_000_000_000))).toBe("279037");
  });

  it("writes the secret in base32, as an authenticator app asks it, and reads it back", () => {
    expect(RFC_SECRET).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(base32Decode("gezd gnbv gy3t qojq gezd gnbv gy3t qojq").toString("ascii")).toBe("12345678901234567890");
  });

  it("accepts the code of the 30 seconds before or after, and says which period it was", () => {
    const at = new Date(1_234_567_890_000);
    const step = Math.floor(at.getTime() / 30_000);

    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, at), at)).toBe(step);
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, new Date(at.getTime() - 30_000)), at)).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, new Date(at.getTime() + 30_000)), at)).toBe(step + 1);
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, new Date(at.getTime() - 90_000)), at)).toBeNull();
  });

  it("refuses anything but six digits, and reads a code typed with spaces", () => {
    const at = new Date(59_000);

    expect(verifyTotp(RFC_SECRET, "287 082", at)).not.toBeNull();
    expect(verifyTotp(RFC_SECRET, "28708", at)).toBeNull();
    expect(verifyTotp(RFC_SECRET, "abcdef", at)).toBeNull();
  });

  it("gives the otpauth address an authenticator app reads from the QR code", () => {
    const uri = new URL(totpUri(RFC_SECRET, { issuer: "Jobbbox", account: "marie.dupont@example.fr" }));

    expect(uri.protocol).toBe("otpauth:");
    expect(uri.host).toBe("totp");
    expect(decodeURIComponent(uri.pathname)).toBe("/Jobbbox:marie.dupont@example.fr");
    expect(Object.fromEntries(uri.searchParams)).toEqual({ secret: RFC_SECRET, issuer: "Jobbbox", algorithm: "SHA1", digits: "6", period: "30" });
  });
});
