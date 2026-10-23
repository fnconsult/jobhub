import { describe, expect, expectTypeOf, it } from "vitest";
import { readProvenance, type Provenance, type ProvenanceSite, type ProvenanceStep } from "./provenance";

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

  it("is none when it is not one this version knows", () => {
    expect(readProvenance({ ...provenance, v: 2 })).toBeNull();
    expect(readProvenance({ steps: [] })).toBeNull();
    expect(readProvenance({ ...provenance, steps: [{ ...toolStep, outcome: "maybe" }] })).toBeNull();
    expect(readProvenance({ ...provenance, steps: [{ ...toolStep, count: 0 }] })).toBeNull();
    expect(readProvenance({ ...provenance, steps: [{ ...toolStep, tool: "unknown-tool" }] })).toBeNull();
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
      "kind" | "activity" | "task" | "provider" | "endpoint" | "model" | "tokens" | "ms" | "at" | "outcome" | "count"
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
