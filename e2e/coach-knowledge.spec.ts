import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";

// Issue #128: the AI Coach's coaching knowledge (`@jobhub/coach-knowledge`) has no UI or HTTP route
// yet: its public entry point is `loadCoachKnowledge()`. Each test loads it in a fresh process
// (see support/coach-knowledge-harness.ts) and observes what a consumer would receive.

const tsx = path.resolve("node_modules/.bin/tsx");
const harness = path.resolve("e2e/support/coach-knowledge-harness.ts");
const packageDir = path.resolve("packages/coach-knowledge");

interface Rule { id: string; title: string; text: string; sourceIds: string[] }
interface Doc { title: string; version: string; updated: string; status: string; rules: Rule[]; sources: { id: string }[]; text: string }
interface Result {
  error?: { name: string; message: string };
  playbooks: (Doc & { id: string; hasFrontmatter: boolean })[];
  digest: Doc | null;
}

function load(environment: string, dir?: string): Result {
  const result = spawnSync(tsx, [harness, environment, ...(dir ? [dir] : [])], { encoding: "utf8", timeout: 60_000 });
  const line = result.stdout.split("\n").find((l) => l.startsWith("CK_RESULT "));
  if (!line) throw new Error(`harness failed (exit ${result.status}):\n${result.stdout}\n${result.stderr}`);
  return JSON.parse(line.slice("CK_RESULT ".length)) as Result;
}

/** A copy of the package's knowledge files that a test can edit. */
function scratchCopy(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "coach-knowledge-e2e-"));
  cpSync(path.join(packageDir, "playbooks"), path.join(dir, "playbooks"), { recursive: true });
  for (const file of ["sources.md", "core-digest.md"]) cpSync(path.join(packageDir, file), path.join(dir, file));
  return dir;
}

const setStatus = (file: string, status: string) =>
  writeFileSync(file, readFileSync(file, "utf8").replace(/^statut:.*$/m, `statut: ${status}`));

test.describe("imported playbooks", () => {
  test("every playbook file is imported with its frontmatter (version, updated, statut, sources)", () => {
    const files = readdirSync(path.join(packageDir, "playbooks")).filter((f) => f.endsWith(".md"));
    expect(files).toHaveLength(10);
    for (const file of files) {
      const frontmatter = /^---\n([\s\S]*?)\n---/.exec(readFileSync(path.join(packageDir, "playbooks", file), "utf8"))?.[1] ?? "";
      for (const key of ["version", "updated", "statut", "sources"]) expect(frontmatter, `${file} ${key}`).toMatch(new RegExp(`^${key}:`, "m"));
    }
    const { playbooks } = load("eval");
    expect(playbooks.map((p) => p.id).sort()).toEqual(files.map((f) => f.replace(/\.md$/, "")).sort());
    for (const p of playbooks) {
      expect(p.version).toMatch(/^\d+\.\d+$/);
      expect(p.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(p.status).not.toBe("");
      expect(p.hasFrontmatter).toBe(false);
    }
  });

  test("sources.md lists S1 to S56, except the five IDs it documents as never ingested", () => {
    // sources.md: "Les ID S7, S21, S22, S30 et S31 n'ont jamais été ingérés ... ne doivent pas être cités."
    const listed = [...readFileSync(path.join(packageDir, "sources.md"), "utf8").matchAll(/^\| (S\d+) \|/gm)].map((m) => m[1]);
    const neverIngested = ["S7", "S21", "S22", "S30", "S31"];
    expect(listed).toEqual(Array.from({ length: 56 }, (_, i) => `S${i + 1}`).filter((id) => !neverIngested.includes(id)));
  });
});

test.describe("typed loader", () => {
  test("exposes a playbook by id with its rules and the sources they cite", () => {
    const { playbooks } = load("eval");
    const playbook = playbooks.find((p) => p.id === "coaching-journey-gamification")!;
    expect(playbook.title).toBe("Parcours d'accompagnement : cadence, suivi et gamification");
    expect(playbook.version).toBe("1.0");
    expect(playbook.updated).toBe("2026-07-26");
    expect(playbook.sources.map((s) => s.id)).toEqual(["S24", "S35", "S54", "S55", "S56"]);
    expect(playbook.rules).toHaveLength(12);
    expect(playbook.rules[1]).toMatchObject({ id: "R2", sourceIds: ["S55"] });
    for (const rule of playbook.rules) {
      const allowed = new Set(playbook.sources.map((s) => s.id));
      expect(rule.sourceIds.every((id) => allowed.has(id)), rule.id).toBe(true);
    }
  });
});

test.describe("core digest", () => {
  test("is a ~1k-token set of cross-cutting rules", () => {
    const { digest } = load("eval");
    expect(digest).not.toBeNull();
    expect(digest!.rules.length).toBeGreaterThan(0);
    const approxTokens = digest!.text.length / 4;
    expect(approxTokens).toBeGreaterThan(300);
    expect(approxTokens).toBeLessThan(2000);
  });
});

test.describe("production serves only human-validated knowledge", () => {
  test("the shipped auto-QA / draft files are not served in production but are in dev and eval", () => {
    const production = load("production");
    expect(production.playbooks).toEqual([]);
    expect(production.digest).toBeNull();
    for (const environment of ["development", "eval"]) {
      const result = load(environment);
      expect(result.playbooks).toHaveLength(10);
      expect(result.digest).not.toBeNull();
    }
  });

  test("a playbook validated by a human is served in production, an AI-reviewed one is not", () => {
    const dir = scratchCopy();
    setStatus(path.join(dir, "playbooks", "ats-optimization.md"), "validé (François Nader, 2026-10-10)");
    setStatus(path.join(dir, "core-digest.md"), "validé (François Nader, 2026-10-10)");
    const production = load("production", dir);
    expect(production.playbooks.map((p) => p.id)).toEqual(["ats-optimization"]);
    expect(production.digest).not.toBeNull();
  });
});

test.describe("citations", () => {
  test("every [Sn] a playbook cites exists in sources.md", () => {
    expect(load("eval").error).toBeUndefined();
    const cited = readdirSync(path.join(packageDir, "playbooks")).flatMap((f) =>
      [...readFileSync(path.join(packageDir, "playbooks", f), "utf8").matchAll(/\[(S\d+)\]/g)].map((m) => m[1]),
    );
    expect(cited.length).toBeGreaterThan(100);
    const listed = new Set([...readFileSync(path.join(packageDir, "sources.md"), "utf8").matchAll(/^\| (S\d+) \|/gm)].map((m) => m[1]));
    expect(cited.filter((id) => !listed.has(id))).toEqual([]);
  });

  test("the loader refuses a playbook citing a source missing from sources.md", () => {
    const dir = scratchCopy();
    const file = path.join(dir, "playbooks", "ats-optimization.md");
    writeFileSync(file, readFileSync(file, "utf8").replace("[S11][S23]", "[S11][S99]"));
    const result = load("eval", dir);
    expect(result.error?.name).toBe("CoachKnowledgeError");
    expect(result.error?.message).toContain("S99");
  });
});
