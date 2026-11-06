import { describe, expect, it } from "vitest";
import { CONSUMPTION_TOOLS, QUOTA_CONSUMPTION_TOOLS, consumptionTools, isConsumptionTool } from "./consumption";
import { WEEKLY_QUOTAS } from "./domain";

describe("the Tools « Votre consommation » counts (#799, ADR-0091)", () => {
  it("are the nine features of one shared list, in the order they are shown", () => {
    expect(consumptionTools()).toEqual(["coach", "jobSearch", "matchScore", "tailoredCv", "tailoredDocument", "atsScore", "companyDossier", "enrichedContact", "cvReading"]);
  });

  it("each has a French and an English label and unit", () => {
    for (const tool of consumptionTools()) {
      for (const locale of ["fr", "en"] as const) {
        expect(CONSUMPTION_TOOLS[tool][locale].label).not.toBe("");
        expect(CONSUMPTION_TOOLS[tool][locale].unit).not.toBe("");
        expect(CONSUMPTION_TOOLS[tool][locale].one).not.toBe("");
      }
    }
    expect(CONSUMPTION_TOOLS.coach.fr.unit).toBe("réponses");
    expect(CONSUMPTION_TOOLS.cvReading.fr.unit).toBe("CV lus");
    expect(CONSUMPTION_TOOLS.cvReading.fr.one).toBe("CV lu");
  });

  it("each weekly Plan Quota counts under one Tool of its own", () => {
    expect(Object.keys(QUOTA_CONSUMPTION_TOOLS).sort()).toEqual([...WEEKLY_QUOTAS].sort());
    expect(new Set(Object.values(QUOTA_CONSUMPTION_TOOLS)).size).toBe(WEEKLY_QUOTAS.length);
    expect(QUOTA_CONSUMPTION_TOOLS.jobSearches).toBe("jobSearch");
  });

  it("tells a Tool key from anything else", () => {
    expect(isConsumptionTool("coach")).toBe(true);
    expect(isConsumptionTool("extension")).toBe(false);
    expect(isConsumptionTool("toString")).toBe(false);
    expect(isConsumptionTool(1)).toBe(false);
  });
});
