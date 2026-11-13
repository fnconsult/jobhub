import { TEST_BUILD_PUBLIC_KEY } from "@jobhub/shared/extension-test-build";
import { describe, expect, it } from "vitest";
import { buildTarget, isExtensionVersion, manifestIcons } from "./build-target";

describe("the extension's build target (#563)", () => {
  it("ties the public listing's build to Production and the beta's to the Beta, ignoring WXT_WEB_ORIGIN", () => {
    const env = { WXT_WEB_ORIGIN: "https://elsewhere.example" };
    expect(buildTarget("production", env)).toMatchObject({ store: "public", webOrigin: "https://jobbbox.ai", name: "__MSG_extName__" });
    expect(buildTarget("beta", env)).toMatchObject({ store: "beta", webOrigin: "https://staging.jobbbox.ai", name: "__MSG_extNameBeta__" });
  });

  it("points a development or e2e build at WXT_WEB_ORIGIN, the local web app by default", () => {
    expect(buildTarget("e2e", { WXT_WEB_ORIGIN: "http://localhost:3999" })).toMatchObject({ store: null, webOrigin: "http://localhost:3999" });
    expect(buildTarget("development", {})).toMatchObject({ store: null, webOrigin: "http://localhost:3000" });
  });

  // The test zip Outils serves (#989) is loaded unpacked: without a key, Chrome derives its id from the folder, and a new
  // folder's id is one EXTENSION_ORIGINS does not list (the 2026-11-13 regression).
  it("fixes the test zip's id with the shared public key, and leaves it out of the store zips and the local builds", () => {
    const test = { JOBBBOX_EXTENSION_TEST_BUILD: "1" };
    expect(buildTarget("beta", test).key).toBe(TEST_BUILD_PUBLIC_KEY);
    expect(buildTarget("production", test).key).toBe(TEST_BUILD_PUBLIC_KEY);
    expect(buildTarget("beta", {}).key).toBeUndefined();
    expect(buildTarget("production", {}).key).toBeUndefined();
    expect(buildTarget("e2e", test).key).toBeUndefined();
  });

  it("gives each build its own icons", () => {
    expect(manifestIcons(buildTarget("beta"))).toEqual({ "16": "icon-beta/16.png", "32": "icon-beta/32.png", "48": "icon-beta/48.png", "128": "icon-beta/128.png" });
    expect(manifestIcons(buildTarget("production"))["128"]).toBe("icon/128.png");
  });

  it("accepts as an Extension Version only X.Y.Z in digits", () => {
    for (const version of ["0.1.0", "1.12.3"]) expect(isExtensionVersion(version)).toBe(true);
    for (const version of ["0.1.0-beta.1", "0.1", "v0.1.0", "1.0.0.0", undefined, 1]) expect(isExtensionVersion(version)).toBe(false);
  });
});
