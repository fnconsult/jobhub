import { readFileSync } from "node:fs";
import path from "node:path";
import { API_VERSION } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import { repoRoot } from "../env/root-env";
import { builtExtensionVersion, EXTENSION_TEST_BUILD_URL, extensionTestBuild } from "./index";

describe("extensionTestBuild — the latest extension an Administrator loads unpacked from Outils (#920)", () => {
  it("on the Beta: the beta zip of the Extension Version, tied to the Beta", () => {
    expect(extensionTestBuild({ beta: true }, "1.4.2")).toEqual({
      extensionVersion: "1.4.2",
      apiVersion: API_VERSION,
      zip: "jobbbox-extension-1.4.2-chrome-beta.zip",
      downloadUrl: "/api/account/extension-test-build",
    });
  });

  it("in Production: the public zip, tied to Production", () => {
    expect(extensionTestBuild({ beta: false }, "1.4.2").zip).toBe("jobbbox-extension-1.4.2-chrome.zip");
  });

  it("states the API Version the server serves, the one proxy.ts asks an outdated extension to update to", () => {
    expect(extensionTestBuild({ beta: true }, "1.4.2", 3).apiVersion).toBe(3);
  });

  it("is downloaded from the web app itself, not from the private repo's GitHub Releases (#989)", () => {
    expect(EXTENSION_TEST_BUILD_URL).toBe("/api/account/extension-test-build");
    expect(EXTENSION_TEST_BUILD_URL).not.toContain("github.com");
  });

  it("reads the Extension Version from apps/extension/package.json, with no environment variable naming it", () => {
    const manifest = JSON.parse(readFileSync(path.join(repoRoot, "apps/extension/package.json"), "utf8")) as { version: string };
    expect(builtExtensionVersion).toBe(manifest.version);
    expect(extensionTestBuild({ beta: true }).extensionVersion).toBe(manifest.version);
  });
});

describe("apps/web/Dockerfile — the image carries both zips of its commit's Extension Version (#989)", () => {
  const dockerfile = readFileSync(path.join(repoRoot, "apps/web/Dockerfile"), "utf8");
  const web = dockerfile.slice(dockerfile.indexOf("AS web"));

  it("builds the public zip and the beta zip, as extension.yml does", () => {
    expect(dockerfile).toContain("npm run zip --workspace @jobhub/extension && npm run zip:beta --workspace @jobhub/extension");
    expect(dockerfile).toContain('"apps/extension/.output/jobbbox-extension-$version-chrome.zip"');
    expect(dockerfile).toContain('"apps/extension/.output/jobbbox-extension-$version-chrome-beta.zip"');
  });

  it("copies them into the web image and names their folder with EXTENSION_ZIP_DIR", () => {
    expect(web).toContain("COPY --from=extension --chown=node:node /extension ./extension");
    expect(web).toContain("ENV EXTENSION_ZIP_DIR=/app/extension");
  });
});
