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

describe("loadCoachKnowledge — the core digest", () => {
  const digest = loadCoachKnowledge({ environment: "eval" }).coreDigest();

  it("is about 1k tokens of cross-cutting rules, ready for a system prompt", () => {
    // ~3.5 characters per token for French prose: 2,800–4,800 characters ≈ 800–1,350 tokens.
    expect(digest?.text.length).toBeGreaterThan(2800);
    expect(digest?.text.length).toBeLessThan(4800);
    expect(digest?.text).not.toMatch(/^---/);
    expect(digest).toMatchObject({ version: "1.0", humanValidated: false });
  });

  it("covers the five cross-cutting rules, each grounded in a cited source", () => {
    expect(digest?.rules.map((rule) => rule.title)).toEqual([
      expect.stringMatching(/jamais .*résultat/i),
      expect.stringMatching(/recherche longue.*marché/i),
      expect.stringMatching(/budget/i),
      expect.stringMatching(/faits.*résultats/i),
      expect.stringMatching(/contact humain/i),
    ]);
    for (const rule of digest?.rules ?? []) expect(rule.sourceIds.length, rule.id).toBeGreaterThan(0);
    expect(digest?.sources.map((source) => source.id)).toEqual(expect.arrayContaining(["S24", "S35", "S55"]));
  });

  it("is not served in production until a human validated it", () => {
    expect(loadCoachKnowledge({ environment: "production" }).coreDigest()).toBeUndefined();
  });
});

describe("loadCoachKnowledge — which playbooks are served", () => {
  const dir = knowledgeDir({
    sources: ["S1"],
    playbooks: {
      "ats-optimization": playbookMarkdown({ id: "ats-optimization", sources: ["S1"], body: "[S1]", statut: "validé (François Nader, 2026-10-10)" }),
      "cover-letter-writing": playbookMarkdown({ id: "cover-letter-writing", sources: ["S1"], body: "[S1]", statut: "validé (auto-QA Claude, 2026-07-26)" }),
      "interview-psychology": playbookMarkdown({ id: "interview-psychology", sources: ["S1"], body: "[S1]", statut: "brouillon" }),
    },
  });

  it("serves only playbooks a human validated in production", () => {
    const knowledge = loadCoachKnowledge({ environment: "production", dir });

    expect(knowledge.playbooks().map((playbook) => playbook.id)).toEqual(["ats-optimization"]);
    expect(knowledge.playbook("ats-optimization")?.humanValidated).toBe(true);
    expect(knowledge.playbook("cover-letter-writing")).toBeUndefined();
    expect(knowledge.playbook("interview-psychology")).toBeUndefined();
  });

  it.each(["development", "eval"] as const)("serves every playbook in %s", (environment) => {
    const knowledge = loadCoachKnowledge({ environment, dir });

    expect(knowledge.playbooks().map((playbook) => [playbook.id, playbook.humanValidated])).toEqual([
      ["ats-optimization", true],
      ["cover-letter-writing", false],
      ["interview-psychology", false],
    ]);
  });

  it("serves none of today's playbooks in production: an AI review is not a human validation", () => {
    expect(loadCoachKnowledge({ environment: "production" }).playbooks()).toEqual([]);
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

  it("refuses a playbook citing a source its frontmatter does not list, so its sources resolve every rule's", () => {
    const dir = knowledgeDir({
      sources: ["S1", "S2"],
      playbooks: { "ats-optimization": playbookMarkdown({ id: "ats-optimization", sources: ["S1"], body: "Texte. [S1][S2]" }) },
    });

    expect(() => loadCoachKnowledge({ environment: "eval", dir })).toThrow(/ats-optimization.*frontmatter.*S2/);
  });

  it("refuses a playbook file that is not a known playbook id", () => {
    const dir = knowledgeDir({
      sources: ["S1"],
      playbooks: { "salary-negotiation": playbookMarkdown({ id: "salary-negotiation", sources: ["S1"], body: "[S1]" }) },
    });

    expect(() => loadCoachKnowledge({ environment: "eval", dir })).toThrow(/salary-negotiation/);
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
  writeFileSync(path.join(dir, "core-digest.md"), playbookMarkdown({ id: "core-digest", sources: [], body: "Socle." }));
  for (const [id, markdown] of Object.entries(playbooks)) writeFileSync(path.join(dir, "playbooks", `${id}.md`), markdown);
  return dir;
}
