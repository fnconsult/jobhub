import type { ApplicationStatus, MasterCvContent } from "@jobhub/shared";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApplications, migrateApplications, type Applications } from "../applications";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { createProfiles, migrateProfiles, type Profiles } from "../profiles";
import {
  createJobOffers,
  createSourceChecks,
  EXPIRED_RECHECK_INTERVAL_DAYS,
  migrateJobOffers,
  RECHECK_INTERVAL_DAYS,
  type JobOffers,
  type SourceChecks,
} from "./index";

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

const posting = {
  source: { url: "https://www.welcometothejungle.com/fr/companies/seb/jobs/daf-lyon", name: "Welcome to the Jungle" },
  title: "Directeur administratif et financier H/F",
  content: "Rattaché au Directeur général, vous pilotez la finance du groupe.",
};

const daysFromNow = (days: number) => new Date(Date.now() + days * 86_400_000);

// Issue #16: which Job Offers the worker re-checks at their source, when, and
// what a re-check makes of them (Expired Job Offers).
describe.skipIf(!connectionString)("Job Offer source re-checks (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let jobOffers: JobOffers;
  let profiles: Profiles;
  let applications: Applications;
  let sourceChecks: SourceChecks;
  let candidateId: string;
  let profileId: string;

  async function signIn(email: string) {
    const cookie = await signInWithMagicLink(testAuth, email);
    return (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id as string;
  }

  async function capture(input: object = posting): Promise<string> {
    const captured = await jobOffers.capture(input);
    if (!captured.ok) throw new Error("fixture Job Offer refused");
    return captured.jobOffer.id;
  }

  /** The Candidate saves the Job Offer as an Application, and moves it to `status` by hand. */
  async function follow(jobOfferId: string, status: ApplicationStatus = "applied", owner = candidateId, profile = profileId): Promise<string> {
    const saved = await applications.save(owner, { jobOfferId, profileId: profile });
    if (!saved.ok) throw new Error("fixture Application refused");
    await applications.change(owner, saved.application.id, { status });
    return saved.application.id;
  }

  /** A Job Offer captured and followed by an ongoing Application: one the worker re-checks. */
  async function followed(input: object = posting): Promise<string> {
    const id = await capture(input);
    await follow(id);
    return id;
  }

  const dueIds = async (at: Date, limit = 10) => (await sourceChecks.dueForRecheck(at, limit)).map((due) => due.id);

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.auth.options.database as Pool;
    await migrateProfiles(database);
    await migrateJobOffers(database);
    await migrateApplications(database);
    profiles = createProfiles(database);
    jobOffers = createJobOffers(database);
    applications = createApplications(database, { jobOffers, profiles });
    sourceChecks = createSourceChecks(database);
    candidateId = await signIn("marie.dupont@example.fr");
    const created = await profiles.create(candidateId, { masterCv, searchCriteria: { targetRole: "DAF", location: "Lyon" } });
    if (!created.ok) throw new Error("fixture Profile refused");
    profileId = created.profile.id;
  });
  afterEach(async () => {
    await testAuth.stop();
  });

  describe("what is re-checked", () => {
    it("is due every few days: three days after capture, then three days after each re-check", async () => {
      const id = await followed();

      expect(await sourceChecks.dueForRecheck(daysFromNow(2), 10)).toEqual([]);
      expect(await sourceChecks.dueForRecheck(daysFromNow(3.1), 10)).toEqual([{ id, sourceUrl: posting.source.url }]);

      await sourceChecks.record(id, "published", daysFromNow(3.1));
      expect(await sourceChecks.dueForRecheck(daysFromNow(5), 10)).toEqual([]);
      expect(await sourceChecks.dueForRecheck(daysFromNow(6.2), 10)).toEqual([{ id, sourceUrl: posting.source.url }]);
    });

    it("is due RECHECK_INTERVAL_DAYS × 24 hours after the last check, even across a clock change in the database's time zone", async () => {
      const id = await followed();
      const hoursAfter = (from: string, hours: number) => new Date(Date.parse(from) + hours * 3_600_000);
      // A session in a time zone with daylight saving time: a calendar day there is 23 or 25 hours long twice a year.
      const client = await database.connect();
      try {
        await client.query("SET TIME ZONE 'Europe/Paris'");
        const parisChecks = createSourceChecks(client);
        const interval = RECHECK_INTERVAL_DAYS * 24;
        // Clocks go back on 25 October 2026 and forward on 29 March 2026, in Paris.
        for (const checkedAt of ["2026-10-24T00:00:00+02:00", "2026-03-28T00:00:00+01:00"]) {
          await parisChecks.record(id, "published", new Date(checkedAt));
          expect(await parisChecks.dueForRecheck(hoursAfter(checkedAt, interval - 0.5), 10), `${checkedAt} + ${interval - 0.5} h`).toEqual([]);
          expect(await parisChecks.dueForRecheck(hoursAfter(checkedAt, interval + 0.5), 10), `${checkedAt} + ${interval + 0.5} h`).toEqual([
            { id, sourceUrl: posting.source.url },
          ]);
        }
      } finally {
        await client.query("RESET TIME ZONE");
        client.release();
      }
    });

    it("only Job Offers an ongoing Application follows: never one no Candidate applies to, nor one whose Applications are all over", async () => {
      const ongoing = await followed();
      await capture({ source: { url: "https://www.apec.fr/offre/sans-candidature" }, title: "DAF", content: "Poste sans candidature." });
      for (const status of ["accepted", "rejected", "abandoned"] as const) {
        await follow(await capture({ source: { url: `https://www.apec.fr/offre/${status}` }, title: "DAF", content: `Poste ${status}.` }), status);
      }

      expect(await dueIds(daysFromNow(30))).toEqual([ongoing]);
    });

    it("a Job Offer stops being re-checked once its last ongoing Application is over, and is again when one is reopened", async () => {
      const id = await capture();
      const applicationId = await follow(id, "interview");

      await applications.change(candidateId, applicationId, { status: "abandoned" });
      expect(await dueIds(daysFromNow(30))).toEqual([]);

      await applications.change(candidateId, applicationId, { status: "applied" });
      expect(await dueIds(daysFromNow(30))).toEqual([id]);
    });

    it("one ongoing Application is enough, whoever's it is", async () => {
      const id = await capture();
      await follow(id, "rejected");
      const otherCandidate = await signIn("paul.martin@example.fr");
      const other = await profiles.create(otherCandidate, { masterCv, searchCriteria: { targetRole: "DAF", location: "Lyon" } });
      if (!other.ok) throw new Error("fixture Profile refused");
      await follow(id, "to_apply", otherCandidate, other.profile.id);

      expect(await sourceChecks.dueForRecheck(daysFromNow(30), 10)).toEqual([{ id, sourceUrl: posting.source.url }]);
    });

    it("is never due without a source URL", async () => {
      await followed({ title: "DAF", content: "Poste sans URL." });

      expect(await sourceChecks.dueForRecheck(daysFromNow(30), 10)).toEqual([]);
    });

    it("re-checks the longest unchecked first, a batch at a time", async () => {
      const first = await followed();
      const second = await followed({ source: { url: "https://www.apec.fr/offre/2" }, title: "DAF", content: "Poste 2." });
      await sourceChecks.record(first, "unknown", daysFromNow(4));

      expect(await dueIds(daysFromNow(8), 1)).toEqual([second]);
      expect(await dueIds(daysFromNow(8), 10)).toEqual([second, first]);
    });

    it("counts the days as elapsed time, whatever the database's time zone and its clock changes", async () => {
      // A database on Europe/Paris time: its clocks go back an hour on 25 October 2026.
      // Three calendar days there span 73 hours, three days of elapsed time 72.
      const client = await database.connect();
      try {
        await client.query("SET TIME ZONE 'Europe/Paris'");
        const checks = createSourceChecks(client);
        const id = await followed();
        await checks.record(id, "unknown", new Date("2026-10-23T20:00:00Z"));

        expect(await checks.dueForRecheck(new Date("2026-10-26T19:59:00Z"), 10)).toEqual([]);
        expect(await checks.dueForRecheck(new Date("2026-10-26T20:30:00Z"), 10)).toEqual([{ id, sourceUrl: posting.source.url }]);
      } finally {
        await client.query("RESET TIME ZONE");
        client.release();
      }
    });

    it("re-checks an Expired Job Offer too, less often: every two weeks instead of every few days", async () => {
      const id = await followed();
      await sourceChecks.record(id, "gone", daysFromNow(3.5));
      await sourceChecks.record(id, "gone", daysFromNow(7));
      expect(await jobOffers.get(id)).toHaveProperty("expiredAt");

      expect(await sourceChecks.dueForRecheck(daysFromNow(7 + RECHECK_INTERVAL_DAYS + 1), 10)).toEqual([]);
      expect(await sourceChecks.dueForRecheck(daysFromNow(7 + EXPIRED_RECHECK_INTERVAL_DAYS + 0.1), 10)).toEqual([{ id, sourceUrl: posting.source.url }]);
    });
  });

  describe("what a re-check makes of a Job Offer", () => {
    it("one gone check does not expire it", async () => {
      const id = await followed();

      expect(await sourceChecks.record(id, "gone", daysFromNow(3.5))).toEqual({ expired: false });

      expect(await jobOffers.get(id)).not.toHaveProperty("expiredAt");
    });

    it("two gone checks in a row make it an Expired Job Offer, as of the check that confirmed it", async () => {
      const id = await followed();
      const confirmedAt = daysFromNow(7);

      await sourceChecks.record(id, "gone", daysFromNow(3.5));
      expect(await sourceChecks.record(id, "gone", confirmedAt)).toEqual({ expired: true });

      expect(await jobOffers.get(id)).toMatchObject({ id, expiredAt: confirmedAt });
      expect(await jobOffers.findBySourceUrl(posting.source.url)).toMatchObject({ expiredAt: confirmedAt });
    });

    it("a live check in between resets the count: it takes two gone checks in a row again", async () => {
      const id = await followed();

      await sourceChecks.record(id, "gone", daysFromNow(3.5));
      await sourceChecks.record(id, "published", daysFromNow(7));
      await sourceChecks.record(id, "gone", daysFromNow(10));
      expect(await jobOffers.get(id)).not.toHaveProperty("expiredAt");

      await sourceChecks.record(id, "gone", daysFromNow(13));
      expect(await jobOffers.get(id)).toHaveProperty("expiredAt");
    });

    it("a check that could not read the source changes nothing: neither resets the count nor adds to it", async () => {
      const id = await followed();

      await sourceChecks.record(id, "gone", daysFromNow(3.5));
      await sourceChecks.record(id, "unknown", daysFromNow(7));
      expect(await jobOffers.get(id)).not.toHaveProperty("expiredAt");

      await sourceChecks.record(id, "gone", daysFromNow(10));
      expect(await jobOffers.get(id)).toHaveProperty("expiredAt");
    });

    it("keeps the date it was first confirmed expired while its source stays gone", async () => {
      const id = await followed();
      const confirmedAt = daysFromNow(7);
      await sourceChecks.record(id, "gone", daysFromNow(3.5));
      await sourceChecks.record(id, "gone", confirmedAt);

      await sourceChecks.record(id, "gone", daysFromNow(21));
      await sourceChecks.record(id, "unknown", daysFromNow(35));

      expect(await jobOffers.get(id)).toMatchObject({ expiredAt: confirmedAt });
    });

    it("takes an Expired Job Offer back to published when a later re-check finds its source publishing it again", async () => {
      const id = await followed();
      await sourceChecks.record(id, "gone", daysFromNow(3.5));
      await sourceChecks.record(id, "gone", daysFromNow(7));

      await sourceChecks.record(id, "published", daysFromNow(21));
      expect(await jobOffers.get(id)).not.toHaveProperty("expiredAt");

      // ...and it takes two gone checks in a row to expire it again.
      await sourceChecks.record(id, "gone", daysFromNow(24));
      expect(await jobOffers.get(id)).not.toHaveProperty("expiredAt");
    });

    it("never changes the Application Status", async () => {
      const id = await capture();
      const applicationId = await follow(id, "interview");
      const before = await applications.get(candidateId, applicationId);

      await sourceChecks.record(id, "gone", daysFromNow(3.5));
      await sourceChecks.record(id, "gone", daysFromNow(7));

      expect(await applications.get(candidateId, applicationId)).toMatchObject({ status: "interview", statusChangedAt: before!.statusChangedAt });
    });
  });
});
