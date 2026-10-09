import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import config from "../playwright.config";

const read = (file: string) => readFileSync(file, "utf8");

test.describe("monorepo tooling", () => {
  test("is an npm-workspaces monorepo with web, extension and shared packages", () => {
    const root = JSON.parse(read("package.json"));
    expect(root.workspaces).toEqual(expect.arrayContaining(["apps/*", "packages/*"]));
    const names = ["apps/web", "apps/extension", "packages/shared"].map((dir) => JSON.parse(read(`${dir}/package.json`)).name);
    expect(names).toEqual(["@jobhub/web", "@jobhub/extension", "@jobhub/shared"]);
    for (const app of ["apps/web", "apps/extension"]) {
      expect(JSON.parse(read(`${app}/package.json`)).dependencies).toHaveProperty("@jobhub/shared");
    }
  });

  test("CI runs lint, typecheck, tests and the e2e suite", () => {
    const ci = read(".github/workflows/ci.yml");
    for (const step of ["npm run lint", "npm run typecheck", "npm test", "npm run build", "npm run test:e2e"]) {
      expect(ci).toContain(`run: ${step}`);
    }
    expect(ci).toMatch(/pull_request/);
  });

  test("lint rejects a hard-coded user-facing string in the web app", () => {
    const dir = mkdtempSync(path.join("apps/web/src", "e2e-lint-"));
    try {
      const file = path.join(dir, "Hardcoded.tsx");
      writeFileSync(file, "export function Hardcoded() {\n  return <p>Bonjour tout le monde</p>;\n}\n");
      const result = spawnSync("npx", ["eslint", file], { encoding: "utf8" });
      expect(result.status).not.toBe(0);
      expect(result.stdout).toContain("i18next/no-literal-string");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("lint rejects a hard-coded user-facing string in the extension", () => {
    const dir = mkdtempSync(path.join("apps/extension/entrypoints", "e2e-lint-"));
    try {
      const file = path.join(dir, "Hardcoded.tsx");
      writeFileSync(file, "export function Hardcoded() {\n  return <p>Bonjour</p>;\n}\n");
      const result = spawnSync("npx", ["eslint", file], { encoding: "utf8" });
      expect(result.status).not.toBe(0);
      expect(result.stdout).toContain("i18next/no-literal-string");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Next.js runs one `next dev` per app directory and refuses a second ("Another next dev
  // server is already running"), so the specs that start it must never run at the same time:
  // all in one project, one spec at a time. Two projects run in parallel with each other (#71).
  test("the e2e specs that start `npm run dev` share one serial project", () => {
    const startsNextDev = readdirSync("e2e")
      .filter((file) => file.endsWith(".spec.ts"))
      .filter((file) => /\[\s*(?:"npm",\s*)?"run",\s*"dev"\s*\]/.test(read(path.join("e2e", file))));
    expect(startsNextDev.length).toBeGreaterThan(1);

    const projects = (config.projects ?? []).filter((project) =>
      startsNextDev.some((file) => (project.testMatch as RegExp).test(file)),
    );
    expect(projects.map((project) => project.name)).toHaveLength(1);
    for (const file of startsNextDev) expect(file).toMatch(projects[0].testMatch as RegExp);
    expect(projects[0].workers).toBe(1);
  });

  test("EU hosting target is documented (ADR-0007)", () => {
    const adr = read("docs/adr/0007-eu-hosting-provider-agnostic-ai.md");
    expect(adr).toMatch(/\bEU\b/);
    const hosting = read("docs/ops/hosting.md");
    expect(hosting).toContain("ADR-0007");
    expect(hosting).toMatch(/eu-west-3|eu-central-1|fr-par/);
    expect(hosting).not.toMatch(/\b(us|ap|sa)-(east|west|south|north|central|northeast|southeast)-\d\b/);
    expect(read("README.md")).toMatch(/hosting\.md|ADR-0007/);
  });
});
