import { AiProviderError, createAiLayer, readOfferFields } from "@jobhub/ai";
import { createFakeProvider, createMemoryUsageLog } from "@jobhub/ai/testing";
import type { MasterCvContent } from "@jobhub/shared";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { createJobOffers, migrateJobOffers } from "../job-offers";
import { createProfiles, migrateProfiles, type Profiles } from "../profiles";
import type { QuotaDecision } from "../billing";
import { createMatchScoring, type MatchScoring, type OfferTextReader } from "./index";

const masterCv: MasterCvContent = {
  fullName: "Marie Dupont",
  headline: "Directrice financière",
  email: "marie.dupont@example.fr",
  phone: "",
  location: "Lyon",
  summary: "",
  experience: [{ title: "Directrice financière", employer: "Groupe Seb", location: "Lyon", period: "2005 – 2024", description: "Consolidation IFRS." }],
  education: [],
  skills: ["IFRS", "SAP"],
  languages: [],
};

describe.skipIf(!connectionString)("Match Scoring (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let profiles: Profiles;
  let scoring: MatchScoring;
  let candidateId: string;
  let jobOfferId: string;
  let jobOffers: ReturnType<typeof createJobOffers>;

  /** Match Scoring whose Plan Quota answers `decision`, recording who it was asked for. */
  function meteredScoring(decision: QuotaDecision) {
    const asked: string[] = [];
    const metered = createMatchScoring({
      jobOffers,
      profiles,
      matchScoreQuota: async (id) => {
        asked.push(id);
        return decision;
      },
    });
    return { metered, asked };
  }
  const REFUSED: QuotaDecision = { allowed: false, quota: "matchScores", plan: "free", planName: { fr: "Gratuite", en: "Free" }, limit: 3, upgradeTo: "standard", upgradeToName: { fr: "Standard", en: "Standard" } };

  beforeEach(async () => {
    testAuth = await startTestAuth();
    const database = testAuth.auth.options.database as Pool;
    await migrateProfiles(database);
    await migrateJobOffers(database);
    profiles = createProfiles(database);
    jobOffers = createJobOffers(database);
    scoring = createMatchScoring({ jobOffers, profiles });
    const cookie = await signInWithMagicLink(testAuth, "marie.dupont@example.fr");
    candidateId = (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id;
    const captured = await jobOffers.capture({
      source: { url: "https://www.apec.fr/offre/1" },
      title: "DAF H/F",
      content: "DAF pour un groupe industriel. 15 ans d'expérience.",
      location: "Lyon",
      contractType: "cdi",
      salary: { min: 110_000, max: 130_000 },
      skills: ["IFRS", "SAP", "Power BI"],
    });
    if (!captured.ok) throw new Error("fixture Job Offer refused");
    jobOfferId = captured.jobOffer.id;
  });
  afterEach(async () => {
    await testAuth.stop();
  });

  it("scores a Guest's CV, given with the request, against a Job Offer, without an account", async () => {
    const result = await scoring.score(null, { jobOfferId, cv: masterCv });

    expect(result).toEqual({
      ok: true,
      matchScore: {
        score: 82, // skills 2/3 of 40 + seniority 20 + location 15, out of 75 (no Search Criteria: salary and contract type unknown)
        breakdown: {
          skills: { status: "partial", covered: ["IFRS", "SAP"], missing: ["Power BI"] },
          seniority: { status: "match", cvYears: 19, requiredYears: 15 },
          location: { status: "match", offer: "Lyon", wanted: ["Lyon"] },
          salary: { status: "unknown", offer: { min: 110_000, max: 130_000 } },
          contractType: { status: "unknown", offer: "cdi" },
        },
      },
    });
  });

  it("scores a Profile's Master CV against its Search Criteria for the signed-in Candidate", async () => {
    const created = await profiles.create(candidateId, {
      masterCv,
      searchCriteria: { targetRole: "DAF", locations: ["Lyon"], minSalary: 150_000, contractTypes: ["cdi"] },
    });
    if (!created.ok) throw new Error("fixture Profile refused");

    const result = await scoring.score(candidateId, { jobOfferId, profileId: created.profile.id });

    expect(result).toMatchObject({
      ok: true,
      matchScore: {
        breakdown: {
          salary: { status: "mismatch", offer: { min: 110_000, max: 130_000 }, wanted: 150_000 },
          contractType: { status: "match", offer: "cdi", wanted: ["cdi"] },
        },
      },
    });
  });

  it("scores a Tailored CV sent with the request, with the Search Criteria it is for", async () => {
    const tailoredCv = { ...masterCv, skills: [...masterCv.skills, "Power BI"] };
    const searchCriteria = { targetRole: "DAF", locations: ["Lyon"], minSalary: 120_000, contractTypes: ["cdi"] };

    const result = await scoring.score(candidateId, { jobOfferId, cv: tailoredCv, searchCriteria });

    expect(result).toEqual({ ok: true, matchScore: expect.objectContaining({ score: 100 }) });
  });

  it("refuses a Profile to a Guest, and someone else's Profile or an unknown Job Offer to anyone", async () => {
    const created = await profiles.create(candidateId, { masterCv, searchCriteria: { targetRole: "DAF", locations: ["Lyon"] } });
    if (!created.ok) throw new Error("fixture Profile refused");
    const cookie = await signInWithMagicLink(testAuth, "jean.martin@example.fr");
    const otherId = (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id;

    expect(await scoring.score(null, { jobOfferId, profileId: created.profile.id })).toEqual({ ok: false, error: "unauthorized" });
    expect(await scoring.score(otherId, { jobOfferId, profileId: created.profile.id })).toEqual({ ok: false, error: "not_found" });
    expect(await scoring.score(null, { jobOfferId: "00000000-0000-4000-8000-000000000000", cv: masterCv })).toEqual({ ok: false, error: "not_found" });
  });

  it("scores a Job Offer private to the Candidate for them only: to another Candidate or a Guest it is unknown (ADR-0049)", async () => {
    const privateOffer = await jobOffers.capture({ title: "DAF H/F, client confidentiel", content: "Mon client cherche son DAF à Lyon." }, "candidate", { privateTo: candidateId });
    if (!privateOffer.ok) throw new Error("fixture Job Offer refused");
    const cookie = await signInWithMagicLink(testAuth, "jean.martin@example.fr");
    const otherId = (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id;

    expect(await scoring.score(candidateId, { jobOfferId: privateOffer.jobOffer.id, cv: masterCv })).toMatchObject({ ok: true });
    expect(await scoring.score(otherId, { jobOfferId: privateOffer.jobOffer.id, cv: masterCv })).toEqual({ ok: false, error: "not_found" });
    expect(await scoring.score(null, { jobOfferId: privateOffer.jobOffer.id, cv: masterCv })).toEqual({ ok: false, error: "not_found" });
  });

  it("refuses a request without a Job Offer or a CV, naming the fields to fix", async () => {
    expect(await scoring.score(null, { cv: masterCv })).toEqual({ ok: false, error: "invalid", errors: [{ field: "jobOfferId", code: "required" }] });
    expect(await scoring.score(null, { jobOfferId })).toEqual({ ok: false, error: "invalid", errors: [{ field: "cv", code: "required" }] });
    expect(await scoring.score(null, "hello")).toMatchObject({ ok: false, error: "invalid" });
  });

  it("counts one Match Score against the signed-in Candidate's Plan Quota, for a Profile or a CV sent with the request", async () => {
    const created = await profiles.create(candidateId, { masterCv, searchCriteria: { targetRole: "DAF", locations: ["Lyon"] } });
    if (!created.ok) throw new Error("fixture Profile refused");
    const { metered, asked } = meteredScoring({ allowed: true, remaining: 2 });

    expect(await metered.score(candidateId, { jobOfferId, profileId: created.profile.id })).toMatchObject({ ok: true });
    expect(await metered.score(candidateId, { jobOfferId, cv: masterCv })).toMatchObject({ ok: true });

    expect(asked).toEqual([candidateId, candidateId]);
  });

  it("refuses a Match Score the Candidate's Plan Quota does not allow, without scoring", async () => {
    const created = await profiles.create(candidateId, { masterCv, searchCriteria: { targetRole: "DAF", locations: ["Lyon"] } });
    if (!created.ok) throw new Error("fixture Profile refused");
    const { metered } = meteredScoring(REFUSED);

    expect(await metered.score(candidateId, { jobOfferId, profileId: created.profile.id })).toEqual({ ok: false, error: "quota_exceeded", refusal: REFUSED });
    expect(await metered.score(candidateId, { jobOfferId, cv: masterCv })).toEqual({ ok: false, error: "quota_exceeded", refusal: REFUSED });
  });

  it("does not count a Guest's Match Scores: Guests have no Plan", async () => {
    const { metered, asked } = meteredScoring(REFUSED);

    expect(await metered.score(null, { jobOfferId, cv: masterCv })).toMatchObject({ ok: true, matchScore: { score: 82 } });
    expect(asked).toEqual([]);
  });

  it("does not count requests it cannot score: invalid, unknown Job Offer, unknown Profile", async () => {
    const { metered, asked } = meteredScoring({ allowed: true, remaining: 2 });

    expect(await metered.score(candidateId, { cv: masterCv })).toMatchObject({ ok: false, error: "invalid" });
    expect(await metered.score(candidateId, { jobOfferId: "00000000-0000-4000-8000-000000000000", cv: masterCv })).toEqual({ ok: false, error: "not_found" });
    expect(await metered.score(candidateId, { jobOfferId, profileId: "00000000-0000-4000-8000-000000000000" })).toEqual({ ok: false, error: "not_found" });

    expect(asked).toEqual([]);
  });
  describe("two phases: the Job Offer's text read by an AI when its structured data is not enough (#94)", () => {
    /** A Capture without JobPosting data: a title and the page text, nothing else. */
    async function textOnlyJobOffer(content = "Chef de projet SI. Type de contrat : CDI. Ville : Lyon. Compétences : IFRS, SAP.") {
      const captured = await jobOffers.capture({ title: "Chef de projet SI H/F", content });
      if (!captured.ok) throw new Error("fixture Job Offer refused");
      return captured.jobOffer.id;
    }
    const searchCriteria = { targetRole: "DAF", locations: ["Lyon"], contractTypes: ["cdi"] };

    function readingScoring(read: OfferTextReader, extra: { textReadTimeoutMs?: number; decision?: QuotaDecision } = {}) {
      const reads: { jobOfferId: string; candidateId: string | null; content: string }[] = [];
      const asked: string[] = [];
      const warnings: string[] = [];
      const reading = createMatchScoring({
        jobOffers,
        profiles,
        matchScoreQuota: async (id) => {
          asked.push(id);
          return extra.decision ?? { allowed: true, remaining: 5 };
        },
        readOfferText: async (jobOffer, candidateId, call) => {
          reads.push({ jobOfferId: jobOffer.id, candidateId, content: jobOffer.content });
          return read(jobOffer, candidateId, call);
        },
        warn: (message) => warnings.push(message),
        ...(extra.textReadTimeoutMs ? { textReadTimeoutMs: extra.textReadTimeoutMs } : {}),
      });
      return { reading, reads, asked, warnings };
    }

    it("reads the details from the offer's text, keeps them on the Job Offer and scores with them, counting one Match Score", async () => {
      const id = await textOnlyJobOffer();
      const { reading, reads, asked } = readingScoring(async () => ({ location: "Lyon", contractType: "cdi", skills: ["IFRS", "SAP"], employer: "Groupe Seb" }));

      const result = await reading.score(candidateId, { jobOfferId: id, cv: masterCv, searchCriteria });

      expect(result).toMatchObject({
        ok: true,
        matchScore: {
          score: 100,
          breakdown: {
            skills: { status: "match", covered: ["IFRS", "SAP"] },
            location: { status: "match", offer: "Lyon" },
            contractType: { status: "match", offer: "cdi" },
          },
        },
      });
      expect(result.ok && result.matchScore.offerTextUnread).toBeUndefined();
      expect(reads).toEqual([{ jobOfferId: id, candidateId, content: expect.stringContaining("Type de contrat") }]);
      expect(asked).toEqual([candidateId]);
      expect(await jobOffers.get(id)).toMatchObject({ employer: "Groupe Seb", location: "Lyon", contractType: "cdi", skills: ["IFRS", "SAP"] });
    });

    it("reads a Job Offer's text once: the next Match Scores, a Guest's included, use what was kept", async () => {
      const id = await textOnlyJobOffer();
      const { reading, reads } = readingScoring(async () => ({ location: "Paris" }));

      await reading.score(candidateId, { jobOfferId: id, cv: masterCv, searchCriteria });
      const again = await reading.score(null, { jobOfferId: id, cv: masterCv });

      expect(reads).toHaveLength(1);
      expect(again).toMatchObject({ ok: true, matchScore: { breakdown: { location: { status: "mismatch", offer: "Paris", wanted: ["Lyon"] } } } });
    });

    it("needs no AI when the structured data gives a reliable score of 70 or more", async () => {
      const { reading, reads } = readingScoring(async () => ({}));

      // The fixture Job Offer states skills, location, contract type and salary: 82 for a Guest.
      expect(await reading.score(null, { jobOfferId, cv: masterCv })).toMatchObject({ ok: true, matchScore: { score: 82 } });
      expect(reads).toEqual([]);
    });

    it("does not read the text when it could not change the score: every criterion the CV can compare is known", async () => {
      const captured = await jobOffers.capture({
        title: "DAF H/F",
        content: "DAF. 30 ans d'expérience.",
        location: "Paris",
        skills: ["Power BI"],
      });
      if (!captured.ok) throw new Error("fixture Job Offer refused");
      const { reading, reads } = readingScoring(async () => ({}));

      // A Guest without Search Criteria: salary and contract type have nothing to compare with.
      const result = await reading.score(null, { jobOfferId: captured.jobOffer.id, cv: masterCv });

      expect(result).toMatchObject({ ok: true, matchScore: { score: 0 } });
      expect(reads).toEqual([]);
    });

    it("falls back to the phase 1 score, flagged, when the AI fails, and reads again next time", async () => {
      const id = await textOnlyJobOffer();
      let fail = true;
      const { reading, reads, asked, warnings } = readingScoring(async () => {
        if (fail) throw new Error("provider down");
        return { location: "Lyon" };
      });

      const failed = await reading.score(candidateId, { jobOfferId: id, cv: masterCv, searchCriteria });
      expect(failed).toMatchObject({ ok: true, matchScore: { offerTextUnread: true, breakdown: { location: { status: "unknown" } } } });
      expect(warnings).toHaveLength(1);

      fail = false;
      const retried = await reading.score(candidateId, { jobOfferId: id, cv: masterCv, searchCriteria });
      expect(retried).toMatchObject({ ok: true, matchScore: { breakdown: { location: { status: "match" } } } });
      expect(reads).toHaveLength(2);
      expect(asked).toEqual([candidateId, candidateId]);
    });

    it("does not keep the Candidate waiting on a slow AI, and keeps what it reads once it answers", async () => {
      const id = await textOnlyJobOffer();
      let answer!: () => void;
      const answered = new Promise<void>((resolve) => (answer = resolve));
      const { reading } = readingScoring(
        async () => {
          await answered;
          return { location: "Lyon" };
        },
        { textReadTimeoutMs: 50 },
      );

      const result = await reading.score(null, { jobOfferId: id, cv: masterCv });
      expect(result).toMatchObject({ ok: true, matchScore: { offerTextUnread: true } });

      answer();
      await expect.poll(async () => (await jobOffers.get(id))?.location).toBe("Lyon");
    });

    describe("records on the AI call reading the text why the Match Score is from the structured data only (#260)", () => {
      /** The AI layer reading the text on a fake provider, as the app wires it (`readOfferFields`). */
      function aiReading(provider: Parameters<typeof createFakeProvider>[0]) {
        const usage = createMemoryUsageLog();
        const ai = createAiLayer({ providers: [createFakeProvider({ id: "mistral", ...provider })], routes: { offer_analysis: "mistral" }, usage, warn: () => {} });
        const read: OfferTextReader = (jobOffer, candidateId, call) => readOfferFields(ai, { candidateId, jobOffer, ...call });
        return { read, usage };
      }

      it("the AI call failed: its own reason, and match_score_text_unread", async () => {
        const id = await textOnlyJobOffer();
        const { read, usage } = aiReading({ fail: new AiProviderError("mistral", "HTTP 503", 503) });

        await readingScoring(read).reading.score(candidateId, { jobOfferId: id, cv: masterCv, searchCriteria });

        expect(usage.entries).toEqual([expect.objectContaining({ task: "offer_analysis", outcome: "failed", reason: "provider_unavailable", warnings: [{ reason: "match_score_text_unread" }] })]);
      });

      it("its reply could not be read: warning match_score_text_unread", async () => {
        const id = await textOnlyJobOffer();
        const { read, usage } = aiReading({ reply: "Je ne peux pas lire cette offre." });

        const result = await readingScoring(read).reading.score(candidateId, { jobOfferId: id, cv: masterCv, searchCriteria });

        expect(result).toMatchObject({ ok: true, matchScore: { offerTextUnread: true } });
        expect(usage.entries).toEqual([expect.objectContaining({ outcome: "warning", reason: "match_score_text_unread", warnings: [{ reason: "match_score_text_unread", detail: "the reply is not a JSON object" }] })]);
      });

      it("it was too slow: the call, recorded once it answers, is warning match_score_too_slow", async () => {
        const id = await textOnlyJobOffer();
        let answer!: () => void;
        const answered = new Promise<void>((resolve) => (answer = resolve));
        const { read, usage } = aiReading({ reply: '{"location": "Lyon"}' });
        const slow: OfferTextReader = async (jobOffer, candidateId, call) => {
          await answered;
          return read(jobOffer, candidateId, call);
        };

        const result = await readingScoring(slow, { textReadTimeoutMs: 50 }).reading.score(null, { jobOfferId: id, cv: masterCv });
        expect(result).toMatchObject({ ok: true, matchScore: { offerTextUnread: true } });

        answer();
        await expect.poll(() => usage.entries.length).toBe(1);
        expect(usage.entries[0]).toMatchObject({ outcome: "warning", reason: "match_score_too_slow", warnings: [{ reason: "match_score_too_slow", detail: "stopped waiting after 50 ms" }] });
      });
    });

    it("never reads the text of a Match Score the Plan Quota refuses", async () => {
      const id = await textOnlyJobOffer();
      const { reading, reads } = readingScoring(async () => ({}), { decision: REFUSED });

      expect(await reading.score(candidateId, { jobOfferId: id, cv: masterCv })).toMatchObject({ ok: false, error: "quota_exceeded" });
      expect(reads).toEqual([]);
    });

    it("never replaces a detail the Job Offer states", async () => {
      const captured = await jobOffers.capture({ title: "DAF H/F", content: "DAF à Lyon.", location: "Lyon" });
      if (!captured.ok) throw new Error("fixture Job Offer refused");
      const { reading } = readingScoring(async () => ({ location: "Marseille", contractType: "cdd" }));

      await reading.score(candidateId, { jobOfferId: captured.jobOffer.id, cv: masterCv, searchCriteria });

      expect(await jobOffers.get(captured.jobOffer.id)).toMatchObject({ location: "Lyon", contractType: "cdd" });
    });
  });
});
