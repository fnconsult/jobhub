import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot } from "../env/root-env";
import { nouveautesDeployment } from "./deployment";

describe("nouveautesDeployment — the Version this deployment serves, and whether it is the Beta", () => {
  it("on the Beta (staging), sets the Version it serves apart, not yet published", () => {
    expect(nouveautesDeployment({ NODE_ENV: "production", JOBHUB_TARGET: "staging" }, "0.2.0")).toEqual({ version: "0.2.0", beta: true });
  });

  it("in production, publishes it", () => {
    expect(nouveautesDeployment({ NODE_ENV: "production", JOBHUB_TARGET: "production" }, "0.2.0")).toEqual({ version: "0.2.0", beta: false });
  });

  it("a production build that names no target is taken for production, never for the Beta", () => {
    expect(nouveautesDeployment({ NODE_ENV: "production" }, "0.2.0").beta).toBe(false);
  });

  it("the e2e suite and a developer's machine run what main carries: the Beta's next Version", () => {
    expect(nouveautesDeployment({ NODE_ENV: "production", JOBHUB_TARGET: "e2e" }, "0.2.0").beta).toBe(true);
    expect(nouveautesDeployment({ NODE_ENV: "development" }, "0.2.0").beta).toBe(true);
  });

  it("knows no Version when the build carries none", () => {
    expect(nouveautesDeployment({ JOBHUB_TARGET: "staging" }, null).version).toBeNull();
    expect(nouveautesDeployment({ JOBHUB_TARGET: "staging" }, " ").version).toBeNull();
  });

  // Regression (#470): the Version used to come from JOBHUB_VERSION, which next.config.ts's `env` only inlines where
  // code reads `process.env.JOBHUB_VERSION` by name. The page passed `process.env` as a whole, nothing set the variable
  // at run time, so every deployed build served no Version and staging showed the Beta's Release Note as published.
  it("serves the root package.json's Version on its own, with no environment variable naming it", () => {
    const deployment = nouveautesDeployment({ NODE_ENV: "production", JOBHUB_TARGET: "staging" });
    const rootManifest = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as { version: string };
    expect(deployment.version).toBe(rootManifest.version);
    expect(deployment.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
