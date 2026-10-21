import type { MasterCvContent } from "@jobhub/shared";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApplications, migrateApplications, type Applications } from "../applications";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { createHumanCoaches, migrateHumanCoaches, type HumanCoaches } from "../human-coaches";
import { createJobOffers, migrateJobOffers, type JobOffers } from "../job-offers";
import { createProfiles, migrateProfiles, type Profiles } from "../profiles";
import { agendaPeriod, createAgenda, type Agenda } from "./index";

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
  let coaches: HumanCoaches;
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

  async function addInterview(owner: string, applicationId: string, scheduledAt: string, details: object = {}) {
    const added = await applications.addInterview(owner, applicationId, { scheduledAt, ...details });
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
    await migrateHumanCoaches(database);
    profiles = createProfiles(database);
    jobOffers = createJobOffers(database);
    applications = createApplications(database, { jobOffers, profiles });
    coaches = createHumanCoaches(database, { profiles, applications, tailoredDocuments: { get: async () => null }, tailoredCvs: { get: async () => null } });
    agenda = createAgenda(database);
    candidateId = await signIn("marie.dupont@example.fr");
    otherCandidateId = await signIn("paul.martin@example.fr");
  }, 60_000);
  afterEach(async () => {
    await testAuth.stop();
  }, 60_000);

  it("shows only the signed-in Candidate's Interviews, with the Job Offer's title and company and the Application they belong to", async () => {
    const mine = await applicationInInterview(candidateId, "DAF H/F", "Acme Industrie");
    const theirs = await applicationInInterview(otherCandidateId, "Contrôleur de gestion", "Globex");
    await addInterview(candidateId, mine, "2026-10-22T14:30");
    await addInterview(otherCandidateId, theirs, "2026-10-22T09:00");

    expect(await agenda.days(candidateId, { period: "upcoming", now: NOW })).toEqual([
      {
        day: "2026-10-22",
        items: [
          {
            kind: "interview",
            id: expect.any(String),
            scheduledAt: new Date("2026-10-22T12:30:00.000Z"),
            durationMinutes: null,
            format: null,
            place: "",
            applicationId: mine,
            jobTitle: "DAF H/F",
            employer: "Acme Industrie",
            reschedules: [],
          },
        ],
      },
    ]);
  });

  it("shows what the Candidate needs on the day: the Interview's duration, format and place or link", async () => {
    const applicationId = await applicationInInterview(candidateId, "DAF H/F", "Acme Industrie");
    await addInterview(candidateId, applicationId, "2026-10-22T14:30", { durationMinutes: 45, format: "video", place: "https://meet.example.com/abc" });

    expect((await agenda.days(candidateId, { period: "upcoming", now: NOW }))[0]?.items).toMatchObject([
      { durationMinutes: 45, format: "video", place: "https://meet.example.com/abc" },
    ]);
  });

  it("shows upcoming Interviews from today on, oldest first, and past ones (before today) only when asked, newest first", async () => {
    const daf = await applicationInInterview(candidateId, "DAF H/F", "Acme Industrie");
    const controller = await applicationInInterview(candidateId, "Contrôleur de gestion", "Globex");
    await addInterview(candidateId, daf, "2026-10-27T09:00");
    await addInterview(candidateId, controller, "2026-10-20T11:00"); // later today
    await addInterview(candidateId, daf, "2026-10-20T09:00"); // earlier today: still today, so upcoming
    await addInterview(candidateId, controller, "2026-10-20T00:00"); // today's very start, French time
    await addInterview(candidateId, daf, "2026-10-19T23:59"); // yesterday, French time (21:59 UTC): past
    await addInterview(candidateId, controller, "2026-10-13T15:00");
    await addInterview(candidateId, daf, "2026-10-13T10:00");

    expect(shape(await agenda.days(candidateId, { period: "upcoming", now: NOW }))).toEqual([
      ["2026-10-20", ["2026-10-19T22:00:00.000Z", "2026-10-20T07:00:00.000Z", "2026-10-20T09:00:00.000Z"]],
      ["2026-10-27", ["2026-10-27T08:00:00.000Z"]],
    ]);
    expect(shape(await agenda.days(candidateId, { period: "past", now: NOW }))).toEqual([
      ["2026-10-19", ["2026-10-19T21:59:00.000Z"]],
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

  describe("daysBetween: a week or month view's days", () => {
    it("lists the period's Agenda Items oldest first, past and upcoming alike, and nothing outside it", async () => {
      const applicationId = await applicationInInterview(candidateId, "DAF H/F", "Acme Industrie");
      const theirs = await applicationInInterview(otherCandidateId, "Contrôleur de gestion", "Globex");
      await addInterview(candidateId, applicationId, "2026-10-18T23:59"); // the Sunday before
      await addInterview(candidateId, applicationId, "2026-10-22T14:30");
      await addInterview(candidateId, applicationId, "2026-10-19T00:00"); // Monday's very start, before now
      await addInterview(candidateId, applicationId, "2026-10-26T00:00"); // the Monday after
      await addInterview(otherCandidateId, theirs, "2026-10-21T09:00");

      expect(shape(await agenda.daysBetween(candidateId, { first: "2026-10-19", last: "2026-10-25" }))).toEqual([
        ["2026-10-19", ["2026-10-18T22:00:00.000Z"]],
        ["2026-10-22", ["2026-10-22T12:30:00.000Z"]],
      ]);
    });

    it("puts the Agenda Items of the week the clocks go back (end of October) on the right day", async () => {
      const applicationId = await applicationInInterview(candidateId, "DAF H/F", "Acme Industrie");
      await addInterview(candidateId, applicationId, "2026-10-19T00:30"); // Monday, summer time: 22:30 UTC on Sunday 18
      await addInterview(candidateId, applicationId, "2026-10-25T01:30"); // Sunday, before the change (UTC+2)
      await addInterview(candidateId, applicationId, "2026-10-25T23:30"); // Sunday, after the change (UTC+1): 22:30 UTC
      await addInterview(candidateId, applicationId, "2026-10-26T00:30"); // the next Monday: 23:30 UTC on Sunday 25

      expect(shape(await agenda.daysBetween(candidateId, { first: "2026-10-19", last: "2026-10-25" }))).toEqual([
        ["2026-10-19", ["2026-10-18T22:30:00.000Z"]],
        ["2026-10-25", ["2026-10-24T23:30:00.000Z", "2026-10-25T22:30:00.000Z"]],
      ]);
      expect(shape(await agenda.daysBetween(candidateId, { first: "2026-10-26", last: "2026-11-01" }))).toEqual([["2026-10-26", ["2026-10-25T23:30:00.000Z"]]]);
    });

    it("puts the Agenda Items of the week the clocks go forward (end of March) on the right day", async () => {
      const applicationId = await applicationInInterview(candidateId, "DAF H/F", "Acme Industrie");
      await addInterview(candidateId, applicationId, "2026-03-23T00:30"); // Monday, winter time: 23:30 UTC on Sunday 22
      await addInterview(candidateId, applicationId, "2026-03-29T23:30"); // Sunday, after the change (UTC+2): 21:30 UTC
      await addInterview(candidateId, applicationId, "2026-03-30T00:30"); // the next Monday: 22:30 UTC on Sunday 29

      expect(shape(await agenda.daysBetween(candidateId, { first: "2026-03-23", last: "2026-03-29" }))).toEqual([
        ["2026-03-23", ["2026-03-22T23:30:00.000Z"]],
        ["2026-03-29", ["2026-03-29T21:30:00.000Z"]],
      ]);
      expect(shape(await agenda.daysBetween(candidateId, { first: "2026-03-30", last: "2026-04-05" }))).toEqual([["2026-03-30", ["2026-03-29T22:30:00.000Z"]]]);
    });
  });

  it("is empty when the Candidate has no Interview", async () => {
    expect(await agenda.days(candidateId, { period: "upcoming", now: NOW })).toEqual([]);
    expect(await agenda.days(candidateId, { period: "past", now: NOW })).toEqual([]);
    expect(await agenda.unscheduled(candidateId)).toEqual([]);
  });

  it("gives an Interview's note, when the Candidate wrote one", async () => {
    const applicationId = await applicationInInterview(candidateId, "DAF H/F", "Acme Industrie");
    await addInterview(candidateId, applicationId, "2026-10-22T14:30", { note: "avec la DRH" });
    await addInterview(candidateId, applicationId, "2026-10-23T09:00");

    const [first, second] = (await agenda.days(candidateId, { period: "upcoming", now: NOW })).flatMap((day) => day.items);
    expect(first).toMatchObject({ kind: "interview", note: "avec la DRH" });
    expect(second).not.toHaveProperty("note");
  });

  it("a Cancelled Interview stays, with its date of cancellation, among the upcoming and then the past Agenda Items", async () => {
    const applicationId = await applicationInInterview(candidateId, "DAF H/F", "Acme Industrie");
    await addInterview(candidateId, applicationId, "2026-10-22T14:30");
    await addInterview(candidateId, applicationId, "2026-10-13T14:30");
    const [past, upcoming] = (await applications.get(candidateId, applicationId))!.interviews;
    await applications.cancelInterview(candidateId, applicationId, upcoming!.id);
    await applications.cancelInterview(candidateId, applicationId, past!.id);

    expect((await agenda.days(candidateId, { period: "upcoming", now: NOW }))[0]?.items).toMatchObject([{ id: upcoming!.id, cancelledAt: expect.any(Date) }]);
    expect((await agenda.days(candidateId, { period: "past", now: NOW }))[0]?.items).toMatchObject([{ id: past!.id, cancelledAt: expect.any(Date) }]);
  });

  it("gives each Agenda Item its Reschedule history, oldest first, with who made each change", async () => {
    let clock = new Date("2026-10-19T08:00:00.000Z");
    const clocked = createApplications(database, { jobOffers, profiles, now: () => clock });
    const applicationId = await applicationInInterview(candidateId, "DAF H/F", "Acme Industrie");
    const added = await clocked.addInterview(candidateId, applicationId, { scheduledAt: "2026-10-22T14:30" });
    const interviewId = added.ok ? added.application.interviews[0]!.id : "";
    clock = new Date("2026-10-19T12:00:00.000Z");
    await clocked.editInterview(candidateId, applicationId, interviewId, { scheduledAt: "2026-10-23T09:00" });
    clock = new Date("2026-10-20T07:00:00.000Z");
    await clocked.editInterview(candidateId, applicationId, interviewId, { scheduledAt: "2026-10-24T09:00" });

    expect((await agenda.days(candidateId, { period: "upcoming", now: NOW }))[0]?.items).toMatchObject([
      {
        id: interviewId,
        scheduledAt: new Date("2026-10-24T07:00:00.000Z"),
        reschedules: [
          { previousAt: new Date("2026-10-22T12:30:00.000Z"), newAt: new Date("2026-10-23T07:00:00.000Z"), by: "candidate", at: new Date("2026-10-19T12:00:00.000Z") },
          { previousAt: new Date("2026-10-23T07:00:00.000Z"), newAt: new Date("2026-10-24T07:00:00.000Z"), by: "candidate", at: new Date("2026-10-20T07:00:00.000Z") },
        ],
      },
    ]);
  });

  describe("Coaching Sessions", () => {
    let paid = 0;
    /** A Human Coach named `name`, with their Cal.com booking link. */
    async function addCoach(name: string) {
      const added = await coaches.add({ name, email: `${name.split(" ")[0]!.toLowerCase()}@rh-conseil.fr`, bookingUrl: `https://cal.com/${name.split(" ")[0]!.toLowerCase()}/seance` });
      if (!added.ok) throw new Error("fixture Human Coach refused");
      return added.coach;
    }
    /** A Coaching Session `owner` paid with `coachId`, as Stripe's webhook records it; its id. */
    async function paySession(owner: string, coachId: string) {
      paid += 1;
      await coaches.recordPaidSession({ checkoutSessionId: `cs_${paid}`, candidateId: owner, coachId, amount: 9000, currency: "eur" });
      return (await coaches.sessions(owner))[0]!.id;
    }

    it("a paid Coaching Session with no date is an Unscheduled Coaching Session, with the Human Coach's booking link, and not in the dated lists", async () => {
      const sophie = await addCoach("Sophie Martin");
      const sessionId = await paySession(candidateId, sophie.id);
      await paySession(otherCandidateId, sophie.id);

      expect(await agenda.unscheduled(candidateId)).toEqual([{ id: sessionId, coach: { id: sophie.id, name: "Sophie Martin", bookingUrl: "https://cal.com/sophie/seance" }, paidAt: expect.any(Date), reschedules: [] }]);
      expect(await agenda.days(candidateId, { period: "upcoming", now: NOW })).toEqual([]);
      expect(await agenda.days(candidateId, { period: "past", now: NOW })).toEqual([]);
    });

    it("once dated, a Coaching Session leaves « À planifier » for the list, on its day in French time, among the Interviews", async () => {
      const sophie = await addCoach("Sophie Martin");
      const sessionId = await paySession(candidateId, sophie.id);
      const applicationId = await applicationInInterview(candidateId, "DAF H/F", "Acme Industrie");
      await addInterview(candidateId, applicationId, "2026-10-22T14:30");

      await coaches.scheduleSession(candidateId, sessionId, { scheduledAt: "2026-10-22T23:30", durationMinutes: 45, videoLink: "https://meet.google.com/abc" });

      expect(await agenda.unscheduled(candidateId)).toEqual([]);
      expect(await agenda.days(candidateId, { period: "upcoming", now: NOW })).toEqual([
        {
          day: "2026-10-22",
          items: [
            expect.objectContaining({ kind: "interview", scheduledAt: new Date("2026-10-22T12:30:00.000Z") }),
            { kind: "coachingSession", id: sessionId, scheduledAt: new Date("2026-10-22T21:30:00.000Z"), coach: { id: sophie.id, name: "Sophie Martin" }, durationMinutes: 45, videoLink: "https://meet.google.com/abc", changedBy: "candidate", reschedules: [] },
          ],
        },
      ]);
    });

    it("reflects a date the Human Coach entered or corrected, saying the coach changed it", async () => {
      const sophie = await addCoach("Sophie Martin");
      const sessionId = await paySession(candidateId, sophie.id);
      await coaches.scheduleSession(candidateId, sessionId, { scheduledAt: "2026-10-22T10:00", note: "Préparer mon pitch." });

      await coaches.scheduleCoachedSession(sophie.id, sessionId, { scheduledAt: "2026-10-23T11:00", durationMinutes: 60, videoLink: "https://meet.google.com/xyz" });

      expect(await agenda.days(candidateId, { period: "upcoming", now: NOW })).toEqual([
        {
          day: "2026-10-23",
          items: [
            { kind: "coachingSession", id: sessionId, scheduledAt: new Date("2026-10-23T09:00:00.000Z"), coach: { id: sophie.id, name: "Sophie Martin" }, durationMinutes: 60, videoLink: "https://meet.google.com/xyz", note: "Préparer mon pitch.", changedBy: "coach", reschedules: [] },
          ],
        },
      ]);
    });

    it("a week or month view shows dated Coaching Sessions among the Interviews, never Unscheduled ones", async () => {
      const sophie = await addCoach("Sophie Martin");
      const dated = await paySession(candidateId, sophie.id);
      await paySession(candidateId, sophie.id);
      await coaches.scheduleSession(candidateId, dated, { scheduledAt: "2026-10-22T09:00" });
      const applicationId = await applicationInInterview(candidateId, "DAF H/F", "Acme Industrie");
      await addInterview(candidateId, applicationId, "2026-10-22T14:30");

      expect(await agenda.daysBetween(candidateId, { first: "2026-10-01", last: "2026-10-31" })).toEqual([
        {
          day: "2026-10-22",
          items: [expect.objectContaining({ kind: "coachingSession", id: dated }), expect.objectContaining({ kind: "interview", scheduledAt: new Date("2026-10-22T12:30:00.000Z") })],
        },
      ]);
    });

    it("a cancelled Coaching Session is back under « À planifier », its cancellation in its history, and leaves the dated lists", async () => {
      const sophie = await addCoach("Sophie Martin");
      const sessionId = await paySession(candidateId, sophie.id);
      await coaches.scheduleSession(candidateId, sessionId, { scheduledAt: "2026-10-22T14:00" });

      await coaches.cancelSession(candidateId, sessionId);

      expect(await agenda.days(candidateId, { period: "upcoming", now: NOW })).toEqual([]);
      expect(await agenda.unscheduled(candidateId)).toMatchObject([{ id: sessionId, reschedules: [{ previousAt: new Date("2026-10-22T12:00:00.000Z"), newAt: null, by: "candidate" }] }]);
    });

    it("shows only the Candidate's own Coaching Sessions", async () => {
      const sophie = await addCoach("Sophie Martin");
      const theirs = await paySession(otherCandidateId, sophie.id);
      await coaches.scheduleSession(otherCandidateId, theirs, { scheduledAt: "2026-10-22T10:00" });

      expect(await agenda.days(candidateId, { period: "upcoming", now: NOW })).toEqual([]);
      expect(await agenda.unscheduled(candidateId)).toEqual([]);
    });

    it("keeps a Retired Human Coach's past Coaching Sessions, newest first among the past Agenda Items", async () => {
      const sophie = await addCoach("Sophie Martin");
      const older = await paySession(candidateId, sophie.id);
      const newer = await paySession(candidateId, sophie.id);
      await coaches.scheduleSession(candidateId, older, { scheduledAt: "2026-10-06T10:00" });
      await coaches.scheduleSession(candidateId, newer, { scheduledAt: "2026-10-13T10:00" });
      const applicationId = await applicationInInterview(candidateId, "DAF H/F", "Acme Industrie");
      await addInterview(candidateId, applicationId, "2026-10-13T15:00");

      await coaches.retire(sophie.id);

      expect(shape(await agenda.days(candidateId, { period: "past", now: NOW }))).toEqual([
        ["2026-10-13", ["2026-10-13T13:00:00.000Z", "2026-10-13T08:00:00.000Z"]],
        ["2026-10-06", ["2026-10-06T08:00:00.000Z"]],
      ]);
    });
  });
});

describe("agendaPeriod: where the Agenda puts an instant, split at the start of today in French time", () => {
  it("puts anything from today's midnight in French time on in the upcoming Agenda Items, even earlier today", () => {
    expect(agendaPeriod(new Date("2026-10-20T07:00:00.000Z"), NOW)).toBe("upcoming"); // 09:00 today, before now
    expect(agendaPeriod(new Date("2026-10-19T22:00:00.000Z"), NOW)).toBe("upcoming"); // 00:00 today, French time
    expect(agendaPeriod(new Date("2026-10-27T08:00:00.000Z"), NOW)).toBe("upcoming");
  });

  it("puts anything before today in French time in the past ones, even when it is today in UTC", () => {
    expect(agendaPeriod(new Date("2026-10-19T21:59:59.999Z"), NOW)).toBe("past"); // 23:59 yesterday, French time
    expect(agendaPeriod(new Date("2026-10-13T08:00:00.000Z"), NOW)).toBe("past");
  });

  it("follows French time in winter too, and just after midnight", () => {
    const winterNow = new Date("2026-11-04T23:30:00.000Z"); // 00:30 on 5 November, French time (UTC+1)
    expect(agendaPeriod(new Date("2026-11-04T23:00:00.000Z"), winterNow)).toBe("upcoming"); // 00:00 on the 5th
    expect(agendaPeriod(new Date("2026-11-04T22:59:00.000Z"), winterNow)).toBe("past"); // 23:59 on the 4th
  });
});
