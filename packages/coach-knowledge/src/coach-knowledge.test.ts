import { mkdtempSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadCoachKnowledge, PLAYBOOK_IDS } from "./index";

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

describe("loadCoachKnowledge — the imported playbooks", () => {
  const knowledge = loadCoachKnowledge({ environment: "eval" });

  it("exposes a playbook by id with its frontmatter, rules and sources", () => {
    const playbook = knowledge.playbook("coaching-journey-gamification");

    expect(playbook).toMatchObject({
      id: "coaching-journey-gamification",
      title: "Parcours d'accompagnement : cadence, suivi et gamification",
      version: "1.0",
      updated: "2026-07-26",
      status: "validé (auto-QA Claude, 2026-07-26)",
    });
    expect(playbook?.sources.map((source) => source.id)).toEqual(["S24", "S35", "S54", "S55", "S56"]);
    expect(playbook?.rules).toHaveLength(12);
    expect(playbook?.rules[1]).toMatchObject({
      id: "R2",
      title: "Annoncez un effet réel mais modeste, jamais une promesse de résultat.",
      sourceIds: ["S55"],
    });
    expect(playbook?.rules[1]?.text).toMatch(/^Dans cette même évaluation, l'effet sur l'emploi durable/);
  });

  it("loads all ten playbooks, each with its version, rules and sources", () => {
    for (const id of PLAYBOOK_IDS) {
      const playbook = knowledge.playbook(id);
      expect(playbook, id).toBeDefined();
      expect(playbook?.version, id).toMatch(/^\d+\.\d+$/);
      expect(playbook?.updated, id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(playbook?.rules.length, id).toBeGreaterThanOrEqual(9);
      expect(playbook?.rules.every((rule) => rule.title && rule.text), id).toBe(true);
      expect(playbook?.sources.length, id).toBeGreaterThanOrEqual(4);
    }
    expect(knowledge.playbook("senior-40plus-positioning")?.rules[0]).toMatchObject({
      id: "R1",
      title: "Positionnez votre expérience comme une valeur directement utile au poste.",
      sourceIds: ["S4", "S20"],
    });
  });
});

describe("loadCoachKnowledge — a knowledge folder", () => {
  it("refuses a playbook citing a source missing from sources.md", () => {
    const dir = knowledgeDir({
      sources: ["S1"],
      playbooks: { "ats-optimization": playbookMarkdown({ id: "ats-optimization", sources: ["S1"], body: "Texte. [S1][S99]" }) },
    });

    expect(() => loadCoachKnowledge({ environment: "eval", dir })).toThrow(/ats-optimization.*S99/);
  });
});

function playbookMarkdown({
  id,
  sources,
  body,
  statut = "validé (auto-QA Claude, 2026-07-26)",
}: {
  id: string;
  sources: string[];
  body: string;
  statut?: string;
}): string {
  return [
    "---",
    `playbook: ${id}`,
    'version: "2.0"',
    'updated: "2026-10-01"',
    `statut: ${statut}`,
    `sources: [${sources.join(", ")}]`,
    "langue: fr",
    "---",
    "",
    `# ${id}`,
    "",
    "## Règles",
    "",
    "**R1. Une règle.**",
    "",
    body,
    "",
  ].join("\n");
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
  for (const [id, markdown] of Object.entries(playbooks)) writeFileSync(path.join(dir, "playbooks", `${id}.md`), markdown);
  return dir;
}
