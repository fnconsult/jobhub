import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot } from "../env/root-env";
import { VERSIONED_MANIFESTS, versionMismatches } from "./versions";

const read = (file: string) => JSON.parse(readFileSync(path.join(repoRoot, file), "utf8")) as { version?: unknown };

describe("versionMismatches — one Version for the web app and the worker (#559, ADR-0063)", () => {
  it("finds nothing when apps/web and apps/worker carry the root package.json's Version", () => {
    expect(versionMismatches({ "package.json": "0.1.0", "apps/web/package.json": "0.1.0", "apps/worker/package.json": "0.1.0" })).toEqual([]);
  });

  it("names each package.json that differs from the root's", () => {
    expect(versionMismatches({ "package.json": "0.2.0", "apps/web/package.json": "0.1.0", "apps/worker/package.json": "0.2.0" })).toEqual([
      "apps/web/package.json is at 0.1.0, not the root package.json's 0.2.0",
    ]);
  });

  it("refuses a root Version that is not X.Y.Z, such as one with a -beta suffix", () => {
    expect(versionMismatches({ "package.json": "0.2.0-beta", "apps/web/package.json": "0.2.0-beta", "apps/worker/package.json": "0.2.0-beta" })).toEqual([
      "the root package.json's Version is 0.2.0-beta, not X.Y.Z",
    ]);
    expect(versionMismatches({ "package.json": undefined, "apps/web/package.json": "0.1.0", "apps/worker/package.json": "0.1.0" })).toHaveLength(3);
  });

  it("the repo's own package.json files agree", () => {
    const versions = Object.fromEntries(VERSIONED_MANIFESTS.map((file) => [file, read(file).version])) as Parameters<typeof versionMismatches>[0];
    expect(versionMismatches(versions)).toEqual([]);
  });
});
