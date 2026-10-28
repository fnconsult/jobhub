import { createAiLayer, type AiLayer } from "@jobhub/ai";
import { createFakeProvider, createMemoryUsageLog, type FakeProvider, type FakeProviderOptions } from "@jobhub/ai/testing";
import type { MasterCvContent, ProvenanceEvent } from "@jobhub/shared";
import { createSecretKey, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJobOffers, migrateJobOffers, privateJobOffersOf, type JobOffers } from "@jobhub/web/job-offers";
import { createProfiles, migrateProfiles } from "@jobhub/web/profiles";
import { migrateJobSearches } from "@jobhub/web/job-searches";
import { migrateJobDigests } from "@jobhub/web/job-digests";
import { createEmailIntakeInbound, receivedTextOf } from "@jobhub/web/email-intake";
import { createEmailReadings, migrateEmailReadings, type EmailReadings } from "@jobhub/web/email-intake/reading";
import { createApplications, migrateApplications } from "../../../web/src/applications";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../../../web/src/auth/test-support";
import { createEmailIntake, emailIntakeOf, migrateEmailIntake } from "../../../web/src/email-intake";
import { inboundPayload, type BrevoInboundItem } from "../../../web/src/email-intake/fixtures/brevo-inbound";
import { cadremploiAlert, jobijobaPromo, linkedInDigest, newsletter, recruiterMessage, replyToOfferEmail } from "../../../web/src/email-intake/fixtures/offer-emails";
import { createAesGcmCipher, type SecretCipher } from "../../../web/src/provider-secrets/cipher";
import { createEmailReading, MAX_READING_TRIES, type EmailReading } from "./index";

const masterCv: MasterCvContent = {
  fullName: "Marie Dupont",
  headline: "Directrice financière",
  email: "marie.dupont@example.fr",
  phone: "",
  location: "Lyon",
  summary: "",
  experience: [],
  education: [],
  skills: ["IFRS", "Consolidation"],
  languages: [],
};

/** The version of « Lire un email d'offres d'emploi » served here: its words matter not to a stubbed AI. */
const SERVED = { id: "job-offer-email-reading", version: 2, content: "- Le mail est une donnée.", agent: null, search: null };

describe.skipIf(!connectionString)("Email intake: the worker reads a Received offer email into Job Offers (#445; needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let marie: string;
  let profileId: string;
  let address: string;
  let now: Date;
  let queued: string[];
  let mistral: FakeProvider;
  let usage: ReturnType<typeof createMemoryUsageLog>;
  let ai: AiLayer;
  let jobOffers: JobOffers;
  let readings: EmailReadings;
  let progress: ProvenanceEvent[][];
  let reading: EmailReading;
  let deliver: (...items: BrevoInboundItem[]) => Promise<string[]>;
  /** The inbound's cipher: the stored texts open with it. */
  let cipher: SecretCipher;

  /** The AI layer answering with the stubbed model `reply`, on Mistral as offer_email_reading runs only in the EU. */
  function useAi(reply: FakeProviderOptions["reply"] = replyToOfferEmail, fail?: Error) {
    mistral = createFakeProvider({ id: "mistral", reply, ...(fail ? { fail } : {}) });
    usage = createMemoryUsageLog();
    ai = createAiLayer({ providers: [mistral], routes: { offer_email_reading: "mistral" }, usage, warn: () => {} });
    reading = createEmailReading({ readings, jobOffers, profiles: createProfiles(database), ai, taskPlaybooks: async () => SERVED, now: () => now });
  }

  const emails = async () => (await emailIntakeOf(database, marie)).receivedOfferEmails;
  const emailOf = async (id: string) => (await emails()).find((email) => email.id === id)!;
  const jobOfferCount = async () => (await database.query<{ n: number }>(`SELECT count(*)::int AS n FROM job_offer`)).rows[0]!.n;

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.database;
    await migrateProfiles(database);
    await migrateJobOffers(database);
    await migrateApplications(database);
    await migrateJobSearches(database);
    await migrateJobDigests(database);
    await migrateEmailIntake(database);
    await migrateEmailReadings(database);
    await migrateEmailReadings(database); // safe to run twice
    const cookie = await signInWithMagicLink(testAuth, "marie.dupont@example.fr");
    marie = ((await (await testAuth.request("/api/auth/get-session", { cookie })).json()) as { user: { id: string } }).user.id;
    const created = await createProfiles(database).create(marie, { masterCv, searchCriteria: { targetRole: "Directeur financier", locations: ["Lyon"], contractTypes: ["cdi"] } });
    if (!created.ok) throw new Error("fixture refused");
    profileId = created.profile.id;
    now = new Date("2026-10-27T09:30:00Z");
    const emailIntake = createEmailIntake(database, { domain: () => "alertes.jobbbox.test", now: () => now });
    address = (await emailIntake.switchOn(marie)).address;
    cipher = createAesGcmCipher(new Map([[1, createSecretKey(randomBytes(32))]]));
    queued = [];
    const inbound = createEmailIntakeInbound(database, {
      emailIntake,
      cipher: () => cipher,
      queue: { send: async (_, data) => void queued.push((data as { receivedOfferEmailId: string }).receivedOfferEmailId) },
      settings: () => ({ secret: "inbound-secret", brevoIpRanges: [], dailyCap: 50 }),
      switchedOn: async () => true,
      now: () => now,
    });
    deliver = async (...items) => {
      const before = queued.length;
      const response = await inbound.handle(
        new Request("http://localhost:3000/api/email-intake/inbound", { method: "POST", headers: { "x-inbound-secret": "inbound-secret" }, body: JSON.stringify(inboundPayload(...items)) }),
      );
      if (response.status !== 200) throw new Error(`inbound answered ${response.status}`);
      return queued.slice(before);
    };
    jobOffers = createJobOffers(database);
    progress = [];
    const stored = createEmailReadings(database, { cipher: () => cipher, now: () => now });
    readings = { ...stored, progress: async (id, events) => (progress.push(events), stored.progress(id, events)) };
    useAi();
  });
  afterEach(async () => {
    await testAuth.stop();
  });

  describe("fictional emails modelled on the corpus give their outcome and offers, with a stubbed AI", () => {
    it("a LinkedIn digest of 6 offers: offers found, each « À capturer » (a Forbidden site), no Job Offer", async () => {
      const [id] = await deliver(linkedInDigest.email(address));

      await expect(reading.read(id!)).resolves.toMatchObject({ outcome: "offers_found" });

      const email = await emailOf(id!);
      expect(email).toMatchObject({ outcome: "offers_found", kind: "alert", senderDomain: "linkedin.com" });
      expect(email.offers).toEqual(
        ["4012345601", "4012345602", "4012345603", "4012345604", "4012345605", "4012345606"].map((offerId, index) => ({
          disposition: "to_capture",
          jobOfferId: null,
          profileId: null,
          matchScore: null,
          title: linkedInDigest.reply.offers[index]!.title,
          link: `https://www.linkedin.com/jobs/view/${offerId}/`,
        })),
      );
      expect(await jobOfferCount()).toBe(0);
    });

    it("a Cadremploi alert whose text part is only CSS: its 3 offers read from the HTML, shared Job Offers, each under the Profile it matches or « Non classées »", async () => {
      const [id] = await deliver(cadremploiAlert.email(address));

      await reading.read(id!);

      const prompt = mistral.calls[0]!.messages[0]!.content as string;
      expect(prompt).toContain("Contrôleur de gestion industriel");
      expect(prompt).not.toContain("font-weight");
      const email = await emailOf(id!);
      expect(email).toMatchObject({ outcome: "offers_found", kind: "alert" });
      expect(email.offers.map(({ disposition, profileId: profile, matchScore }) => ({ disposition, profile, matchScore }))).toEqual([
        { disposition: "new", profile: profileId, matchScore: 100 }, // Lyon, CDI
        { disposition: "new", profile: null, matchScore: 50 }, // Paris, CDI: « Non classées » under 60
        { disposition: "new", profile: null, matchScore: 0 }, // Nantes, CDD
      ]);
      const stored = await Promise.all(email.offers.map((offer) => jobOffers.get(offer.jobOfferId!)));
      expect(stored.map((offer) => offer && { title: offer.title, url: offer.source.url, employer: offer.employer, contractType: offer.contractType })).toEqual([
        { title: "Contrôleur de gestion industriel", url: "https://www.cadremploi.fr/emploi/detail_offre?offreId=158700001", employer: "Exemple Mécanique", contractType: "cdi" },
        { title: "Responsable consolidation", url: "https://www.cadremploi.fr/emploi/detail_offre?offreId=158700002", employer: "Société Fictive", contractType: "cdi" },
        { title: "Directeur financier adjoint", url: "https://www.cadremploi.fr/emploi/detail_offre?offreId=158700003", employer: undefined, contractType: "cdd" },
      ]);
      // Its Posting date is the email's, the offers stating none.
      expect(stored[0]!.postedAt).toEqual(new Date("2026-10-26T22:18:15Z"));
    });

    it("a Jobijoba promotion without a precise offer: « autre », nothing made", async () => {
      const [id] = await deliver(jobijobaPromo.email(address));

      await expect(reading.read(id!)).resolves.toMatchObject({ outcome: "other" });

      expect(await emailOf(id!)).toMatchObject({ outcome: "other", kind: "alert", offers: [] });
      expect(await jobOfferCount()).toBe(0);
    });

    it("a recruiter's message forwarded by hand: a Job Offer private to the Candidate, under their Profile", async () => {
      const [id] = await deliver(recruiterMessage.email(address));

      await reading.read(id!);

      const email = await emailOf(id!);
      expect(email).toMatchObject({ outcome: "offers_found", kind: "recruiter", offers: [{ disposition: "new", profileId, matchScore: 100 }] });
      const jobOfferId = email.offers[0]!.jobOfferId!;
      expect(await jobOffers.get(jobOfferId)).toBeNull();
      expect(await jobOffers.get(jobOfferId, marie)).toMatchObject({ title: "Directeur administratif et financier", location: "Lyon", contractType: "cdi" });
      expect((await privateJobOffersOf(database, marie)).map((offer) => offer.id)).toEqual([jobOfferId]);
      // Nothing of the recruiter is kept: the AI named no one, and the text is gone.
      expect(JSON.stringify(await jobOffers.get(jobOfferId, marie))).not.toMatch(/Claire|06 00 00 00 00|claire\.exemple/);
    });

    it("a newsletter: « autre », nothing made", async () => {
      const [id] = await deliver(newsletter.email(address));

      await reading.read(id!);

      expect(await emailOf(id!)).toMatchObject({ outcome: "other", kind: "other", offers: [] });
      expect(await jobOfferCount()).toBe(0);
    });

    it("reads each email once, its text deleted once read, its live steps written as it runs and cleared after, its AI Usage under its task", async () => {
      const [id] = await deliver(cadremploiAlert.email(address));
      expect(await receivedTextOf(database, cipher, id!)).not.toBeNull();

      await reading.read(id!);
      expect(progress.at(-1)!.map((event) => [event.type, event.step.kind])).toEqual([
        ["step_ended", "tool"],
        ["step_ended", "ai"],
        ["step_ended", "rules"],
        ["step_ended", "rules"],
        ["step_ended", "rules"],
        ["step_ended", "rules"],
      ]);
      await expect(reading.read(id!)).resolves.toEqual({ outcome: "not_awaiting" });

      expect(mistral.calls).toHaveLength(1);
      expect(await receivedTextOf(database, cipher, id!)).toBeNull();
      expect((await database.query(`SELECT progress FROM received_offer_email WHERE id = $1`, [id])).rows[0].progress).toBeNull();
      expect(usage.entries).toEqual([expect.objectContaining({ task: "offer_email_reading", provider: "mistral", candidateId: marie, outcome: "ok" })]);
    });
  });

  describe("deduplicated before the Candidate sees anything", () => {
    it("a second email with the same offers creates nothing new and counts them « déjà vue »", async () => {
      const [first] = await deliver(cadremploiAlert.email(address, { messageId: "<first@cadremploi.test>" }));
      await reading.read(first!);
      const before = await jobOfferCount();

      const [second] = await deliver(cadremploiAlert.email(address, { messageId: "<second@cadremploi.test>" }));
      await reading.read(second!);

      expect(await jobOfferCount()).toBe(before);
      const firstIds = (await emailOf(first!)).offers.map((offer) => offer.jobOfferId);
      expect((await emailOf(second!)).offers).toEqual(firstIds.map((jobOfferId) => ({ disposition: "seen", jobOfferId, profileId: null, matchScore: null, title: null, link: null })));
    });

    it("an offer already in one of the Candidate's Applications or Job Searches counts « déjà vue »", async () => {
      const applied = await jobOffers.capture({ source: { url: "https://www.cadremploi.fr/emploi/detail_offre?offreId=158700001" }, title: "Contrôleur de gestion industriel", content: "Poste à Lyon." });
      const searched = await jobOffers.capture({ source: { url: "https://www.cadremploi.fr/emploi/detail_offre?offreId=158700002" }, title: "Responsable consolidation", content: "Poste à Paris." });
      if (!applied.ok || !searched.ok) throw new Error("fixture refused");
      await createApplications(database, { jobOffers, profiles: createProfiles(database) }).save(marie, { jobOfferId: applied.jobOffer.id, profileId });
      await database.query(`INSERT INTO job_search (candidate_id, profile_id, status, job_offer_ids, started_at) VALUES ($1, $2, 'done', ARRAY[$3::uuid], now())`, [marie, profileId, searched.jobOffer.id]);

      const [id] = await deliver(cadremploiAlert.email(address));
      await reading.read(id!);

      expect((await emailOf(id!)).offers.map(({ disposition, jobOfferId }) => ({ disposition, jobOfferId }))).toEqual([
        { disposition: "seen", jobOfferId: applied.jobOffer.id },
        { disposition: "seen", jobOfferId: searched.jobOffer.id },
        { disposition: "new", jobOfferId: expect.any(String) },
      ]);
    });

    it("a recruiter's offer stays private: another Candidate's same message makes their own, and never shows them Marie's", async () => {
      const [id] = await deliver(recruiterMessage.email(address));
      await reading.read(id!);
      const marieOffer = (await emailOf(id!)).offers[0]!.jobOfferId!;

      const cookie = await signInWithMagicLink(testAuth, "paul.martin@example.fr");
      const paul = ((await (await testAuth.request("/api/auth/get-session", { cookie })).json()) as { user: { id: string } }).user.id;
      const paulAddress = (await createEmailIntake(database, { domain: () => "alertes.jobbbox.test", now: () => now }).switchOn(paul)).address;
      const [paulsId] = await deliver(recruiterMessage.email(paulAddress, { from: "paul.martin@example.fr" }));
      await reading.read(paulsId!);

      const paulsOffers = (await emailIntakeOf(database, paul)).receivedOfferEmails[0]!.offers;
      expect(paulsOffers).toMatchObject([{ disposition: "new" }]);
      expect(paulsOffers[0]!.jobOfferId).not.toBe(marieOffer);
      expect(await jobOffers.get(marieOffer, paul)).toBeNull();
    });
  });

  it("the Provenance of a Job Offer it made lists the Email intake Tool, the AI step and the deduplication and Match Score rules, with the sender's domain as a site", async () => {
    const [id] = await deliver(cadremploiAlert.email(address));
    await reading.read(id!);
    const jobOfferId = (await emailOf(id!)).offers[0]!.jobOfferId!;

    const provenance = await jobOffers.provenance(jobOfferId);

    expect(provenance?.steps.map((step) => ({ kind: step.kind, activity: step.activity, outcome: step.outcome, ...("tool" in step ? { tool: step.tool } : {}), ...("rule" in step ? { rule: step.rule } : {}), ...(step.kind === "ai" ? { task: step.task, provider: step.provider, model: step.model } : {}) }))).toEqual([
      { kind: "tool", tool: "brevo-inbound", activity: "read", outcome: "ok" },
      { kind: "ai", task: "offer_email_reading", provider: "mistral", model: "fake-mistral", activity: "read", outcome: "ok" },
      { kind: "rules", rule: "match_score", activity: "compute", outcome: "ok" },
      { kind: "rules", rule: "offer_dedup", activity: "compute", outcome: "ok" },
    ]);
    expect(provenance?.sites).toEqual(
      expect.arrayContaining([
        { kind: "web", domain: "alertes.cadremploi.fr", links: ["https://alertes.cadremploi.fr/"] },
        { kind: "web", domain: "cadremploi.fr", links: ["https://www.cadremploi.fr/emploi/detail_offre"] },
      ]),
    );
    // A manual forward's sender is the Candidate's own address: their domain is no Provenance site.
    const [forwarded] = await deliver(recruiterMessage.email(address));
    await reading.read(forwarded!);
    const privateOffer = (await emailOf(forwarded!)).offers[0]!.jobOfferId!;
    expect(JSON.stringify((await jobOffers.provenance(privateOffer))?.sites)).not.toContain("example.fr");
  });

  describe("Posting date: the offer's stated date, else the email's; the 30-day rule applies", () => {
    it("keeps an offer's stated date over the email's", async () => {
      useAi(() => JSON.stringify({ kind: "alerte", offers: [{ title: "Contrôleur financier", employer: "Exemple", location: "Lyon", link: "https://www.hellowork.com/fr-fr/emplois/1.html", postedAt: "2026-10-20" }] }));
      const [id] = await deliver(cadremploiAlert.email(address));

      await reading.read(id!);

      const [offer] = (await emailOf(id!)).offers;
      expect((await jobOffers.get(offer!.jobOfferId!))?.postedAt).toEqual(new Date("2026-10-20T00:00:00Z"));
    });

    it("makes no Job Offer of an email sent more than 30 days ago whose offers state no date", async () => {
      const [id] = await deliver(cadremploiAlert.email(address, { sentAt: "Tue, 15 Sep 2026 08:00:00 +0000" }));

      await reading.read(id!);

      expect((await emailOf(id!)).offers.map((offer) => offer.disposition)).toEqual(["too_old", "too_old", "too_old"]);
      expect(await jobOfferCount()).toBe(0);
    });
  });

  describe(`${MAX_READING_TRIES} tries within 72 hours, then « échec »`, () => {
    it("a try that fails is tried again, its text kept; the third failure is « échec », its text deleted", async () => {
      useAi(undefined, new Error("provider down"));
      const [id] = await deliver(cadremploiAlert.email(address));

      await expect(reading.read(id!)).rejects.toThrow("provider down");
      await expect(reading.read(id!)).rejects.toThrow("provider down");
      expect(await emailOf(id!)).toMatchObject({ outcome: "awaiting_reading" });
      expect(await receivedTextOf(database, cipher, id!)).not.toBeNull();

      await expect(reading.read(id!)).resolves.toEqual({ outcome: "failed" });
      expect(await emailOf(id!)).toMatchObject({ outcome: "failed", offers: [] });
      expect(await receivedTextOf(database, cipher, id!)).toBeNull();
      expect(usage.entries.map((entry) => ({ task: entry.task, outcome: entry.outcome }))).toEqual(Array(3).fill({ task: "offer_email_reading", outcome: "failed" }));
    });

    it("an email whose 72 hours are over is « échec » at once, unread", async () => {
      const [id] = await deliver(cadremploiAlert.email(address));
      now = new Date(now.getTime() + 73 * 3_600_000);

      await expect(reading.read(id!)).resolves.toEqual({ outcome: "failed" });
      expect(mistral.calls).toEqual([]);
    });

    it("while no version of its Task Playbook is served, a try fails without calling the AI", async () => {
      reading = createEmailReading({ readings, jobOffers, profiles: createProfiles(database), ai, taskPlaybooks: async () => null, now: () => now });
      const [id] = await deliver(cadremploiAlert.email(address));

      await expect(reading.read(id!)).rejects.toThrow(/Task Playbook/);
      expect(mistral.calls).toEqual([]);
      expect(await emailOf(id!)).toMatchObject({ outcome: "awaiting_reading" });
    });
  });
});
