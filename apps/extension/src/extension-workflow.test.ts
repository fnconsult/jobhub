// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const workflow = readFileSync(`${repoRoot}.github/workflows/extension.yml`, "utf8");
const scripts: Record<string, string> = JSON.parse(readFileSync(`${repoRoot}apps/extension/package.json`, "utf8")).scripts;
const releaseJob = workflow.slice(workflow.indexOf("\n  release:"));

// The extension workflow (#563, docs/ops/extension.md): the two zips of one Extension Version and its Release.
describe("extension.yml", () => {
  it("is run by hand, and only checks the zips on a pull request", () => {
    expect(workflow).toMatch(/^on:\n {2}workflow_dispatch:\n {2}pull_request:/m);
    expect(releaseJob).toContain("if: github.event_name == 'workflow_dispatch'");
  });

  it("builds the public and the beta zip with the extension's own scripts", () => {
    expect(scripts.zip).toBe("wxt zip");
    expect(scripts["zip:beta"]).toBe("wxt zip --mode beta");
    expect(workflow).toContain("npm run zip -w @jobhub/extension");
    expect(workflow).toContain("npm run zip:beta -w @jobhub/extension");
    expect(workflow).toContain('check "jobbbox-extension-$VERSION-chrome.zip" https://jobbbox.ai __MSG_extName__');
    expect(workflow).toContain('check "jobbbox-extension-$VERSION-chrome-beta.zip" https://staging.jobbbox.ai __MSG_extNameBeta__');
  });

  it("refuses a version that is not X.Y.Z in digits, and one already released", () => {
    expect(workflow).toContain("^[0-9]+\\.[0-9]+\\.[0-9]+$");
    expect(workflow).toContain('gh release view "extension-v$version"');
  });

  it("attaches both zips to the Release extension-vX.Y.Z, which is never the repo's latest", () => {
    expect(releaseJob).toContain('gh release create "extension-v$VERSION"');
    expect(releaseJob).toContain('"jobbbox-extension-$VERSION-chrome.zip" "jobbbox-extension-$VERSION-chrome-beta.zip"');
    expect(releaseJob).toContain("--latest=false");
    expect(releaseJob).toContain("contents: write");
    // Nothing publishes to the Chrome Web Store: the product owner uploads the zips by hand.
    expect(workflow).not.toMatch(/chromewebstore\.googleapis|chrome-webstore-upload/);
  });
});
