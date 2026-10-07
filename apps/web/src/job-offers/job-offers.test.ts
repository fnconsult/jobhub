import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createThrowawayDatabase } from "../test-support/throwaway-database";
import { createJobOffers, migrateJobOffers, type JobOffers } from "./index";

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
});
