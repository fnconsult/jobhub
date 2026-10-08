import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createThrowawayDatabase } from "../test-support/throwaway-database";
import {
  createJobOffers,
  createSourceChecks,
  EXPIRED_RECHECK_INTERVAL_DAYS,
  forgetExpiredGuestCaptures,
  migrateJobOffers,
  RECHECK_INTERVAL_DAYS,
  type JobOffers,
} from "./index";

const connectionString = process.env.DATABASE_URL;

const posting = {
  source: { url: "https://www.welcometothejungle.com/fr/companies/seb/jobs/daf-lyon", name: "Welcome to the Jungle" },
  title: "Directeur administratif et financier H/F",
  content: "Rattaché au Directeur général, vous pilotez la finance du groupe.\n\nProfil : 15 ans d'expérience.",
  employer: "Groupe Seb",
  location: "Écully (69)",
  contractType: "cdi",
  remoteWork: "hybrid",
  salary: { min: 110_000, max: 130_000 },
  skills: ["IFRS", "Consolidation"],
  requiredExperienceYears: 15,
};

describe.skipIf(!connectionString)("Job Offers (needs Postgres: DATABASE_URL)", () => {
  let throwaway: Awaited<ReturnType<typeof createThrowawayDatabase>>;
  let jobOffers: JobOffers;

  beforeEach(async () => {
    throwaway = await createThrowawayDatabase("test_job_offers");
    await migrateJobOffers(throwaway.pool);
    jobOffers = createJobOffers(throwaway.pool);
  });
  afterEach(async () => {
    await throwaway.drop();
  });

  it("captures a Job Offer with its source, full content, employer, location, contract type and salary", async () => {
    const captured = await jobOffers.capture(posting);

    expect(captured.ok).toBe(true);
    if (!captured.ok) return;
    expect(captured.jobOffer).toEqual({ id: expect.any(String), ...posting });
    expect(await jobOffers.get(captured.jobOffer.id)).toEqual(captured.jobOffer);
  });

  it("names the source after its site when the capture does not, and keeps what the posting leaves out unset", async () => {
    const captured = await jobOffers.capture({ source: { url: "https://www.apec.fr/candidat/offre/123" }, title: "DAF", content: "Poste de DAF." });

    expect(captured.ok && captured.jobOffer).toEqual({
      id: expect.any(String),
      source: { url: "https://www.apec.fr/candidat/offre/123", name: "apec.fr" },
      title: "DAF",
      content: "Poste de DAF.",
    });
  });

  it("drops NUL characters scraped from the page, which Postgres cannot store", async () => {
    const captured = await jobOffers.capture({
      ...posting,
      source: { url: "https://www.apec.fr/offre/1\u000023" },
      title: "DAF\u0000 H/F",
      content: "Poste\u0000 de DAF.", skills: ["IF\u0000RS"],
    });

    expect(captured.ok && captured.jobOffer).toMatchObject({ source: { url: "https://www.apec.fr/offre/123" }, title: "DAF H/F", content: "Poste de DAF.", skills: ["IFRS"] });
    expect((await jobOffers.capture({ ...posting, title: "\u0000" })).ok).toBe(false);
  });

  it("returns the same Job Offer when the same posting is captured again from its URL", async () => {
    const first = await jobOffers.capture(posting);
    const again = await jobOffers.capture({
      ...posting,
      source: { url: "https://WWW.welcometothejungle.com/fr/companies/seb/jobs/daf-lyon/?utm_source=linkedin&utm_medium=social#apply" },
      content: "The page changed a little.",
    });

    expect(first.ok && again.ok && again.jobOffer.id).toBe(first.ok && first.jobOffer.id);
    expect(again.ok && again.jobOffer.content).toBe(posting.content);
  });

  it("returns the same Job Offer when the same posting text is captured from another site", async () => {
    const first = await jobOffers.capture(posting);
    const elsewhere = await jobOffers.capture({
      ...posting,
      source: { url: "https://www.indeed.fr/viewjob?jk=abc" },
      content: `  ${posting.content.toUpperCase().replaceAll("\n", "  ")} `,
    });
    const other = await jobOffers.capture({ ...posting, source: { url: "https://www.indeed.fr/viewjob?jk=def" }, content: "Un autre poste." });

    expect(elsewhere.ok && elsewhere.jobOffer.id).toBe(first.ok && first.jobOffer.id);
    expect(other.ok && other.jobOffer.id).not.toBe(first.ok && first.jobOffer.id);
  });

  it("tells apart two postings on one site that differ only by their query string", async () => {
    const first = await jobOffers.capture({ source: { url: "https://www.indeed.fr/viewjob?jk=abc" }, title: "DAF", content: "Poste A." });
    const second = await jobOffers.capture({ source: { url: "https://www.indeed.fr/viewjob?jk=def" }, title: "DAF", content: "Poste B." });

    expect(first.ok && second.ok && second.jobOffer.id).not.toBe(first.ok && first.jobOffer.id);
  });

  it("refuses a capture without a title or content, naming the fields to fix", async () => {
    expect(await jobOffers.capture({ title: " ", content: "", contractType: "stage", salary: { min: -1 }, source: { url: "javascript:alert(1)" } })).toEqual({
      ok: false,
      errors: expect.arrayContaining([
        { field: "title", code: "required" },
        { field: "content", code: "required" },
        { field: "contractType", code: "invalid" },
        { field: "salary.min", code: "invalid" },
        { field: "source.url", code: "invalid" },
      ]),
    });
    expect(await jobOffers.capture("hello")).toMatchObject({ ok: false });
    expect(await jobOffers.get("not-a-uuid")).toBeNull();
    expect(await jobOffers.get("00000000-0000-4000-8000-000000000000")).toBeNull();
  });

  it("finds the Job Offer captured from a source URL, ignoring tracking parameters, so it is not fetched again", async () => {
    const captured = await jobOffers.capture(posting);

    const found = await jobOffers.findBySourceUrl("https://welcometothejungle.com/fr/companies/seb/jobs/daf-lyon?utm_campaign=x");

    expect(found).toEqual(captured.ok && captured.jobOffer);
    expect(await jobOffers.findBySourceUrl("https://www.apec.fr/candidat/offre/999")).toBeNull();
    expect(await jobOffers.findBySourceUrl("pas une url")).toBeNull();
  });

  describe("a Job Offer captured by a Guest (ADR-0003)", () => {
    const hoursFromNow = (hours: number) => new Date(Date.now() + hours * 3_600_000);

    it("is forgotten within 24 hours", async () => {
      const captured = await jobOffers.capture(posting, "guest");
      const id = captured.ok ? captured.jobOffer.id : "";

      await forgetExpiredGuestCaptures(throwaway.pool, hoursFromNow(22));
      expect(await jobOffers.get(id)).not.toBeNull();

      await forgetExpiredGuestCaptures(throwaway.pool, hoursFromNow(23.5));
      expect(await jobOffers.get(id)).toBeNull();
    });

    it("is kept once a Candidate captures the same posting", async () => {
      const byGuest = await jobOffers.capture(posting, "guest");
      const byCandidate = await jobOffers.capture(posting, "candidate");
      expect(byCandidate.ok && byCandidate.jobOffer.id).toBe(byGuest.ok && byGuest.jobOffer.id);

      await forgetExpiredGuestCaptures(throwaway.pool, hoursFromNow(48));
      expect(await jobOffers.get(byGuest.ok ? byGuest.jobOffer.id : "")).not.toBeNull();
    });

    it("never takes away a Job Offer a Candidate captured first", async () => {
      const byCandidate = await jobOffers.capture(posting);
      await jobOffers.capture(posting, "guest");

      await forgetExpiredGuestCaptures(throwaway.pool, hoursFromNow(48));
      expect(await jobOffers.get(byCandidate.ok ? byCandidate.jobOffer.id : "")).not.toBeNull();
    });
  });

  describe("re-checking a Job Offer's source (Expired Job Offers)", () => {
    const daysFromNow = (days: number) => new Date(Date.now() + days * 86_400_000);
    const idOf = (result: Awaited<ReturnType<JobOffers["capture"]>>) => (result.ok ? result.jobOffer.id : "");

    it("is due every few days: three days after capture, then three days after each re-check", async () => {
      const id = idOf(await jobOffers.capture(posting));
      const sourceChecks = createSourceChecks(throwaway.pool);

      expect(await sourceChecks.dueForRecheck(daysFromNow(2), 10)).toEqual([]);
      expect(await sourceChecks.dueForRecheck(daysFromNow(3.1), 10)).toEqual([{ id, sourceUrl: posting.source.url }]);

      await sourceChecks.record(id, "published", daysFromNow(3.1));
      expect(await sourceChecks.dueForRecheck(daysFromNow(5), 10)).toEqual([]);
      expect(await sourceChecks.dueForRecheck(daysFromNow(6.2), 10)).toEqual([{ id, sourceUrl: posting.source.url }]);
    });

    it("is never due without a source URL, or while only Guests captured it", async () => {
      await jobOffers.capture({ title: "DAF", content: "Poste sans URL." });
      await jobOffers.capture({ source: { url: "https://www.apec.fr/offre/guest" }, title: "DAF", content: "Poste vu par un Guest." }, "guest");

      expect(await createSourceChecks(throwaway.pool).dueForRecheck(daysFromNow(30), 10)).toEqual([]);
    });

    it("re-checks an Expired Job Offer too, less often: every two weeks instead of every few days", async () => {
      const id = idOf(await jobOffers.capture(posting));
      const sourceChecks = createSourceChecks(throwaway.pool);

      await sourceChecks.record(id, "expired", daysFromNow(4));

      expect(await sourceChecks.dueForRecheck(daysFromNow(4 + RECHECK_INTERVAL_DAYS + 1), 10)).toEqual([]);
      expect(await sourceChecks.dueForRecheck(daysFromNow(4 + EXPIRED_RECHECK_INTERVAL_DAYS + 0.1), 10)).toEqual([{ id, sourceUrl: posting.source.url }]);
    });

    it("takes an Expired Job Offer back to published when a later re-check finds its source publishing it again", async () => {
      const id = idOf(await jobOffers.capture(posting));
      const sourceChecks = createSourceChecks(throwaway.pool);
      await sourceChecks.record(id, "expired", daysFromNow(4));

      await sourceChecks.record(id, "unknown", daysFromNow(20));
      expect(await jobOffers.get(id)).toHaveProperty("expiredAt");

      await sourceChecks.record(id, "published", daysFromNow(35));
      expect(await jobOffers.get(id)).not.toHaveProperty("expiredAt");
    });

    it("takes an Expired Job Offer back to published when its source page is captured again", async () => {
      const id = idOf(await jobOffers.capture(posting));
      await createSourceChecks(throwaway.pool).record(id, "expired", daysFromNow(4));

      const recaptured = await jobOffers.capture(posting);

      expect(recaptured.ok && recaptured.jobOffer).toMatchObject({ id });
      expect(recaptured.ok && recaptured.jobOffer).not.toHaveProperty("expiredAt");
      expect(await jobOffers.get(id)).not.toHaveProperty("expiredAt");
    });

    it("keeps it expired when only the same text is captured from another address", async () => {
      const id = idOf(await jobOffers.capture(posting));
      await createSourceChecks(throwaway.pool).record(id, "expired", daysFromNow(4));

      await jobOffers.capture({ ...posting, source: { url: "https://www.apec.fr/offre/daf-lyon-copie" } });

      expect(await jobOffers.get(id)).toHaveProperty("expiredAt");
    });

    it("re-checks the longest unchecked first, a batch at a time", async () => {
      const first = idOf(await jobOffers.capture(posting));
      const second = idOf(await jobOffers.capture({ source: { url: "https://www.apec.fr/offre/2" }, title: "DAF", content: "Poste 2." }));
      const sourceChecks = createSourceChecks(throwaway.pool);
      await sourceChecks.record(first, "unknown", daysFromNow(4));

      expect((await sourceChecks.dueForRecheck(daysFromNow(8), 1)).map((due) => due.id)).toEqual([second]);
      expect((await sourceChecks.dueForRecheck(daysFromNow(8), 10)).map((due) => due.id)).toEqual([second, first]);
    });

    it("marks the Job Offer expired, with the date its source was found no longer publishing it", async () => {
      const id = idOf(await jobOffers.capture(posting));
      const foundAt = daysFromNow(3.5);

      await createSourceChecks(throwaway.pool).record(id, "expired", foundAt);

      expect(await jobOffers.get(id)).toMatchObject({ id, expiredAt: foundAt });
      expect(await jobOffers.findBySourceUrl(posting.source.url)).toMatchObject({ expiredAt: foundAt });
    });

    it("keeps a Job Offer not expired when its source could not be read or still publishes it", async () => {
      const id = idOf(await jobOffers.capture(posting));
      const sourceChecks = createSourceChecks(throwaway.pool);

      await sourceChecks.record(id, "unknown", daysFromNow(3.5));
      await sourceChecks.record(id, "published", daysFromNow(7));

      expect(await jobOffers.get(id)).not.toHaveProperty("expiredAt");
    });
  });
});
