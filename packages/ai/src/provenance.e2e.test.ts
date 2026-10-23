/**
 * End-to-end (#326): the Provenance feature through its public entry points only: `createAiLayer` and
 * `createProvenanceRecorder` (@jobhub/ai index) and `readProvenance` / `provenanceLink` / `TOOLS` (@jobhub/shared).
 * What is stored is read back the way a result row's jsonb is: serialised to JSON, then `readProvenance`.
 * One test group per acceptance criterion of the issue.
 */
import { ACTIVITIES, provenanceLink, readProvenance, TOOLS, type Provenance, type SearchCriteria } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import { activityOf, createAiLayer, createProvenanceRecorder, FEATURE_STEPS, SEARCH_TASK, TEXT_TASKS, TOOL_STEPS } from "./index";
import type { AiTask } from "./types";
import { createFakeProvider, createMemoryUsageLog } from "./testing";

const criteria: SearchCriteria = { targetRole: "Développeur", locations: ["Paris"], contractTypes: [], remoteWorkOptions: [], sectors: [], subsectors: [], domains: [] };

function aiLayer() {
  const claude = createFakeProvider({ id: "anthropic", reply: '["Développeur web"]', usage: { inputTokens: 100, outputTokens: 20 } });
  const perplexity = createFakeProvider({ id: "perplexity", sources: ["https://www.apec.fr/offre/1"] });
  return createAiLayer({
    providers: [claude, perplexity],
    routes: { job_titles: "anthropic", offer_analysis: "anthropic", writing: "anthropic", web_search: "perplexity" },
    usage: createMemoryUsageLog(),
  });
}

/** What a result row's jsonb gives back. */
const stored = (provenance: Provenance): Provenance | null => readProvenance(JSON.parse(JSON.stringify(provenance)));

describe("Folding keeps a 30-offer Job Search to a few dozen steps", () => {
  it("folds 30 offers' reads, analyses, rules and Tool calls into at most 36 steps, losing no call", async () => {
    const events: string[] = [];
    const recorder = createProvenanceRecorder(aiLayer(), { onEvent: (event) => events.push(event.type) });

    await recorder.ai.planJobSearch({ candidateId: "c1", criteria });
    await recorder.step({ tool: "france-travail" }, async () => []);
    await recorder.step({ tool: "fantastic-jobs" }, async () => []);
    for (let offer = 1; offer <= 30; offer++) {
      await recorder.step({ tool: "job-site" }, async () => `page ${offer}`);
      await recorder.aiFor("read_job_page").generate({ task: "offer_analysis", candidateId: null, prompt: `Page ${offer}` });
      await recorder.ai.generate({ task: "offer_analysis", candidateId: null, prompt: `Offre ${offer}` });
      await recorder.step({ rule: "offer_freshness" }, () => true);
      await recorder.step({ rule: "offer_dedup" }, () => true);
      await recorder.step({ rule: "match_score" }, () => 70);
      recorder.site(`https://www.apec.fr/offre/${offer}?utm=x`);
    }

    const provenance = stored(recorder.provenance());
    expect(provenance).not.toBeNull();
    const steps = provenance!.steps;
    expect(steps.length).toBeLessThanOrEqual(36);
    expect(steps.length).toBeLessThan(30 * 6 + 3);
    // 30 offers x 6 calls + 3 = 183 calls ran; the folded counts add up to all of them.
    expect(steps.reduce((sum, step) => sum + step.count, 0)).toBe(183);
    expect(steps.find((step) => step.kind === "tool" && step.tool === "job-site")?.count).toBe(30);
    expect(steps.find((step) => step.kind === "rules" && step.rule === "match_score")?.count).toBe(30);
    // The live events stay unfolded: one start and one end per call.
    expect(events.filter((type) => type === "step_started")).toHaveLength(183);
    expect(events.filter((type) => type === "step_ended")).toHaveLength(183);
    // 30 pages of one site are one site with 30 links.
    expect(provenance!.sites).toHaveLength(1);
    expect(provenance!.sites[0]).toMatchObject({ kind: "web", domain: "apec.fr" });
  });
});

describe("A test fails when an AI task or a Tool of the catalog has no Activity", () => {
  it("gives every AI task of the AI layer an Activity", () => {
    for (const task of [...(Object.keys(TEXT_TASKS) as (keyof typeof TEXT_TASKS)[]), SEARCH_TASK] as AiTask[]) {
      expect(ACTIVITIES, `AI task ${task}`).toContain(activityOf({ kind: "ai", task }));
    }
  });

  it("gives every Tool of the catalog an Activity, or says why it has none", () => {
    const allowed: readonly string[] = [...ACTIVITIES, "by_task", "not_a_step"];
    for (const tool of TOOLS) {
      expect(Object.keys(TOOL_STEPS), `Tool ${tool.id}`).toContain(tool.id);
      expect(allowed, `Tool ${tool.id}`).toContain((TOOL_STEPS as Record<string, string>)[tool.id]);
    }
    expect(Object.keys(TOOL_STEPS).sort()).toEqual(TOOLS.map((tool) => tool.id).sort());
  });

  it("gives every feature step an Activity", () => {
    for (const [name, activity] of Object.entries(FEATURE_STEPS)) expect(ACTIVITIES, name).toContain(activity);
  });

  it("records the Activity the map gives, through the recorder", async () => {
    const recorder = createProvenanceRecorder(aiLayer());
    await recorder.ai.generate({ task: "writing", candidateId: null, prompt: "x" });
    await recorder.step({ tool: "france-travail" }, async () => 1);
    await recorder.step({ rule: "ats_score" }, () => 1);
    expect(recorder.provenance().steps.map((step) => step.activity)).toEqual(["write", "search", "compute"]);
  });
});

describe("The link filter has a table of allowed and refused examples", () => {
  const allowed: [string, string][] = [
    ["https://www.apec.fr/offre/123?utm_source=x#top", "https://www.apec.fr/offre/123"],
    ["http://example.com/jobs?id=1", "http://example.com/jobs"],
    ["https://www.linkedin.com/jobs/view/12345?trk=a", "https://www.linkedin.com/jobs/view/12345"],
    ["https://www.linkedin.com/company/acme/", "https://www.linkedin.com/company/acme/"],
    ["/offres/abc", "/offres/abc"],
    ["https://jobbbox.ai/recherches/42", "/recherches/42"],
  ];
  const refused: [string, string][] = [
    ["javascript:alert(1)", "not http(s)"],
    ["ftp://example.com/a", "not http(s)"],
    ["https://www.linkedin.com/in/jane-doe", "LinkedIn profile"],
    ["https://twitter.com/jane", "person page"],
    ["https://lusha.com/person/jane", "Enriched Contact"],
    ["https://user:pw@example.com/a", "credentials in address"],
    ["https://example.com/file?X-Amz-Signature=abc", "signed"],
    ["https://example.com/a?token=abc", "tokenised"],
    ["https://bucket.example.com/a?Expires=1&Signature=2", "signed"],
    ["https://192.168.1.1/a", "IP address"],
    ["https://localhost/admin", "Jobbbox address, not the Candidate's"],
    ["https://jobbbox.ai/back-office/users", "Back Office"],
    ["/compte/parametres", "account"],
    ["/fichiers/cv.pdf", "Candidate's file"],
    ["//evil.example/a", "protocol-relative"],
    ["not a link", "not an address"],
  ];

  it.each(allowed)("allows %s as %s", (link, kept) => {
    expect(provenanceLink(link)).toBe(kept);
  });

  it.each(refused)("refuses %s (%s)", (link) => {
    expect(provenanceLink(link)).toBeNull();
  });

  it("applies the same table when stored by the recorder and when read back", () => {
    const recorder = createProvenanceRecorder(aiLayer());
    for (const [link] of [...allowed, ...refused]) recorder.site(link);
    const kept = stored(recorder.provenance())!.sites.flatMap((site) => site.links);
    expect(kept.sort()).toEqual(allowed.map(([, link]) => link).sort());

    const tampered = JSON.parse(JSON.stringify(recorder.provenance()));
    tampered.sites[0].links.push("https://www.linkedin.com/in/jane-doe", "https://example.com/a?token=1");
    expect(readProvenance(tampered)!.sites.flatMap((site) => site.links).sort()).toEqual(kept);
  });
});

describe("No field of Provenance can hold a Candidate id, a cost or text", () => {
  const base = (): Record<string, unknown> => JSON.parse(JSON.stringify(createProvenanceRecorder(aiLayer()).provenance()));
  const withStep = (extra: Record<string, unknown>) => {
    const provenance = base();
    provenance.steps = [{ kind: "ai", activity: "write", task: "writing", ms: 1, at: "2026-10-23T10:00:00.000Z", outcome: "ok", count: 1, ...extra }];
    return provenance;
  };

  it("stores nothing of the Candidate, the cost or the prompt after a real action", async () => {
    const candidateId = "0b9c1a7e-3f4d-4c6a-9d2e-5a1b7c8d9e0f";
    const recorder = createProvenanceRecorder(aiLayer());
    await recorder.ai.generate({ task: "writing", candidateId, prompt: "Madame Dupont, je postule chez Acme" });
    await recorder.ai.planJobSearch({ candidateId, criteria });
    recorder.site("/offres/offer-7");
    const json = JSON.stringify(recorder.provenance());
    expect(json).not.toContain(candidateId);
    expect(json).not.toContain("Dupont");
    expect(json).not.toContain("postule");
    expect(json).not.toMatch(/cost|eur|price|candidate_?id|prompt|text/i);
  });

  it("is a strict shape: a Candidate id, a cost or a text field makes the stored object unreadable", () => {
    expect(readProvenance(base())).not.toBeNull();
    expect(readProvenance({ ...base(), candidateId: "c1" })).toBeNull();
    expect(readProvenance({ ...base(), costEur: 0.12 })).toBeNull();
    expect(readProvenance({ ...base(), text: "Bonjour" })).toBeNull();
    for (const extra of [{ candidateId: "c1" }, { cost: 0.01 }, { costEur: 1 }, { prompt: "Bonjour" }, { text: "Bonjour" }, { reply: "Bonjour" }]) {
      expect(readProvenance(withStep(extra)), JSON.stringify(extra)).toBeNull();
    }
    expect(readProvenance(withStep({ tokens: { input: 1, output: 2, cost: 3 } }))).toBeNull();
  });

  it("refuses an id or a sentence in a string field", () => {
    const uuid = "0b9c1a7e-3f4d-4c6a-9d2e-5a1b7c8d9e0f";
    expect(readProvenance(withStep({ task: `task_${uuid}` }))).toBeNull();
    expect(readProvenance(withStep({ task: "Bonjour Madame Dupont" }))).toBeNull();
    expect(readProvenance(withStep({ model: "a sentence with spaces" }))).toBeNull();
    expect(readProvenance(withStep({ model: `model-${uuid}` }))).toBeNull();
    expect(readProvenance(withStep({ endpoint: "Bonjour tout le monde" }))).toBeNull();
    expect(readProvenance(withStep({ at: "yesterday evening" }))).toBeNull();
    expect(readProvenance(withStep({ outcome: "it went fine" }))).toBeNull();
    const withSite = base();
    withSite.sites = [{ kind: "web", domain: "Une phrase libre", links: [] }];
    expect(readProvenance(withSite)).toBeNull();
  });

  it("types it: a Candidate id, a cost or a text field does not type-check", () => {
    const step: Provenance["steps"][number] = { kind: "rules", activity: "compute", rule: "match_score", ms: 1, at: "2026-10-23T10:00:00.000Z", outcome: "ok", count: 1 };
    // @ts-expect-error no Candidate id on a step
    const withId: Provenance["steps"][number] = { ...step, candidateId: "c1" };
    // @ts-expect-error no cost on a step
    const withCost: Provenance["steps"][number] = { ...step, costEur: 1 };
    // @ts-expect-error no text on a step
    const withText: Provenance["steps"][number] = { ...step, text: "x" };
    // @ts-expect-error no Candidate id on the Provenance
    const whole: Provenance = { v: 1, steps: [], sites: [], startedAt: "2026-10-23T10:00:00.000Z", wallMs: 0, candidateId: "c1" };
    expect([withId, withCost, withText, whole]).toHaveLength(4);
  });
});
