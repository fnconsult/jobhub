import type { MasterCvContent, Plan } from "@jobhub/shared";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApplications, migrateApplications, type Applications } from "../applications";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import type { MailMessage } from "../auth";
import { createBilling, migrateBilling, type Billing } from "../billing";
import { createJobOffers, migrateJobOffers, type JobOffers } from "../job-offers";
import { createJobSearches, migrateJobSearches, type JobSearches } from "../job-searches";
import { createProfiles, migrateProfiles, type Profiles } from "../profiles";
import { createJobDigests, migrateJobDigests, type JobDigests } from "./index";

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

  async function signIn(email: string) {
    const cookie = await signInWithMagicLink(testAuth, email);
    return (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id as string;
  }

  async function createProfile(owner: string, targetRole = "DAF") {
    const created = await profiles.create(owner, { masterCv, searchCriteria: { targetRole, location: "Lyon", contractType: "cdi" } });
    if (!created.ok) throw new Error("fixture Profile refused");
    return created.profile.id;
  }

  async function capture(title: string, details: object = {}) {
    const captured = await jobOffers.capture({ source: { url: `https://carrieres.example.fr/${encodeURIComponent(title)}` }, title, content: `${title}. Poste à pourvoir.`, ...details });
    if (!captured.ok) throw new Error("fixture Job Offer refused");
    return captured.jobOffer.id;
  }

  /** Puts the Candidate on a Plan, as the Stripe webhook would. */
  async function onPlan(owner: string, plan: Plan) {
    await database.query(
      `INSERT INTO candidate_plan (candidate_id, plan) VALUES ($1, $2) ON CONFLICT (candidate_id) DO UPDATE SET plan = $2`,
      [owner, plan],
    );
  }

  async function subscribed(owner = candidateId, profile = profileId) {
    const result = await jobDigests.subscribe(owner, profile);
    if (!result.ok) throw new Error(`fixture subscription refused: ${JSON.stringify(result)}`);
  }

  async function deliverOne(): Promise<MailMessage> {
    await jobDigests.deliver(candidateId, profileId, [await capture(`DAF ${outbox.length}`, { location: "Lyon" })]);
    return outbox.at(-1)!;
  }

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
    clock = { now: new Date("2026-10-15T08:00:00+02:00") };
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
    jobDigests = createJobDigests(database, {
      profiles,
      jobOffers,
      applications,
      billing,
      mailer: { send: async (message) => void outbox.push(message) },
      baseURL: "https://app.jobbbox.fr",
      now: () => clock.now,
    });
    candidateId = await signIn("marie.dupont@example.fr");
    otherCandidateId = await signIn("paul.martin@example.fr");
    profileId = await createProfile(candidateId);
    await onPlan(candidateId, "standard");
  });
  afterEach(async () => {
    await testAuth.stop();
  });

  describe("opting in", () => {
    it("is off until the Candidate opts in for a Profile, then sent as often as their Plan allows", async () => {
      expect(await jobDigests.settings(candidateId, profileId)).toMatchObject({ subscribed: false, frequency: "weekly", digests: [] });

      expect(await jobDigests.subscribe(candidateId, profileId)).toMatchObject({ ok: true });

      expect(await jobDigests.settings(candidateId, profileId)).toMatchObject({ subscribed: true, frequency: "weekly" });
      await onPlan(candidateId, "premium");
      expect(await jobDigests.settings(candidateId, profileId)).toMatchObject({ subscribed: true, frequency: "daily" });
    });

    it("is per Profile", async () => {
      const otherProfile = await createProfile(candidateId, "Consultant transformation");
      await subscribed();

      expect(await jobDigests.settings(candidateId, otherProfile)).toMatchObject({ subscribed: false });
    });

    it("is refused on a Plan without the Job Digest, naming the Plan that includes it", async () => {
      await onPlan(candidateId, "free");

      expect(await jobDigests.subscribe(candidateId, profileId)).toEqual({ ok: false, error: "not_included", plan: "free", upgradeTo: "standard" });
      expect(await jobDigests.settings(candidateId, profileId)).toMatchObject({ subscribed: false, frequency: "none", upgradeTo: "standard" });
    });

    it("only for the Candidate's own, active Profiles", async () => {
      const othersProfile = await createProfile(otherCandidateId);
      expect(await jobDigests.subscribe(candidateId, othersProfile)).toEqual({ ok: false, error: "not_found" });
      expect(await jobDigests.settings(candidateId, othersProfile)).toBeNull();
      expect(await jobDigests.subscribe(candidateId, "not-a-profile")).toEqual({ ok: false, error: "not_found" });

      await profiles.archive(candidateId, profileId);
      expect(await jobDigests.subscribe(candidateId, profileId)).toEqual({ ok: false, error: "archived" });
    });

    it("is not received any more once the Candidate's Plan no longer includes it", async () => {
      await subscribed();

      await onPlan(candidateId, "free");

      expect(await jobDigests.settings(candidateId, profileId)).toMatchObject({ subscribed: false, frequency: "none", upgradeTo: "standard" });
      await onPlan(candidateId, "standard");
      expect(await jobDigests.settings(candidateId, profileId)).toMatchObject({ subscribed: true, frequency: "weekly" });
    });

    it("can be undone from the app", async () => {
      await subscribed();

      await jobDigests.unsubscribe(candidateId, profileId);

      expect(await jobDigests.settings(candidateId, profileId)).toMatchObject({ subscribed: false });
    });
  });
  describe("delivering", () => {
    it("emails the new Job Offers found, best Match Score first, and keeps them for the Profile page", async () => {
      const weak = await capture("Contrôleur de gestion", { location: "Marseille", contractType: "cdd", skills: ["Excel"] });
      const strong = await capture("DAF H/F", { employer: "Acme Industrie", location: "Lyon", contractType: "cdi", skills: ["IFRS", "SAP"] });
      await subscribed();

      const digest = await jobDigests.deliver(candidateId, profileId, [weak, strong]);

      expect(digest?.results.map((result) => result.jobOffer.title)).toEqual(["DAF H/F", "Contrôleur de gestion"]);
      expect(outbox).toHaveLength(1);
      expect(outbox[0]).toMatchObject({ to: "marie.dupont@example.fr", subject: expect.stringContaining("2 nouvelles offres") });
      expect(outbox[0]!.text).toContain(`https://app.jobbbox.fr/offres/${strong}`);
      expect(outbox[0]!.text.indexOf("DAF H/F")).toBeLessThan(outbox[0]!.text.indexOf("Contrôleur de gestion"));
      expect((await jobDigests.settings(candidateId, profileId))?.digests).toMatchObject([
        { id: digest!.id, sentAt: clock.now, results: [{ jobOffer: { id: strong }, matchScore: { score: 100 } }, { jobOffer: { id: weak } }] },
      ]);
    });

    it("only lists Job Offers not shown before: in an earlier Job Digest of the Profile, or saved as an Application", async () => {
      const first = await capture("DAF H/F", { location: "Lyon" });
      const saved = await capture("Directeur financier", { location: "Lyon" });
      const fresh = await capture("Responsable financier", { location: "Lyon" });
      await subscribed();
      await jobDigests.deliver(candidateId, profileId, [first]);
      const application = await applications.save(candidateId, { jobOfferId: saved, profileId });
      if (!application.ok) throw new Error("fixture Application refused");

      const digest = await jobDigests.deliver(candidateId, profileId, [first, saved, fresh, fresh]);

      expect(digest?.results.map((result) => result.jobOffer.id)).toEqual([fresh]);
      expect(await jobDigests.deliver(candidateId, profileId, [first, saved, fresh])).toBeNull();
      expect(outbox).toHaveLength(2);
    });

    it("does not list again the Job Offers a Job Search of the Profile already showed the Candidate", async () => {
      const seen = await capture("DAF H/F", { location: "Lyon" });
      const fresh = await capture("Responsable financier", { location: "Lyon" });
      await subscribed();
      const started = await jobSearches.start(candidateId, { profileId });
      if (!started.ok) throw new Error("fixture Job Search refused");
      await jobSearches.record(started.jobSearch.id, { jobOfferIds: [seen] });

      const digest = await jobDigests.deliver(candidateId, profileId, [seen, fresh]);

      expect(digest?.results.map((result) => result.jobOffer.id)).toEqual([fresh]);
    });

    it("sends nothing when nothing is new, the Candidate did not opt in, or their Plan no longer includes it", async () => {
      const jobOfferId = await capture("DAF H/F", { location: "Lyon" });
      expect(await jobDigests.deliver(candidateId, profileId, [jobOfferId])).toBeNull();

      await subscribed();
      expect(await jobDigests.deliver(candidateId, profileId, [])).toBeNull();
      expect(await jobDigests.deliver(candidateId, profileId, ["not-a-job-offer", "6f1c3d1e-0000-4000-8000-000000000000"])).toBeNull();

      await onPlan(candidateId, "free");
      expect(await jobDigests.deliver(candidateId, profileId, [jobOfferId])).toBeNull();
      expect(outbox).toEqual([]);
    });

    it("writes the email in the Candidate's Interface Language, with an unsubscribe link and one-click unsubscribe headers", async () => {
      await database.query(`UPDATE candidate SET "interfaceLanguage" = 'en' WHERE id = $1`, [candidateId]);
      await subscribed();

      await jobDigests.deliver(candidateId, profileId, [await capture("DAF H/F", { location: "Lyon" })]);

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

    it("keeps each Candidate's Job Digests to themselves", async () => {
      await subscribed();
      await jobDigests.deliver(candidateId, profileId, [await capture("DAF H/F", { location: "Lyon" })]);

      expect(await jobDigests.deliver(otherCandidateId, profileId, [await capture("DAF Lyon")])).toBeNull();
      expect(await jobDigests.settings(otherCandidateId, profileId)).toBeNull();
    });
  });

  describe("scheduling", () => {
    it("is due right after opting in, then once per period of the Candidate's Plan", async () => {
      await subscribed();

      expect(await jobDigests.claimDue()).toEqual([{ candidateId, profileId }]);
      expect(await jobDigests.claimDue()).toEqual([]);

      later(6 * 24 + 23);
      expect(await jobDigests.claimDue()).toEqual([{ candidateId, profileId }]);

      await onPlan(candidateId, "premium");
      later(23);
      expect(await jobDigests.claimDue()).toEqual([{ candidateId, profileId }]);
      later(12);
      expect(await jobDigests.claimDue()).toEqual([]);
    });

    it("is not due again sooner by opting out and in again", async () => {
      await subscribed();
      expect(await jobDigests.claimDue()).toEqual([{ candidateId, profileId }]);
      later(1);

      await jobDigests.unsubscribe(candidateId, profileId);
      await subscribed();
      expect(await jobDigests.claimDue()).toEqual([]);

      const token = new URL((await deliverOne()).headers!["List-Unsubscribe"]!.slice(1, -1)).searchParams.get("token")!;
      await jobDigests.unsubscribeByToken(token);
      await subscribed();
      expect(await jobDigests.claimDue()).toEqual([]);

      later(6 * 24 + 21);
      expect(await jobDigests.claimDue()).toEqual([]);
      later(1);
      expect(await jobDigests.claimDue()).toEqual([{ candidateId, profileId }]);
    });

    it("skips Profiles whose Plan no longer includes the Job Digest, or that were archived", async () => {
      const archived = await createProfile(candidateId, "Consultant transformation");
      await subscribed(candidateId, archived);
      await profiles.archive(candidateId, archived);
      await subscribed();
      await onPlan(candidateId, "free");

      expect(await jobDigests.claimDue()).toEqual([]);
    });
  });
});
