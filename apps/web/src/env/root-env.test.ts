import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadRootEnv, repoRoot } from "./root-env";

describe("loadRootEnv", () => {
  const dirs: string[] = [];
  const touched: string[] = [];

  function rootWith(contents?: string): string {
    const dir = mkdtempSync(path.join(tmpdir(), "jobhub-root-env-"));
    dirs.push(dir);
    if (contents !== undefined) writeFileSync(path.join(dir, ".env"), contents);
    return dir;
  }

  afterEach(() => {
    for (const name of touched.splice(0)) delete process.env[name];
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("gives the web app a variable defined only in the root .env", () => {
    touched.push("JOBHUB_ROOT_ONLY");
    loadRootEnv(rootWith("JOBHUB_ROOT_ONLY=from-root\n"));
    expect(process.env.JOBHUB_ROOT_ONLY).toBe("from-root");
  });

  it("keeps values already in process.env", () => {
    touched.push("JOBHUB_ALREADY_SET");
    process.env.JOBHUB_ALREADY_SET = "from-shell";
    loadRootEnv(rootWith("JOBHUB_ALREADY_SET=from-root\n"));
    expect(process.env.JOBHUB_ALREADY_SET).toBe("from-shell");
  });

  it("does nothing when there is no root .env (CI, containers)", () => {
    expect(() => loadRootEnv(rootWith())).not.toThrow();
  });

  // #544: the e2e suite's server is configured whole by playwright.config.ts, as CI's is. A developer's .env, copied
  // from .env.example, set BEDROCK_REGION and MAIL_FROM there, and the specs expecting the code's defaults failed.
  it("leaves the root .env out of a server whose environment says JOBHUB_ROOT_ENV=ignore (the e2e suite's)", () => {
    touched.push("JOBHUB_ROOT_ONLY", "JOBHUB_ROOT_ENV");
    process.env.JOBHUB_ROOT_ENV = "ignore";
    loadRootEnv(rootWith("JOBHUB_ROOT_ONLY=from-root\n"));
    expect(process.env.JOBHUB_ROOT_ONLY).toBeUndefined();
  });

  it("is what playwright.config.ts asks for the e2e suite's server", () => {
    expect(readFileSync(path.join(repoRoot, "playwright.config.ts"), "utf8")).toMatch(/\n\s+JOBHUB_ROOT_ENV: "ignore",\n/);
  });
});

describe("repoRoot", () => {
  it("is the monorepo root, where the README tells developers to create .env", () => {
    expect(existsSync(path.join(repoRoot, ".env.example"))).toBe(true);
    expect(existsSync(path.join(repoRoot, "apps", "web", "next.config.ts"))).toBe(true);
  });
});
