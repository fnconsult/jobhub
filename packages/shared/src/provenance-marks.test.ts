import { describe, expect, expectTypeOf, it } from "vitest";
import en from "./i18n/locales/en.json";
import fr from "./i18n/locales/fr.json";
import { markOf, markOfTool, STEP_LABELS, stepLabel } from "./provenance-marks";
import { toolById, TOOLS, type Tool } from "./tools";

describe("a Tool's logo", () => {
  it("is none until its owner allowed it in writing (#318): France Travail's only (#424)", () => {
    for (const tool of TOOLS as readonly Tool[]) expect(tool.logo, tool.id).toBe(tool.id === "france-travail" ? "/logos/france-travail.svg" : undefined);
  });

  it("can only be one of Jobbbox's own assets, never a third-party favicon", () => {
    expectTypeOf<NonNullable<Tool["logo"]>>().toEqualTypeOf<`/logos/${string}`>();
    // @ts-expect-error a third-party address
    const favicon: Tool["logo"] = "https://www.apec.fr/favicon.ico";
    expect(favicon).toBeDefined();
  });
});

describe("what AI Activity shows for an element of a Provenance", () => {
  it("is 👤 for the Candidate's data", () => {
    expect(markOf({ kind: "candidate", links: ["/profils/4b1c"] })).toEqual({ glyph: "👤" });
  });

  it("is 🌐 for a site, with its domain in text", () => {
    expect(markOf({ kind: "web", domain: "apec.fr", links: [] })).toEqual({ glyph: "🌐", text: "apec.fr" });
  });

  it("is « J » for Jobbbox's rules", () => {
    expect(markOf({ kind: "rules", activity: "compute", rule: "match_score", ms: 2, at: "2026-10-23T10:00:00.000Z", outcome: "ok", count: 1 })).toEqual({ glyph: "J" });
  });

  it("is a Tool's name in text, without a logo while it has none", () => {
    const step = { kind: "tool", activity: "search", tool: "fantastic-jobs", ms: 400, at: "2026-10-23T10:00:00.000Z", outcome: "ok", count: 1 } as const;
    expect(markOf(step)).toEqual({ text: "Fantastic.jobs" });
  });

  it("is a Tool's logo, with its name, once it has one: France Travail's (#424)", () => {
    const step = { kind: "tool", activity: "search", tool: "france-travail", ms: 400, at: "2026-10-23T10:00:00.000Z", outcome: "ok", count: 1 } as const;
    expect(markOf(step)).toEqual({ logo: "/logos/france-travail.svg", text: "France Travail" });
  });

  it("is the provider's name in text for an AI step, by the Tool that served it", () => {
    const step = { kind: "ai", activity: "write", task: "writing", provider: "anthropic", endpoint: "bedrock eu-north-1", model: "anthropic.claude-opus-5", ms: 4000, at: "2026-10-23T10:00:00.000Z", outcome: "ok", count: 1 } as const;
    expect(markOf(step)).toEqual({ text: "Claude (AWS Bedrock)" });
    expect(markOf({ ...step, provider: undefined, endpoint: undefined, model: undefined })).toEqual({});
  });
});

describe("a Tool credited where its data is shown, as France Travail beside La Bonne Boite's companies (#409)", () => {
  const franceTravail = toolById("france-travail")!;

  it("is its logo, with its name, once its owner allowed one: the same `Tool.logo` AI Activity shows", () => {
    expect(markOfTool(franceTravail)).toEqual({ logo: "/logos/france-travail.svg", text: "France Travail" });
  });

  it("is its name in text while it has none", () => {
    expect(markOfTool({ ...franceTravail, logo: undefined })).toEqual({ text: "France Travail" });
    expect(markOfTool(undefined)).toEqual({});
  });
});

describe("what AI Activity calls a step while it runs (#328)", () => {
  const at = "2026-10-23T10:00:00.000Z";

  it("is its Activity's label", () => {
    expect(stepLabel({ kind: "ai", activity: "think_write", task: "coaching", at })).toBe("think_write");
    expect(stepLabel({ kind: "tool", activity: "read", tool: "job-site", at })).toBe("read");
    expect(stepLabel({ kind: "rules", activity: "compute", rule: "match_score", at })).toBe("compute");
  });

  it("is a check for a Guardrail's, whatever its Activity", () => {
    expect(stepLabel({ kind: "ai", activity: "think", task: "guardrail", at })).toBe("check");
  });

  it("has words in every interface language", () => {
    for (const locale of [fr, en]) for (const label of STEP_LABELS) expect(locale.aiActivity.steps[label], label).toEqual(expect.any(String));
  });

  it("has its result in words in every interface language, one and many (« 1 page lue », « 12 pages lues »)", () => {
    for (const locale of [fr, en]) {
      const results: Record<string, string> = locale.aiActivity.live.result;
      for (const label of STEP_LABELS) for (const plural of ["one", "other"]) expect(results[`${label}_${plural}`], `${label}_${plural}`).toContain("{{count}}");
    }
  });
});
