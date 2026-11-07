import type { Provenance } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import { activityEntries } from "./entries";

/**
 * The scenarios of the « Activité unifiée » prototype (ADR-0086, variant C), as the builder is given them: a Job Search
 * page with its run and a Job Offer read from it, a conversation with two replies interleaved and an applied card, a
 * Profile page's chain reply → Master CV Version 7 → ATS Score, a reply saved before #791, and an element « modèle non
 * enregistré ».
 */

const SEARCH = "1a5b6c7d-8e9f-4a0b-9c2d-3e4f5a6b7c8d";
const OFFER = "7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";

const at = (hhmm: string, day = "2026-11-05") => `${day}T${hhmm}:00.000Z`;

/** A Job Search's run (scenario 1): Brave's web search, Mistral Medium reading 23 pages, duplicates and Match Scores by rules. */
const searchRun: Provenance = {
  v: 1,
  steps: [
    { kind: "tool", activity: "web_search", tool: "brave", ms: 2_000, at: at("14:02"), outcome: "ok", count: 8 },
    { kind: "ai", activity: "read", task: "offer_analysis", provider: "mistral", endpoint: "api.mistral.ai", model: "mistral-medium-3-5", tokens: { input: 30_000, output: 6_100 }, ms: 9_000, at: at("14:03"), outcome: "ok", count: 23 },
    { kind: "rules", activity: "compute", rule: "offer_dedup", ms: 40, at: at("14:04"), outcome: "ok", count: 1 },
    { kind: "rules", activity: "compute", rule: "match_score", ms: 60, at: at("14:04"), outcome: "ok", count: 1 },
  ],
  sites: [{ kind: "web", domain: "airbus.com", links: ["https://www.airbus.com/fr/careers/controleuse-de-gestion"] }],
  startedAt: at("14:02"),
  wallMs: 161_000,
};

/** The Job Offer opened afterwards, its page read and summarized by Mistral Small. */
const offerRead: Provenance = {
  v: 1,
  steps: [
    { kind: "tool", activity: "read", tool: "job-site", ms: 900, at: at("14:06"), outcome: "ok", count: 1 },
    { kind: "ai", activity: "think_write", task: "offer_summary", provider: "mistral", endpoint: "api.mistral.ai", model: "mistral-small", tokens: { input: 2_000, output: 300 }, ms: 3_000, at: at("14:06"), outcome: "ok", count: 1 },
  ],
  sites: [{ kind: "web", domain: "airbus.com", links: ["https://www.airbus.com/fr/careers/controleuse-de-gestion"] }],
  startedAt: at("14:06"),
  wallMs: 4_000,
};

const searchElement = { kind: "job_search" as const, provenance: searchRun, href: `/recherches/${SEARCH}`, result: { offers: 14 } };
const offerElement = { kind: "job_offer" as const, provenance: offerRead, name: "Airbus · Contrôleuse de gestion industrielle", href: `/recherches/${SEARCH}/offres/${OFFER}`, after: 0 };

describe("Activité entries (#807): a pure builder over a page's elements, Coach replies, Master CV Versions and applied cards", () => {
  describe("scenario 1, a Job Search alone", () => {
    const entries = activityEntries({ page: "job_search", elements: [searchElement, offerElement] });

    it("lists the Job Offer read, then the run that found it, newest first, the offer « suite de » the run", () => {
      expect(entries.map(({ kind, at, object, after }) => ({ kind, at, object, after }))).toEqual([
        { kind: "job_offer", at: at("14:06"), object: { href: `/recherches/${SEARCH}/offres/${OFFER}`, label: "Airbus · Contrôleuse de gestion industrielle" }, after: entries[1]!.key },
        { kind: "job_search", at: at("14:02"), object: { href: `/recherches/${SEARCH}`, label: null }, after: undefined },
      ]);
      expect(entries[1]).not.toHaveProperty("messageId");
    });

    it("gives the run its steps, models, Tools and sites from its Provenance, its result, and its cost: one Job Search of the Plan Quota and its tokens", () => {
      const [, search] = entries;
      expect(search!.steps.map(({ label, tool, model, count }) => ({ label, tool, model, count }))).toEqual([
        { label: "web_search", tool: "Brave Search", model: null, count: 8 },
        { label: "read", tool: null, model: "Mistral Medium 3.5", count: 23 },
        { label: "compute", tool: null, model: null, count: 2 },
      ]);
      expect(search!.models.map((model) => model.name)).toEqual(["Mistral Medium 3.5"]);
      expect(search!.tools.map((tool) => tool.name)).toEqual(["Brave Search", null]);
      expect(search!.sites).toEqual(searchRun.sites);
      expect(search!.origin).toBe("candidate");
      expect(search!.result).toEqual({ end: { state: "done" }, offers: 14 });
      expect(search!.cost).toEqual({ quota: "jobSearches", tokens: { count: 36_100, calls: null, partial: false }, noAi: false });
    });

    it("counts the Job Offer's reading in no Plan Quota", () => {
      expect(entries[0]!.cost).toEqual({ quota: null, tokens: { count: 2_300, calls: null, partial: false }, noAi: false });
    });
  });
});
