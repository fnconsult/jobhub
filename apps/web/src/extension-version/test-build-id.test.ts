import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { TEST_BUILD_EXTENSION_ID, TEST_BUILD_EXTENSION_ORIGIN, TEST_BUILD_PUBLIC_KEY } from "@jobhub/shared/extension-test-build";

/** Chrome's id for a manifest `key`: the SHA-256 of the DER public key, its first 32 hex digits written a to p. */
const extensionIdOfKey = (key: string) =>
  [...createHash("sha256").update(Buffer.from(key, "base64")).digest("hex").slice(0, 32)].map((digit) => String.fromCharCode(97 + parseInt(digit, 16))).join("");

describe("the test zip's fixed extension id", () => {
  it("is the id Chrome derives from the public key the test zips carry", () => {
    expect(extensionIdOfKey(TEST_BUILD_PUBLIC_KEY)).toBe(TEST_BUILD_EXTENSION_ID);
    expect(TEST_BUILD_EXTENSION_ORIGIN).toBe(`chrome-extension://${TEST_BUILD_EXTENSION_ID}`);
  });

  it("is a public key alone, never a private one", () => {
    expect(TEST_BUILD_PUBLIC_KEY).toMatch(/^MIIBIjAN[A-Za-z0-9+/]+=*$/);
    expect(TEST_BUILD_PUBLIC_KEY).not.toMatch(/PRIVATE/);
  });
});
