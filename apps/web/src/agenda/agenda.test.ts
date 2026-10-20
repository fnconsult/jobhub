import type { MasterCvContent } from "@jobhub/shared";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApplications, migrateApplications, type Applications } from "../applications";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { createJobOffers, migrateJobOffers, type JobOffers } from "../job-offers";
import { createProfiles, migrateProfiles, type Profiles } from "../profiles";
import { createAgenda, type Agenda } from "./index";

const masterCv: MasterCvContent = {
  fullName: "Marie Dupont",
  headline: "Directrice financière",
  email: "marie.dupont@example.fr",
  phone: "",
  location: "Lyon",
  summary: "",
  experience: [],
  education: [],
  skills: ["IFRS"],
  languages: [],
};

/** "Now" in these tests: Tuesday 20 October 2026, 10:00 French time (UTC+2). */
const NOW = new Date("2026-10-20T08:00:00.000Z");

describe.skipIf(!connectionString)("Agenda (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let profiles: Profiles;
  let jobOffers: JobOffers;
  let applications: Applications;
  let agenda: Agenda;
  let candidateId: string;
  let otherCandidateId: string;

  async function signIn(email: string) {
    const cookie = await signInWithMagicLink(testAuth, email);
    return (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id as string;
  }

  /** An Application at "Entretien" for `owner`, on a Job Offer `title` at `employer`. */
  async function applicationInInterview(owner: string, title: string, employer: string) {
    const profile = await profiles.create(owner, { masterCv, searchCriteria: { targetRole: "DAF", locations: ["Lyon"], contractTypes: ["cdi"] } });
    if (!profile.ok) throw new Error("fixture Profile refused");
    const captured = await jobOffers.capture({ source: { url: `https://www.apec.fr/offre/${encodeURIComponent(title)}-${owner}` }, title, content: `${title} chez ${employer}.`, employer });
    if (!captured.ok) throw new Error("fixture Job Offer refused");
    const saved = await applications.save(owner, { jobOfferId: captured.jobOffer.id, profileId: profile.profile.id });
    if (!saved.ok) throw new Error("fixture Application refused");
    await applications.change(owner, saved.application.id, { status: "interview" });
    return saved.application.id;
  }

  async function addInterview(owner: string, applicationId: string, scheduledAt: string) {
    const added = await applications.addInterview(owner, applicationId, { scheduledAt });
    if (!added.ok) throw new Error("fixture Interview refused");
  }

  /** Each day shown, with the times of its items (ISO, UTC). */
  const shape = (days: Awaited<ReturnType<Agenda["days"]>>) => days.map(({ day, items }) => [day, items.map((item) => item.scheduledAt.toISOString())]);

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.auth.options.database as Pool;
    await migrateProfiles(database);
    await migrateJobOffers(database);
    await migrateApplications(database);
    profiles = createProfiles(database);
    jobOffers = createJobOffers(database);
    applications = createApplications(database, { jobOffers, profiles });
    agenda = createAgenda(database);
    candidateId = await signIn("marie.dupont@example.fr");
    otherCandidateId = await signIn("paul.martin@example.fr");
  });
  afterEach(async () => {
    await testAuth.stop();
  });

  it("shows only the signed-in Candidate's Interviews, with the Job Offer's title and company and the Application they belong to", async () => {
    const mine = await applicationInInterview(candidateId, "DAF H/F", "Acme Industrie");
    const theirs = await applicationInInterview(otherCandidateId, "Contrôleur de gestion", "Globex");
    await addInterview(candidateId, mine, "2026-10-22T14:30");
    await addInterview(otherCandidateId, theirs, "2026-10-22T09:00");

    expect(await agenda.days(candidateId, { period: "upcoming", now: NOW })).toEqual([
      {
        day: "2026-10-22",
        items: [{ kind: "interview", id: expect.any(String), scheduledAt: new Date("2026-10-22T12:30:00.000Z"), applicationId: mine, jobTitle: "DAF H/F", employer: "Acme Industrie" }],
      },
    ]);
  });

  it("shows upcoming Interviews from now on, oldest first, and past ones only when asked, newest first", async () => {
    const daf = await applicationInInterview(candidateId, "DAF H/F", "Acme Industrie");
    const controller = await applicationInInterview(candidateId, "Contrôleur de gestion", "Globex");
    await addInterview(candidateId, daf, "2026-10-27T09:00");
    await addInterview(candidateId, controller, "2026-10-20T11:00"); // later today
    await addInterview(candidateId, daf, "2026-10-20T09:00"); // earlier today: past already
    await addInterview(candidateId, controller, "2026-10-13T15:00");
    await addInterview(candidateId, daf, "2026-10-13T10:00");

    expect(shape(await agenda.days(candidateId, { period: "upcoming", now: NOW }))).toEqual([
      ["2026-10-20", ["2026-10-20T09:00:00.000Z"]],
      ["2026-10-27", ["2026-10-27T08:00:00.000Z"]],
    ]);
    expect(shape(await agenda.days(candidateId, { period: "past", now: NOW }))).toEqual([
      ["2026-10-20", ["2026-10-20T07:00:00.000Z"]],
      ["2026-10-13", ["2026-10-13T13:00:00.000Z", "2026-10-13T08:00:00.000Z"]],
    ]);
  });

  it("keeps the Interviews of Archived Applications", async () => {
    const applicationId = await applicationInInterview(candidateId, "DAF H/F", "Acme Industrie");
    await addInterview(candidateId, applicationId, "2026-10-22T14:30");
    await applications.change(candidateId, applicationId, { status: "rejected" });

    expect(shape(await agenda.days(candidateId, { period: "upcoming", now: NOW }))).toEqual([["2026-10-22", ["2026-10-22T12:30:00.000Z"]]]);
  });

  it("groups by day in French time: an Interview at 23:30 is on that day, not the next one as in UTC", async () => {
    const applicationId = await applicationInInterview(candidateId, "DAF H/F", "Acme Industrie");
    await addInterview(candidateId, applicationId, "2026-10-22T23:30"); // 21:30 UTC, summer time
    await addInterview(candidateId, applicationId, "2026-11-05T23:30"); // 22:30 UTC, winter time
    await addInterview(candidateId, applicationId, "2026-11-06T00:15"); // 23:15 UTC on the 5th

    expect(shape(await agenda.days(candidateId, { period: "upcoming", now: NOW }))).toEqual([
      ["2026-10-22", ["2026-10-22T21:30:00.000Z"]],
      ["2026-11-05", ["2026-11-05T22:30:00.000Z"]],
      ["2026-11-06", ["2026-11-05T23:15:00.000Z"]],
    ]);
  });

  it("is empty when the Candidate has no Interview", async () => {
    expect(await agenda.days(candidateId, { period: "upcoming", now: NOW })).toEqual([]);
    expect(await agenda.days(candidateId, { period: "past", now: NOW })).toEqual([]);
  });
});
