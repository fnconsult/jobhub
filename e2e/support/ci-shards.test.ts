import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

// CI splits the e2e suite across the `e2e` job's matrix (.github/workflows/ci.yml): each shard runs `npm run test:e2e`
// with its own arguments. A project added to playwright.config.ts and named in no shard would never run in CI, and the
// suite would stay green without it. Playwright lists what each command would run; together they must list every test
// of the suite, the whole of `npm run test:e2e`.

const root = path.resolve(import.meta.dirname, "../..");
const run = promisify(execFile);

type Suite = { title: string; file: string; specs?: Spec[]; suites?: Suite[] };
type Spec = { title: string; file: string; tests: { projectName: string }[] };

/**
 * Every test `playwright test --list <args>` would run, as « project › file › titles », with how many tests have that
 * name. No line numbers: listings sharing a cold transform cache may map a test to another line.
 */
async function listed(args: string[]): Promise<Map<string, number>> {
  const { stdout } = await run(path.join(root, "node_modules/.bin/playwright"), ["test", "--list", "--reporter=json", ...args], {
    cwd: root,
    maxBuffer: 64 * 1024 * 1024,
  });
  const ids = new Map<string, number>();
  const walk = (suite: Suite, titles: string[]) => {
    const inside = suite.title && suite.title !== suite.file ? [...titles, suite.title] : titles;
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests) {
        const id = `${test.projectName} › ${spec.file} › ${[...inside, spec.title].join(" › ")}`;
        ids.set(id, (ids.get(id) ?? 0) + 1);
      }
    }
    for (const child of suite.suites ?? []) walk(child, inside);
  };
  for (const suite of (JSON.parse(stdout) as { suites: Suite[] }).suites) walk(suite, []);
  return ids;
}

/** The `npm run test:e2e` commands of CI's `e2e` job, one per shard and step, with the shard's arguments. */
export function e2eCommands(ci: string): { shard: string; args: string[] }[] {
  const job = ci.slice(ci.indexOf("\n  e2e:"), ci.indexOf("\n  check:"));
  const shards = [...job.matchAll(/^ {10}- \{ shard: ([\w-]+), (plans: true, )?args: "([^"]+)" \}$/gm)].map(([, shard, plans, args]) => ({
    shard,
    plans: Boolean(plans),
    args,
  }));
  const steps = job.split(/\n(?= {6}- )/).filter((step) => step.includes("run: npm run test:e2e"));
  const commands: { shard: string; args: string[] }[] = [];
  for (const shard of shards) {
    for (const step of steps) {
      if (/^\s*-?\s*if: matrix\.plans$/m.test(step) && !shard.plans) continue;
      const command = /run: npm run test:e2e -- (.+)$/m.exec(step)?.[1] ?? "";
      commands.push({ shard: shard.shard, args: command.replace("${{ matrix.args }}", shard.args).split(/\s+/) });
    }
  }
  return commands;
}

describe("CI's e2e shards", () => {
  const ci = readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8");
  const commands = e2eCommands(ci);

  it("are read from the workflow: eight shards, one of them running the Plans' quota projects first", () => {
    expect(new Set(commands.map((command) => command.shard)).size).toBe(8);
    const others = commands.filter((command) => command.shard === "others").map((command) => command.args.join(" "));
    expect(others.slice(0, 2)).toEqual(["--project=plan-quotas --no-deps", "--project=plan-coach-context --no-deps"]);
  });

  it("together run every test of the suite once, each command some", { timeout: 300_000 }, async () => {
    // One listing at a time: side by side, they took the runner's cores from the other test files, which timed out.
    const all = await listed([]);
    const parts: Map<string, number>[] = [];
    for (const command of commands) parts.push(await listed(command.args));
    const sharded = new Map<string, number>();
    parts.forEach((part, index) => {
      expect(part.size, commands[index].args.join(" ")).toBeGreaterThan(0);
      for (const [id, count] of part) sharded.set(id, (sharded.get(id) ?? 0) + count);
    });
    const differing = [...new Set([...all.keys(), ...sharded.keys()])]
      .filter((id) => all.get(id) !== sharded.get(id))
      .map((id) => `${id}: ${all.get(id) ?? 0} in the suite, ${sharded.get(id) ?? 0} in the shards`);
    expect(differing).toEqual([]);
    expect(all.size).toBeGreaterThan(1000);
  });

  it("run no web spec beside the Plans' quota projects", async () => {
    const plans = commands.filter((command) => command.args.some((arg) => /plan-quotas|plan-coach-context/.test(arg)));
    expect(plans).toHaveLength(2);
    for (const command of plans) {
      expect(command.args).toContain("--no-deps");
      expect([...(await listed(command.args)).keys()].every((id) => /^plan-(quotas|coach-context) › /.test(id))).toBe(true);
    }
  });
});
