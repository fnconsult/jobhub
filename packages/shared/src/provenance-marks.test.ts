import { describe, expect, expectTypeOf, it } from "vitest";
import { markOf } from "./provenance-marks";
import { TOOLS, type Tool } from "./tools";

describe("a Tool's logo", () => {
  it("is none until its owner allowed it in writing (#318): none yet", () => {
    for (const tool of TOOLS as readonly Tool[]) expect(tool.logo, tool.id).toBeUndefined();
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
    const step = { kind: "tool", activity: "search", tool: "france-travail", ms: 400, at: "2026-10-23T10:00:00.000Z", outcome: "ok", count: 1 } as const;
    expect(markOf(step)).toEqual({ text: "France Travail" });
  });

  it("is the provider's name in text for an AI step, by the Tool that served it", () => {
    const step = { kind: "ai", activity: "write", task: "writing", provider: "anthropic", endpoint: "bedrock eu-north-1", model: "anthropic.claude-opus-5", ms: 4000, at: "2026-10-23T10:00:00.000Z", outcome: "ok", count: 1 } as const;
    expect(markOf(step)).toEqual({ text: "Claude (AWS Bedrock)" });
    expect(markOf({ ...step, provider: undefined, endpoint: undefined, model: undefined })).toEqual({});
  });
});
