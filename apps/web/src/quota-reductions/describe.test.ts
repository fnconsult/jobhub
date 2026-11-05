import { describe, expect, it } from "vitest";
import { reductionLines } from "./describe";

describe("a Quota Reduction in words, as its subscribers read it", () => {
  it("names a lowered Coach context limit with the quotas, never in jetons (ADR-0078, #731; #332)", () => {
    const lines = reductionLines(
      { quotas: { jobSearches: { before: 7, after: 3 }, coachContextMessages: { before: null, after: 60 }, coachContextTokens: { before: 12_000, after: 8_000 } }, removedFeatures: [] },
      "fr",
    );

    expect(lines).toEqual([
      { label: "Recherches d'offres", before: "7 par semaine", after: "3 par semaine" },
      { label: "Mémoire du coach (messages lus)", before: "Illimité", after: "60" },
      { label: "Taille du contexte du coach", before: "12000", after: "8000" },
    ]);
    expect(JSON.stringify(reductionLines({ quotas: { coachContextTokens: { before: 12_000, after: 8_000 } }, removedFeatures: [] }, "en"))).not.toMatch(/tokens?|jetons?/i);
  });
});
