import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_OPTIONS, nextVersion, parseArguments, promote, writeVersion, type Deps, type Options } from "./promotion";

const SHA = "a".repeat(40);
const OTHER = "b".repeat(40);

/** The repo `main` carries in the fake `git`: its files at SHA, and which tags and branches exist. */
type FakeRepo = { files: Record<string, string>; tags?: string[]; prod?: string | null; prodBehind?: boolean };

const manifest = (version: string) => JSON.stringify({ name: "x", version });
const goodFiles = (version = "0.2.0"): Record<string, string> => ({
  "package.json": manifest(version),
  "apps/web/package.json": manifest(version),
  "apps/worker/package.json": manifest(version),
  [`packages/help/releases/fr/${version}.md`]: "# FR",
  [`packages/help/releases/en/${version}.md`]: "# EN",
});

type Fakes = {
  repo?: FakeRepo;
  ci?: { status: string; conclusion: string }[] | "fails";
  beta?: unknown;
  production?: unknown;
  answer?: string;
};

/** Deps whose `git`, `gh` and `fetch` are fakes; `calls` records every git and gh command. */
function fakeDeps({ repo = { files: goodFiles() }, ci = [{ status: "completed", conclusion: "success" }], beta = { version: "0.2.0", commit: SHA }, production = { version: "0.2.0", commit: SHA }, answer = "0.2.0" }: Fakes = {}) {
  const calls: string[] = [];
  const logs: string[] = [];
  const git = (args: string[]): string => {
    const [command, ...rest] = args;
    if (command === "fetch" || command === "tag" || command === "push" || command === "commit" || command === "worktree") return "";
    if (command === "rev-parse") {
      const ref = rest.at(-1)!;
      if (ref === "origin/main^{commit}") return `${SHA}\n`;
      if (ref.startsWith("refs/tags/")) {
        if (repo.tags?.includes(ref.slice(10))) return SHA;
        throw new Error("not a ref");
      }
      if (ref === "refs/remotes/origin/prod" && repo.prod) return repo.prod;
      throw new Error("not a ref");
    }
    if (command === "merge-base") {
      if (repo.prodBehind) throw new Error("not an ancestor");
      return "";
    }
    if (command === "show") {
      const file = rest[0]!.slice(SHA.length + 1);
      if (file in repo.files) return repo.files[file]!;
      throw new Error("no such file");
    }
    if (command === "cat-file") {
      if (rest[1]!.slice(SHA.length + 1) in repo.files) return "";
      throw new Error("no such file");
    }
    if (command === "ls-tree") return Object.keys(repo.files).filter((file) => file.startsWith(rest.at(-1)!)).join("\n");
    throw new Error(`unexpected git ${args.join(" ")}`);
  };
  const gh = (args: string[]): string => {
    const line = args.join(" ");
    if (line.startsWith("run list --workflow ci.yml")) {
      if (ci === "fails") throw new Error("gh: not logged in");
      return JSON.stringify(ci);
    }
    if (line.startsWith("workflow run deploy.yml")) return "";
    if (line.startsWith("run list --workflow deploy.yml")) return JSON.stringify([{ databaseId: 42, createdAt: new Date(0).toISOString(), url: "https://github.com/fnconsult/jobhub/actions/runs/42" }]);
    if (line.startsWith("run watch")) return "";
    if (line.startsWith("pr create")) return "https://github.com/fnconsult/jobhub/pull/700\n";
    throw new Error(`unexpected gh ${line}`);
  };
  const deps: Deps = {
    run: (command, args) => {
      calls.push(`${command} ${args.join(" ")}`);
      return command === "git" ? git(args) : gh(args);
    },
    fetch: async (url) => {
      const body = url.startsWith(DEFAULT_OPTIONS.betaUrl) ? beta : production;
      if (body instanceof Error) throw body;
      return { ok: true, status: 200, json: async () => body };
    },
    log: (line) => logs.push(line),
    ask: async () => answer,
    sleep: async () => {},
    now: () => new Date(0),
    tempDir: () => "/tmp/next-version",
  };
  return { deps, calls, logs };
}

const options = (overrides: Partial<Options> = {}): Options => ({ ...DEFAULT_OPTIONS, ...overrides });
const pushes = (calls: string[]) => calls.filter((call) => call.startsWith("git push") || call.startsWith("git tag") || call.startsWith("gh workflow run"));

describe("promote — refuses when a precondition is missing, says it, and pushes nothing", () => {
  const refuses = async (fakes: Fakes, problem: RegExp, overrides: Partial<Options> = {}) => {
    const { deps, calls, logs } = fakeDeps(fakes);
    const outcome = await promote(deps, options(overrides));
    expect(outcome.promoted).toBe(false);
    expect(outcome.problems.join("\n")).toMatch(problem);
    expect(logs).toContain("Une précondition manque : rien n'a été poussé.");
    expect(pushes(calls)).toEqual([]);
  };

  it("when the versions disagree", () =>
    refuses({ repo: { files: { ...goodFiles(), "apps/worker/package.json": manifest("0.1.9") } } }, /apps\/worker\/package\.json is at 0\.1\.9/));

  it("when the Version is already tagged", () => refuses({ repo: { files: goodFiles(), tags: ["v0.2.0"] } }, /le tag v0\.2\.0 existe déjà/));

  it("when prod cannot move forward to this commit", () => refuses({ repo: { files: goodFiles(), prod: OTHER, prodBehind: true } }, /prod \(bbbbbbb\) n'est pas un ancêtre/));

  it("when the CI of the commit is not green, still running or unreadable", async () => {
    await refuses({ ci: [{ status: "completed", conclusion: "failure" }] }, /la CI de aaaaaaa n'est pas verte/);
    await refuses({ ci: [] }, /la CI de aaaaaaa n'est pas verte/);
    await refuses({ ci: [{ status: "in_progress", conclusion: "" }] }, /tourne encore/);
    await refuses({ ci: "fails" }, /n'a pas pu être lue/);
  });

  it("when the Beta serves another commit or Version, or cannot be reached", async () => {
    await refuses({ beta: { version: "0.2.0", commit: OTHER } }, /la Beta sert bbbbbbb, pas aaaaaaa/);
    await refuses({ beta: { version: "0.1.0", commit: SHA } }, /la Beta sert la Version 0\.1\.0, pas 0\.2\.0/);
    await refuses({ beta: new Error("ECONNREFUSED") }, /staging\.jobbbox\.ai\/api\/health est injoignable/);
  });

  it("when a Release Note is missing, unless nothing a Candidate can see changed", async () => {
    const files = goodFiles();
    delete files["packages/help/releases/en/0.2.0.md"];
    await refuses({ repo: { files } }, /packages\/help\/releases\/en\/0\.2\.0\.md manque \(ou passez --rien-de-visible/);
    delete files["packages/help/releases/fr/0.2.0.md"];
    await refuses({ repo: { files } }, /fr\/0\.2\.0\.md et packages\/help\/releases\/en\/0\.2\.0\.md manquent/);
  });

  it("when fragments remain in releases/unreleased/", () =>
    refuses({ repo: { files: { ...goodFiles(), "packages/help/releases/unreleased/612.md": "x", "packages/help/releases/unreleased/613.md": "y" } } }, /2 fragments restent .*\(612\.md, 613\.md\)/));

  it("says every missing precondition at once", async () => {
    const { deps } = fakeDeps({ ci: [], beta: { version: "0.2.0", commit: OTHER } });
    const outcome = await promote(deps, options());
    expect(outcome.problems).toHaveLength(2);
  });

  it("when the product owner does not confirm", async () => {
    const { deps, calls } = fakeDeps({ answer: "non" });
    const outcome = await promote(deps, options());
    expect(outcome).toEqual({ promoted: false, problems: ["Promotion annulée. Rien n'a été poussé."] });
    expect(pushes(calls)).toEqual([]);
  });
});

describe("promote — when every precondition holds", () => {
  it("tags, pushes prod and the tag atomically, deploys Production from the tag, checks it, then opens the next Version", async () => {
    const { deps, calls } = fakeDeps();
    // The next Version's worktree is faked: writeVersion has its own test.
    deps.tempDir = () => {
      const dir = mkdtempSync(path.join(tmpdir(), "promotion-test-"));
      for (const file of ["package.json", "apps/web/package.json", "apps/worker/package.json", "package-lock.json"]) {
        mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
        writeFileSync(path.join(dir, file), JSON.stringify({ version: "0.2.0", packages: {} }));
      }
      return dir;
    };
    const outcome = await promote(deps, options());
    expect(outcome).toEqual({ promoted: true, version: "0.2.0", commit: SHA, pullRequest: "https://github.com/fnconsult/jobhub/pull/700", problems: [] });
    expect(pushes(calls)).toEqual([
      `git tag --annotate v0.2.0 ${SHA} --message Version 0.2.0`,
      `git push --atomic origin ${SHA}:refs/heads/prod refs/tags/v0.2.0`,
      "gh workflow run deploy.yml --ref v0.2.0 -f target=production -f confirm=jobbbox.ai",
      expect.stringMatching(/^git push --quiet -u origin version-0\.2\.1$/),
    ]);
    expect(calls).toContain("gh run watch 42 --exit-status --interval 15");
    expect(calls.find((call) => call.startsWith("gh pr create"))).toMatch(/--base main --head version-0\.2\.1 --title Version suivante : 0\.2\.1/);
  });

  it("with --rien-de-visible, needs no Release Note and recalls it in the summary", async () => {
    const files = goodFiles();
    delete files["packages/help/releases/fr/0.2.0.md"];
    delete files["packages/help/releases/en/0.2.0.md"];
    const { deps, logs } = fakeDeps({ repo: { files } });
    deps.run = ((run) => (command, args, cwd) => (args[0] === "worktree" && args[1] === "add" ? (() => { throw new Error("stop here"); })() : run(command, args, cwd)))(deps.run);
    const outcome = await promote(deps, options({ nothingVisible: true }));
    expect(outcome.promoted).toBe(true);
    expect(logs).toContain("✓ Rien de visible pour un Candidat : pas de Release Note exigée");
    expect(logs.join("\n")).toMatch(/Rappel : vous avez déclaré « rien de visible pour un Candidat » : la Version 0\.2\.0 n'aura pas de Release Note/);
  });

  it("says what to do when Production does not serve the Version, and opens no next Version", async () => {
    const { deps, calls, logs } = fakeDeps({ production: { version: "0.1.0", commit: OTHER } });
    const outcome = await promote(deps, options());
    expect(outcome).toMatchObject({ promoted: true, pullRequest: null, problems: [expect.stringMatching(/la Production sert 0\.1\.0 \(bbbbbbb\), pas 0\.2\.0/)] });
    expect(logs.join("\n")).toMatch(/redéployant le tag précédent/);
    expect(calls.some((call) => call.startsWith("gh pr create"))).toBe(false);
  });

  it("leaves no local branch behind when the next Version's pull request cannot be opened", async () => {
    const { deps, calls } = fakeDeps();
    deps.tempDir = () => {
      const dir = mkdtempSync(path.join(tmpdir(), "promotion-test-"));
      for (const file of ["package.json", "apps/web/package.json", "apps/worker/package.json", "package-lock.json"]) {
        mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
        writeFileSync(path.join(dir, file), JSON.stringify({ version: "0.2.0" }));
      }
      return dir;
    };
    deps.run = ((run) => (command, args, cwd) => (args[0] === "pr" ? (() => { throw new Error("gh: authentication expired"); })() : run(command, args, cwd)))(deps.run);
    const outcome = await promote(deps, options());
    expect(outcome).toMatchObject({ promoted: true, pullRequest: null, problems: [expect.stringMatching(/PR de la Version suivante n'a pas pu être ouverte \(gh: authentication expired\)/)] });
    expect(calls).toContain("git branch --quiet -D version-0.2.1");
  });

  it("deletes its local tag when the atomic push is refused", async () => {
    const { deps, calls } = fakeDeps();
    deps.run = ((run) => (command, args, cwd) => (args[0] === "push" ? (() => { throw new Error("! [remote rejected] prod (protected)"); })() : run(command, args, cwd)))(deps.run);
    const outcome = await promote(deps, options());
    expect(outcome.promoted).toBe(false);
    expect(outcome.problems[0]).toMatch(/le push de prod et v0\.2\.0 a été refusé .*Rien n'a été poussé/);
    expect(calls).toContain("git tag --delete v0.2.0");
    expect(calls.some((call) => call.startsWith("gh workflow run"))).toBe(false);
  });
});

describe("nextVersion and parseArguments", () => {
  it("numbers the next Version: patch by default, --minor or --major", () => {
    expect(nextVersion("1.4.2", "patch")).toBe("1.4.3");
    expect(nextVersion("1.4.2", "minor")).toBe("1.5.0");
    expect(nextVersion("1.4.2", "major")).toBe("2.0.0");
    expect(parseArguments([])).toEqual(DEFAULT_OPTIONS);
    expect(parseArguments(["--rien-de-visible", "--minor", "--yes"])).toMatchObject({ nothingVisible: true, bump: "minor", yes: true });
    expect(() => parseArguments(["--force"])).toThrow(/option inconnue : --force/);
  });
});

/** A real git repo and its bare remote; `gh` and `fetch` stay fakes. */
describe("promote — on a test repo", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  const sh = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

  function testRepo() {
    const root = mkdtempSync(path.join(tmpdir(), "promotion-repo-"));
    dirs.push(root);
    const remote = path.join(root, "remote.git");
    const work = path.join(root, "work");
    execFileSync("git", ["init", "--quiet", "--bare", "--initial-branch=main", remote]);
    execFileSync("git", ["init", "--quiet", "--initial-branch=main", work]);
    for (const [key, value] of [["user.name", "Product Owner"], ["user.email", "po@example.com"], ["commit.gpgsign", "false"], ["tag.gpgsign", "false"]]) sh(work, "config", key!, value!);
    const write = (file: string, content: string) => {
      mkdirSync(path.dirname(path.join(work, file)), { recursive: true });
      writeFileSync(path.join(work, file), content);
    };
    const pkg = (name: string) => `${JSON.stringify({ name, version: "0.2.0" }, null, 2)}\n`;
    write("package.json", pkg("jobhub"));
    write("apps/web/package.json", pkg("@jobhub/web"));
    write("apps/worker/package.json", pkg("@jobhub/worker"));
    write("package-lock.json", `${JSON.stringify({ name: "jobhub", version: "0.2.0", lockfileVersion: 3, packages: { "": { name: "jobhub", version: "0.2.0" }, "apps/web": { version: "0.2.0" }, "apps/worker": { version: "0.2.0" }, "node_modules/x": { version: "0.2.0" } } }, null, 2)}\n`);
    write("packages/help/releases/fr/0.2.0.md", "# 0.2.0\n");
    write("packages/help/releases/en/0.2.0.md", "# 0.2.0\n");
    sh(work, "add", ".");
    sh(work, "commit", "--quiet", "-m", "0.2.0");
    sh(work, "remote", "add", "origin", remote);
    sh(work, "push", "--quiet", "origin", "main");
    return { root, remote, work, sha: sh(work, "rev-parse", "HEAD").trim() };
  }

  function realGitDeps(work: string, sha: string) {
    const { deps } = fakeDeps({ beta: { version: "0.2.0", commit: sha }, production: { version: "0.2.0", commit: sha } });
    const gh: string[] = [];
    const fake = deps.run;
    deps.run = (command, args, cwd = work) => {
      if (command === "git") return sh(cwd, ...args);
      gh.push(args.join(" "));
      return fake(command, args, cwd);
    };
    deps.tempDir = () => mkdtempSync(path.join(tmpdir(), "promotion-next-"));
    return { deps, gh };
  }

  it("creates the tag, pushes prod and the tag atomically, then pushes and opens the next Version", async () => {
    const { remote, work, sha } = testRepo();
    const { deps, gh } = realGitDeps(work, sha);
    const outcome = await promote(deps, options({ yes: true }));
    expect(outcome).toMatchObject({ promoted: true, version: "0.2.0", problems: [] });
    expect(sh(remote, "rev-parse", "refs/heads/prod").trim()).toBe(sha);
    expect(sh(remote, "rev-parse", "v0.2.0^{commit}").trim()).toBe(sha);
    expect(sh(remote, "cat-file", "-t", "v0.2.0").trim()).toBe("tag");
    const next = (file: string) => JSON.parse(sh(remote, "show", `version-0.2.1:${file}`)) as { version: string; packages?: Record<string, { version: string }> };
    expect(next("package.json").version).toBe("0.2.1");
    expect(next("apps/web/package.json").version).toBe("0.2.1");
    expect(next("apps/worker/package.json").version).toBe("0.2.1");
    const lock = next("package-lock.json");
    expect([lock.version, lock.packages![""]!.version, lock.packages!["apps/web"]!.version, lock.packages!["apps/worker"]!.version, lock.packages!["node_modules/x"]!.version]).toEqual(["0.2.1", "0.2.1", "0.2.1", "0.2.1", "0.2.0"]);
    expect(sh(remote, "rev-parse", "version-0.2.1~1").trim()).toBe(sha);
    expect(gh.find((line) => line.startsWith("pr create"))).toMatch(/--head version-0\.2\.1/);
    // The next Version's worktree is gone.
    expect(sh(work, "worktree", "list").trim().split("\n")).toHaveLength(1);
  });

  it("pushes neither prod nor the tag when the remote refuses one of them", async () => {
    const { remote, work, sha } = testRepo();
    writeFileSync(path.join(remote, "hooks", "pre-receive"), '#!/bin/sh\nwhile read old new ref; do [ "$ref" = refs/heads/prod ] && { echo "prod is protected"; exit 1; }; done\nexit 0\n', { mode: 0o755 });
    const { deps, gh } = realGitDeps(work, sha);
    const outcome = await promote(deps, options({ yes: true }));
    expect(outcome.promoted).toBe(false);
    expect(sh(remote, "tag", "--list").trim()).toBe("");
    expect(sh(remote, "branch", "--list", "prod").trim()).toBe("");
    expect(sh(work, "tag", "--list").trim()).toBe("");
    expect(gh.some((line) => line.startsWith("workflow run"))).toBe(false);
  });
});

describe("writeVersion", () => {
  it("rewrites the three manifests and the lockfile's own entries, as npm formats them", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "promotion-version-"));
    for (const file of ["package.json", "apps/web/package.json", "apps/worker/package.json"]) {
      mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      writeFileSync(path.join(dir, file), `${JSON.stringify({ name: file, version: "1.0.0", private: true }, null, 2)}\n`);
    }
    writeFileSync(path.join(dir, "package-lock.json"), `${JSON.stringify({ version: "1.0.0", packages: { "": { version: "1.0.0" }, "apps/web": { version: "1.0.0" }, "node_modules/y": { version: "1.0.0" } } }, null, 2)}\n`);
    writeVersion(dir, "1.1.0");
    expect(readFileSync(path.join(dir, "apps/web/package.json"), "utf8")).toBe(`${JSON.stringify({ name: "apps/web/package.json", version: "1.1.0", private: true }, null, 2)}\n`);
    const lock = JSON.parse(readFileSync(path.join(dir, "package-lock.json"), "utf8")) as { packages: Record<string, { version: string }> };
    expect(lock.packages["node_modules/y"]!.version).toBe("1.0.0");
    expect(lock.packages["apps/web"]!.version).toBe("1.1.0");
  });
});
