import type { MasterCvContent } from "@jobhub/shared";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApplications, migrateApplications, type Applications } from "../applications";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { createJobOffers, migrateJobOffers } from "../job-offers";
import { createProfiles, migrateProfiles, type Profiles } from "../profiles";
import type { ApplicationTailoredCv } from "../tailored-cv";
import type { ApplicationDrafts } from "../tailored-documents";
import { createHumanCoaches, migrateHumanCoaches, type HumanCoach, type HumanCoaches } from "./index";

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

const SOPHIE = { name: "Sophie Martin", email: "sophie.martin@rh-conseil.fr", bookingUrl: "https://cal.com/sophie-martin/seance" };

describe.skipIf(!connectionString)("Human Coaches (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let coaches: HumanCoaches;
  let profiles: Profiles;
  let applications: Applications;
  /** The Tailored Documents of each Application, as their modules would give them to the Candidate. */
  let drafts: Map<string, ApplicationDrafts>;
  let tailoredCvs: Map<string, ApplicationTailoredCv>;

  async function signUp(email: string) {
    const cookie = await signInWithMagicLink(testAuth, email);
    return (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id as string;
  }

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.auth.options.database as Pool;
    await migrateProfiles(database);
    await migrateJobOffers(database);
    await migrateApplications(database);
    await migrateHumanCoaches(database);
    profiles = createProfiles(database);
    const jobOffers = createJobOffers(database);
    applications = createApplications(database, { jobOffers, profiles });
    drafts = new Map();
    tailoredCvs = new Map();
    coaches = createHumanCoaches(database, {
      profiles,
      applications,
      tailoredDocuments: { get: async (owner, id) => ((await applications.get(owner, id)) ? (drafts.get(id) ?? null) : null) },
      tailoredCvs: { get: async (owner, id) => ((await applications.get(owner, id)) ? (tailoredCvs.get(id) ?? null) : null) },
    });
    jobOfferId = async () => {
      const captured = await jobOffers.capture({ source: { url: "https://www.apec.fr/offre/1" }, title: "DAF H/F", content: "Nous recherchons un DAF pour un groupe industriel à Lyon, avec 15 ans d'expérience.", employer: "Acme Industrie" });
      if (!captured.ok) throw new Error("fixture refused");
      return captured.jobOffer.id;
    };
  }, 60_000);
  afterEach(async () => {
    await testAuth.stop();
  }, 60_000);

  let jobOfferId: () => Promise<string>;

  /** A Candidate with one Profile and one Application. */
  async function candidateWithApplication(email: string) {
    const id = await signUp(email);
    const profile = await profiles.create(id, { masterCv, searchCriteria: { targetRole: "DAF", location: "Lyon" } });
    if (!profile.ok) throw new Error("fixture refused");
    const saved = await applications.save(id, { jobOfferId: await jobOfferId(), profileId: profile.profile.id });
    if (!saved.ok) throw new Error("fixture refused");
    return { id, profileId: profile.profile.id, applicationId: saved.application.id };
  }

  async function addCoach(coach = SOPHIE): Promise<HumanCoach> {
    const added = await coaches.add(coach);
    if (!added.ok) throw new Error("fixture refused");
    return added.coach;
  }

  describe("in the Back Office", () => {
    it("adds a Human Coach with their Cal.com booking link", async () => {
      const added = await coaches.add({ ...SOPHIE, bio: "  Ancienne DRH, 20 ans dans l'industrie. " });

      expect(added).toMatchObject({ ok: true, coach: { ...SOPHIE, bio: "Ancienne DRH, 20 ans dans l'industrie." } });
      expect(await coaches.list()).toEqual([added.ok && added.coach]);
    });

    it("refuses a booking link that is not a Cal.com page", async () => {
      for (const bookingUrl of ["https://calendly.com/sophie", "http://cal.com/sophie", "cal.com/sophie", "https://cal.com/", "https://evil.com/cal.com/x"]) {
        expect(await coaches.add({ ...SOPHIE, bookingUrl })).toEqual({ ok: false, errors: [{ field: "bookingUrl", code: "invalid" }] });
      }
      expect((await coaches.add({ ...SOPHIE, bookingUrl: "https://app.cal.eu/sophie/30min" })).ok).toBe(true);
    });

    it("requires a name and a valid email, and one Human Coach per email", async () => {
      expect(await coaches.add({ ...SOPHIE, name: " ", email: "sophie" })).toEqual({
        ok: false,
        errors: [
          { field: "name", code: "required" },
          { field: "email", code: "invalid" },
        ],
      });
      await coaches.add(SOPHIE);
      expect(await coaches.add({ ...SOPHIE, email: "Sophie.Martin@RH-conseil.fr" })).toEqual({ ok: false, error: "email_taken" });
    });

    it("retires a Human Coach: no longer listed", async () => {
      const added = await coaches.add(SOPHIE);
      if (!added.ok) throw new Error("fixture refused");

      await coaches.retire(added.coach.id);

      expect(await coaches.list()).toEqual([]);
    });
  });

  describe("Coach Access", () => {
    it("a Human Coach signs in with the email the Back Office gave them", async () => {
      const sophie = await addCoach();

      expect(await coaches.coachSignedIn({ email: "Sophie.Martin@rh-conseil.fr", emailVerified: true })).toEqual(sophie);
      expect(await coaches.coachSignedIn({ email: SOPHIE.email, emailVerified: false })).toBeNull();
      expect(await coaches.coachSignedIn({ email: "marie.dupont@example.fr", emailVerified: true })).toBeNull();
      await coaches.retire(sophie.id);
      expect(await coaches.coachSignedIn({ email: SOPHIE.email, emailVerified: true })).toBeNull();
    });

    it("a Human Coach reads nothing of a Candidate who has not granted them Coach Access", async () => {
      const sophie = await addCoach();
      const marie = await candidateWithApplication("marie.dupont@example.fr");

      expect(await coaches.candidates(sophie.id)).toEqual([]);
      expect(await coaches.candidateFile(sophie.id, marie.id)).toBeNull();
      expect(await coaches.application(sophie.id, marie.id, marie.applicationId)).toBeNull();
    });

    it("once granted, the Human Coach reads the Candidate's Profiles and Applications", async () => {
      const sophie = await addCoach();
      const marie = await candidateWithApplication("marie.dupont@example.fr");

      expect(await coaches.grantAccess(marie.id, sophie.id)).toBe(true);

      expect(await coaches.accessGranted(marie.id)).toEqual([sophie.id]);
      expect(await coaches.candidates(sophie.id)).toEqual([{ id: marie.id, name: "", email: "marie.dupont@example.fr" }]);
      const file = await coaches.candidateFile(sophie.id, marie.id);
      expect(file?.profiles).toMatchObject([{ id: marie.profileId, masterCv: { content: masterCv } }]);
      expect(file?.applications).toMatchObject([{ id: marie.applicationId, jobOffer: { title: "DAF H/F" } }]);
      expect((await coaches.application(sophie.id, marie.id, marie.applicationId))?.application).toMatchObject({ id: marie.applicationId });
    });

    it("Coach Access is per Human Coach and per Candidate", async () => {
      const sophie = await addCoach();
      const luc = await addCoach({ ...SOPHIE, name: "Luc Bernard", email: "luc@rh.fr" });
      const marie = await candidateWithApplication("marie.dupont@example.fr");
      const paul = await candidateWithApplication("paul.martin@example.fr");
      await coaches.grantAccess(marie.id, sophie.id);

      expect(await coaches.candidateFile(luc.id, marie.id)).toBeNull();
      expect(await coaches.candidateFile(sophie.id, paul.id)).toBeNull();
      expect(await coaches.application(sophie.id, marie.id, paul.applicationId)).toBeNull();
      expect(await coaches.application(sophie.id, paul.id, paul.applicationId)).toBeNull();
    });

    it("granting twice is harmless, and revoking ends the access at once", async () => {
      const sophie = await addCoach();
      const marie = await candidateWithApplication("marie.dupont@example.fr");
      await coaches.grantAccess(marie.id, sophie.id);
      await coaches.grantAccess(marie.id, sophie.id);

      await coaches.revokeAccess(marie.id, sophie.id);

      expect(await coaches.accessGranted(marie.id)).toEqual([]);
      expect(await coaches.candidateFile(sophie.id, marie.id)).toBeNull();
    });

    it("cannot be granted to an unknown or retired Human Coach, and a retired one reads nothing", async () => {
      const sophie = await addCoach();
      const marie = await candidateWithApplication("marie.dupont@example.fr");
      await coaches.grantAccess(marie.id, sophie.id);

      await coaches.retire(sophie.id);

      expect(await coaches.candidateFile(sophie.id, marie.id)).toBeNull();
      expect(await coaches.accessGranted(marie.id)).toEqual([]);
      expect(await coaches.grantAccess(marie.id, sophie.id)).toBe(false);
      expect(await coaches.grantAccess(marie.id, "not-a-coach")).toBe(false);
    });
  });

  describe("reviewing Tailored Documents", () => {
    const now = new Date("2026-10-09T10:00:00Z");
    const coverLetter = { language: "fr" as const, text: "Madame, Monsieur, …", draftedAt: now, updatedAt: now };

    async function coachedApplication() {
      const sophie = await addCoach();
      const marie = await candidateWithApplication("marie.dupont@example.fr");
      await coaches.grantAccess(marie.id, sophie.id);
      return { sophie, marie };
    }

    it("a Human Coach reads the Application's saved Tailored CV, Cover Letter and Outreach Message", async () => {
      const { sophie, marie } = await coachedApplication();
      drafts.set(marie.applicationId, { documentLanguage: "fr", coverLetter, outreachMessage: null });
      const saved = { language: "fr" as const, masterCvVersion: 1, content: masterCv, matchScore: { master: 60, tailored: 75 }, savedAt: now };
      tailoredCvs.set(marie.applicationId, { documentLanguage: "fr", proposal: null, saved });

      const read = await coaches.application(sophie.id, marie.id, marie.applicationId);

      expect(read).toMatchObject({ tailoredCv: saved, coverLetter, outreachMessage: null, reviews: [] });
    });

    it("a Human Coach's Coach Review of a Tailored Document reaches the Candidate on the Application", async () => {
      const { sophie, marie } = await coachedApplication();
      drafts.set(marie.applicationId, { documentLanguage: "fr", coverLetter, outreachMessage: null });

      const reviewed = await coaches.review(sophie.id, marie.id, marie.applicationId, { document: "cover_letter", text: "  Ouvrez sur votre dernier poste. " });

      const review = { coach: { id: sophie.id, name: SOPHIE.name }, document: "cover_letter", text: "Ouvrez sur votre dernier poste." };
      expect(reviewed).toMatchObject({ ok: true, review });
      expect(await coaches.reviews(marie.id, marie.applicationId)).toMatchObject([review]);
      expect((await coaches.application(sophie.id, marie.id, marie.applicationId))?.reviews).toMatchObject([review]);
    });

    it("only a Tailored Document the Application has can be reviewed, with some text", async () => {
      const { sophie, marie } = await coachedApplication();

      expect(await coaches.review(sophie.id, marie.id, marie.applicationId, { document: "tailored_cv", text: "Bien." })).toEqual({ ok: false, error: "not_found" });
      drafts.set(marie.applicationId, { documentLanguage: "fr", coverLetter, outreachMessage: null });
      expect(await coaches.review(sophie.id, marie.id, marie.applicationId, { document: "cover_letter", text: " " })).toEqual({
        ok: false,
        errors: [{ field: "text", code: "required" }],
      });
      expect(await coaches.review(sophie.id, marie.id, marie.applicationId, { document: "cv", text: "Bien." })).toMatchObject({ ok: false, errors: [{ field: "document" }] });
    });

    it("needs Coach Access, and the Candidate keeps the Coach Reviews after revoking it", async () => {
      const { sophie, marie } = await coachedApplication();
      drafts.set(marie.applicationId, { documentLanguage: "fr", coverLetter, outreachMessage: null });
      await coaches.review(sophie.id, marie.id, marie.applicationId, { document: "cover_letter", text: "Bien." });

      await coaches.revokeAccess(marie.id, sophie.id);

      expect(await coaches.review(sophie.id, marie.id, marie.applicationId, { document: "cover_letter", text: "Encore." })).toEqual({ ok: false, error: "not_found" });
      expect(await coaches.reviews(marie.id, marie.applicationId)).toHaveLength(1);
      expect(await coaches.reviews("someone-else", marie.applicationId)).toEqual([]);
    });
  });

  describe("Coaching Sessions", () => {
    const payment = { amount: 9000, currency: "eur" };

    it("a paid Coaching Session gives the Candidate the Human Coach's booking link", async () => {
      const sophie = await addCoach();
      const marie = await signUp("marie.dupont@example.fr");
      expect(await coaches.sessions(marie)).toEqual([]);

      expect(await coaches.recordPaidSession({ checkoutSessionId: "cs_1", candidateId: marie, coachId: sophie.id, ...payment })).toBe(true);

      expect(await coaches.sessions(marie)).toMatchObject([{ coach: { id: sophie.id, name: SOPHIE.name, bookingUrl: SOPHIE.bookingUrl }, ...payment }]);
    });

    it("records a payment once, however often it is reported", async () => {
      const sophie = await addCoach();
      const marie = await signUp("marie.dupont@example.fr");

      await Promise.all([1, 2, 3].map(() => coaches.recordPaidSession({ checkoutSessionId: "cs_1", candidateId: marie, coachId: sophie.id, ...payment })));

      expect(await coaches.sessions(marie)).toHaveLength(1);
    });

    it("ignores a payment for an unknown Human Coach or Candidate", async () => {
      const sophie = await addCoach();
      const marie = await signUp("marie.dupont@example.fr");

      expect(await coaches.recordPaidSession({ checkoutSessionId: "cs_1", candidateId: marie, coachId: "not-a-coach", ...payment })).toBe(false);
      expect(await coaches.recordPaidSession({ checkoutSessionId: "cs_2", candidateId: "nobody", coachId: sophie.id, ...payment })).toBe(false);
      expect(await coaches.sessions(marie)).toEqual([]);
    });

    it("keeps a paid Coaching Session with a Human Coach retired since", async () => {
      const sophie = await addCoach();
      const marie = await signUp("marie.dupont@example.fr");
      await coaches.recordPaidSession({ checkoutSessionId: "cs_1", candidateId: marie, coachId: sophie.id, ...payment });

      await coaches.retire(sophie.id);

      expect(await coaches.sessions(marie)).toHaveLength(1);
    });
  });
});
