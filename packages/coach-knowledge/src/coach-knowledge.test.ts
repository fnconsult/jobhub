import { mkdtempSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { citedSourceIds, markdownTitle, parseSources, readCoachKnowledgeFiles } from "./index";

const packageDir = fileURLToPath(new URL("..", import.meta.url));

describe("sources.md", () => {
  it("lists every [Sn] the playbooks cite", () => {
    const listed = new Set(
      [...readFileSync(path.join(packageDir, "sources.md"), "utf8").matchAll(/^\| (S\d+) \|/gm)].map((match) => match[1]),
    );
    const playbookFiles = readdirSync(path.join(packageDir, "playbooks"));
    const cited = playbookFiles.flatMap((file) =>
      [...readFileSync(path.join(packageDir, "playbooks", file), "utf8").matchAll(/\[(S\d+)\]|\b(S\d+)\b/g)].map(
        (match) => ({ file, id: match[1] ?? match[2] }),
      ),
    );

    expect(playbookFiles).toHaveLength(10);
    expect(cited.length).toBeGreaterThan(100);
    expect(cited.filter(({ id }) => !listed.has(id))).toEqual([]);
  });
});

describe("readCoachKnowledgeFiles — what is imported as Playbook Version 1 (#225)", () => {
  const files = readCoachKnowledgeFiles();

  it("reads the ten playbooks by id, each with its title, rules, cited sources and Markdown without frontmatter", () => {
    expect(files.playbooks.map((playbook) => playbook.id)).toEqual([
      "application-strategy",
      "ats-optimization",
      "coaching-journey-gamification",
      "cover-letter-writing",
      "cv-offer-fit-scoring",
      "freelance-mission-positioning",
      "interview-journey-stages",
      "interview-psychology",
      "outreach-first-contact",
      "senior-40plus-positioning",
    ]);
    const playbook = files.playbooks.find((each) => each.id === "coaching-journey-gamification")!;
    expect(playbook.title).toBe("Parcours d'accompagnement : cadence, suivi et gamification");
    expect(playbook.sources.map((source) => source.id)).toEqual(["S24", "S35", "S54", "S55", "S56"]);
    expect(playbook.rules).toHaveLength(12);
    expect(playbook.rules[1]).toMatchObject({ id: "R2", title: "Annoncez un effet réel mais modeste, jamais une promesse de résultat.", sourceIds: ["S55"] });
    expect(playbook.text).toMatch(/^# Parcours d'accompagnement/);
    for (const each of files.playbooks) expect(each.rules.length, each.id).toBeGreaterThanOrEqual(9);
  });

  it("reads the Core Digest: about 1k tokens of five cross-cutting rules, each grounded in a cited source", () => {
    // ~3.5 characters per token for French prose: 2,800–4,800 characters ≈ 800–1,350 tokens.
    expect(files.coreDigest.text.length).toBeGreaterThan(2800);
    expect(files.coreDigest.text.length).toBeLessThan(4800);
    expect(files.coreDigest.text).not.toMatch(/^---/);
    expect(files.coreDigest.rules).toHaveLength(5);
    for (const rule of files.coreDigest.rules) expect(rule.sourceIds.length, rule.id).toBeGreaterThan(0);
  });

  it("reads the Sources list whole, with the sources its table lists", () => {
    expect(files.sources.text).toMatch(/^# Sources des playbooks de coaching/);
    expect(files.sources.entries).toHaveLength(51);
    expect(files.sources.entries[0]).toMatchObject({ id: "S1", author: "Apec × France Travail", year: "2026" });
  });
});

describe("readCoachKnowledgeFiles — a knowledge folder", () => {
  it("refuses a playbook citing a source missing from sources.md", () => {
    const dir = knowledgeDir({ sources: ["S1"], playbooks: { "ats-optimization": playbookMarkdown({ id: "ats-optimization", sources: ["S1"], body: "Texte. [S1][S99]" }) } });

    expect(() => readCoachKnowledgeFiles(dir)).toThrow(/ats-optimization.*S99/);
  });

  it("refuses a playbook citing a source its frontmatter does not list", () => {
    const dir = knowledgeDir({ sources: ["S1", "S2"], playbooks: { "ats-optimization": playbookMarkdown({ id: "ats-optimization", sources: ["S1"], body: "Texte. [S1][S2]" }) } });

    expect(() => readCoachKnowledgeFiles(dir)).toThrow(/ats-optimization.*frontmatter.*S2/);
  });
});

describe("the Markdown of coaching knowledge", () => {
  it("finds every [Sn] a text cites, once, in order", () => {
    expect(citedSourceIds("Un fait [S11][S23]. Un autre [S11] et S4 sans crochets.")).toEqual(["S11", "S23"]);
  });

  it("reads the Sources table, row by row", () => {
    expect(parseSources("| ID | Titre | Auteur | Année | URL | Licence |\n|--|--|--|--|--|--|\n| S1 | Une étude | Apec | 2026 | https://apec.fr | publique |")).toEqual([
      { id: "S1", title: "Une étude", author: "Apec", year: "2026", url: "https://apec.fr", licence: "publique" },
    ]);
  });

  it("finds a playbook's # title", () => {
    expect(markdownTitle("Intro\n\n# Optimiser son CV\n\n## Règles")).toBe("Optimiser son CV");
    expect(markdownTitle("Aucun titre")).toBe("");
  });
});

function playbookMarkdown({ id, sources, body }: { id: string; sources: string[]; body: string }): string {
  return ["---", `playbook: ${id}`, `sources: [${sources.join(", ")}]`, "langue: fr", "---", "", `# ${id}`, "", "## Règles", "", "**R1. Une règle.**", "", body, ""].join("\n");
}

function knowledgeDir({ sources, playbooks }: { sources: string[]; playbooks: Record<string, string> }): string {
  const dir = mkdtempSync(path.join(tmpdir(), "coach-knowledge-"));
  mkdirSync(path.join(dir, "playbooks"));
  writeFileSync(
    path.join(dir, "sources.md"),
    ["| ID | Titre | Auteur | Année | URL | Licence |", "|----|----|----|----|----|----|"]
      .concat(sources.map((id) => `| ${id} | Titre ${id} | Auteur | 2026 | https://example.org/${id} | publique |`))
      .join("\n"),
  );
  writeFileSync(path.join(dir, "core-digest.md"), playbookMarkdown({ id: "core-digest", sources: [], body: "Socle." }));
  for (const [id, markdown] of Object.entries(playbooks)) writeFileSync(path.join(dir, "playbooks", `${id}.md`), markdown);
  return dir;
}
