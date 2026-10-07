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
});
