import type { MasterCvContent } from "@jobhub/shared";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { createJobOffers, migrateJobOffers } from "../job-offers";
import { createProfiles, migrateProfiles, type Profiles } from "../profiles";
import { createMatchScoring, type MatchScoring } from "./index";

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

  beforeEach(async () => {
    testAuth = await startTestAuth();
    const database = testAuth.auth.options.database as Pool;
    await migrateProfiles(database);
    await migrateJobOffers(database);
    profiles = createProfiles(database);
    const jobOffers = createJobOffers(database);
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
          location: { status: "match", offer: "Lyon", wanted: "Lyon" },
          salary: { status: "unknown", offer: { min: 110_000, max: 130_000 } },
          contractType: { status: "unknown", offer: "cdi" },
        },
      },
    });
  });

  it("scores a Profile's Master CV against its Search Criteria for the signed-in Candidate", async () => {
    const created = await profiles.create(candidateId, {
      masterCv,
      searchCriteria: { targetRole: "DAF", location: "Lyon", minSalary: 150_000, contractType: "cdi" },
    });
    if (!created.ok) throw new Error("fixture Profile refused");

    const result = await scoring.score(candidateId, { jobOfferId, profileId: created.profile.id });

    expect(result).toMatchObject({
      ok: true,
      matchScore: {
        breakdown: {
          salary: { status: "mismatch", offer: { min: 110_000, max: 130_000 }, wanted: 150_000 },
          contractType: { status: "match", offer: "cdi", wanted: "cdi" },
        },
      },
    });
  });

  it("scores a Tailored CV sent with the request, with the Search Criteria it is for", async () => {
    const tailoredCv = { ...masterCv, skills: [...masterCv.skills, "Power BI"] };
    const searchCriteria = { targetRole: "DAF", location: "Lyon", minSalary: 120_000, contractType: "cdi" };

    const result = await scoring.score(candidateId, { jobOfferId, cv: tailoredCv, searchCriteria });

    expect(result).toEqual({ ok: true, matchScore: expect.objectContaining({ score: 100 }) });
  });

  it("refuses a Profile to a Guest, and someone else's Profile or an unknown Job Offer to anyone", async () => {
    const created = await profiles.create(candidateId, { masterCv, searchCriteria: { targetRole: "DAF", location: "Lyon" } });
    if (!created.ok) throw new Error("fixture Profile refused");
    const cookie = await signInWithMagicLink(testAuth, "jean.martin@example.fr");
    const otherId = (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id;

    expect(await scoring.score(null, { jobOfferId, profileId: created.profile.id })).toEqual({ ok: false, error: "unauthorized" });
    expect(await scoring.score(otherId, { jobOfferId, profileId: created.profile.id })).toEqual({ ok: false, error: "not_found" });
    expect(await scoring.score(null, { jobOfferId: "00000000-0000-4000-8000-000000000000", cv: masterCv })).toEqual({ ok: false, error: "not_found" });
  });

  it("refuses a request without a Job Offer or a CV, naming the fields to fix", async () => {
    expect(await scoring.score(null, { cv: masterCv })).toEqual({ ok: false, error: "invalid", errors: [{ field: "jobOfferId", code: "required" }] });
    expect(await scoring.score(null, { jobOfferId })).toEqual({ ok: false, error: "invalid", errors: [{ field: "cv", code: "required" }] });
    expect(await scoring.score(null, "hello")).toMatchObject({ ok: false, error: "invalid" });
  });
});
