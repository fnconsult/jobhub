import { describe, expect, it } from "vitest";
import { builtInInstructions, fillSlots, slotsIn, TASK_PLAYBOOKS, taskInstructionsProblems, taskPlaybookSeed, taskSection, taskSections } from "./index";

describe("task Playbooks as written in this repo (ADR-0026)", () => {
  it("each has a stable id, a French title and a version 1 its own task can read", () => {
    expect(new Set(TASK_PLAYBOOKS.map((task) => task.id)).size).toBe(TASK_PLAYBOOKS.length);
    for (const task of TASK_PLAYBOOKS) {
      expect(task.id, task.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(task.title.length, task.id).toBeGreaterThan(5);
      expect(taskInstructionsProblems(task, task.instructions), task.id).toEqual([]);
      expect(task.instructions, task.id).toBe(task.instructions.trim());
    }
  });

  it("are imported validated, but for the new Job Offer Summary and sector", () => {
    expect(TASK_PLAYBOOKS.filter((task) => !task.validatedAtImport).map((task) => task.id)).toEqual(["job-offer-reading"]);
    expect(TASK_PLAYBOOKS.filter((task) => !task.agent).map((task) => task.id)).toEqual(["company-facts-search", "company-news-search"]);
    expect(TASK_PLAYBOOKS.filter((task) => task.search).map((task) => task.id)).toEqual(["company-facts-search", "company-news-search", "job-search-queries"]);
  });

  it("read a text's `## key` sections, a note before the first one left out", () => {
    const text = "Note pour les rédacteurs.\n\n## fr\n\nBonjour.\nRègles :\n\n## en\n\nHello.\n";

    expect([...taskSections(text)]).toEqual([
      ["fr", "Bonjour.\nRègles :"],
      ["en", "Hello."],
    ]);
    expect(taskSection(text, "de")).toBeNull();
    expect(builtInInstructions("tailored-cv", "en")).toMatch(/^You are the Jobbbox coach\./);
  });

  it("tell what a text lacks: a section, a slot, or length", () => {
    const tailoredCv = taskPlaybookSeed("tailored-cv")!;
    const queries = taskPlaybookSeed("job-search-queries")!;
    const facts = taskPlaybookSeed("company-facts-search")!;

    expect(taskInstructionsProblems(tailoredCv, "## fr\n\nAdapte.")).toEqual(["## en"]);
    expect(taskInstructionsProblems(queries, "## intitulés\n\nDonne.\n\n## requête fr\n\nOffre {{intitulé}}\n\n## requête en\n\n{{intitulé}} in {{lieu}}")).toEqual([
      "## requête fr : {{lieu}}",
    ]);
    expect(taskInstructionsProblems(facts, "Fiche de l'entreprise.")).toEqual(["{{entreprise}}"]);
    expect(taskInstructionsProblems(facts, `{{entreprise}}${" x".repeat(400)}`)).toEqual(["length"]);
  });

  it("fill slots with the values given, any other left out", () => {
    expect(slotsIn("Offre « {{intitulé}} » à {{ lieu }}")).toEqual(["intitulé", "lieu"]);
    expect(fillSlots("Offre « {{intitulé}} » à {{lieu}} {{autre}}", { intitulé: "DAF", lieu: "Lyon" })).toBe("Offre « DAF » à Lyon ");
  });
});
