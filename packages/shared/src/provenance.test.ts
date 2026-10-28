import { describe, expect, expectTypeOf, it } from "vitest";
import { byRules, joinProvenance, readProvenance, replyActivity, rulesProvenance, type Provenance, type ProvenanceSite, type ProvenanceStep } from "./provenance";

const aiStep: ProvenanceStep = {
  kind: "ai",
  activity: "write",
  task: "writing",
  provider: "anthropic",
  endpoint: "bedrock eu-north-1",
  model: "anthropic.claude-opus-5",
  tokens: { input: 5200, output: 900 },
  ms: 8200,
  at: "2026-10-23T10:00:01.000Z",
  outcome: "ok",
  count: 1,
};
const toolStep: ProvenanceStep = { kind: "tool", activity: "search", tool: "france-travail", ms: 640, at: "2026-10-23T10:00:00.500Z", outcome: "ok", count: 2 };
const rulesStep: ProvenanceStep = { kind: "rules", activity: "compute", rule: "match_score", ms: 3, at: "2026-10-23T10:00:09.300Z", outcome: "ok", count: 1 };
const sites: ProvenanceSite[] = [
  { kind: "web", domain: "apec.fr", links: ["https://www.apec.fr/candidat/recherche-emploi.html/emploi/detail-offre/178456"] },
  { kind: "candidate", links: ["/profils/4b1c"] },
];
const provenance: Provenance = { v: 1, steps: [aiStep, toolStep, rulesStep], sites, startedAt: "2026-10-23T10:00:00.000Z", wallMs: 9400 };

describe("a Provenance read from its jsonb column", () => {
  it("is the Provenance stored", () => {
    expect(readProvenance(JSON.parse(JSON.stringify(provenance)))).toEqual(provenance);
  });

  it("is none for a result made before Provenance was kept (« modèle non enregistré »)", () => {
    expect(readProvenance(null)).toBeNull();
    expect(readProvenance(undefined)).toBeNull();
  });

  describe("for a result saved before Provenance was kept, with who answered and its tokens (#327)", () => {
    const saved = {
      activity: "think_write",
      task: "coaching",
      provider: "anthropic",
      model: "claude-opus-5-5",
      inputTokens: 1200,
      outputTokens: 300,
      cachedInputTokens: 800,
      at: new Date("2026-10-01T08:15:00.000Z"),
    } as const;

    it("is a partial Provenance read from them: one AI step, its times unknown (0), no endpoint, no sites", () => {
      expect(readProvenance(null, saved)).toEqual({
        v: 1,
        steps: [
          {
            kind: "ai",
            activity: "think_write",
            task: "coaching",
            provider: "anthropic",
            model: "claude-opus-5-5",
            tokens: { input: 2000, output: 300 },
            ms: 0,
            at: "2026-10-01T08:15:00.000Z",
            outcome: "ok",
            count: 1,
          },
        ],
        sites: [],
        startedAt: "2026-10-01T08:15:00.000Z",
        wallMs: 0,
      });
    });

    it("is the stored one when there is one", () => {
      expect(readProvenance(JSON.parse(JSON.stringify(provenance)), saved)).toEqual(provenance);
    });

    it("is none when no model was saved either (« modèle non enregistré »)", () => {
      expect(readProvenance(null, { ...saved, provider: null, model: null })).toBeNull();
    });

    it("leaves out tokens it does not have, and a model whose shape a Provenance does not keep", () => {
      const partial = readProvenance(null, { ...saved, inputTokens: null, outputTokens: null, cachedInputTokens: null, model: "a model with spaces" });
      expect(partial?.steps).toEqual([expect.not.objectContaining({ tokens: expect.anything() })]);
      expect(partial?.steps[0]).not.toHaveProperty("model");
    });
  });

  it("is none when it is not one this version knows", () => {
    expect(readProvenance({ ...provenance, v: 2 })).toBeNull();
    expect(readProvenance({ steps: [] })).toBeNull();
    expect(readProvenance({ ...provenance, steps: [{ ...toolStep, outcome: "maybe" }] })).toBeNull();
    expect(readProvenance({ ...provenance, steps: [{ ...toolStep, count: 0 }] })).toBeNull();
    expect(readProvenance({ ...provenance, steps: [{ ...toolStep, tool: "unknown-tool" }] })).toBeNull();
  });

  it("shows only the links the link filter allows, each on its own kind of site", () => {
    const stored = {
      ...provenance,
      sites: [
        { kind: "web", domain: "apec.fr", links: ["https://www.apec.fr/offre/1?utm_source=x", "https://www.linkedin.com/in/jean-dupont", "/profils/4b1c"] },
        { kind: "candidate", links: ["/profils/4b1c", "/admin/outils", "https://www.apec.fr/offre/1"] },
      ],
    };
    expect(readProvenance(stored)?.sites).toEqual([
      { kind: "web", domain: "apec.fr", links: ["https://www.apec.fr/offre/1"] },
      { kind: "candidate", links: ["/profils/4b1c"] },
    ]);
  });

  it("keeps a stopped step", () => {
    const stopped = { ...provenance, steps: [{ ...aiStep, outcome: "stopped" }] };
    expect(readProvenance(stopped)).toEqual(stopped);
  });
});

describe("no field of a Provenance can hold a Candidate id, a cost or text", () => {
  it("has no such field, by type", () => {
    expectTypeOf<keyof Provenance>().toEqualTypeOf<"v" | "steps" | "sites" | "startedAt" | "wallMs">();
    expectTypeOf<keyof Extract<ProvenanceStep, { kind: "ai" }>>().toEqualTypeOf<
      "kind" | "activity" | "task" | "provider" | "endpoint" | "model" | "tokens" | "euAiConsent" | "ms" | "at" | "outcome" | "count"
    >();
    expectTypeOf<keyof Extract<ProvenanceStep, { kind: "tool" }>>().toEqualTypeOf<"kind" | "activity" | "tool" | "ms" | "at" | "outcome" | "count">();
    expectTypeOf<keyof Extract<ProvenanceStep, { kind: "rules" }>>().toEqualTypeOf<"kind" | "activity" | "rule" | "ms" | "at" | "outcome" | "count">();
    // @ts-expect-error no Candidate id
    const withCandidate: Provenance = { ...provenance, candidateId: "c0ffee00-0000-4000-8000-000000000000" };
    // @ts-expect-error no cost
    const withCost: ProvenanceStep = { ...toolStep, costEur: 0.002 };
    // @ts-expect-error no text
    const withText: ProvenanceSite = { kind: "web", domain: "apec.fr", links: [], text: "Jean Dupont, Paris" };
    expect([withCandidate, withCost, withText]).toHaveLength(3);
  });

  it("refuses a stored one carrying a Candidate id", () => {
    const candidateId = "0f8fad5b-d9cb-469f-a165-70867728950e";
    expect(readProvenance({ ...provenance, candidateId })).toBeNull();
    expect(readProvenance({ ...provenance, steps: [{ ...aiStep, candidateId }] })).toBeNull();
    expect(readProvenance({ ...provenance, steps: [{ ...aiStep, model: candidateId }] })).toBeNull();
    expect(readProvenance({ ...provenance, steps: [{ ...aiStep, endpoint: candidateId }] })).toBeNull();
    expect(readProvenance({ ...provenance, steps: [{ ...aiStep, task: candidateId }] })).toBeNull();
  });

  it("refuses a stored one carrying a cost", () => {
    expect(readProvenance({ ...provenance, costEur: 0.03 })).toBeNull();
    expect(readProvenance({ ...provenance, steps: [{ ...aiStep, costEur: 0.03 }] })).toBeNull();
    expect(readProvenance({ ...provenance, steps: [{ ...aiStep, tokens: { input: 1, output: 1, costEur: 0.03 } }] })).toBeNull();
    expect(readProvenance({ ...provenance, steps: [{ ...aiStep, ms: 0.03 }] })).toBeNull();
  });

  it("refuses a stored one carrying text", () => {
    const text = "Jean Dupont, développeur, 12 rue de la Paix";
    expect(readProvenance({ ...provenance, text })).toBeNull();
    expect(readProvenance({ ...provenance, steps: [{ ...aiStep, reply: text }] })).toBeNull();
    expect(readProvenance({ ...provenance, steps: [{ ...aiStep, model: text }] })).toBeNull();
    expect(readProvenance({ ...provenance, steps: [{ ...aiStep, endpoint: text }] })).toBeNull();
    expect(readProvenance({ ...provenance, steps: [{ ...aiStep, task: text }] })).toBeNull();
    expect(readProvenance({ ...provenance, steps: [{ ...aiStep, at: text }] })).toBeNull();
    expect(readProvenance({ ...provenance, sites: [{ ...sites[0], label: text }] })).toBeNull();
    expect(readProvenance({ ...provenance, sites: [{ ...sites[0], domain: text }] })).toBeNull();
    expect(readProvenance({ ...provenance, startedAt: text })).toBeNull();
  });
});

describe("two Provenances joined, the later action after the earlier one (#329)", () => {
  const search: Provenance = {
    v: 1,
    steps: [{ kind: "ai", activity: "web_search", task: "web_search", provider: "perplexity", endpoint: "api.perplexity.ai", model: "sonar", tokens: { input: 300, output: 800 }, ms: 4100, at: "2026-10-23T10:00:00.000Z", outcome: "ok", count: 1 }],
    sites: [],
    startedAt: "2026-10-23T10:00:00.000Z",
    wallMs: 4200,
  };
  const read: Provenance = {
    v: 1,
    steps: [toolStep, aiStep],
    sites: [{ kind: "web", domain: "apec.fr", links: ["https://www.apec.fr/offre/1"] }],
    startedAt: "2026-10-23T10:00:07.000Z",
    wallMs: 9000,
  };

  it("has the steps of both in order, the sites of both, the first start, and the time both took", () => {
    expect(joinProvenance(search, read)).toEqual({ v: 1, steps: [...search.steps, ...read.steps], sites: read.sites, startedAt: search.startedAt, wallMs: 13_200 });
  });

  it("lists a site both name once, with the links of both", () => {
    const again: Provenance = { ...read, sites: [{ kind: "web", domain: "apec.fr", links: ["https://www.apec.fr/offre/1", "https://www.apec.fr/offre/2"] }] };

    expect(joinProvenance(read, again)?.sites).toEqual([{ kind: "web", domain: "apec.fr", links: ["https://www.apec.fr/offre/1", "https://www.apec.fr/offre/2"] }]);
  });

  it("is the Provenance known when the other is none (« modèle non enregistré »)", () => {
    expect(joinProvenance(null, read)).toEqual(read);
  });
});

describe("content made by Jobbbox's rules alone, no AI (#336)", () => {
  it("is one rules step, compute, timed from its start, with the Candidate's pages it was built from", () => {
    expect(rulesProvenance("ats_score", { at: new Date("2026-10-24T09:00:00Z"), ms: 4, links: ["/profils/4b1c/cv-de-reference"] })).toEqual({
      v: 1,
      steps: [{ kind: "rules", activity: "compute", rule: "ats_score", ms: 4, at: "2026-10-24T09:00:00.000Z", outcome: "ok", count: 1 }],
      sites: [{ kind: "candidate", links: ["/profils/4b1c/cv-de-reference"] }],
      startedAt: "2026-10-24T09:00:00.000Z",
      wallMs: 4,
    });
  });

  it("knows no time when none was measured, and keeps no link the link filter refuses", () => {
    const fixed = rulesProvenance("ats_score", { at: new Date("2026-10-24T09:00:00Z"), links: ["/admin/candidates", "https://www.linkedin.com/in/marie-dupont"] });

    expect(fixed).toMatchObject({ steps: [{ ms: 0 }], sites: [], wallMs: 0 });
    expect(readProvenance(JSON.parse(JSON.stringify(fixed)))).toEqual(fixed);
  });

  it("times what the rules work out, and gives it back with its Provenance", async () => {
    const clock = [new Date("2026-10-24T09:00:00.000Z"), new Date("2026-10-24T09:00:00.012Z")];
    const { value, provenance } = await byRules("ats_fixes", () => ["fix"], { now: () => clock.shift()! });

    expect(value).toEqual(["fix"]);
    expect(provenance).toMatchObject({ steps: [{ kind: "rules", rule: "ats_fixes", ms: 12, at: "2026-10-24T09:00:00.000Z" }], wallMs: 12 });
  });
});

describe("the Activity glyph beside a reply (#464)", () => {
  it("is its last step's: what the reply did last", () => {
    expect(replyActivity(provenance)).toBe("compute");
    expect(replyActivity({ ...provenance, steps: [toolStep, aiStep] })).toBe("write");
  });

  it("is « think, then write » when its Provenance was not kept, or holds no step", () => {
    expect(replyActivity(null)).toBe("think_write");
    expect(replyActivity({ ...provenance, steps: [] })).toBe("think_write");
  });
});
