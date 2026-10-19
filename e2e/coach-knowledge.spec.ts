import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";

// Issues #128 and #225: the coaching knowledge files (`@jobhub/coach-knowledge`), now only what the
// one-off import of the Coaching Playbooks reads (ADR-0021): its public entry point is
// `readCoachKnowledgeFiles()`. Each test reads them in a fresh process (see
// support/coach-knowledge-harness.ts) and observes what the import would receive.

const tsx = path.resolve("node_modules/.bin/tsx");
const harness = path.resolve("e2e/support/coach-knowledge-harness.ts");
const packageDir = path.resolve("packages/coach-knowledge");

interface Rule { id: string; title: string; text: string; sourceIds: string[] }
interface Result {
  error?: { name: string; message: string };
  playbooks: { id: string; title: string; rules: Rule[]; sources: { id: string }[]; hasFrontmatter: boolean }[];
  digest: { title: string; rules: Rule[]; text: string };
  sources: string[];
}

function load(dir?: string): Result {
  const result = spawnSync(tsx, [harness, ...(dir ? [dir] : [])], { encoding: "utf8", timeout: 60_000 });
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

test.describe("imported playbooks", () => {
  test("every playbook file is read, its frontmatter (version, updated, statut, sources) left out", () => {
    const files = readdirSync(path.join(packageDir, "playbooks")).filter((f) => f.endsWith(".md"));
    expect(files).toHaveLength(10);
    for (const file of files) {
      const frontmatter = /^---\n([\s\S]*?)\n---/.exec(readFileSync(path.join(packageDir, "playbooks", file), "utf8"))?.[1] ?? "";
      for (const key of ["version", "updated", "statut", "sources"]) expect(frontmatter, `${file} ${key}`).toMatch(new RegExp(`^${key}:`, "m"));
    }
    const { playbooks } = load();
    expect(playbooks.map((p) => p.id).sort()).toEqual(files.map((f) => f.replace(/\.md$/, "")).sort());
    for (const p of playbooks) expect(p.hasFrontmatter).toBe(false);
  });

  test("sources.md lists S1 to S56, except the five IDs it documents as never ingested", () => {
    // sources.md: "Les ID S7, S21, S22, S30 et S31 n'ont jamais été ingérés ... ne doivent pas être cités."
    const listed = [...readFileSync(path.join(packageDir, "sources.md"), "utf8").matchAll(/^\| (S\d+) \|/gm)].map((m) => m[1]);
    const neverIngested = ["S7", "S21", "S22", "S30", "S31"];
    expect(listed).toEqual(Array.from({ length: 56 }, (_, i) => `S${i + 1}`).filter((id) => !neverIngested.includes(id)));
    expect(load().sources).toEqual(listed);
  });
});

test.describe("typed reader", () => {
  test("gives a playbook by id with its rules and the sources they cite", () => {
    const { playbooks } = load();
    const playbook = playbooks.find((p) => p.id === "coaching-journey-gamification")!;
    expect(playbook.title).toBe("Parcours d'accompagnement : cadence, suivi et gamification");
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
    const { digest } = load();
    expect(digest.rules.length).toBeGreaterThan(0);
    const approxTokens = digest.text.length / 4;
    expect(approxTokens).toBeGreaterThan(300);
    expect(approxTokens).toBeLessThan(2000);
  });
});

test.describe("citations", () => {
  test("every [Sn] a playbook cites exists in sources.md", () => {
    expect(load().error).toBeUndefined();
    const cited = readdirSync(path.join(packageDir, "playbooks")).flatMap((f) =>
      [...readFileSync(path.join(packageDir, "playbooks", f), "utf8").matchAll(/\[(S\d+)\]/g)].map((m) => m[1]),
    );
    expect(cited.length).toBeGreaterThan(100);
    const listed = new Set([...readFileSync(path.join(packageDir, "sources.md"), "utf8").matchAll(/^\| (S\d+) \|/gm)].map((m) => m[1]));
    expect(cited.filter((id) => !listed.has(id))).toEqual([]);
  });

  test("the reader refuses a playbook citing a source missing from sources.md", () => {
    const dir = scratchCopy();
    const file = path.join(dir, "playbooks", "ats-optimization.md");
    writeFileSync(file, readFileSync(file, "utf8").replace("[S11][S23]", "[S11][S99]"));
    const result = load(dir);
    expect(result.error?.name).toBe("CoachKnowledgeError");
    expect(result.error?.message).toContain("S99");
  });
});
