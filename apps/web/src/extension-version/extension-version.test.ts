import { readFileSync } from "node:fs";
import path from "node:path";
import { API_VERSION } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import { repoRoot } from "../env/root-env";
import { builtExtensionVersion, EXTENSION_RELEASES_URL, extensionTestBuild } from "./index";

describe("extensionTestBuild — the latest extension an Administrator loads unpacked from Outils (#920)", () => {
  it("on the Beta: the beta zip of the Extension Version, tied to the Beta", () => {
    expect(extensionTestBuild({ beta: true }, "1.4.2")).toEqual({
      extensionVersion: "1.4.2",
      apiVersion: API_VERSION,
      zip: "jobbbox-extension-1.4.2-chrome-beta.zip",
      releasesUrl: EXTENSION_RELEASES_URL,
    });
  });

  it("in Production: the public zip, tied to Production", () => {
    expect(extensionTestBuild({ beta: false }, "1.4.2").zip).toBe("jobbbox-extension-1.4.2-chrome.zip");
  });

  it("states the API Version the server serves, the one proxy.ts asks an outdated extension to update to", () => {
    expect(extensionTestBuild({ beta: true }, "1.4.2", 3).apiVersion).toBe(3);
  });

  it("links to the repo's Releases filtered on extension-v, where extension.yml attaches both zips", () => {
    expect(EXTENSION_RELEASES_URL).toBe("https://github.com/fnconsult/jobhub/releases?q=extension-v&expanded=true");
  });

  it("reads the Extension Version from apps/extension/package.json, with no environment variable naming it", () => {
    const manifest = JSON.parse(readFileSync(path.join(repoRoot, "apps/extension/package.json"), "utf8")) as { version: string };
    expect(builtExtensionVersion).toBe(manifest.version);
    expect(extensionTestBuild({ beta: true }).extensionVersion).toBe(manifest.version);
  });
});
