import type { MasterCvContent, Plan } from "@jobhub/shared";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApplications, migrateApplications, type Applications } from "../applications";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import type { MailMessage } from "../auth";
import { createBilling, migrateBilling, type Billing } from "../billing";
import { createJobOffers, migrateJobOffers, type JobOffers } from "../job-offers";
import { createJobSearches, migrateJobSearches, type JobSearches } from "../job-searches";
import { createProfiles, migrateProfiles, type Profiles } from "../profiles";
import { createJobDigests, migrateJobDigests, type JobDigestDiscovery, type JobDigests, type JobDigestsDeps } from "./index";

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

const HOUR = 3_600_000;

/** Job discovery that must not run. */
const noDiscovery: JobDigestDiscovery = async () => {
  throw new Error("Job discovery ran");
};

describe.skipIf(!connectionString)("Job Digests (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let profiles: Profiles;
  let jobOffers: JobOffers;
  let applications: Applications;
  let billing: Billing;
  let jobSearches: JobSearches;
  let jobDigests: JobDigests;
  let outbox: MailMessage[];
  let clock: { now: Date };
  let candidateId: string;
  let otherCandidateId: string;
  let profileId: string;
  let captured: number;

  async function signIn(email: string) {
    const cookie = await signInWithMagicLink(testAuth, email);
    return (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id as string;
  }

  async function createProfile(owner: string, targetRole = "DAF") {
    const created = await profiles.create(owner, { masterCv, searchCriteria: { targetRole, location: "Lyon", contractType: "cdi" } });
    if (!created.ok) throw new Error("fixture Profile refused");
    return created.profile.id;
  }

  /** A Job Offer stored now (on the test clock), by a Candidate unless `guest`. */
  async function capture(title: string, details: object = {}, options: { guest?: boolean; storedAt?: Date } = {}) {
    captured++;
    const result = await jobOffers.capture(
      { source: { url: `https://carrieres.example.fr/${encodeURIComponent(title)}/${captured}` }, title, content: `${title} (${captured}). Poste à pourvoir.`, ...details },
      options.guest ? "guest" : "candidate",
    );
    if (!result.ok) throw new Error("fixture Job Offer refused");
    await database.query("UPDATE job_offer SET created_at = $2 WHERE id = $1", [result.jobOffer.id, options.storedAt ?? clock.now]);
    return result.jobOffer.id;
  }

  /** A Job Offer that fits the Profile: Match Score 100. */
  const strong = (title: string, options?: { guest?: boolean; storedAt?: Date }) =>
    capture(title, { employer: "Acme Industrie", location: "Lyon", contractType: "cdi", skills: ["IFRS", "SAP"] }, options);
  /** A Job Offer that does not: Match Score 0. */
  const weak = (title: string) => capture(title, { location: "Marseille", contractType: "cdd", skills: ["Excel"] });

  /** Puts the Candidate on a Plan, as the Stripe webhook would. */
  async function onPlan(owner: string, plan: Plan) {
    await database.query(
      `INSERT INTO candidate_plan (candidate_id, plan) VALUES ($1, $2) ON CONFLICT (candidate_id) DO UPDATE SET plan = $2`,
      [owner, plan],
    );
  }

  async function subscribed(frequency: "daily" | "weekly" = "weekly", owner = candidateId, profile = profileId) {
    const result = await jobDigests.subscribe(owner, profile, frequency);
    if (!result.ok) throw new Error(`fixture subscription refused: ${JSON.stringify(result)}`);
  }

  function digestsWith(config: Partial<Pick<JobDigestsDeps, "minMatchScore" | "targetCount" | "firstLookBackDays">>): JobDigests {
    return createJobDigests(database, {
      profiles,
      jobOffers,
      applications,
      billing,
      mailer: { send: async (message) => void outbox.push(message) },
      baseURL: "https://app.jobbbox.fr",
      now: () => clock.now,
      ...config,
    });
  }

  const at = (iso: string) => (clock.now = new Date(iso));
  const later = (hours: number) => (clock.now = new Date(clock.now.getTime() + hours * HOUR));

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.auth.options.database as Pool;
    await migrateProfiles(database);
    await migrateJobOffers(database);
    await migrateApplications(database);
    await migrateBilling(database);
    await migrateJobSearches(database);
    await migrateJobDigests(database);
    // A Thursday, in French summer time.
    clock = { now: new Date("2026-10-15T08:00:00+02:00") };
    captured = 0;
    profiles = createProfiles(database);
    jobOffers = createJobOffers(database);
    applications = createApplications(database, { jobOffers, profiles });
    billing = createBilling({ database, baseURL: "http://localhost:3000", now: () => clock.now });
    jobSearches = createJobSearches(database, {
      profiles,
      jobOffers,
      applications,
      quotas: billing,
      queue: { send: async () => {} },
      now: () => clock.now,
    });
    outbox = [];
    jobDigests = digestsWith({});
    candidateId = await signIn("marie.dupont@example.fr");
    otherCandidateId = await signIn("paul.martin@example.fr");
    profileId = await createProfile(candidateId);
    await onPlan(candidateId, "standard");
  });
  afterEach(async () => {
    await testAuth.stop();
  });

  describe("opting in", () => {
    it("is off until the Candidate opts in for a Profile, at the frequency they pick within their Plan", async () => {
      expect(await jobDigests.settings(candidateId, profileId)).toMatchObject({ subscribed: false, chosenFrequency: null, planFrequency: "weekly", digests: [] });

      expect(await jobDigests.subscribe(candidateId, profileId, "weekly")).toMatchObject({ ok: true });
      expect(await jobDigests.settings(candidateId, profileId)).toMatchObject({ subscribed: true, chosenFrequency: "weekly", frequency: "weekly" });

      // A better Plan does not change what the Candidate picked; they may now pick daily.
      await onPlan(candidateId, "premium");
      expect(await jobDigests.settings(candidateId, profileId)).toMatchObject({ subscribed: true, frequency: "weekly", planFrequency: "daily" });
      expect(await jobDigests.subscribe(candidateId, profileId, "daily")).toMatchObject({ ok: true, settings: { frequency: "daily" } });
    });

    it("refuses, server-side, a frequency above the Plan's, naming the Plan that includes it", async () => {
      expect(await jobDigests.subscribe(candidateId, profileId, "daily")).toEqual({
        ok: false,
        error: "above_plan",
        plan: "standard",
        planFrequency: "weekly",
        upgradeTo: "premium",
      });
      expect(await jobDigests.settings(candidateId, profileId)).toMatchObject({ subscribed: false, chosenFrequency: null });

      expect(await jobDigests.subscribe(candidateId, profileId, "hourly")).toEqual({ ok: false, error: "invalid_frequency" });
      expect(await jobDigests.subscribe(candidateId, profileId, undefined)).toEqual({ ok: false, error: "invalid_frequency" });
    });

    it("is per Profile", async () => {
      const otherProfile = await createProfile(candidateId, "Consultant transformation");
      await subscribed();

      expect(await jobDigests.settings(candidateId, otherProfile)).toMatchObject({ subscribed: false });
    });

    it("is refused on a Plan without the Job Digest, naming the Plan that includes it", async () => {
      await onPlan(candidateId, "free");

      expect(await jobDigests.subscribe(candidateId, profileId, "weekly")).toEqual({ ok: false, error: "not_included", plan: "free", upgradeTo: "standard" });
      expect(await jobDigests.settings(candidateId, profileId)).toMatchObject({ subscribed: false, frequency: "none", planFrequency: "none", upgradeTo: "standard" });
    });

    it("only for the Candidate's own, active Profiles", async () => {
      const othersProfile = await createProfile(otherCandidateId);
      expect(await jobDigests.subscribe(candidateId, othersProfile, "weekly")).toEqual({ ok: false, error: "not_found" });
      expect(await jobDigests.settings(candidateId, othersProfile)).toBeNull();
      expect(await jobDigests.subscribe(candidateId, "not-a-profile", "weekly")).toEqual({ ok: false, error: "not_found" });

      await profiles.archive(candidateId, profileId);
      expect(await jobDigests.subscribe(candidateId, profileId, "weekly")).toEqual({ ok: false, error: "archived" });
    });

    it("is not received while the Plan has none, and the Candidate's choice is kept for when it does again", async () => {
      await onPlan(candidateId, "premium");
      await subscribed("daily");

      await onPlan(candidateId, "free");
      expect(await jobDigests.settings(candidateId, profileId)).toMatchObject({ subscribed: false, chosenFrequency: "daily", frequency: "none", upgradeTo: "standard" });

      // Lowered from daily to weekly: sent weekly.
      await onPlan(candidateId, "standard");
      expect(await jobDigests.settings(candidateId, profileId)).toMatchObject({ subscribed: true, chosenFrequency: "daily", frequency: "weekly" });
      await onPlan(candidateId, "premium");
      expect(await jobDigests.settings(candidateId, profileId)).toMatchObject({ subscribed: true, frequency: "daily" });
    });

    it("can be undone from the app", async () => {
      await subscribed();

      await jobDigests.unsubscribe(candidateId, profileId);

      expect(await jobDigests.settings(candidateId, profileId)).toMatchObject({ subscribed: false, chosenFrequency: null });
    });
  });

  describe("selecting Job Offers", () => {
    it("picks the Job Offers stored since the last Job Digest whose Match Score reaches the threshold, best first, whoever stored them", async () => {
      const best = await strong("DAF H/F");
      const atThreshold = await capture("Responsable financier", { location: "Lyon", contractType: "cdd", skills: ["IFRS", "SAP", "Excel"] });
      await capture("Comptable", { location: "Lyon", contractType: "cdd", skills: ["IFRS", "Excel"] });
      await weak("Contrôleur de gestion");
      await subscribed();

      const { digest, discovery } = await jobDigests.deliver(candidateId, profileId, async () => []);

      expect(digest?.results.map(({ jobOffer, matchScore }) => [jobOffer.id, matchScore.score])).toEqual([
        [best, 100],
        [atThreshold, 60],
      ]);
      // Two qualified, fewer than the target count (10): Job discovery topped up.
      expect(discovery).toBe("ran");
    });

    it("looks back a week for the first Job Digest, then only at the Job Offers stored since the previous one", async () => {
      await strong("Trop ancienne", { storedAt: new Date(clock.now.getTime() - 8 * 24 * HOUR) });
      const lastWeek = await strong("De la semaine", { storedAt: new Date(clock.now.getTime() - 6 * 24 * HOUR) });
      await subscribed();
      const first = await jobDigests.deliver(candidateId, profileId, async () => []);
      expect(first.digest?.results.map((result) => result.jobOffer.id)).toEqual([lastWeek]);

      later(24);
      await strong("Avant le premier Job Digest", { storedAt: new Date(clock.now.getTime() - 25 * HOUR) });
      const since = await strong("Depuis");
      const second = await jobDigests.deliver(candidateId, profileId, async () => []);

      expect(second.digest?.results.map((result) => result.jobOffer.id)).toEqual([since]);
    });

    it("looks back as many days as configured for the first Job Digest: none, and it is what Job discovery finds", async () => {
      jobDigests = digestsWith({ firstLookBackDays: 0 });
      // Stored an hour ago, by another Candidate as much as by this one: before the first Job Digest's pool.
      for (const title of ["DAF 1", "DAF 2", "DAF 3"]) await strong(title, { storedAt: new Date(clock.now.getTime() - HOUR) });
      await subscribed();
      const found = await strong("Trouvée par Job discovery");

      const { digest, discovery } = await jobDigests.deliver(candidateId, profileId, async () => [found]);

      expect(discovery).toBe("ran");
      expect(digest?.results.map((result) => result.jobOffer.id)).toEqual([found]);
    });

    it("leaves out Guest-only and Expired Job Offers, and those already shown: in a Job Digest, a Job Search, or saved as an Application", async () => {
      const inDigest = await strong("Déjà dans un Job Digest");
      await subscribed();
      await jobDigests.deliver(candidateId, profileId, async () => []);
      later(1);
      const guestOnly = await strong("Capturée par un invité", { guest: true });
      const expired = await strong("Expirée");
      await database.query("UPDATE job_offer SET expired_at = $2 WHERE id = $1", [expired, clock.now]);
      const saved = await strong("Enregistrée");
      const application = await applications.save(candidateId, { jobOfferId: saved, profileId });
      if (!application.ok) throw new Error("fixture Application refused");
      const searched = await strong("Vue dans une recherche");
      const started = await jobSearches.start(candidateId, { profileId });
      if (!started.ok) throw new Error("fixture Job Search refused");
      await jobSearches.record(started.jobSearch.id, { jobOfferIds: [searched] });
      const fresh = await strong("Nouvelle");

      // Job discovery finds them all again: still left out.
      const { digest } = await jobDigests.deliver(candidateId, profileId, async () => [inDigest, guestOnly, expired, saved, searched, fresh]);

      expect(digest?.results.map((result) => result.jobOffer.id)).toEqual([fresh]);
    });

    it("runs Job discovery only when the stored Job Offers give fewer than the target count", async () => {
      jobDigests = digestsWith({ targetCount: 2 });
      await subscribed();
      const pooled = [await strong("DAF 1"), await strong("DAF 2")];
      const discover = vi.fn(noDiscovery);

      const enough = await jobDigests.deliver(candidateId, profileId, discover);

      expect(discover).not.toHaveBeenCalled();
      expect(enough).toMatchObject({ discovery: "not_run" });
      expect(enough.digest?.results.map((result) => result.jobOffer.id).sort()).toEqual([...pooled].sort());

      later(24);
      const pooledAgain = await strong("DAF 3");
      // Found by Job discovery: scored the same way, and only kept above the threshold.
      const foundWeak = await weak("Trouvée, mais loin");
      const short = await jobDigests.deliver(candidateId, profileId, async () => {
        const found = await strong("DAF trouvée", { storedAt: new Date(clock.now.getTime() + 1) });
        return [found, foundWeak];
      });

      expect(short.discovery).toBe("ran");
      expect(short.digest?.results).toHaveLength(2);
      expect(short.digest?.results.map((result) => result.jobOffer.title)).toContain("DAF trouvée");
      expect(short.digest?.results.map((result) => result.jobOffer.id)).toContain(pooledAgain);
    });

    it("keeps at most the target count, and emails the top 10", async () => {
      jobDigests = digestsWith({ targetCount: 12 });
      await subscribed();
      for (let n = 0; n < 13; n++) await strong(`DAF ${n}`);

      const { digest } = await jobDigests.deliver(candidateId, profileId, noDiscovery);

      expect(digest?.results).toHaveLength(12);
      expect(outbox[0]!.subject).toContain("12 nouvelles offres");
      expect(outbox[0]!.text.match(/^- DAF/gm)).toHaveLength(10);
    });

    it("applies the Match Score threshold it is given", async () => {
      jobDigests = digestsWith({ minMatchScore: 50 });
      const half = await capture("Comptable", { location: "Lyon", contractType: "cdd", skills: ["IFRS", "Excel"] });
      await subscribed();

      const { digest } = await jobDigests.deliver(candidateId, profileId, async () => []);

      expect(digest?.results.map(({ jobOffer, matchScore }) => [jobOffer.id, matchScore.score])).toEqual([[half, 50]]);
    });

    it("sends what the stored Job Offers gave when Job discovery fails, and nothing when they gave nothing", async () => {
      const pooled = await strong("DAF H/F");
      await subscribed();
      const failing = async () => {
        throw new Error("Perplexity answered 503");
      };

      const partial = await jobDigests.deliver(candidateId, profileId, failing);

      expect(partial).toMatchObject({ discovery: "failed" });
      expect(partial.digest?.results.map((result) => result.jobOffer.id)).toEqual([pooled]);
      expect(outbox).toHaveLength(1);

      later(24);
      expect(await jobDigests.deliver(candidateId, profileId, failing)).toEqual({ digest: null, discovery: "failed" });
      expect(outbox).toHaveLength(1);
    });

    it("makes no Job Digest and sends no email when nothing qualifies", async () => {
      await weak("Contrôleur de gestion");
      await subscribed();

      expect(await jobDigests.deliver(candidateId, profileId, async () => [await weak("Assistant comptable")])).toEqual({ digest: null, discovery: "ran" });
      expect(outbox).toEqual([]);
      expect((await jobDigests.settings(candidateId, profileId))?.digests).toEqual([]);
    });

    it("uses none of the Candidate's Match Score or Job Search Plan Quota", async () => {
      await onPlan(candidateId, "free");
      await database.query("UPDATE plan_quota SET job_digest = 'weekly' WHERE plan = 'free'");
      await strong("DAF H/F");
      await subscribed();

      const { digest } = await jobDigests.deliver(candidateId, profileId, async () => [await strong("DAF trouvée")]);

      expect(digest?.results).toHaveLength(2);
      expect((await billing.entitlements(candidateId)).usedThisMonth).toMatchObject({ matchScores: 0, jobSearches: 0 });
    });

    it("does nothing, Job discovery included, when the Candidate did not opt in, their Plan has none, or the Profile is archived", async () => {
      await strong("DAF H/F");
      const discover = vi.fn(noDiscovery);
      expect(await jobDigests.deliver(candidateId, profileId, discover)).toEqual({ digest: null, discovery: "not_run" });

      await subscribed();
      await onPlan(candidateId, "free");
      expect(await jobDigests.deliver(candidateId, profileId, discover)).toEqual({ digest: null, discovery: "not_run" });

      await onPlan(candidateId, "standard");
      await profiles.archive(candidateId, profileId);
      expect(await jobDigests.deliver(candidateId, profileId, discover)).toEqual({ digest: null, discovery: "not_run" });
      expect(discover).not.toHaveBeenCalled();
      expect(outbox).toEqual([]);
    });
  });

  describe("the Job Digest", () => {
    it("is a page of its Job Offers ranked by Match Score, linked from the email and listed on the Profile", async () => {
      const best = await strong("DAF H/F");
      const second = await capture("Responsable financier", { location: "Lyon", contractType: "cdd", skills: ["IFRS", "SAP", "Excel"] });
      await subscribed();
      const { digest } = await jobDigests.deliver(candidateId, profileId, async () => []);
      const application = await applications.save(candidateId, { jobOfferId: second, profileId });
      if (!application.ok) throw new Error("fixture Application refused");

      const page = await jobDigests.get(candidateId, digest!.id);

      expect(page).toMatchObject({
        id: digest!.id,
        profile: { id: profileId, name: expect.any(String) },
        sentAt: clock.now,
        results: [
          { jobOffer: { id: best }, matchScore: { score: 100 }, applicationId: null },
          { jobOffer: { id: second }, matchScore: { score: 60 }, applicationId: application.application.id },
        ],
      });
      expect((await jobDigests.settings(candidateId, profileId))?.digests).toEqual([{ id: digest!.id, sentAt: clock.now, count: 2 }]);
      const email = outbox[0]!;
      expect(email).toMatchObject({ to: "marie.dupont@example.fr", subject: expect.stringContaining("2 nouvelles offres") });
      expect(email.text).toContain(`https://app.jobbbox.fr/job-digests/${digest!.id}`);
      expect(email.text).toContain(`https://app.jobbbox.fr/offres/${best}`);
      expect(email.text.indexOf("DAF H/F")).toBeLessThan(email.text.indexOf("Responsable financier"));
      expect(email.text).toContain("- DAF H/F (Acme Industrie, Lyon)");
    });

    it("belongs to its Candidate", async () => {
      await strong("DAF H/F");
      await subscribed();
      const { digest } = await jobDigests.deliver(candidateId, profileId, async () => []);

      expect(await jobDigests.get(otherCandidateId, digest!.id)).toBeNull();
      expect(await jobDigests.get(candidateId, "not-a-digest")).toBeNull();
      expect(await jobDigests.deliver(otherCandidateId, profileId, noDiscovery)).toEqual({ digest: null, discovery: "not_run" });
      expect(await jobDigests.settings(otherCandidateId, profileId)).toBeNull();
    });

    it("is emailed in the Candidate's Interface Language, with an unsubscribe link and one-click unsubscribe headers", async () => {
      await database.query(`UPDATE candidate SET "interfaceLanguage" = 'en' WHERE id = $1`, [candidateId]);
      await strong("DAF H/F");
      await subscribed();

      await jobDigests.deliver(candidateId, profileId, async () => []);

      const email = outbox[0]!;
      expect(email.subject).toContain("1 new job offer");
      const unsubscribeUrl = email.headers?.["List-Unsubscribe"]?.match(/^<(https:\/\/app\.jobbbox\.fr\/[^>]+)>$/)?.[1];
      expect(unsubscribeUrl).toBeDefined();
      expect(email.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
      const token = new URL(unsubscribeUrl!).searchParams.get("token")!;
      expect(email.text).toContain(`https://app.jobbbox.fr/desabonnement?token=${token}&lang=en`);

      expect(await jobDigests.unsubscribeByToken(token)).toBe(true);
      expect(await jobDigests.settings(candidateId, profileId)).toMatchObject({ subscribed: false });
      expect(await jobDigests.unsubscribeByToken(token)).toBe(false);
      expect(await jobDigests.unsubscribeByToken("forged")).toBe(false);
    });
  });

  describe("scheduling", () => {
    it("daily: at 07:00 Europe/Paris, not right after opting in", async () => {
      await onPlan(candidateId, "premium");
      await subscribed("daily");

      expect(await jobDigests.claimDue()).toEqual([]);
      at("2026-10-16T06:59:00+02:00");
      expect(await jobDigests.claimDue()).toEqual([]);
      at("2026-10-16T07:00:00+02:00");
      expect(await jobDigests.claimDue()).toEqual([{ candidateId, profileId }]);
      expect(await jobDigests.claimDue()).toEqual([]);
      at("2026-10-16T23:00:00+02:00");
      expect(await jobDigests.claimDue()).toEqual([]);
      at("2026-10-17T07:00:00+02:00");
      expect(await jobDigests.claimDue()).toEqual([{ candidateId, profileId }]);
    });

    it("weekly: on Monday at 07:00 Europe/Paris", async () => {
      await subscribed("weekly");

      for (const day of ["2026-10-16", "2026-10-17", "2026-10-18"]) {
        at(`${day}T07:00:00+02:00`);
        expect(await jobDigests.claimDue()).toEqual([]);
      }
      at("2026-10-19T07:00:00+02:00");
      expect(await jobDigests.claimDue()).toEqual([{ candidateId, profileId }]);
      at("2026-10-20T07:00:00+02:00");
      expect(await jobDigests.claimDue()).toEqual([]);
      // Winter time from 25 October.
      at("2026-10-26T07:00:00+01:00");
      expect(await jobDigests.claimDue()).toEqual([{ candidateId, profileId }]);
    });

    it("a daily choice is sent weekly once the Plan is lowered to weekly", async () => {
      await onPlan(candidateId, "premium");
      await subscribed("daily");
      at("2026-10-16T07:00:00+02:00");
      expect(await jobDigests.claimDue()).toEqual([{ candidateId, profileId }]);

      await onPlan(candidateId, "standard");
      for (const day of ["2026-10-17", "2026-10-18"]) {
        at(`${day}T07:00:00+02:00`);
        expect(await jobDigests.claimDue()).toEqual([]);
      }
      at("2026-10-19T07:00:00+02:00");
      expect(await jobDigests.claimDue()).toEqual([{ candidateId, profileId }]);
      at("2026-10-20T07:00:00+02:00");
      expect(await jobDigests.claimDue()).toEqual([]);
    });

    it("is not due again sooner by opting out and in again", async () => {
      await subscribed("weekly");
      at("2026-10-19T07:00:00+02:00");
      expect(await jobDigests.claimDue()).toEqual([{ candidateId, profileId }]);
      later(3);

      await jobDigests.unsubscribe(candidateId, profileId);
      await subscribed("weekly");
      expect(await jobDigests.claimDue()).toEqual([]);

      await strong("DAF H/F");
      await jobDigests.deliver(candidateId, profileId, async () => []);
      const token = new URL(outbox.at(-1)!.headers!["List-Unsubscribe"]!.slice(1, -1)).searchParams.get("token")!;
      await jobDigests.unsubscribeByToken(token);
      later(24);
      await subscribed("weekly");
      expect(await jobDigests.claimDue()).toEqual([]);

      at("2026-10-26T06:59:00+01:00");
      expect(await jobDigests.claimDue()).toEqual([]);
      at("2026-10-26T07:00:00+01:00");
      expect(await jobDigests.claimDue()).toEqual([{ candidateId, profileId }]);
    });

    it("skips Profiles whose Plan no longer includes the Job Digest, or that were archived, and takes them back when the Plan does", async () => {
      const archived = await createProfile(candidateId, "Consultant transformation");
      await subscribed("weekly", candidateId, archived);
      await profiles.archive(candidateId, archived);
      await subscribed();
      await onPlan(candidateId, "free");

      at("2026-10-19T07:00:00+02:00");
      expect(await jobDigests.claimDue()).toEqual([]);

      await onPlan(candidateId, "standard");
      expect(await jobDigests.claimDue()).toEqual([{ candidateId, profileId }]);
    });
  });
});
