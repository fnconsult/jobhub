import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// #562: the project's deploy-staging skill (.claude/skills/deploy-staging/SKILL.md) deploys the Beta and says where
// the next Version's Release Note stands; since ADR-0063 it neither tags, nor publishes a Release, nor bumps the Version.

const root = path.resolve(import.meta.dirname, "..", "..");
const skill = readFileSync(path.join(root, ".claude/skills/deploy-staging/SKILL.md"), "utf8");
/** Every command line of the skill's ```bash blocks. */
const commands = [...skill.matchAll(/```bash\n([\s\S]*?)```/g)].flatMap((block) => block[1]!.split("\n").filter((line) => line.trim()));

describe("the deploy-staging skill", () => {
  it("is the project's skill, named deploy-staging", () => {
    expect(skill).toMatch(/^---\nname: deploy-staging\ndescription: .+\n---\n/);
  });

  it.each([
    ["no tag", /\bgit\s+tag\b|refs\/tags|--follow-tags|--tags\b/],
    ["no GitHub Release", /\bgh\s+release\b|repos\/\S*\/releases|create_release/],
    ["no Version bump", /\bnpm\s+version\b|\bversion\s+(patch|minor|major)\b|--(minor|major)\b|"version"\s*:|sed\b.*package\.json|promote/],
    ["no push", /\bgit\s+push\b|\bgit\s+commit\b/],
  ])("holds %s, anywhere in its text", (_case, forbidden) => {
    expect(skill).not.toMatch(forbidden);
  });

  it("runs nothing against Production", () => {
    expect(commands.filter((line) => /production|\/\/jobbbox\.ai|confirm=/.test(line))).toEqual([]);
  });

  it("deploys only staging, from main, and follows the workflow", () => {
    const dispatches = commands.filter((line) => /\bgh\s+workflow\s+run\b/.test(line));
    expect(dispatches).toEqual(["gh workflow run deploy.yml --ref main -f target=staging"]);
    expect(commands).toContain('gh run watch "$RUN" --exit-status');
    expect(commands.filter((line) => line.includes("/api/health"))).toEqual(Array(2).fill("curl -fsS https://staging.jobbbox.ai/api/health"));
  });

  it("checks the next Version's Release Note, without blocking, and has a dry run that deploys nothing", () => {
    expect(commands).toContain("npm run --silent release-note -w @jobhub/help -- --check");
    expect(skill).toContain("**Ce constat ne bloque jamais le déploiement de la Beta**");
    expect(skill).toMatch(/`à blanc` ou `--dry-run` : fait les étapes 1 à 3, affiche la commande de l'étape 4 sans la lancer/);
  });

  // The dry run's own Release Note step, on this repository: it reads only, and always succeeds.
  it("its Release Note check runs on this repository and changes nothing", () => {
    const status = (cmd: string[]) => spawnSync("git", cmd, { cwd: root, encoding: "utf8" }).stdout;
    const before = status(["status", "--porcelain", "packages/help"]);
    const check = spawnSync("npm", ["run", "--silent", "release-note", "-w", "@jobhub/help", "--", "--check"], { cwd: root, encoding: "utf8", timeout: 60_000 });
    expect(check.status, check.stderr).toBe(0);
    const version = (JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { version: string }).version;
    expect(check.stdout.trim()).toMatch(new RegExp(`^Release Note ${version.replaceAll(".", "\\.")} : `));
    expect(status(["status", "--porcelain", "packages/help"])).toBe(before);
  });
});
