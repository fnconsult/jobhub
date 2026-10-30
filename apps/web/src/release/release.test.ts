import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot } from "../env/root-env";
import { currentRelease, releaseLabel } from "./index";

const SHA = "3f9c2a1b7e4d5c6f8a9b0c1d2e3f4a5b6c7d8e9f";

describe("currentRelease — the Version, commit and environment this deployment serves (#559, ADR-0063)", () => {
  it("on the Beta: the build's Version, the commit deploy.yml injected, staging", () => {
    expect(currentRelease({ NODE_ENV: "production", JOBHUB_TARGET: "staging", JOBHUB_COMMIT: SHA }, "0.2.0")).toEqual({
      version: "0.2.0",
      commit: SHA,
      environment: "staging",
      beta: true,
    });
  });

  it("in Production: not the Beta", () => {
    expect(currentRelease({ NODE_ENV: "production", JOBHUB_TARGET: "production", JOBHUB_COMMIT: SHA }, "0.2.0")).toMatchObject({ environment: "production", beta: false });
  });

  it("a production build that names no target is taken for Production, never for the Beta", () => {
    expect(currentRelease({ NODE_ENV: "production" }, "0.2.0")).toMatchObject({ environment: "production", beta: false });
  });

  it("the e2e suite and a developer's machine run what main carries: the Beta", () => {
    expect(currentRelease({ NODE_ENV: "production", JOBHUB_TARGET: "e2e" }, "0.2.0")).toMatchObject({ environment: "e2e", beta: true });
    expect(currentRelease({ NODE_ENV: "development" }, "0.2.0")).toMatchObject({ environment: "development", beta: true });
  });

  it("falls back on the revision deploy/compose.yml sets when the image carries no commit; none on a developer's machine", () => {
    expect(currentRelease({ JOBHUB_TARGET: "staging", JOBHUB_REVISION: SHA }, "0.2.0").commit).toBe(SHA);
    expect(currentRelease({ JOBHUB_TARGET: "staging", JOBHUB_COMMIT: " " }, "0.2.0").commit).toBeNull();
  });

  it("serves the root package.json's Version on its own, with no environment variable naming it", () => {
    const rootManifest = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as { version: string };
    expect(currentRelease({ JOBHUB_TARGET: "staging" }).version).toBe(rootManifest.version);
  });
});

describe("releaseLabel — how the Back Office and Mon compte show the Version", () => {
  it("on the Beta: « X.Y.Z (main·sha) », the commit shortened as git does", () => {
    expect(releaseLabel(currentRelease({ JOBHUB_TARGET: "staging", JOBHUB_COMMIT: SHA }, "0.2.0"))).toBe("0.2.0 (main·3f9c2a1)");
  });

  it("in Production: « X.Y.Z » alone", () => {
    expect(releaseLabel(currentRelease({ JOBHUB_TARGET: "production", JOBHUB_COMMIT: SHA }, "0.2.0"))).toBe("0.2.0");
  });

  it("on the Beta with no commit known (the e2e suite, a developer's machine): « dev » in its place", () => {
    expect(releaseLabel(currentRelease({ JOBHUB_TARGET: "e2e" }, "0.2.0"))).toBe("0.2.0 (main·dev)");
  });
});
