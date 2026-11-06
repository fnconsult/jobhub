import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { offerBoxResponseSchema } from "@jobhub/shared/reads";
import pg from "pg";
import { signInWithMagicLink } from "./support/candidate";
import { toConversation } from "./support/conversation";
import { newAddress } from "./support/mailbox";

// Issue #815 (ADR-0090, « Offres à traiter 1 »): the Offer box, one entry per Candidate and Job Offer, filled by each
// Arrival door. The Job Search's, the Job Digest's and Email intake's doors are asserted in their own specs
// (job-search, job-digest, email-intake-reading), the page in conversation-menus, the read over HTTP in app-reads.
// Here: the Job Offer link door (the Coach Panel, a careers site faked inside the server), an Application made anywhere
// making the entry « Suivie », the Data export, the deletion of the account, a Job Offer shared by two Candidates, and the
// deployment's backfill (`npm run db:migrate`) and the nightly purge (the worker's job), on a database of their own.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;
const databaseUrl = process.env.E2E_DATABASE_URL!;
const SITE = "https://carrieres.coach-links.e2e-jobbbox.fr";
const LINK = `${SITE}/offres/daf-lyon`;
const TITLE = "Directrice administrative et financière H/F";
const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

test.use({ baseURL: origin });

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

async function withDatabase<T>(connectionString: string, run: (db: pg.Client) => Promise<T>): Promise<T> {
  const db = new pg.Client({ connectionString });
  await db.connect();
  try {
    return await run(db);
  } finally {
    await db.end();
  }
}

const offerBox = async (page: Page) => offerBoxResponseSchema.parse(await (await page.request.get("/api/offer-box")).json());

async function pasteLink(page: Page) {
  const panel = page.getByRole("region", { name: fr.conversationFirst.label });
  const cards = panel.getByRole("article", { name: fr.coachPanel.jobOfferLink.card });
  const before = await cards.count();
  await panel.getByLabel(fr.coachPanel.messageLabel).fill(`Que pensez-vous de cette offre ? ${LINK}`);
  await panel.getByRole("button", { name: fr.coachPanel.send }).click();
  await expect(cards).toHaveCount(before + 1, { timeout: 30_000 });
  await expect(cards.last()).toContainText("Directrice administrative et financière");
}

async function candidate(browser: Browser, label: string) {
  const page = await (await browser.newContext({ baseURL: origin })).newPage();
  const email = newAddress(label);
  await signInWithMagicLink(page, email);
  const candidateId = (await (await page.request.get("/api/auth/get-session")).json()).user.id as string;
  const created = await page.request.post("/api/profiles", { headers: { origin }, data: { masterCv, searchCriteria: { targetRole: "Directrice administrative et financière", locations: ["Lyon"], contractTypes: ["cdi"] } } });
  expect(created.status(), await created.text()).toBe(201);
  return { page, email, candidateId, profileId: (await created.json()).id as string };
}

test.describe("The Offer box (#815, ADR-0090)", () => {
  test("a Job Offer link pasted in the Coach Panel is an Arrival; the same link again adds nothing; the Application makes the entry « Suivie »; each Candidate has an entry of their own", async ({ browser }) => {
    const ines = await candidate(browser, "offer-box-link");
    await toConversation(ines.page);
    await pasteLink(ines.page);

    const [entry, ...others] = (await offerBox(ines.page)).entries;
    expect(others).toEqual([]);
    expect(entry).toMatchObject({ state: "to_handle", applicationId: null, sources: [{ source: "job_offer_link" }], jobOffer: { title: TITLE } });
    const first = entry!.firstArrivalAt;

    // The same posting again: the same Job Offer, the same entry, its first Arrival where it was.
    await pasteLink(ines.page);
    const again = (await offerBox(ines.page)).entries;
    expect(again).toHaveLength(1);
    expect(again[0]).toMatchObject({ id: entry!.id, firstArrivalAt: first, sources: [{ source: "job_offer_link" }] });

    // Another Candidate pasting it has their own entry, not Inès's.
    const paul = await candidate(browser, "offer-box-link-other");
    expect(await offerBox(paul.page)).toMatchObject({ toHandle: 0, entries: [] });
    await toConversation(paul.page);
    await pasteLink(paul.page);
    const theirs = (await offerBox(paul.page)).entries;
    expect(theirs).toHaveLength(1);
    expect(theirs[0]).toMatchObject({ jobOffer: { id: entry!.jobOffer.id }, state: "to_handle" });
    expect(theirs[0]!.id).not.toBe(entry!.id);

    // An Application made anywhere (here, « Enregistrer en candidature » through the API, as the extension and the Coach do)
    // makes the entry « Suivie » for as long as it exists.
    const saved = await ines.page.request.post("/api/applications", { headers: { origin }, data: { jobOfferId: entry!.jobOffer.id, profileId: ines.profileId } });
    expect(saved.ok(), await saved.text()).toBe(true);
    const followed = await offerBox(ines.page);
    expect(followed.toHandle).toBe(0);
    expect(followed.entries[0]).toMatchObject({ state: "followed", applicationId: (await saved.json()).id });
    expect((await offerBox(paul.page)).toHandle).toBe(1);

    // The Data export holds the entry: Job Offer, Profile, first Arrival, Arrival sources with their dates, where it stands.
    const exported = await (await ines.page.request.get("/api/account/export")).json();
    expect(exported.offerBox).toEqual([
      expect.objectContaining({
        jobOfferId: entry!.jobOffer.id,
        firstArrivalAt: first,
        arrivalSources: [{ source: "job_offer_link", at: expect.any(String) }],
        state: "followed",
        decidedAt: null,
        dismissalReason: null,
        laterUntil: null,
      }),
    ]);
    expect((await (await paul.page.request.get("/api/account/export")).json()).offerBox).toHaveLength(1);

    // Deleting the account deletes the entries; the other Candidate's, and the shared Job Offer, stay.
    const count = (id: string) => withDatabase(databaseUrl, async (db) => (await db.query("SELECT count(*)::int AS n FROM offer_box_entry WHERE candidate_id = $1", [id])).rows[0].n as number);
    expect(await count(ines.candidateId)).toBe(1);
    const deleted = await ines.page.request.delete("/api/account", { headers: { origin }, data: { email: ines.email } });
    expect(deleted.status(), await deleted.text()).toBe(204);
    expect(await count(ines.candidateId)).toBe(0);
    expect(await count(paul.candidateId)).toBe(1);
    expect((await paul.page.request.get(`/api/job-offers/${entry!.jobOffer.id}`)).status()).toBe(200);
  });

  test("only the Candidate who is signed in reads the Offer box", async ({ request }) => {
    expect((await request.get("/api/offer-box")).status()).toBe(401);
  });
});

// The deployment's backfill and the nightly purge, on a database of their own: `npm run db:migrate` fills the Offer box
// from the last 30 days, and runs again without changing it (ADR-0090).
test.describe("The Offer box at deployment and every night (#815)", () => {
  const url = new URL(databaseUrl);
  url.pathname = `${url.pathname}_offer_box`;
  const name = url.pathname.slice(1);
  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const migrate = () => spawnSync("npm", ["run", "db:migrate"], { env: { ...process.env, DATABASE_URL: url.toString() }, encoding: "utf8", timeout: 240_000 });
  const days = (n: number) => `now() - interval '${n} days'`;

  test.beforeAll(async () => {
    await withDatabase(adminUrl.toString(), async (db) => {
      await db.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await db.query(`CREATE DATABASE ${name}`);
    });
  });
  test.afterAll(async () => {
    await withDatabase(adminUrl.toString(), (db) => db.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });

  test("the last 30 days of Job Searches, Job Digests and Received offer emails become entries, old or too old a posting excluded, a Private Job Offer only for its Candidate, an Application « Suivie »; run again, nothing changes; 12 months after the first Arrival the nightly purge deletes the entry", async () => {
    test.setTimeout(480_000);
    const first = migrate();
    expect(first.status, first.stderr).toBe(0);
    expect(first.stdout).toContain("The Offer box is up to date");

    const offerIds: Record<string, string> = {};
    await withDatabase(url.toString(), async (db) => {
      for (const id of ["ines", "paul"]) {
        await db.query(`INSERT INTO "candidate" (id, name, email, "emailVerified", "interfaceLanguage") VALUES ($1, $1, $2, true, 'fr')`, [`${id}-${tag}`, `${id}-${tag}@e2e.jobbbox.test`]);
      }
      const profile = (await db.query(`INSERT INTO profile (candidate_id, name, target_role, locations) VALUES ($1, 'DAF', 'DAF', ARRAY['Lyon']) RETURNING id`, [`ines-${tag}`])).rows[0].id as string;
      const offer = async (key: string, { postedDaysAgo = null, privateTo = null }: { postedDaysAgo?: number | null; privateTo?: string | null } = {}) => {
        const row = await db.query(
          `INSERT INTO job_offer (url_key, content_fingerprint, source_url, title, content, posted_at, private_to_candidate_id)
           VALUES ($1, $1, $2, $3, 'Un poste.', ${postedDaysAgo === null ? "NULL" : days(postedDaysAgo)}, $4) RETURNING id`,
          [`bf-${tag}-${key}`, `https://emploi-e2e.example/${tag}/${key}`, `Offre ${key}`, privateTo],
        );
        offerIds[key] = row.rows[0].id;
      };
      await offer("search", { postedDaysAgo: 3 });
      await offer("old-search");
      await offer("old-posting", { postedDaysAgo: 45 });
      await offer("both");
      await offer("applied");
      await offer("email");
      await offer("pauls-private", { privateTo: `paul-${tag}` });
      const search = (ids: string[], ago: number) =>
        db.query(`INSERT INTO job_search (candidate_id, profile_id, status, job_offer_ids, started_at, finished_at) VALUES ($1, $2, 'done', $3, ${days(ago)}, ${days(ago)})`, [`ines-${tag}`, profile, ids]);
      await search([offerIds.search!, offerIds.both!, offerIds.applied!], 5);
      await search([offerIds["old-search"]!], 40);
      await db.query(`INSERT INTO job_digest (candidate_id, profile_id, job_offer_ids, sent_at) VALUES ($1, $2, $3, ${days(2)})`, [`ines-${tag}`, profile, [offerIds.both, offerIds["old-posting"], offerIds["pauls-private"]]]);
      await db.query(`INSERT INTO application (candidate_id, job_offer_id, profile_id) VALUES ($1, $2, $3)`, [`ines-${tag}`, offerIds.applied, profile]);
      const mail = `${tag}-mail`;
      await db.query(`INSERT INTO received_offer_email (id, candidate_id, message_id, outcome, kind, sender_domain, received_at, read_at) VALUES ($1, $2, $3, 'offers_found', 'alert', 'alertes.example', ${days(1)}, ${days(1)})`, [mail, `ines-${tag}`, `<${mail}@mail.example.test>`]);
      await db.query(`INSERT INTO received_offer_email_offer (received_offer_email_id, position, candidate_id, disposition, job_offer_id, profile_id, match_score) VALUES ($1, 0, $2, 'new', $3, NULL, 42)`, [mail, `ines-${tag}`, offerIds.email]);
    });

    const entries = () =>
      withDatabase(url.toString(), async (db) =>
        (
          await db.query(
            `SELECT o.title, e.candidate_id, e.profile_id, e.arrival_sources, e.first_arrival_at, (a.id IS NOT NULL) AS followed
               FROM offer_box_entry e JOIN job_offer o ON o.id = e.job_offer_id LEFT JOIN application a ON a.candidate_id = e.candidate_id AND a.job_offer_id = e.job_offer_id
              ORDER BY o.title`,
          )
        ).rows as { title: string; candidate_id: string; profile_id: string | null; arrival_sources: Record<string, string>; first_arrival_at: Date; followed: boolean }[],
      );
    const deployed = migrate();
    expect(deployed.status, deployed.stderr).toBe(0);
    const filled = await entries();
    expect(filled.map((entry) => entry.title)).toEqual(["Offre applied", "Offre both", "Offre email", "Offre search"]);
    expect(filled.every((entry) => entry.candidate_id === `ines-${tag}`)).toBe(true);
    const byTitle = new Map(filled.map((entry) => [entry.title, entry]));
    expect(Object.keys(byTitle.get("Offre both")!.arrival_sources).sort()).toEqual(["job_digest", "job_search"]);
    // The earliest Arrival makes the entry: the Job Search, 5 days ago, before the Job Digest.
    expect(byTitle.get("Offre both")!.arrival_sources.job_search).toBe(new Date(byTitle.get("Offre both")!.first_arrival_at).toISOString());
    expect(Object.keys(byTitle.get("Offre email")!.arrival_sources)).toEqual(["email"]);
    expect(byTitle.get("Offre email")!.profile_id).toBeNull();
    expect(filled.filter((entry) => entry.followed).map((entry) => entry.title)).toEqual(["Offre applied"]);

    // Idempotent.
    const redeployed = migrate();
    expect(redeployed.status, redeployed.stderr).toBe(0);
    expect(await entries()).toEqual(filled);

    // The nightly purge: nothing at 11 months, the entries at 13 (the worker's clock set ahead, as e2e/support/worker-job.ts does).
    const purge = (hours: number) =>
      spawnSync(path.resolve("node_modules/.bin/tsx"), ["e2e/support/worker-job.ts", "offer-box.purge", String(hours)], { env: { ...process.env, DATABASE_URL: url.toString(), APP_URL: origin, MAIL_TRANSPORT: "console" }, encoding: "utf8", timeout: 120_000 });
    const kept = purge(24 * 30 * 11);
    expect(kept.status, kept.stderr).toBe(0);
    expect(await entries()).toHaveLength(4);
    const purged = purge(24 * 30 * 13);
    expect(purged.status, purged.stderr).toBe(0);
    expect(purged.stdout).toContain("4 Offer box entry(ies) purged");
    expect(await entries()).toEqual([]);
  });
});
