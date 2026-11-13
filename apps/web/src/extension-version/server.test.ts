import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { TEST_BUILD_EXTENSION_ORIGIN } from "@jobhub/shared/extension-test-build";
import { extensionOriginsFromEnv } from "@/auth/extension-origins";
import { extensionZipPath, hasExtensionZip, readExtensionZip, recognisesTestBuild } from "./server";

describe("the extension's zips this server serves (#989)", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "extension-zips-"));
  const zip = "jobbbox-extension-1.4.2-chrome-beta.zip";
  writeFileSync(path.join(dir, zip), "zip bytes");
  const env = { EXTENSION_ZIP_DIR: dir };
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("reads a zip from EXTENSION_ZIP_DIR, the folder apps/web/Dockerfile builds them into", async () => {
    expect(extensionZipPath(zip, env)).toBe(path.join(dir, zip));
    expect(await hasExtensionZip(zip, env)).toBe(true);
    expect((await readExtensionZip(zip, env))?.toString()).toBe("zip bytes");
  });

  it("has none outside an image, where EXTENSION_ZIP_DIR is unset", async () => {
    expect(extensionZipPath(zip, {})).toBeNull();
    expect(await hasExtensionZip(zip, {})).toBe(false);
    expect(await readExtensionZip(zip, {})).toBeNull();
  });

  it("has none when the folder lacks this Extension Version's zip", async () => {
    expect(await hasExtensionZip("jobbbox-extension-9.9.9-chrome.zip", env)).toBe(false);
    expect(await readExtensionZip("jobbbox-extension-9.9.9-chrome.zip", env)).toBeNull();
  });

  it("never leaves the folder", () => {
    expect(extensionZipPath("../../etc/passwd", env)).toBe(path.join(dir, "passwd"));
  });
});

// The test zip's id is fixed (@jobhub/shared/extension-test-build): Outils says whether EXTENSION_ORIGINS lists it, without
// which the extension loaded reads the session and every Capture is refused (the 2026-11-13 regression).
describe("whether this server recognises the test zip", () => {
  it("does when EXTENSION_ORIGINS lists its fixed origin, beside the store listing's", () => {
    const origins = extensionOriginsFromEnv({ EXTENSION_ORIGINS: ` chrome-extension://storelistingid , ${TEST_BUILD_EXTENSION_ORIGIN}` });
    expect(origins).toEqual(["chrome-extension://storelistingid", TEST_BUILD_EXTENSION_ORIGIN]);
    expect(recognisesTestBuild(origins)).toBe(true);
  });

  it("does not when EXTENSION_ORIGINS lists only other ids, or nothing", () => {
    expect(recognisesTestBuild(extensionOriginsFromEnv({ EXTENSION_ORIGINS: "chrome-extension://storelistingid" }))).toBe(false);
    expect(recognisesTestBuild(extensionOriginsFromEnv({}))).toBe(false);
  });
});
