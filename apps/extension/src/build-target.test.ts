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

  it("gives each build its own icons", () => {
    expect(manifestIcons(buildTarget("beta"))).toEqual({ "16": "icon-beta/16.png", "32": "icon-beta/32.png", "48": "icon-beta/48.png", "128": "icon-beta/128.png" });
    expect(manifestIcons(buildTarget("production"))["128"]).toBe("icon/128.png");
  });

  it("accepts as an Extension Version only X.Y.Z in digits", () => {
    for (const version of ["0.1.0", "1.12.3"]) expect(isExtensionVersion(version)).toBe(true);
    for (const version of ["0.1.0-beta.1", "0.1", "v0.1.0", "1.0.0.0", undefined, 1]) expect(isExtensionVersion(version)).toBe(false);
  });
});
