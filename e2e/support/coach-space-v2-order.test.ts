import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

// « Espace coach v2 » (ADR-0107) is global to the suite's database: the coach-v2-setup project turns it on, and every web
// spec must run with it off. A project with no dependencies starts first, so a setup that depended on nothing turned the
// setting on as `npm run test:e2e` began, and a local run of the whole suite (or of --project=web --project=coach-v2)
// ran the web specs with it on: the Agenda's Coaching Session answered 404 (agenda-account-screenshots.spec.ts) and
// « Mes données » offered no Human Coach to give access to (account-data.spec.ts), green when run alone.

const root = path.resolve(import.meta.dirname, "../..");
const run = promisify(execFile);

type Project = { name: string; dependencies?: string[] };

/** playwright.config.ts's projects, loaded in a process of their own: the config sets the suite's environment as it loads. */
async function projects(env: NodeJS.ProcessEnv): Promise<Map<string, Project>> {
  const script = `import("./playwright.config.ts").then(({ default: c }) => console.log(JSON.stringify((c.default ?? c).projects.map(({ name, dependencies }) => ({ name, dependencies })))))`;
  const { stdout } = await run(path.join(root, "node_modules/.bin/tsx"), ["-e", script], { cwd: root, env });
  return new Map((JSON.parse(stdout) as Project[]).map((project) => [project.name, project]));
}

/** Every project `name` waits for, directly or through another. */
function upstream(all: Map<string, Project>, name: string, seen = new Set<string>()): Set<string> {
  for (const dependency of all.get(name)?.dependencies ?? []) {
    if (!seen.has(dependency)) {
      seen.add(dependency);
      upstream(all, dependency, seen);
    }
  }
  return seen;
}

const withoutCi = () => {
  const env = { ...process.env, E2E_NO_WEB_SERVER: "1" };
  delete env.CI;
  return env;
};

describe("« Espace coach v2 » in the e2e suite (ADR-0107)", () => {
  it("goes on, outside CI, only once every web spec has run: its setup waits for the web project", { timeout: 60_000 }, async () => {
    const all = await projects(withoutCi());
    expect([...upstream(all, "coach-v2-setup")]).toContain("web");
    expect([...upstream(all, "coach-v2")]).toEqual(expect.arrayContaining(["web", "coach-v2-setup"]));
  });

  it("goes on in CI with no web spec brought along: the coach-v2 shard runs alone on its database", { timeout: 60_000 }, async () => {
    const all = await projects({ ...process.env, E2E_NO_WEB_SERVER: "1", CI: "1" });
    expect([...upstream(all, "coach-v2-setup")]).not.toContain("web");
    expect([...upstream(all, "coach-v2")]).not.toContain("web");
  });
});
