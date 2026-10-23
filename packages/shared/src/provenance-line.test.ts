import { describe, expect, it } from "vitest";
import type { Provenance, ProvenanceStep } from "./provenance";
import { formatDuration, formatTimeOfDay, formatTokens, provenanceLine, spokenMeasure } from "./provenance-line";

const at = "2026-10-23T08:40:00.000Z";
const ai = (overrides: Partial<Extract<ProvenanceStep, { kind: "ai" }>> = {}): ProvenanceStep => ({
  kind: "ai",
  activity: "think_write",
  task: "coaching",
  provider: "anthropic",
  endpoint: "bedrock eu-north-1",
  model: "anthropic.claude-opus-5",
  tokens: { input: 1500, output: 600 },
  ms: 6000,
  at,
  outcome: "ok",
  count: 1,
  ...overrides,
});
const provenance = (steps: ProvenanceStep[], more: Partial<Provenance> = {}): Provenance => ({ v: 1, steps, sites: [], startedAt: at, wallMs: 6400, ...more });

describe("the Provenance line under an AI Coach reply (#327)", () => {
  it("names the model that served, where it ran, with the tokens of every AI step and the wall-clock time", () => {
    const line = provenanceLine(
      provenance([
        ai({ activity: "think", tokens: { input: 300, output: 20 }, ms: 900 }),
        ai({ tokens: { input: 1500, output: 600 } }),
        ai({ task: "guardrail", activity: "think", provider: "mistral", endpoint: "api.mistral.ai", model: "mistral-small-latest", tokens: { input: 200, output: 5 } }),
      ]),
    );

    expect(line).toEqual({
      recorded: true,
      models: [
        { name: "Claude Opus 5", where: { fr: "AWS Bedrock · UE (Stockholm)", en: "AWS Bedrock · EU (Stockholm)" }, euAiConsent: false, outsideEu: false },
        { name: "Mistral Small", where: { fr: "Mistral AI · UE", en: "Mistral AI · EU" }, euAiConsent: false, outsideEu: false },
      ],
      tokens: 2625,
      ms: 6400,
      tools: [],
      sites: [],
    });
  });

  it("shows Mistral with the « consentement IA UE » chip when the reply went to the EU AI Consent route", () => {
    const line = provenanceLine(provenance([ai({ provider: "mistral", endpoint: "api.mistral.ai", model: "mistral-large-latest", euAiConsent: true })]));

    expect(line.models).toEqual([{ name: "Mistral Large", where: { fr: "Mistral AI · UE", en: "Mistral AI · EU" }, euAiConsent: true, outsideEu: false }]);
  });

  it("says « hors UE » of a model that ran outside the EU", () => {
    const line = provenanceLine(provenance([ai({ endpoint: "api.anthropic.com", model: "claude-opus-5-5" })]));

    expect(line.models).toEqual([{ name: "Claude Opus 5.5", where: { fr: "API Anthropic · hors UE", en: "Anthropic API · outside the EU" }, euAiConsent: false, outsideEu: true }]);
  });

  it("names its Tools and its Provenance sites, the Candidate's own data among them", () => {
    const line = provenanceLine(
      provenance(
        [ai(), { kind: "tool", activity: "read", tool: "job-site", ms: 800, at, outcome: "ok", count: 1 }, { kind: "rules", activity: "compute", rule: "match_score", ms: 2, at, outcome: "ok", count: 1 }],
        {
          sites: [
            { kind: "web", domain: "careers.acme.fr", links: ["https://careers.acme.fr/jobs/42"] },
            { kind: "candidate", links: ["/profils/4b1c"] },
          ],
        },
      ),
    );

    expect(line.tools).toEqual([{ text: "Sites d'emploi" }]);
    expect(line.sites).toEqual([
      { kind: "web", domain: "careers.acme.fr", links: ["https://careers.acme.fr/jobs/42"] },
      { kind: "candidate", links: ["/profils/4b1c"] },
    ]);
  });

  it("is « modèle non enregistré » with no Provenance", () => {
    expect(provenanceLine(null)).toEqual({ recorded: false, models: [], tokens: null, ms: null, tools: [], sites: [] });
  });

  it("has no time for a partial Provenance read from a reply saved before (its times unknown)", () => {
    const line = provenanceLine(provenance([ai({ endpoint: undefined, ms: 0 })], { wallMs: 0 }));

    expect(line).toMatchObject({ recorded: true, models: [{ name: "Claude Opus 5", where: null }], tokens: 2100, ms: null });
  });

  it("holds no cost, prompt, AI task or internal id", () => {
    const line = JSON.stringify(provenanceLine(provenance([ai(), ai({ task: "guardrail" })])));

    expect(line).not.toMatch(/coaching|guardrail|playbook|eur|cost|prompt|[0-9a-f]{8}-[0-9a-f]{4}-/i);
  });
});

describe("the Provenance line's numbers, as AI Activity writes them (#320)", () => {
  it.each([
    [0, "fr", "0"],
    [850, "fr", "850"],
    [1000, "fr", "1k"],
    [2125, "fr", "2,1k"],
    [10_900, "fr", "10,9k"],
    [10_900, "en", "10.9k"],
    [125_400, "fr", "125k"],
  ] as const)("%d tokens are « %s » (%s)", (tokens, language, words) => {
    expect(formatTokens(tokens, language)).toBe(words);
  });

  it.each([
    [0, "fr", "0 ms"],
    [790, "fr", "790 ms"],
    [1000, "fr", "1 s"],
    [5600, "fr", "5,6 s"],
    [6400, "fr", "6,4 s"],
    [21_500, "fr", "21,5 s"],
    [21_500, "en", "21.5 s"],
    [65_000, "fr", "1 min 05 s"],
    [612_400, "en", "10 min 12 s"],
  ] as const)("%d ms are « %s » (%s)", (ms, language, words) => {
    expect(formatDuration(ms, language)).toBe(words);
  });

  it("gives the time of day, the date with it on another day, and the year in another year", () => {
    const now = new Date("2026-10-23T14:00:00.000Z");
    const zone = { timeZone: "Europe/Paris" };

    expect(formatTimeOfDay(new Date("2026-10-23T08:40:00.000Z"), now, "fr", zone)).toBe("10:40");
    expect(formatTimeOfDay(new Date("2026-10-22T08:15:00.000Z"), now, "fr", zone)).toBe("22/10 à 10:15");
    expect(formatTimeOfDay(new Date("2025-10-22T08:15:00.000Z"), now, "fr", zone)).toBe("22/10/2025 à 10:15");
  });

  it("writes them by Intl in English: « 10:40 », « 22 Oct, 10:15 », « 22 Oct 2025, 10:15 »", () => {
    const now = new Date("2026-10-23T14:00:00.000Z");
    const zone = { timeZone: "Europe/Paris" };

    expect(formatTimeOfDay(new Date("2026-10-23T08:40:00.000Z"), now, "en", zone)).toBe("10:40");
    expect(formatTimeOfDay(new Date("2026-10-22T08:15:00.000Z"), now, "en", zone)).toBe("22 Oct, 10:15");
    expect(formatTimeOfDay(new Date("2025-10-22T08:15:00.000Z"), now, "en", zone)).toBe("22 Oct 2025, 10:15");
  });

  it.each([
    [2100, 6400, "fr", "2 100 tokens, 6,4 secondes"],
    [312, 790, "fr", "312 tokens, 790 millisecondes"],
    [10_900, 65_000, "en", "10,900 tokens, 1 minute 5 seconds"],
    [null, 21_500, "en", "21.5 seconds"],
    [850, null, "fr", "850 tokens"],
  ] as const)("says %s tokens in %s ms in words for screen readers (%s)", (tokens, ms, language, words) => {
    expect(spokenMeasure(tokens, ms, language).replace(/\u202f|\u00a0/g, " ")).toBe(words);
  });
});
