import type { MasterCvContent } from "@jobhub/shared";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { createJobOffers, migrateJobOffers } from "../job-offers";
import { createProfiles, migrateProfiles, type Profiles } from "../profiles";
import { createApplications, migrateApplications, type Applications } from "./index";

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

describe.skipIf(!connectionString)("Applications (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let profiles: Profiles;
  let applications: Applications;
  let candidateId: string;
  let otherCandidateId: string;
  let jobOfferId: string;
  let profileId: string;

  async function signIn(email: string) {
    const cookie = await signInWithMagicLink(testAuth, email);
    return (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id as string;
  }

  async function createProfile(owner: string, targetRole: string) {
    const created = await profiles.create(owner, { masterCv, searchCriteria: { targetRole, location: "Lyon", contractType: "cdi" } });
    if (!created.ok) throw new Error("fixture Profile refused");
    return created.profile.id;
  }

  async function save(input: unknown, owner = candidateId) {
    const saved = await applications.save(owner, input);
    if (!saved.ok) throw new Error(`fixture Application refused: ${JSON.stringify(saved)}`);
    return saved.application;
  }

  beforeEach(async () => {
    testAuth = await startTestAuth();
    const database = testAuth.auth.options.database as Pool;
    await migrateProfiles(database);
    await migrateJobOffers(database);
    await migrateApplications(database);
    profiles = createProfiles(database);
    const jobOffers = createJobOffers(database);
    applications = createApplications(database, { jobOffers, profiles });
    candidateId = await signIn("marie.dupont@example.fr");
    otherCandidateId = await signIn("paul.martin@example.fr");
    profileId = await createProfile(candidateId, "DAF");
    const captured = await jobOffers.capture({
      source: { url: "https://www.apec.fr/offre/1" },
      title: "DAF H/F",
      content: "DAF pour un groupe industriel. 15 ans d'expérience.",
      employer: "Acme Industrie",
      location: "Lyon",
      contractType: "cdi",
      skills: ["IFRS", "SAP", "Power BI"],
    });
    if (!captured.ok) throw new Error("fixture Job Offer refused");
    jobOfferId = captured.jobOffer.id;
  });
  afterEach(async () => {
    await testAuth.stop();
  });

  it("saving a Job Offer with one of the Candidate's Profiles creates an Application to apply to", async () => {
    const result = await applications.save(candidateId, { jobOfferId, profileId });

    expect(result).toMatchObject({
      ok: true,
      created: true,
      application: { status: "to_apply", profile: { id: profileId, name: "DAF" }, jobOffer: { id: jobOfferId, title: "DAF H/F" }, interviews: [] },
    });
  });

  it("keeps at most one Application per Candidate per Job Offer: saving it again returns the one they have", async () => {
    const first = await save({ jobOfferId, profileId });
    const otherProfileId = await createProfile(candidateId, "Consultant transformation");

    const again = await applications.save(candidateId, { jobOfferId, profileId: otherProfileId });

    expect(again).toMatchObject({ ok: true, created: false, application: { id: first.id, profile: { id: profileId } } });
  });

  it("lets another Candidate save the same Job Offer as their own Application", async () => {
    const mine = await save({ jobOfferId, profileId });
    const theirProfileId = await createProfile(otherCandidateId, "DAF");

    const theirs = await save({ jobOfferId, profileId: theirProfileId }, otherCandidateId);

    expect(theirs.id).not.toBe(mine.id);
  });

  it("refuses a Profile that is not the Candidate's, and a Job Offer that does not exist", async () => {
    const theirProfileId = await createProfile(otherCandidateId, "DAF");

    expect(await applications.save(candidateId, { jobOfferId, profileId: theirProfileId })).toEqual({ ok: false, error: "not_found" });
    expect(await applications.save(candidateId, { jobOfferId: "00000000-0000-4000-8000-000000000000", profileId })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await applications.save(candidateId, { jobOfferId: "not-an-id", profileId })).toEqual({ ok: false, error: "not_found" });
  });

  it("names the missing fields of a save request", async () => {
    expect(await applications.save(candidateId, { profileId })).toEqual({ ok: false, errors: [{ field: "jobOfferId", code: "required" }] });
  });

  it("shows an Application only to its Candidate", async () => {
    const application = await save({ jobOfferId, profileId });

    expect(await applications.get(candidateId, application.id)).toMatchObject({ id: application.id });
    expect(await applications.get(otherCandidateId, application.id)).toBeNull();
    expect(await applications.get(candidateId, "not-an-id")).toBeNull();
  });

  it("shows the full Job Offer and the Match Score of the Profile's Master CV, with its breakdown", async () => {
    const application = await save({ jobOfferId, profileId });

    const shown = await applications.get(candidateId, application.id);

    expect(shown?.jobOffer).toMatchObject({ content: "DAF pour un groupe industriel. 15 ans d'expérience.", employer: "Acme Industrie" });
    expect(shown?.matchScore).toEqual({
      score: 85, // skills 2/3 of 40 + seniority 20 + location 15 + contract type 15, out of 90 (no salary on the offer)
      breakdown: {
        skills: { status: "partial", covered: ["IFRS", "SAP"], missing: ["Power BI"] },
        seniority: { status: "match", cvYears: 19, requiredYears: 15 },
        location: { status: "match", offer: "Lyon", wanted: "Lyon" },
        salary: { status: "unknown" },
        contractType: { status: "match", offer: "cdi", wanted: "cdi" },
      },
    });
  });

  async function captureOffer(title: string) {
    const captured = await createJobOffers(testAuth.auth.options.database as Pool).capture({ title, content: `${title} : poste à Lyon.` });
    if (!captured.ok) throw new Error("fixture Job Offer refused");
    return captured.jobOffer.id;
  }

  it("lists the Candidate's Applications, newest first, with their Job Offer, Profile and status", async () => {
    const first = await save({ jobOfferId, profileId });
    const second = await save({ jobOfferId: await captureOffer("Contrôleur de gestion"), profileId });
    await save({ jobOfferId, profileId: await createProfile(otherCandidateId, "DAF") }, otherCandidateId);

    const list = await applications.list(candidateId);

    expect(list).toEqual([
      {
        id: second.id,
        status: "to_apply",
        statusChangedAt: expect.any(Date),
        jobOffer: { id: second.jobOffer.id, title: "Contrôleur de gestion" },
        profile: { id: profileId, name: "DAF" },
        interviews: [],
      },
      {
        id: first.id,
        status: "to_apply",
        statusChangedAt: expect.any(Date),
        jobOffer: { id: jobOfferId, title: "DAF H/F", employer: "Acme Industrie", location: "Lyon" },
        profile: { id: profileId, name: "DAF" },
        interviews: [],
      },
    ]);
  });

  it("changes the Application Status when the Candidate says so", async () => {
    const application = await save({ jobOfferId, profileId });

    const changed = await applications.change(candidateId, application.id, { status: "applied" });

    expect(changed).toMatchObject({ ok: true, application: { status: "applied" } });
    expect((await applications.get(candidateId, application.id))?.status).toBe("applied");
    if (changed.ok) expect(changed.application.statusChangedAt.getTime()).toBeGreaterThanOrEqual(application.statusChangedAt.getTime());
  });

  it("refuses a status that is not an Application Status, and someone else's Application", async () => {
    const application = await save({ jobOfferId, profileId });

    expect(await applications.change(candidateId, application.id, { status: "hired" })).toEqual({
      ok: false,
      errors: [{ field: "status", code: "invalid" }],
    });
    expect(await applications.change(otherCandidateId, application.id, { status: "applied" })).toEqual({ ok: false, error: "not_found" });
    expect((await applications.get(candidateId, application.id))?.status).toBe("to_apply");
  });

  it("lets the Candidate pick another of their Profiles for the Application, and scores that one", async () => {
    const application = await save({ jobOfferId, profileId });
    const otherProfileId = await createProfile(candidateId, "Consultant transformation");
    const theirProfileId = await createProfile(otherCandidateId, "DAF");

    const changed = await applications.change(candidateId, application.id, { profileId: otherProfileId });

    expect(changed).toMatchObject({ ok: true, application: { profile: { id: otherProfileId, name: "Consultant transformation" } } });
    expect(await applications.change(candidateId, application.id, { profileId: theirProfileId })).toEqual({ ok: false, error: "not_found" });
  });

  describe("Interviews", () => {
    async function inInterview() {
      const application = await save({ jobOfferId, profileId });
      await applications.change(candidateId, application.id, { status: "interview" });
      return application.id;
    }

    it("holds one or more dated Interviews while the Application is at \"Entretien\", in date order", async () => {
      const applicationId = await inInterview();

      await applications.addInterview(candidateId, applicationId, { scheduledAt: "2026-11-11T14:30:00.000Z", note: "Avec le PDG" });
      const added = await applications.addInterview(candidateId, applicationId, { scheduledAt: "2026-11-04T09:00:00.000Z" });

      expect(added).toMatchObject({
        ok: true,
        application: {
          interviews: [
            { id: expect.any(String), scheduledAt: new Date("2026-11-04T09:00:00.000Z"), note: "" },
            { id: expect.any(String), scheduledAt: new Date("2026-11-11T14:30:00.000Z"), note: "Avec le PDG" },
          ],
        },
      });
      expect((await applications.list(candidateId))[0]?.interviews).toHaveLength(2);
    });

    it("adds Interviews only to an Application at \"Entretien\"", async () => {
      const application = await save({ jobOfferId, profileId });

      expect(await applications.addInterview(candidateId, application.id, { scheduledAt: "2026-11-04T09:00:00.000Z" })).toEqual({
        ok: false,
        error: "not_in_interview",
      });
    });

    it("keeps the Interviews when the Application moves on from \"Entretien\"", async () => {
      const applicationId = await inInterview();
      await applications.addInterview(candidateId, applicationId, { scheduledAt: "2026-11-04T09:00:00.000Z" });

      const changed = await applications.change(candidateId, applicationId, { status: "offer_received" });

      expect(changed.ok && changed.application.interviews).toHaveLength(1);
    });

    it("needs a date for an Interview, and refuses someone else's Application", async () => {
      const applicationId = await inInterview();

      expect(await applications.addInterview(candidateId, applicationId, { note: "Avec la DRH" })).toEqual({
        ok: false,
        errors: [{ field: "scheduledAt", code: "required" }],
      });
      expect(await applications.addInterview(candidateId, applicationId, { scheduledAt: "demain" })).toEqual({
        ok: false,
        errors: [{ field: "scheduledAt", code: "invalid" }],
      });
      expect(await applications.addInterview(otherCandidateId, applicationId, { scheduledAt: "2026-11-04T09:00:00.000Z" })).toEqual({
        ok: false,
        error: "not_found",
      });
    });

    it("removes an Interview the Candidate added by mistake", async () => {
      const applicationId = await inInterview();
      const added = await applications.addInterview(candidateId, applicationId, { scheduledAt: "2026-11-04T09:00:00.000Z" });
      const interviewId = added.ok ? added.application.interviews[0]!.id : "";

      expect(await applications.removeInterview(otherCandidateId, applicationId, interviewId)).toEqual({ ok: false, error: "not_found" });
      const removed = await applications.removeInterview(candidateId, applicationId, interviewId);

      expect(removed).toMatchObject({ ok: true, application: { interviews: [] } });
      expect(await applications.removeInterview(candidateId, applicationId, interviewId)).toEqual({ ok: false, error: "not_found" });
    });
  });
});
