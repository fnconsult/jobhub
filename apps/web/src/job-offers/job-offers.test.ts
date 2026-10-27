import type { Provenance } from "@jobhub/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createThrowawayDatabase } from "../test-support/throwaway-database";
import { createJobOffers, createSourceChecks, forgetExpiredGuestCaptures, migrateJobOffers, type JobOffers } from "./index";

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

/** How Job discovery found and read a posting: its web search, its page read, and the model that wrote its summary. */
const found: Provenance = {
  v: 1,
  steps: [
    { kind: "ai", activity: "web_search", task: "web_search", provider: "perplexity", endpoint: "api.perplexity.ai", model: "sonar", tokens: { input: 300, output: 800 }, ms: 4100, at: "2026-10-23T10:00:00.000Z", outcome: "ok", count: 1 },
    { kind: "tool", activity: "read", tool: "job-site", ms: 900, at: "2026-10-23T10:00:05.000Z", outcome: "ok", count: 1 },
    { kind: "ai", activity: "read", task: "offer_analysis", provider: "anthropic", endpoint: "bedrock eu-north-1", model: "anthropic.claude-haiku-4-5", tokens: { input: 6000, output: 700 }, ms: 3900, at: "2026-10-23T10:00:06.000Z", outcome: "ok", count: 1 },
  ],
  sites: [{ kind: "web", domain: "welcometothejungle.com", links: ["https://www.welcometothejungle.com/fr/companies/seb/jobs/daf-lyon"] }],
  startedAt: "2026-10-23T10:00:00.000Z",
  wallMs: 9100,
};
/** The summary written later, when its Application page was first shown. */
const summarized: Provenance = {
  v: 1,
  steps: [{ kind: "ai", activity: "think_write", task: "offer_analysis", provider: "mistral", endpoint: "api.mistral.ai", model: "mistral-medium-3-5", tokens: { input: 2000, output: 200 }, ms: 1500, at: "2026-10-24T08:00:00.000Z", outcome: "ok", count: 1 }],
  sites: [{ kind: "web", domain: "welcometothejungle.com", links: ["https://www.welcometothejungle.com/fr/companies/seb/jobs/daf-lyon"] }],
  startedAt: "2026-10-24T08:00:00.000Z",
  wallMs: 1600,
};

describe.skipIf(!connectionString)("Job Offers (needs Postgres: DATABASE_URL)", () => {
  let throwaway: Awaited<ReturnType<typeof createThrowawayDatabase>>;
  let jobOffers: JobOffers;

  beforeEach(async () => {
    throwaway = await createThrowawayDatabase("test_job_offers");
    // The candidate table as far as private Job Offers need it.
    await throwaway.pool.query("CREATE TABLE IF NOT EXISTS candidate (id text PRIMARY KEY)");
    await throwaway.pool.query("INSERT INTO candidate (id) VALUES ('candidate-1'), ('candidate-2')");
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

  it("says whether a capture stored the posting for the first time, for a Job discovery run's new Job Offers (#404)", async () => {
    const first = await jobOffers.capture(posting);
    const again = await jobOffers.capture(posting);

    expect(first.ok && first.created).toBe(true);
    expect(again.ok && again.created).toBe(false);
  });

  it("keeps the posting date a trusted source states, and refuses one that is not a date or lies in the future", async () => {
    const postedAt = new Date("2026-10-02T15:31:50Z");
    const captured = await jobOffers.capture(posting, "candidate", { postedAt });

    expect(captured.ok && captured.jobOffer.postedAt).toEqual(postedAt);
    expect(captured.ok && (await jobOffers.get(captured.jobOffer.id))?.postedAt).toEqual(postedAt);

    const other = { ...posting, source: { url: "https://www.apec.fr/offre/7" }, content: "Poste à Nantes." };
    expect(await jobOffers.capture(other, "candidate", { postedAt: new Date("hier") })).toEqual({ ok: false, errors: [{ field: "postedAt", code: "invalid" }] });
    expect(await jobOffers.capture(other, "candidate", { postedAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) })).toMatchObject({ ok: false });
    // Only a Date the caller built: text (as a request body would carry) is never coerced into one.
    expect(await jobOffers.capture(other, "candidate", { postedAt: "2026-10-02T15:31:50Z" as unknown as Date })).toEqual({
      ok: false,
      errors: [{ field: "postedAt", code: "invalid" }],
    });
  });

  it("never takes a posting date from the captured posting itself: the browser cannot state a trusted one", async () => {
    // Any client can post to the capture route (Guests need no account), and the first capture of a URL is kept for everyone.
    for (const postedAt of ["2020-01-01T00:00:00Z", new Date("2020-01-01T00:00:00Z")]) {
      const captured = await jobOffers.capture({ ...posting, postedAt }, "guest");

      expect(captured.ok).toBe(true);
      if (!captured.ok) return;
      expect(captured.jobOffer.postedAt).toBeUndefined();
      expect((await jobOffers.get(captured.jobOffer.id))?.postedAt).toBeUndefined();
    }
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

  describe("a Job Offer private to one Candidate (ADR-0049)", () => {
    const fromRecruiter = {
      ...posting,
      title: "DAF H/F pour un client confidentiel",
      content: "Mon client, un groupe industriel lyonnais, cherche son DAF. Rémunération 150 k€.",
      employer: undefined,
    };

    it("makes two Job Offers when a private offer and a shared one have the same URL; the shared one never shows the private one's data", async () => {
      const privateOffer = await jobOffers.capture(fromRecruiter, "candidate", { privateTo: "candidate-1" });
      const shared = await jobOffers.capture(posting);

      expect(privateOffer.ok && shared.ok).toBe(true);
      if (!privateOffer.ok || !shared.ok) return;
      expect(shared.created).toBe(true);
      expect(shared.jobOffer.id).not.toBe(privateOffer.jobOffer.id);
      expect(shared.jobOffer).toEqual({ id: expect.any(String), ...posting });
      expect(await jobOffers.get(shared.jobOffer.id, "candidate-1")).toEqual(shared.jobOffer);
      expect(await jobOffers.findBySourceUrl(posting.source.url)).toEqual(shared.jobOffer);
    });

    it("is seen by its Candidate only: never by another Candidate, nor a Guest, nor found by its URL for them", async () => {
      const captured = await jobOffers.capture(fromRecruiter, "candidate", { privateTo: "candidate-1" });
      if (!captured.ok) throw new Error("not captured");
      const { id } = captured.jobOffer;

      expect(await jobOffers.get(id, "candidate-1")).toEqual(captured.jobOffer);
      expect(await jobOffers.findBySourceUrl(posting.source.url, "candidate-1")).toEqual(captured.jobOffer);
      expect(await jobOffers.get(id, "candidate-2")).toBeNull();
      expect(await jobOffers.get(id)).toBeNull();
      expect(await jobOffers.findBySourceUrl(posting.source.url, "candidate-2")).toBeNull();
      expect(await jobOffers.findBySourceUrl(posting.source.url)).toBeNull();
      expect(await jobOffers.keepForCandidate(id, "candidate-2")).toBeNull();
      expect(await jobOffers.keepForCandidate(id, "candidate-1")).toEqual(captured.jobOffer);
    });

    it("is deduplicated against its Candidate's own private Job Offers only, never another Candidate's or a shared one's text", async () => {
      const shared = await jobOffers.capture({ ...fromRecruiter, source: {} });
      const first = await jobOffers.capture(fromRecruiter, "candidate", { privateTo: "candidate-1" });
      const again = await jobOffers.capture({ ...fromRecruiter, source: {} }, "candidate", { privateTo: "candidate-1" });
      const another = await jobOffers.capture(fromRecruiter, "candidate", { privateTo: "candidate-2" });
      if (!shared.ok || !first.ok || !again.ok || !another.ok) throw new Error("not captured");

      expect(first.created).toBe(true);
      expect(again).toMatchObject({ created: false, jobOffer: { id: first.jobOffer.id } });
      expect(another.created).toBe(true);
      expect(new Set([shared.jobOffer.id, first.jobOffer.id, another.jobOffer.id]).size).toBe(3);
      expect(await jobOffers.findBySourceUrl(posting.source.url, "candidate-2")).toEqual(another.jobOffer);
    });

    it("prefers the Candidate's private Job Offer to the shared one when both come from the same URL", async () => {
      const shared = await jobOffers.capture(posting);
      const privateOffer = await jobOffers.capture(fromRecruiter, "candidate", { privateTo: "candidate-1" });
      if (!shared.ok || !privateOffer.ok) throw new Error("not captured");

      expect(await jobOffers.findBySourceUrl(posting.source.url, "candidate-1")).toEqual(privateOffer.jobOffer);
      expect(await jobOffers.findBySourceUrl(posting.source.url, "candidate-2")).toEqual(shared.jobOffer);
    });
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

  // Which Job Offers are re-checked, and what a re-check makes of them: source-checks.test.ts.
  describe("an Expired Job Offer captured again (Expired Job Offers)", () => {
    const daysFromNow = (days: number) => new Date(Date.now() + days * 86_400_000);
    const idOf = (result: Awaited<ReturnType<JobOffers["capture"]>>) => (result.ok ? result.jobOffer.id : "");
    /** Two gone checks in a row: what makes it an Expired Job Offer. */
    async function expire(id: string) {
      const sourceChecks = createSourceChecks(throwaway.pool);
      await sourceChecks.record(id, "gone", daysFromNow(3.5));
      await sourceChecks.record(id, "gone", daysFromNow(7));
    }

    it("takes it back to published when its source page is captured again", async () => {
      const id = idOf(await jobOffers.capture(posting));
      await expire(id);
      expect(await jobOffers.get(id)).toHaveProperty("expiredAt");

      const recaptured = await jobOffers.capture(posting);

      expect(recaptured.ok && recaptured.jobOffer).toMatchObject({ id });
      expect(recaptured.ok && recaptured.jobOffer).not.toHaveProperty("expiredAt");
      expect(await jobOffers.get(id)).not.toHaveProperty("expiredAt");
    });

    it("takes two gone checks in a row again to expire it after it was captured again", async () => {
      const id = idOf(await jobOffers.capture(posting));
      await expire(id);
      await jobOffers.capture(posting);

      await createSourceChecks(throwaway.pool).record(id, "gone", daysFromNow(10));

      expect(await jobOffers.get(id)).not.toHaveProperty("expiredAt");
    });

    it("keeps it expired when only the same text is captured from another address", async () => {
      const id = idOf(await jobOffers.capture(posting));
      await expire(id);

      await jobOffers.capture({ ...posting, source: { url: "https://www.apec.fr/offre/daf-lyon-copie" } });

      expect(await jobOffers.get(id)).toHaveProperty("expiredAt");
    });
  });
  describe("fields filled from the Job Offer's text (#94)", () => {
    it("keeps the fields read that are well formed, leaves out the others, and never reads the text twice", async () => {
      const captured = await jobOffers.capture({ title: "Chef de projet SI", content: "CDI à Saint-Ouen." });
      if (!captured.ok) throw new Error("fixture Job Offer refused");
      let reads = 0;
      const read = async () => {
        reads += 1;
        // A contract type outside the list and negative years are dropped; the rest is kept.
        return { location: " Saint-Ouen ", contractType: "permanent", skills: ["Pilotage", ""], requiredExperienceYears: -3, salary: { min: 52_000 } } as never;
      };

      const filled = await jobOffers.fillFromText(captured.jobOffer.id, read);
      const again = await jobOffers.fillFromText(captured.jobOffer.id, read);

      expect(filled).toEqual({ ...captured.jobOffer, location: "Saint-Ouen", skills: ["Pilotage"], salary: { min: 52_000 } });
      expect(again).toEqual(filled);
      expect(reads).toBe(1);
    });

    it("keeps nothing and reads again after a failed read; null for an unknown Job Offer", async () => {
      const captured = await jobOffers.capture({ title: "DAF", content: "Poste de DAF." });
      if (!captured.ok) throw new Error("fixture Job Offer refused");

      await expect(jobOffers.fillFromText(captured.jobOffer.id, async () => Promise.reject(new Error("down")))).rejects.toThrow("down");
      expect(await jobOffers.fillFromText(captured.jobOffer.id, async () => ({ employer: "Groupe Seb" }))).toMatchObject({ employer: "Groupe Seb" });
      expect(await jobOffers.fillFromText("00000000-0000-4000-8000-000000000000", async () => ({}))).toBeNull();
    });
  });

  describe("the Job Offer Summary", () => {
    const capturedId = async (input: object = { title: "Finance Director", content: "Lead a team of 12 in London." }) => {
      const captured = await jobOffers.capture(input);
      if (!captured.ok) throw new Error("fixture Job Offer refused");
      return captured.jobOffer.id;
    };

    it("is stored with the fields read from the text, its spacing tidied, and kept when the text is read for a Match Score", async () => {
      const id = await capturedId();

      const filled = await jobOffers.fillFromText(id, async () => ({ location: "London", summary: " Lead a team\nof 12 in London. " }));

      expect(filled).toMatchObject({ location: "London", summary: "Lead a team of 12 in London." });
      expect(await jobOffers.get(id)).toMatchObject({ summary: "Lead a team of 12 in London." });
    });

    it("is read once, with the fields the offer lacks, and a second call at the same time waits for the first one's", async () => {
      const id = await capturedId();
      let reads = 0;
      const read = async () => {
        reads += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { employer: "Acme", summary: "Acme seeks a Finance Director to lead a team of 12." };
      };

      const [first, second] = await Promise.all([jobOffers.summarize(id, read), jobOffers.summarize(id, read)]);
      const later = await jobOffers.summarize(id, read);

      expect(first).toMatchObject({ employer: "Acme", summary: "Acme seeks a Finance Director to lead a team of 12." });
      expect(second).toEqual(first);
      expect(later).toEqual(first);
      expect(reads).toBe(1);
    });

    it("is read for an offer whose fields were read before there were summaries, never replacing a field stated", async () => {
      const id = await capturedId({ title: "DAF", content: "Poste de DAF à Lyon.", employer: "Groupe Seb" });
      await jobOffers.fillFromText(id, async () => ({ location: "Lyon" }));
      await throwaway.pool.query(`UPDATE job_offer SET summary_read_at = NULL WHERE id = $1`, [id]);

      const summarized = await jobOffers.summarize(id, async () => ({ employer: "Autre", summary: "Poste de DAF à Lyon." }));

      expect(summarized).toMatchObject({ employer: "Groupe Seb", location: "Lyon", summary: "Poste de DAF à Lyon." });
    });

    it("comes with the employer's sector, and an offer summarized before there were sectors is read once more for it", async () => {
      const id = await capturedId({ title: "Consultant", content: "Cabinet de conseil en stratégie.", employer: "Acme Conseil" });
      await jobOffers.summarize(id, async () => ({ summary: "Poste de consultant." }));
      await throwaway.pool.query(`UPDATE job_offer SET sector = NULL, subsector = NULL, sector_read_at = NULL WHERE id = $1`, [id]);
      let reads = 0;
      const read = async () => {
        reads += 1;
        return { summary: "Autre résumé.", sector: "Conseil", subsector: "Stratégie et transformation" };
      };

      expect(await jobOffers.summarize(id, read)).toMatchObject({ summary: "Poste de consultant.", sector: "Conseil", subsector: "Stratégie et transformation" });
      expect(await jobOffers.summarize(id, read)).toMatchObject({ sector: "Conseil" });
      expect(reads).toBe(1);
    });

    it("is not asked for again after a read giving none of the right shape, and is asked for again after a failed read", async () => {
      const id = await capturedId();
      await expect(jobOffers.summarize(id, async () => Promise.reject(new Error("down")))).rejects.toThrow("down");
      let reads = 0;
      const tooLong = async () => {
        reads += 1;
        return { summary: "x".repeat(601) };
      };

      expect(await jobOffers.summarize(id, tooLong)).not.toHaveProperty("summary");
      expect(await jobOffers.summarize(id, tooLong)).not.toHaveProperty("summary");
      expect(reads).toBe(1);
      expect(await jobOffers.summarize("00000000-0000-4000-8000-000000000000", tooLong)).toBeNull();
    });

    it("comes as a trusted fact with a posting Job discovery read, never from the posting a browser sends", async () => {
      const fromBrowser = await jobOffers.capture({ ...posting, summary: "Écrit par le navigateur." });
      expect(fromBrowser.ok && fromBrowser.jobOffer).not.toHaveProperty("summary");

      const read = await jobOffers.capture(posting, "candidate", { summary: "Le groupe recrute son DAF." });
      expect(read.ok && read.jobOffer).toMatchObject({ summary: "Le groupe recrute son DAF." });
      let reads = 0;
      expect(await jobOffers.summarize(read.ok ? read.jobOffer.id : "", async () => ((reads += 1), {}))).toMatchObject({ summary: "Le groupe recrute son DAF." });
      expect(reads).toBe(0);
    });

    it("survives the table's migration run again", async () => {
      const id = await capturedId();
      await jobOffers.summarize(id, async () => ({ summary: "Lead a team of 12 in London." }));

      await migrateJobOffers(throwaway.pool);

      expect(await jobOffers.get(id)).toMatchObject({ summary: "Lead a team of 12 in London." });
    });
  });

  describe("its Provenance (#329)", () => {
    it("is how the reading that captured it found and read it", async () => {
      const read = await jobOffers.capture(posting, "candidate", { summary: "Le groupe recrute son DAF.", provenance: found });

      expect(await jobOffers.provenance(read.ok ? read.jobOffer.id : "")).toEqual(found);
    });

    it("is none for an offer captured before Provenance was kept, or sent by a browser (« modèle non enregistré »)", async () => {
      const captured = await jobOffers.capture({ ...posting, provenance: found });

      expect(await jobOffers.provenance(captured.ok ? captured.jobOffer.id : "")).toBeNull();
      expect(await jobOffers.provenance("00000000-0000-4000-8000-000000000000")).toBeNull();
      expect(await jobOffers.provenance("not-an-id")).toBeNull();
    });

    it("is none rather than one holding an id, whatever field it is in", async () => {
      const candidateId = "3f2b8c1e-9d4a-4e6f-8a1b-2c3d4e5f6a7b";
      const naming = { ...found, steps: [{ ...found.steps[0]!, task: `web_search_${candidateId}` }] } as Provenance;

      const read = await jobOffers.capture(posting, "candidate", { provenance: naming });

      expect(await jobOffers.provenance(read.ok ? read.jobOffer.id : "")).toBeNull();
      const { rows } = await throwaway.pool.query<{ stored: string }>(`SELECT provenance::text AS stored FROM job_offer`);
      expect(rows.map((row) => row.stored ?? "").join()).not.toContain(candidateId);
    });

    it("is the capture's that writes the summary of an offer stored without one", async () => {
      const first = await jobOffers.capture(posting);
      const again = await jobOffers.capture(posting, "candidate", { summary: "Le groupe recrute son DAF.", provenance: found });

      expect(await jobOffers.provenance(again.ok ? again.jobOffer.id : "")).toEqual(found);
      expect(first.ok && again.ok && again.jobOffer.id).toBe(first.ok && first.jobOffer.id);
    });

    it("keeps how it was first found when it is found again", async () => {
      const first = await jobOffers.capture(posting, "candidate", { summary: "Le groupe recrute son DAF.", provenance: found });
      await jobOffers.capture(posting, "candidate", { summary: "Autre résumé.", provenance: summarized });

      expect(await jobOffers.provenance(first.ok ? first.jobOffer.id : "")).toEqual(found);
    });

    it("gains the reading that wrote its summary later, after how it was found", async () => {
      const read = await jobOffers.capture(posting, "candidate", { provenance: found });
      const id = read.ok ? read.jobOffer.id : "";

      await jobOffers.summarize(id, async () => ({ summary: "Le groupe recrute son DAF.", provenance: summarized }));

      expect(await jobOffers.provenance(id)).toEqual({ ...found, steps: [...found.steps, ...summarized.steps], wallMs: 10_700 });
    });

    it("is the summary's alone for an offer captured before Provenance was kept", async () => {
      const captured = await jobOffers.capture(posting);
      const id = captured.ok ? captured.jobOffer.id : "";

      await jobOffers.fillFromText(id, async () => ({ location: "Lyon", summary: "Le groupe recrute son DAF.", provenance: summarized }));

      expect(await jobOffers.provenance(id)).toEqual(summarized);
    });

    it("is read for many offers at once, as AI Activity lists a page's (#332): each id given, none for an unknown one", async () => {
      const read = await jobOffers.capture(posting, "candidate", { provenance: found });
      const other = await jobOffers.capture({
        ...posting,
        title: "Contrôleur de gestion H/F",
        employer: "Biomérieux",
        content: "Vous suivez la performance des usines.",
        source: { ...posting.source, url: "https://www.welcometothejungle.com/fr/companies/biomerieux/jobs/cdg-lyon" },
      });
      if (!read.ok || !other.ok) throw new Error("not captured");
      const unknown = "00000000-0000-4000-8000-000000000000";

      const provenances = await jobOffers.provenances([read.jobOffer.id, other.jobOffer.id, unknown, "not-an-id"]);

      expect(provenances).toEqual(new Map([[read.jobOffer.id, found], [other.jobOffer.id, null], [unknown, null], ["not-an-id", null]]));
      expect(await jobOffers.provenances([])).toEqual(new Map());
    });
  });
});
