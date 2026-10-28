import { spawnSync } from "node:child_process";
import path from "node:path";
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";
import pg from "pg";
import { inboundPayload, type BrevoInboundItem } from "../apps/web/src/email-intake/fixtures/brevo-inbound";
import { cadremploiAlert, jobijobaPromo, linkedInDigest, newsletter, OFFER_EMAILS, recruiterMessage, type OfferEmailFixture } from "../apps/web/src/email-intake/fixtures/offer-emails";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #445 (ADR-0049, ADR-0052): the worker reads each Received offer email into Job Offers. Driven through the
// public entry points: Brevo's inbound webhook over HTTP with fictional emails modelled on the corpus
// (apps/web/src/email-intake/fixtures), the worker's `email-intake.read` job run once per email by
// e2e/support/worker-email-reading.ts (the AI is Mistral, stubbed by e2e/support/fake-mistral.mjs with each fixture's
// reply), and what the Candidate sees: their Data export, the Job Offers API and a Job Offer's stored Provenance.
const origin = process.env.E2E_WEB_ORIGIN!;
const databaseUrl = process.env.E2E_DATABASE_URL!;
const SECRET = "e2e-brevo-inbound-secret";
const BREVO_IP = "203.0.113.7"; // inside EMAIL_INTAKE_BREVO_IP_RANGES (playwright.config.ts)
const MASTER_KEYS = "1:ZTJlLW9ubHktbWFzdGVyLWtleS1lMmUtb25seS0wMDA="; // playwright.config.ts's SECRETS_MASTER_KEYS: the texts open under it
const tag = Date.now().toString(36);

const masterCv = {
  fullName: "Bérénice Castafiore",
  headline: "Directrice financière",
  email: "berenice.castafiore@example.fr",
  phone: "",
  location: "Lyon",
  summary: "Vingt ans à la tête des finances d'un groupe industriel.",
  experience: [{ title: "Directrice financière", employer: "Moulinsart Industries", location: "Lyon", period: "2004 – 2024", description: "Pilotage financier du groupe." }],
  education: [],
  skills: ["Consolidation", "IFRS"],
  languages: [],
};
const searchCriteria = { targetRole: "Contrôleur de gestion", locations: ["Lyon"], contractTypes: ["cdi"] };

interface ExportedOffer {
  disposition: string;
  jobOfferId: string | null;
  profileId: string | null;
  matchScore: number | null;
  title: string | null;
  link: string | null;
}
interface ReceivedEmail {
  id: string;
  outcome: string;
  kind: string | null;
  senderDomain: string;
  offers: ExportedOffer[];
}
interface Step {
  kind: string;
  activity: string;
  tool?: string;
  task?: string;
  provider?: string;
  model?: string;
  outcome: string;
}

const query = async <T = Record<string, unknown>>(sql: string, values: unknown[] = []): Promise<T[]> => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return (await client.query(sql, values)).rows as T[];
  } finally {
    await client.end();
  }
};

function deliver(request: APIRequestContext, ...items: BrevoInboundItem[]) {
  return request.post("/api/email-intake/inbound", { headers: { "x-forwarded-for": BREVO_IP, "x-inbound-secret": SECRET }, data: inboundPayload(...items) });
}

const receivedEmails = async (page: Page): Promise<ReceivedEmail[]> => (await (await page.request.get("/api/account/export")).json()).emailIntake.receivedOfferEmails;

/**
 * The worker's `email-intake.read` job for each email still awaiting reading, as the job runner runs it on the message
 * the inbound route queued; the Received offer emails it read, in the order they arrived.
 */
async function workerReads(page: Page): Promise<ReceivedEmail[]> {
  const waiting = (await receivedEmails(page)).filter((email) => email.outcome === "awaiting_reading");
  expect(waiting.length).toBeGreaterThan(0);
  const worker = spawnSync(path.resolve("node_modules/.bin/tsx"), ["e2e/support/worker-email-reading.ts", ...waiting.map((email) => email.id)], {
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      NODE_ENV: "development",
      DATABASE_URL: databaseUrl,
      JOBHUB_TARGET: "e2e",
      SECRETS_MASTER_KEYS: MASTER_KEYS,
      AI_SCORING_PROVIDER: "mistral",
      AI_WRITING_PROVIDER: "mistral",
      AI_COACHING_PROVIDER: "mistral",
      AI_CV_PARSING_PROVIDER: "mistral",
      AI_OFFER_ANALYSIS_PROVIDER: "mistral",
      AI_OFFER_EMAIL_READING_PROVIDER: "mistral",
      MISTRAL_API_KEY: "e2e-mistral-key",
      E2E_OFFER_EMAIL_REPLIES: JSON.stringify(OFFER_EMAILS.map((fixture) => ({ marker: fixture.marker, reply: fixture.reply }))),
      NODE_OPTIONS: `--import=${path.resolve("e2e/support/fake-mistral.mjs")}`,
    },
    encoding: "utf8",
    timeout: 90_000,
  });
  expect(worker.status, `${worker.stdout}\n${worker.stderr}`).toBe(0);
  const ids = new Set(waiting.map((email) => email.id));
  return (await receivedEmails(page)).filter((email) => ids.has(email.id)).reverse();
}

/** Sends one fixture and has the worker read it; the Received offer email that gives. */
async function sendAndRead(page: Page, address: string, fixture: OfferEmailFixture, options: { from?: string; messageId?: string } = {}): Promise<ReceivedEmail> {
  const response = await deliver(page.request, fixture.email(address, { ...options, messageId: options.messageId ?? `<${tag}-${Math.random().toString(36).slice(2)}@mail.example.test>` }));
  expect(response.status()).toBe(200);
  const read = await workerReads(page);
  expect(read).toHaveLength(1);
  return read[0]!;
}

interface Candidate {
  page: Page;
  email: string;
  address: string;
  candidateId: string;
  profileId: string;
}

/** A Candidate signed in on a page of the running test, with a Profile and Email intake switched on. */
async function candidate(browser: Browser, label: string): Promise<Candidate> {
  const page = await (await browser.newContext({ baseURL: origin })).newPage();
  const email = newAddress(label);
  await signInWithMagicLink(page, email);
  const candidateId = (await (await page.request.get("/api/auth/get-session")).json()).user.id as string;
  const created = await page.request.post("/api/profiles", { headers: { origin }, data: { masterCv, searchCriteria } });
  expect(created.status(), await created.text()).toBe(201);
  const on = await page.request.put("/api/account/email-intake", { headers: { origin } });
  expect(on.status()).toBe(200);
  return { page, email, address: (await on.json()).address as string, candidateId, profileId: (await created.json()).id as string };
}

const jobOfferCountOf = async (urlPart: string) => (await query<{ n: number }>(`SELECT count(*)::int AS n FROM job_offer WHERE source_url LIKE $1`, [`%${urlPart}%`]))[0]!.n;

test.describe("Email intake: the worker reads Received offer emails into Job Offers (#445)", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });
  // A context made in beforeAll loses its artifacts directory between tests: Marie signs in once, in the first test, and each test opens a page as her.
  let marie: Candidate;
  let alert: ReceivedEmail;
  let signedIn: Awaited<ReturnType<BrowserContext["storageState"]>>;
  const asMarie = async (browser: Browser): Promise<Candidate> => {
    const page = await (await browser.newContext({ baseURL: origin, storageState: signedIn })).newPage();
    return { ...marie, page };
  };

  test("a LinkedIn digest of 6 offers: « offres trouvées », each offer « À capturer » behind LinkedIn's Forbidden site, no Job Offer made", async ({ browser }) => {
    marie = await candidate(browser, "email-reading");
    signedIn = await marie.page.context().storageState();
    const email = await sendAndRead(marie.page, marie.address, linkedInDigest);

    expect(email).toMatchObject({ outcome: "offers_found", kind: "alert", senderDomain: "linkedin.com" });
    expect(email.offers).toHaveLength(6);
    expect(email.offers.map((offer) => offer.disposition)).toEqual(Array(6).fill("to_capture"));
    // The link kept is the offer's page, without the email's tracking.
    expect(email.offers.map((offer) => offer.link)).toEqual(["4012345601", "4012345602", "4012345603", "4012345604", "4012345605", "4012345606"].map((id) => `https://www.linkedin.com/jobs/view/${id}/`));
    expect(email.offers.map((offer) => offer.title)).toContain("Directeur administratif et financier");
    expect(email.offers.every((offer) => offer.jobOfferId === null)).toBe(true);
    expect(await jobOfferCountOf("linkedin.com")).toBe(0);
  });

  test("a Cadremploi alert whose text part is only CSS: its 3 offers read from the HTML become shared Job Offers, the Lyon one under the Profile it matches", async ({ browser }) => {
    const me = await asMarie(browser);
    alert = await sendAndRead(me.page, marie.address, cadremploiAlert);

    expect(alert).toMatchObject({ outcome: "offers_found", kind: "alert", senderDomain: "alertes.cadremploi.fr" });
    expect(alert.offers.map((offer) => offer.disposition)).toEqual(["new", "new", "new"]);
    expect(alert.offers[0]).toMatchObject({ profileId: marie.profileId });
    expect(alert.offers[0]!.matchScore).toBeGreaterThanOrEqual(60);
    // Under 60: « Non classées », under no Profile.
    for (const offer of alert.offers.slice(1)) {
      expect(offer.profileId).toBeNull();
      expect(offer.matchScore).toBeLessThan(60);
    }
    const stored = await Promise.all(alert.offers.map(async (offer) => (await me.page.request.get(`/api/job-offers/${offer.jobOfferId}`)).json()));
    expect(stored.map((offer) => offer.title)).toEqual(["Contrôleur de gestion industriel", "Responsable consolidation", "Directeur financier adjoint"]);
    expect(stored.map((offer) => offer.contractType)).toEqual(["cdi", "cdi", "cdd"]);
    expect(stored[0]).toMatchObject({ employer: "Exemple Mécanique", source: { url: "https://www.cadremploi.fr/emploi/detail_offre?offreId=158700001" } });
    // Shared: a Guest gets them too.
    const guest = await browser.newContext({ baseURL: origin });
    expect((await guest.request.get(`/api/job-offers/${alert.offers[0]!.jobOfferId}`)).status()).toBe(200);
    await guest.close();
  });

  test("a Jobijoba promotion without a precise offer, and a newsletter: « autre », no Job Offer", async ({ browser }) => {
    const me = await asMarie(browser);
    const promo = await sendAndRead(me.page, marie.address, jobijobaPromo);
    expect(promo).toMatchObject({ outcome: "other", offers: [] });
    expect(await jobOfferCountOf("jobijoba.com")).toBe(0);

    const letter = await sendAndRead(me.page, marie.address, newsletter);
    expect(letter).toMatchObject({ outcome: "other", kind: "other", offers: [] });
    expect(await jobOfferCountOf("welcometothejungle.com/fr/articles")).toBe(0);
  });

  test("a second email with the same offers creates nothing new: each is « déjà vue », its Job Offer the first email's", async ({ browser }) => {
    const me = await asMarie(browser);
    const before = await jobOfferCountOf("cadremploi.fr/emploi/detail_offre?offreId=1587");
    expect(before).toBe(3);

    const again = await sendAndRead(me.page, marie.address, cadremploiAlert);

    expect(again).toMatchObject({ outcome: "offers_found", kind: "alert" });
    expect(again.offers.map((offer) => offer.disposition)).toEqual(["seen", "seen", "seen"]);
    expect(again.offers.map((offer) => offer.jobOfferId)).toEqual(alert.offers.map((offer) => offer.jobOfferId));
    expect(await jobOfferCountOf("cadremploi.fr/emploi/detail_offre?offreId=1587")).toBe(3);
  });

  test("a recruiter's message forwarded by hand: a Job Offer private to the Candidate, never seen by another Candidate or a Guest", async ({ browser, request }) => {
    const me = await asMarie(browser);
    const email = await sendAndRead(me.page, marie.address, recruiterMessage, { from: marie.email });

    expect(email).toMatchObject({ outcome: "offers_found", kind: "recruiter" });
    expect(email.offers).toHaveLength(1);
    expect(email.offers[0]).toMatchObject({ disposition: "new", profileId: marie.profileId });
    const id = email.offers[0]!.jobOfferId!;

    const hers = await me.page.request.get(`/api/job-offers/${id}`);
    expect(hers.status()).toBe(200);
    expect(await hers.json()).toMatchObject({ title: "Directeur administratif et financier", location: "Lyon", contractType: "cdi" });
    const exported = await (await me.page.request.get("/api/account/export")).json();
    expect(exported.privateJobOffers.map((offer: { id: string }) => offer.id)).toEqual([id]);

    const paul = await candidate(browser, "email-reading-other");
    expect((await paul.page.request.get(`/api/job-offers/${id}`)).status()).toBe(404);
    expect((await request.get(`/api/job-offers/${id}`)).status()).toBe(404);
    expect((await (await paul.page.request.get("/api/account/export")).json()).privateJobOffers).toEqual([]);
    // Nothing of the recruiter is kept.
    expect(JSON.stringify(await hers.json())).not.toMatch(/Claire|06 00 00 00 00|claire\.exemple/);
  });

  test("the Provenance of a created Job Offer lists the Tool, AI and rules steps, with the sender's domain as its site", async ({ browser }) => {
    const me = await asMarie(browser);
    const [stored] = await query<{ provenance: { steps: Step[]; sites: { kind: string; domain?: string }[] } | null }>(`SELECT provenance FROM job_offer WHERE id = $1`, [alert.offers[0]!.jobOfferId]);
    const provenance = stored!.provenance;
    expect(provenance, "the Job Offer has a Provenance").not.toBeNull();

    const kinds = provenance!.steps.map((step) => step.kind);
    expect(kinds, JSON.stringify(provenance!.steps)).toEqual(expect.arrayContaining(["tool", "ai", "rules"]));
    expect(provenance!.steps.find((step) => step.kind === "ai")).toMatchObject({ task: "offer_email_reading", provider: "mistral", outcome: "ok" });
    expect(provenance!.steps.filter((step) => step.kind === "rules").map((step) => (step as Step & { rule?: string }).rule)).toEqual(["match_score", "offer_dedup"]);
    // The Tool step is the Email intake Tool reading the email's text, before the AI reads it.
    const toolIndex = provenance!.steps.findIndex((step) => step.kind === "tool");
    expect(toolIndex).toBeLessThan(provenance!.steps.findIndex((step) => step.kind === "ai"));
    expect(provenance!.steps[toolIndex]).toMatchObject({ tool: "brevo-inbound" });
    expect(provenance!.sites).toEqual(expect.arrayContaining([expect.objectContaining({ domain: "alertes.cadremploi.fr" })]));
    // A shared Job Offer's Provenance names no Candidate.
    const text = JSON.stringify(provenance);
    for (const personal of [marie.candidateId, marie.profileId, marie.email, "Castafiore"]) expect(text).not.toContain(personal);
  });

  test("a recruiter's Job Offer forwarded by hand has its Provenance without a site: the sender's domain there is the Candidate's own", async ({ browser }) => {
    const me = await asMarie(browser);
    const [{ id }] = await query<{ id: string }>(`SELECT id FROM job_offer WHERE private_to_candidate_id = $1`, [marie.candidateId]) as [{ id: string }];
    const [stored] = await query<{ provenance: { steps: Step[]; sites: unknown[] } }>(`SELECT provenance FROM job_offer WHERE id = $1`, [id]);
    expect(stored!.provenance.steps.map((step) => step.kind)).toEqual(expect.arrayContaining(["tool", "ai", "rules"]));
    expect(JSON.stringify(stored!.provenance.sites)).not.toContain(marie.email.split("@")[1]);
  });
});
