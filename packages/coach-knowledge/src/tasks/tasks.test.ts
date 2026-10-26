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
    expect(TASK_PLAYBOOKS.filter((task) => !task.agent).map((task) => task.id)).toEqual(["company-news-search"]);
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
    expect(taskInstructionsProblems(facts, "Fiche de l'entreprise.")).toEqual(["## requête", "## lecture"]);
    expect(taskInstructionsProblems(facts, "## requête\n\nFiche de l'entreprise.\n\n## lecture\n\nLis.")).toEqual(["## requête : {{entreprise}}"]);
    expect(taskInstructionsProblems(facts, `## requête\n\n{{entreprise}}\n\n## lecture\n\n${"x".repeat(4000)}`)).toEqual(["length"]);
  });

  it("keep the version 1 a task Playbook was first imported with, when its text written here came after it (#405)", () => {
    const facts = taskPlaybookSeed("company-facts-search")!;

    // Version 1: the web-search query alone, as production ran it; the text written here adds the Playbook Agent reading the pages.
    expect(facts.firstVersion).toEqual({ instructions: expect.stringContaining("{{entreprise}}"), agent: false });
    expect(facts.firstVersion?.instructions).not.toMatch(/^## /m);
    expect(facts.agent).toBe(true);
    expect(builtInInstructions("company-facts-search", "requête")).toContain("{{entreprise}}");
    expect(builtInInstructions("company-facts-search", "lecture")).toMatch(/pages/);
    expect(TASK_PLAYBOOKS.filter((task) => "firstVersion" in task).map((task) => task.id)).toEqual(["company-facts-search"]);
  });

  it("fill slots with the values given, any other left out", () => {
    expect(slotsIn("Offre « {{intitulé}} » à {{ lieu }}")).toEqual(["intitulé", "lieu"]);
    expect(fillSlots("Offre « {{intitulé}} » à {{lieu}} {{autre}}", { intitulé: "DAF", lieu: "Lyon" })).toBe("Offre « DAF » à Lyon ");
  });
});
