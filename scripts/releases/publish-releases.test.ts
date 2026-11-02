import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { publishReleases, renderRelease, type Release, RELEASES_DIR, versionTags } from "./publish-releases";

const fixture = (locale: string) => readFileSync(path.resolve(RELEASES_DIR, locale, "0.1.0.md"), "utf8");
const note = (title: string, text: string) => `---\nversion: 0.0.0\ndate: 2026-11-02\ntitle: ${title}\ntags: [candidature]\n---\n${text}\n\n## Nouveau\n- **Une ligne** : ${text}\n`;

describe("renderRelease — what a Version's GitHub Release says (#561)", () => {
  it("says the French Release Note, then the English one, then the pull requests (on the 0.1.0 notes)", () => {
    const release = renderRelease("v0.1.0", { fr: fixture("fr"), en: fixture("en") }, "## What's Changed\n* Promotion by @someone in #635\n");
    expect(release.name).toBe("v0.1.0 — Jobbbox, la première version");
    expect(release.technical).toBe(false);
    const [fr, en, pullRequests] = ["# Jobbbox, la première version", "# Jobbbox, the first version", "## What's Changed"].map((part) => release.body.indexOf(part));
    expect(fr).toBe(0);
    expect(en).toBeGreaterThan(fr!);
    expect(pullRequests).toBeGreaterThan(en!);
    expect(release.body).toContain("## Nouveau\n- **Une connexion sans mot de passe**");
    expect(release.body).toContain("## New\n- **Sign in without a password**");
    // The front matter is never shown.
    expect(release.body).not.toMatch(/^version:|^tags:|announce:/m);
  });

  it("gives a tag with no Release Note a technical Release: its title says so, its body is the pull requests alone", () => {
    expect(renderRelease("v0.1.1", { fr: null, en: null }, "## What's Changed\n* Fix by @someone in #700\n")).toEqual({
      tag: "v0.1.1",
      name: "v0.1.1 (technique)",
      body: "## What's Changed\n* Fix by @someone in #700\n",
      technical: true,
    });
    expect(renderRelease("v0.1.1", { fr: null, en: null }, "").body).toMatch(/Aucune pull request/);
  });
});

describe("versionTags", () => {
  it("keeps the vX.Y.Z tags only, oldest Version first", () => {
    expect(versionTags(["v0.10.0", "v0.2.0", "v1.0.0-beta.1", "v0.2.10", "v0.2.9", "latest", ""])).toEqual(["v0.2.0", "v0.2.9", "v0.2.10", "v0.10.0"]);
  });
});

describe("publishReleases — on a real git repo, with a fake GitHub (#561)", () => {
  let repo: string;
  let releases: Release[];
  let writes: { method: string; endpoint: string; payload: Record<string, unknown> }[];
  let generated: string[];
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const write = (file: string, text: string) => {
    mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    writeFileSync(path.join(repo, file), text);
  };
  const commit = (message: string) => {
    git("add", "-A");
    git("commit", "-q", "--allow-empty", "-m", message);
  };

  const deps = {
    log: () => {},
    run: (command: "git" | "gh", args: string[], input?: string) => {
      if (command === "git") return git(...args);
      const endpoint = args.find((arg) => arg.startsWith("repos/"))!;
      if (endpoint.endsWith("/releases") && args.includes("--paginate")) return releases.map((release) => JSON.stringify(release)).join("\n");
      if (endpoint.endsWith("/generate-notes")) {
        const tag = args.find((arg) => arg.startsWith("tag_name="))!.slice("tag_name=".length);
        const previous = args.find((arg) => arg.startsWith("previous_tag_name="))?.slice("previous_tag_name=".length);
        generated.push(`${previous ?? "∅"}..${tag}`);
        return JSON.stringify({ name: tag, body: `## What's Changed\n* Changes up to ${tag}\n` });
      }
      const method = args[args.indexOf("-X") + 1]!;
      const payload = JSON.parse(input!) as Record<string, unknown>;
      writes.push({ method, endpoint, payload });
      if (method === "POST") releases.push({ id: releases.length + 1, tag_name: String(payload.tag_name), name: String(payload.name), body: String(payload.body) });
      else {
        const release = releases.find((candidate) => endpoint.endsWith(`/${candidate.id}`))!;
        Object.assign(release, payload);
      }
      return "{}";
    },
  };
  const options = { repo: "fnconsult/jobhub", dryRun: false };

  beforeEach(() => {
    repo = mkdtempSync(path.join(tmpdir(), "publish-releases-"));
    git("init", "-q", "-b", "main");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    git("config", "tag.gpgSign", "false");
    git("config", "commit.gpgSign", "false");
    releases = [];
    writes = [];
    generated = [];

    // 0.1.0, Promoted with its Release Note; 0.1.1, Promoted with nothing visible; 0.1.2, the next Version on the Beta.
    write(`${RELEASES_DIR}/fr/0.1.0.md`, note("Première version", "Bonjour"));
    write(`${RELEASES_DIR}/en/0.1.0.md`, note("First version", "Hello"));
    commit("0.1.0");
    git("tag", "-a", "v0.1.0", "-m", "Version 0.1.0");
    commit("a fix nobody sees");
    git("tag", "-a", "v0.1.1", "-m", "Version 0.1.1");
    write(`${RELEASES_DIR}/fr/0.1.2.md`, note("Suivante", "Bientôt"));
    write(`${RELEASES_DIR}/en/0.1.2.md`, note("Next", "Soon"));
    commit("the next Version's Release Note");
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("publishes a Release for each tag: FR, EN and pull requests for a noted one, a technical one otherwise, nothing for an untagged note", () => {
    const outcome = publishReleases(deps, options);
    expect(outcome.problems).toEqual([]);
    expect(outcome.actions.map((action) => [action.kind, action.wanted.name])).toEqual([
      ["create", "v0.1.0 — Première version"],
      ["create", "v0.1.1 (technique)"],
    ]);
    expect(generated).toEqual(["∅..v0.1.0", "v0.1.0..v0.1.1"]);
    expect(writes.map((entry) => [entry.method, entry.endpoint, entry.payload.tag_name, entry.payload.make_latest])).toEqual([
      ["POST", "repos/fnconsult/jobhub/releases", "v0.1.0", "false"],
      ["POST", "repos/fnconsult/jobhub/releases", "v0.1.1", "true"],
    ]);
    const body = String(writes[0]!.payload.body);
    expect(body.indexOf("# Première version")).toBe(0);
    expect(body.indexOf("# First version")).toBeGreaterThan(0);
    expect(body.indexOf("* Changes up to v0.1.0")).toBeGreaterThan(body.indexOf("# First version"));
    expect(writes[1]!.payload.body).toBe("## What's Changed\n* Changes up to v0.1.1\n");
    expect(JSON.stringify(writes)).not.toContain("0.1.2");
  });

  it("creates no duplicate when run again, and updates a Release that differs", () => {
    publishReleases(deps, options);
    writes = [];
    expect(publishReleases(deps, options).actions.map((action) => action.kind)).toEqual(["unchanged", "unchanged"]);
    expect(writes).toEqual([]);

    releases[0]!.body = "edited by hand";
    expect(publishReleases(deps, options).actions.map((action) => action.kind)).toEqual(["update", "unchanged"]);
    expect(writes).toEqual([{ method: "PATCH", endpoint: "repos/fnconsult/jobhub/releases/1", payload: expect.objectContaining({ name: "v0.1.0 — Première version" }) }]);
    expect(releases).toHaveLength(2);
  });

  it("in dry-run, says what it would publish and writes nothing", () => {
    expect(publishReleases(deps, { ...options, dryRun: true }).actions.map((action) => action.kind)).toEqual(["create", "create"]);
    expect(writes).toEqual([]);
  });

  it("fails, and publishes nothing, when a tagged Version's Release Note is edited, removed or added", () => {
    write(`${RELEASES_DIR}/en/0.1.0.md`, note("First version", "Hello, edited"));
    write(`${RELEASES_DIR}/fr/0.1.1.md`, note("Après coup", "Trop tard"));
    rmSync(path.join(repo, RELEASES_DIR, "fr/0.1.0.md"));
    commit("rewrite history");
    const outcome = publishReleases(deps, options);
    expect(outcome.problems).toEqual([
      expect.stringMatching(/^packages\/help\/releases\/fr\/0\.1\.0\.md a été supprimée après la Promotion de v0\.1\.0/),
      expect.stringMatching(/^packages\/help\/releases\/en\/0\.1\.0\.md a été modifiée après la Promotion de v0\.1\.0/),
      expect.stringMatching(/^packages\/help\/releases\/fr\/0\.1\.1\.md a été ajoutée après la Promotion de v0\.1\.1/),
    ]);
    expect(outcome.actions).toEqual([]);
    expect(writes).toEqual([]);
    expect(generated).toEqual([]);
  });

  it("as the workflow runs it: exits 1 with a workflow error when a published Release Note changed", () => {
    write(`${RELEASES_DIR}/fr/0.1.0.md`, note("Première version", "Bonjour, retouché"));
    commit("edit a published note");
    const script = path.resolve("scripts/publish-releases.ts");
    const tsx = path.resolve("node_modules/.bin/tsx");
    const result = spawnSync(tsx, [script, "--dry-run"], { cwd: repo, encoding: "utf8", env: { ...process.env, GITHUB_REPOSITORY: "fnconsult/jobhub" } });
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/^::error::packages\/help\/releases\/fr\/0\.1\.0\.md a été modifiée après la Promotion de v0\.1\.0/m);
  });
});
