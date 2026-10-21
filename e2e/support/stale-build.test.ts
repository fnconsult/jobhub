import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { staleBuild } from "./stale-build.mjs";

const BUILT = new Date("2026-10-21T08:53:00Z");
const BEFORE = new Date("2026-10-21T08:00:00Z");
const AFTER = new Date("2026-10-21T09:40:00Z");

describe("staleBuild: is the web app's build older than its sources?", () => {
  let repo: string;

  const file = (relative: string, at: Date) => {
    const full = path.join(repo, relative);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, "x");
    utimesSync(full, at, at);
  };
  const check = () => staleBuild(repo);

  beforeEach(() => {
    repo = mkdtempSync(path.join(os.tmpdir(), "stale-build-"));
    file("apps/web/.next/BUILD_ID", BUILT);
    file("apps/web/src/app/agenda/page.tsx", BEFORE);
    file("packages/shared/src/index.ts", BEFORE);
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("is fresh when every source is older than the build", () => {
    expect(check()).toEqual({ missing: false, newer: [] });
  });

  it("says there is no build", () => {
    rmSync(path.join(repo, "apps/web/.next"), { recursive: true });
    expect(check()).toEqual({ missing: true, newer: [] });
  });

  it("names a web app source changed since the build, e.g. by a rebase or a merge of main", () => {
    file("apps/web/src/app/agenda/page.tsx", AFTER);
    expect(check()).toEqual({ missing: false, newer: ["apps/web/src/app/agenda/page.tsx"] });
  });

  it("names a workspace package source changed since the build", () => {
    file("packages/shared/src/index.ts", AFTER);
    file("apps/web/messages/fr.json", AFTER);
    expect(check().newer.sort()).toEqual(["apps/web/messages/fr.json", "packages/shared/src/index.ts"]);
  });

  it("ignores what the build does not read: the build itself, dependencies, package outputs and tests", () => {
    file("apps/web/.next/server/app/agenda.html", AFTER);
    file("apps/web/node_modules/x/index.js", AFTER);
    file("packages/ai/node_modules/x/index.js", AFTER);
    file("packages/ai/dist/index.js", AFTER);
    file("apps/web/src/app/agenda/page.test.tsx", AFTER);
    file("packages/shared/src/index.test.ts", AFTER);
    file("apps/web/tsconfig.tsbuildinfo", AFTER);
    file("apps/web/next-env.d.ts", AFTER);
    expect(check()).toEqual({ missing: false, newer: [] });
  });
});
