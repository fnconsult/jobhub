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
    const profile = await profiles.create(id, { masterCv, searchCriteria: { targetRole: "DAF", locations: ["Lyon"] } });
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

    /** Marie's one paid Coaching Session with Sophie. */
    async function paidSession() {
      const sophie = await addCoach();
      const marie = await signUp("marie.dupont@example.fr");
      await coaches.recordPaidSession({ checkoutSessionId: "cs_1", candidateId: marie, coachId: sophie.id, ...payment });
      const [session] = await coaches.sessions(marie);
      return { sophie, marie, session: session! };
    }

    it("is recorded without a date: an Unscheduled Coaching Session", async () => {
      const { session } = await paidSession();

      expect(session).toMatchObject({ scheduledAt: null, durationMinutes: null, videoLink: null, note: null });
    });

    it("the Candidate enters its date in French time, its duration, video link and note, then edits them", async () => {
      const { marie, session } = await paidSession();

      const scheduled = await coaches.scheduleSession(marie, session.id, { scheduledAt: "2026-10-22T23:30", durationMinutes: 60, videoLink: " https://meet.google.com/abc-defg-hij ", note: " Préparer mon pitch. " });

      const expected = { id: session.id, scheduledAt: new Date("2026-10-22T21:30:00.000Z"), durationMinutes: 60, videoLink: "https://meet.google.com/abc-defg-hij", note: "Préparer mon pitch." };
      expect(scheduled).toEqual({ ok: true, session: expect.objectContaining(expected) });
      expect(await coaches.sessions(marie)).toEqual([expect.objectContaining(expected)]);

      await coaches.scheduleSession(marie, session.id, { scheduledAt: "2026-10-23T10:00" });
      expect(await coaches.sessions(marie)).toEqual([expect.objectContaining({ scheduledAt: new Date("2026-10-23T08:00:00.000Z"), durationMinutes: null, videoLink: null, note: null })]);
    });

    it("refuses a missing or unreadable date, a video link that is not http(s) and a duration that is not a number of minutes", async () => {
      const { marie, session } = await paidSession();

      const refused = await coaches.scheduleSession(marie, session.id, { scheduledAt: "", durationMinutes: 0, videoLink: "javascript:alert(1)" });

      expect(refused.ok).toBe(false);
      expect(refused.ok === false && "errors" in refused ? refused.errors.sort((a, b) => a.field.localeCompare(b.field)) : []).toEqual([
        { field: "durationMinutes", code: "invalid" },
        { field: "scheduledAt", code: "required" },
        { field: "videoLink", code: "invalid" },
      ]);
      expect(await coaches.scheduleSession(marie, session.id, { scheduledAt: "le 22 octobre" })).toEqual({ ok: false, errors: [{ field: "scheduledAt", code: "invalid" }] });
      expect(await coaches.sessions(marie)).toEqual([expect.objectContaining({ scheduledAt: null })]);
    });

    it("a Candidate can set the date of their own Coaching Sessions only", async () => {
      const { marie, session } = await paidSession();
      const paul = await signUp("paul.martin@example.fr");

      expect(await coaches.scheduleSession(paul, session.id, { scheduledAt: "2026-10-22T14:00" })).toEqual({ ok: false, error: "not_found" });
      expect(await coaches.scheduleSession(paul, "not-a-session", { scheduledAt: "2026-10-22T14:00" })).toEqual({ ok: false, error: "not_found" });
      expect(await coaches.sessions(marie)).toEqual([expect.objectContaining({ scheduledAt: null })]);
    });

    describe("Reschedules and cancelling (fixed clock)", () => {
      /** What the clock says: starts on Tuesday 20 October 2026, 10:00 French time. */
      let now: Date;
      let clocked: HumanCoaches;
      const later = (minutes: number) => {
        now = new Date(now.getTime() + minutes * 60_000);
      };

      beforeEach(() => {
        now = new Date("2026-10-20T08:00:00.000Z");
        clocked = createHumanCoaches(database, { profiles, applications, tailoredDocuments: { get: async () => null }, tailoredCvs: { get: async () => null }, now: () => now });
      });

      /** Marie's Coaching Session with Sophie, its date entered now: 22 October, 14:00 French time. */
      async function datedSession() {
        const paid = await paidSession();
        await clocked.scheduleSession(paid.marie, paid.session.id, { scheduledAt: "2026-10-22T14:00" });
        return paid;
      }

      it("records nothing when the Candidate changes the date 30 minutes after entering it, and a Reschedule 2 hours after", async () => {
        const { marie, session } = await datedSession();

        later(30);
        await clocked.scheduleSession(marie, session.id, { scheduledAt: "2026-10-22T15:00" });
        expect((await clocked.sessions(marie))[0]!.reschedules).toEqual([]);

        later(120);
        const rescheduled = await clocked.scheduleSession(marie, session.id, { scheduledAt: "2026-10-23T09:00" });
        expect(rescheduled).toMatchObject({
          ok: true,
          session: { scheduledAt: new Date("2026-10-23T07:00:00.000Z"), reschedules: [{ previousAt: new Date("2026-10-22T13:00:00.000Z"), newAt: new Date("2026-10-23T07:00:00.000Z"), by: "candidate", at: now }] },
        });
      });

      it("the Candidate cancels it: its date is cleared, back to Unscheduled, the cancellation kept in its history", async () => {
        const { marie, session } = await datedSession();
        later(10);

        expect(await clocked.cancelSession(marie, session.id)).toMatchObject({
          ok: true,
          session: { scheduledAt: null, reschedules: [{ previousAt: new Date("2026-10-22T12:00:00.000Z"), newAt: null, by: "candidate", at: now }] },
        });
        expect((await clocked.sessions(marie))[0]).toMatchObject({ scheduledAt: null });
      });

      it("a date entered again after a cancellation is no Reschedule; changing it later is one", async () => {
        const { marie, session } = await datedSession();
        later(240);
        await clocked.cancelSession(marie, session.id);
        later(240);
        await clocked.scheduleSession(marie, session.id, { scheduledAt: "2026-10-29T14:00" });
        later(30);
        await clocked.scheduleSession(marie, session.id, { scheduledAt: "2026-10-29T15:00" });
        later(120);
        await clocked.scheduleSession(marie, session.id, { scheduledAt: "2026-10-30T15:00" });

        expect((await clocked.sessions(marie))[0]!.reschedules.map(({ previousAt, newAt }) => [previousAt.toISOString(), newAt?.toISOString() ?? null])).toEqual([
          ["2026-10-22T12:00:00.000Z", null],
          ["2026-10-29T14:00:00.000Z", "2026-10-30T14:00:00.000Z"],
        ]);
      });

      it("its Human Coach cancels it too, recorded as theirs; no other Human Coach can, nor a retired one", async () => {
        const { sophie, marie, session } = await datedSession();
        const other = await clocked.add({ name: "Paul Durand", email: "paul.durand@rh-conseil.fr", bookingUrl: "https://cal.com/paul-durand/seance" });
        if (!other.ok) throw new Error("fixture refused");

        expect(await clocked.cancelCoachedSession(other.coach.id, session.id)).toEqual({ ok: false, error: "not_found" });
        expect(await clocked.cancelCoachedSession(sophie.id, "not-a-session")).toEqual({ ok: false, error: "not_found" });
        expect((await clocked.sessions(marie))[0]).toMatchObject({ scheduledAt: new Date("2026-10-22T12:00:00.000Z") });

        expect(await clocked.cancelCoachedSession(sophie.id, session.id)).toEqual({ ok: true });
        expect((await clocked.sessions(marie))[0]).toMatchObject({ scheduledAt: null, reschedules: [{ newAt: null, by: "coach" }] });

        await clocked.scheduleSession(marie, session.id, { scheduledAt: "2026-10-29T14:00" });
        await clocked.retire(sophie.id);
        expect(await clocked.cancelCoachedSession(sophie.id, session.id)).toEqual({ ok: false, error: "not_found" });
      });

      it("a Candidate cancels only their own Coaching Sessions; cancelling an Unscheduled one changes nothing", async () => {
        const { marie, session } = await datedSession();
        const paul = await signUp("paul.martin@example.fr");

        expect(await clocked.cancelSession(paul, session.id)).toEqual({ ok: false, error: "not_found" });
        expect(await clocked.cancelSession(paul, "not-a-session")).toEqual({ ok: false, error: "not_found" });
        expect((await clocked.sessions(marie))[0]).toMatchObject({ scheduledAt: new Date("2026-10-22T12:00:00.000Z") });

        await clocked.cancelSession(marie, session.id);
        await clocked.cancelSession(marie, session.id);
        expect((await clocked.sessions(marie))[0]!.reschedules).toHaveLength(1);
      });
    });

    it("a Retired Human Coach's Coaching Sessions keep their date", async () => {
      const { sophie, marie, session } = await paidSession();
      await coaches.scheduleSession(marie, session.id, { scheduledAt: "2026-10-13T10:00" });

      await coaches.retire(sophie.id);

      expect(await coaches.sessions(marie)).toEqual([expect.objectContaining({ coach: expect.objectContaining({ name: SOPHIE.name }), scheduledAt: new Date("2026-10-13T08:00:00.000Z") })]);
    });

    describe("in the Coach space", () => {
      const PAUL = { name: "Paul Lefèvre", email: "paul.lefevre@rh-conseil.fr", bookingUrl: "https://cal.com/paul-lefevre/seance" };

      /** A Candidate signed up with `email`, under the account name `name`. */
      async function candidateNamed(email: string, name: string) {
        const cookie = await signInWithMagicLink(testAuth, email);
        await testAuth.request("/api/auth/update-user", { cookie, body: { name } });
        return (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id as string;
      }

      it("a Human Coach sees their own Coaching Sessions only, each with the Candidate's first name and last initial, dated or not", async () => {
        const sophie = await addCoach();
        const paul = await addCoach(PAUL);
        const marie = await candidateNamed("marie.dupont@example.fr", "Marie Dupont");
        const eric = await candidateNamed("eric.durand@example.fr", "éric de la Tour");
        await coaches.recordPaidSession({ checkoutSessionId: "cs_1", candidateId: marie, coachId: sophie.id, ...payment });
        await coaches.recordPaidSession({ checkoutSessionId: "cs_2", candidateId: eric, coachId: sophie.id, ...payment });
        await coaches.recordPaidSession({ checkoutSessionId: "cs_3", candidateId: marie, coachId: paul.id, ...payment });
        const [marieWithSophie] = (await coaches.sessions(marie)).filter((session) => session.coach.id === sophie.id);
        await coaches.scheduleSession(marie, marieWithSophie!.id, { scheduledAt: "2026-10-22T14:30", durationMinutes: 60, videoLink: "https://meet.google.com/abc", note: "Mon pitch." });

        const sessions = await coaches.coachSessions(sophie.id);

        // « À planifier » first, then the dated ones, latest first.
        expect(sessions).toEqual([
          { id: expect.any(String), candidateName: "éric T.", paidAt: expect.any(Date), scheduledAt: null, durationMinutes: null, videoLink: null },
          { id: marieWithSophie!.id, candidateName: "Marie D.", paidAt: expect.any(Date), scheduledAt: new Date("2026-10-22T12:30:00.000Z"), durationMinutes: 60, videoLink: "https://meet.google.com/abc" },
        ]);
        expect(JSON.stringify(sessions)).not.toContain("Mon pitch.");
        expect(JSON.stringify(sessions)).not.toContain("example.fr");
        expect(await coaches.coachSessions("not-a-coach")).toEqual([]);
      });

      it("a Human Coach enters or corrects the date, duration and video link of their own Coaching Session; the Candidate's note stays, and the change is the coach's", async () => {
        const { sophie, marie, session } = await paidSession();
        await coaches.scheduleSession(marie, session.id, { scheduledAt: "2026-10-22T14:30", note: "Préparer mon pitch." });
        expect(await coaches.sessions(marie)).toEqual([expect.objectContaining({ changedBy: "candidate" })]);

        const corrected = await coaches.scheduleCoachedSession(sophie.id, session.id, { scheduledAt: "2026-10-22T16:00", durationMinutes: 45, videoLink: "https://meet.google.com/xyz", note: "Écrasée ?" });

        expect(corrected).toEqual({ ok: true, session: expect.objectContaining({ id: session.id, scheduledAt: new Date("2026-10-22T14:00:00.000Z"), durationMinutes: 45, videoLink: "https://meet.google.com/xyz" }) });
        expect(await coaches.sessions(marie)).toEqual([
          expect.objectContaining({ scheduledAt: new Date("2026-10-22T14:00:00.000Z"), durationMinutes: 45, videoLink: "https://meet.google.com/xyz", note: "Préparer mon pitch.", changedBy: "coach" }),
        ]);

        await coaches.scheduleSession(marie, session.id, { scheduledAt: "2026-10-22T17:00", note: "Préparer mon pitch." });
        expect(await coaches.sessions(marie)).toEqual([expect.objectContaining({ changedBy: "candidate" })]);
      });

      it("a Human Coach enters the date of an Unscheduled Coaching Session, and refuses an unreadable one like the Candidate's form", async () => {
        const { sophie, marie, session } = await paidSession();
        expect(await coaches.sessions(marie)).toEqual([expect.objectContaining({ changedBy: null })]);

        expect(await coaches.scheduleCoachedSession(sophie.id, session.id, { scheduledAt: "", videoLink: "javascript:alert(1)" })).toEqual({
          ok: false,
          errors: [
            { field: "scheduledAt", code: "required" },
            { field: "videoLink", code: "invalid" },
          ],
        });
        expect((await coaches.scheduleCoachedSession(sophie.id, session.id, { scheduledAt: "2026-10-23T09:00" })).ok).toBe(true);
        expect(await coaches.coachSessions(sophie.id)).toEqual([expect.objectContaining({ id: session.id, scheduledAt: new Date("2026-10-23T07:00:00.000Z") })]);
      });

      it("another Human Coach's Coaching Session is refused", async () => {
        const { marie, session } = await paidSession();
        const paul = await addCoach(PAUL);

        expect(await coaches.scheduleCoachedSession(paul.id, session.id, { scheduledAt: "2026-10-22T14:00" })).toEqual({ ok: false, error: "not_found" });
        expect(await coaches.scheduleCoachedSession("not-a-coach", session.id, { scheduledAt: "2026-10-22T14:00" })).toEqual({ ok: false, error: "not_found" });
        expect(await coaches.scheduleCoachedSession(paul.id, "not-a-session", { scheduledAt: "2026-10-22T14:00" })).toEqual({ ok: false, error: "not_found" });
        expect(await coaches.coachSessions(paul.id)).toEqual([]);
        expect(await coaches.sessions(marie)).toEqual([expect.objectContaining({ scheduledAt: null })]);
      });

      it("a Retired Human Coach is refused: they no longer see or edit their Coaching Sessions, which the Candidate keeps", async () => {
        const { sophie, marie, session } = await paidSession();
        await coaches.scheduleSession(marie, session.id, { scheduledAt: "2026-10-22T14:30" });

        await coaches.retire(sophie.id);

        expect(await coaches.coachSessions(sophie.id)).toEqual([]);
        expect(await coaches.scheduleCoachedSession(sophie.id, session.id, { scheduledAt: "2026-10-23T09:00" })).toEqual({ ok: false, error: "not_found" });
        expect(await coaches.sessions(marie)).toEqual([expect.objectContaining({ scheduledAt: new Date("2026-10-22T12:30:00.000Z"), changedBy: "candidate" })]);
      });
    });
  });
});
