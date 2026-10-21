import type { MasterCvContent } from "@jobhub/shared";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApplications, migrateApplications, type Applications } from "../applications";
import type { MailMessage } from "../auth";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { createHumanCoaches, migrateHumanCoaches, type HumanCoaches } from "../human-coaches";
import { createJobOffers, migrateJobOffers, type JobOffers } from "../job-offers";
import { createProfiles, migrateProfiles, type Profiles } from "../profiles";
import { createAppointmentReminders, migrateAppointmentReminders, type AppointmentReminders } from "./index";

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

/** Tuesday 20 October 2026, French time is UTC+2. */
const MORNING = "2026-10-20T08:00:00.000Z"; // 10:00 in Paris
const REMINDER_TIME = "2026-10-20T16:00:00.000Z"; // 18:00 in Paris
const EVENING = "2026-10-20T17:00:00.000Z"; // 19:00 in Paris

describe.skipIf(!connectionString)("Appointment Reminders (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let profiles: Profiles;
  let jobOffers: JobOffers;
  let applications: Applications;
  let coaches: HumanCoaches;
  let reminders: AppointmentReminders;
  let outbox: MailMessage[];
  const clock = { now: new Date(MORNING) };
  const at = (iso: string) => (clock.now = new Date(iso));
  let marie: string;
  let paul: string;

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

  /** An Interview for `owner` at `scheduledAt` (French time), entered at the clock's time; its id. */
  async function interview(owner: string, scheduledAt: string, details: { title?: string; employer?: string; place?: string } = {}) {
    const applicationId = await applicationInInterview(owner, details.title ?? "DAF H/F", details.employer ?? "Acme Industrie");
    const added = await applications.addInterview(owner, applicationId, { scheduledAt, ...(details.place ? { place: details.place } : {}) });
    if (!added.ok) throw new Error("fixture Interview refused");
    return { applicationId, id: added.application.interviews.at(-1)!.id };
  }

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.auth.options.database as Pool;
    await migrateProfiles(database);
    await migrateJobOffers(database);
    await migrateApplications(database);
    await migrateHumanCoaches(database);
    await migrateAppointmentReminders(database);
    await migrateAppointmentReminders(database); // safe to run twice
    at(MORNING);
    outbox = [];
    profiles = createProfiles(database);
    jobOffers = createJobOffers(database);
    applications = createApplications(database, { jobOffers, profiles, now: () => clock.now });
    coaches = createHumanCoaches(database, { profiles, applications, tailoredDocuments: { get: async () => null }, tailoredCvs: { get: async () => null }, now: () => clock.now });
    reminders = createAppointmentReminders(database, { mailer: { send: async (message) => void outbox.push(message) }, baseURL: "https://app.jobbbox.fr", now: () => clock.now });
    marie = await signIn("marie.dupont@example.fr");
    paul = await signIn("paul.martin@example.fr");
  }, 60_000);
  afterEach(async () => {
    await testAuth.stop();
  }, 60_000);

  it("emails the Candidate at 18:00 the day before an Interview tomorrow at 09:00, once, with its time, place and a link to the Agenda", async () => {
    await interview(marie, "2026-10-21T09:00", { place: "12 rue de la République, Lyon" });

    at(REMINDER_TIME);
    await reminders.sendDue();

    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.to).toBe("marie.dupont@example.fr");
    expect(outbox[0]!.text).toContain("09:00");
    expect(outbox[0]!.text).toContain("DAF H/F");
    expect(outbox[0]!.text).toContain("12 rue de la République, Lyon");
    expect(outbox[0]!.text).toContain("https://app.jobbbox.fr/agenda");
  });

  it("sends nothing for a Cancelled Interview", async () => {
    const { applicationId, id } = await interview(marie, "2026-10-21T09:00");
    await applications.cancelInterview(marie, applicationId, id);

    at(REMINDER_TIME);
    await reminders.sendDue();

    expect(outbox).toEqual([]);
  });

  it("sends nothing for an Agenda Item entered after 18:00 for tomorrow, even when the job runs later that evening", async () => {
    at(EVENING);
    await interview(marie, "2026-10-21T09:00");

    await reminders.sendDue();

    expect(outbox).toEqual([]);
  });

  it("sends nothing twice when the job runs again, or on two workers at once", async () => {
    await interview(marie, "2026-10-21T09:00");

    at(REMINDER_TIME);
    await Promise.all([reminders.sendDue(), reminders.sendDue()]);
    at("2026-10-20T16:30:00.000Z");
    await reminders.sendDue();

    expect(outbox).toHaveLength(1);
  });

  it("reminds a Rescheduled Interview again for its new date", async () => {
    const { applicationId, id } = await interview(marie, "2026-10-21T09:00");
    at(REMINDER_TIME);
    await reminders.sendDue();
    at("2026-10-21T05:00:00.000Z"); // 07:00 on the day: moved to the next day
    await applications.editInterview(marie, applicationId, id, { scheduledAt: "2026-10-22T11:00" });

    at("2026-10-21T16:00:00.000Z");
    await reminders.sendDue();

    expect(outbox).toHaveLength(2);
    expect(outbox[1]!.text).toContain("11:00");
  });

  it("sends nothing for the day after tomorrow, nor for later today", async () => {
    await interview(marie, "2026-10-22T09:00", { title: "Après-demain" });
    await interview(marie, "2026-10-20T20:00", { title: "Ce soir" });

    at(REMINDER_TIME);
    await reminders.sendDue();

    expect(outbox).toEqual([]);
  });
});
