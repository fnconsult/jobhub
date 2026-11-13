import { migrateCoachPages } from "../../apps/web/src/coach-pages";
import path from "node:path";
import { startOwnServer, signInByEmail, type OwnServer } from "../support/own-server";
import { derivedPort } from "../support/ports";
import { Pool } from "pg";
import { showInTheme } from "../support/theme";
import { readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { coachingOffers } from "../../apps/web/src/coaching-offers";
import { signInWithMagicLink } from "../support/candidate";
import { newAddress } from "../support/mailbox";
import { exitHref } from "../support/exit-page";

// Issue #24: Human Coaches, added in the Back Office with their Cal.com booking
// link; Coaching Sessions paid through Stripe Checkout at the single Coaching
// Session Price (discounted on Premium), recorded from the signed webhook only;
// Coach Access granted and revoked by the Candidate, letting a Human Coach read
// their Profiles and Applications and review their Tailored Documents.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const hc = fr.humanCoaches;
const space = fr.coachSpace;
const origin = process.env.E2E_WEB_ORIGIN!;
// Its own Administrator: billing.spec.ts signs "back-office@" in from another worker, and two
// sign-ins of one address at once can pick up each other's link.
const ADMINISTRATOR = "coach-office@e2e.jobbbox.test";

const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const tr = (template: string, values: Record<string, string>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");

const masterCv = {
  fullName: "Marie Dupont",
  headline: "Directrice financière",
  email: "marie.dupont@example.fr",
  phone: "",
  location: "Lyon",
  summary: "",
  experience: [{ title: "Directrice financière", employer: "Groupe Seb", location: "Lyon", period: "2005 – 2024", description: "Pilotage financier." }],
  education: [],
  skills: ["Consolidation", "IFRS"],
  languages: [],
};

/** The Administrator adds a Human Coach in the Back Office; returns their name and booking link. */
async function addCoachInBackOffice(admin: Page, email: string) {
  const name = `Sophie Martin ${unique()}`;
  const bookingUrl = `https://cal.com/sophie-${unique()}/seance`;
  await admin.goto("/admin");
  await admin.getByRole("link", { name: fr.admin.sections.humanCoaches }).click();
  await expect(admin.getByRole("heading", { level: 1 })).toHaveText(fr.admin.humanCoaches.title);
  await admin.getByLabel(fr.admin.humanCoaches.name, { exact: true }).fill(name);
  await admin.getByLabel(fr.admin.humanCoaches.email).fill(email);
  await admin.getByLabel(fr.admin.humanCoaches.bookingUrl).fill(bookingUrl);
  if(await admin.getByLabel(fr.admin.humanCoaches.bio).count())await admin.getByLabel(fr.admin.humanCoaches.bio).fill("Ancienne DRH dans l'industrie.");
  await admin.getByRole("button", { name: fr.admin.humanCoaches.add }).click();
  await expect(admin.getByRole("status")).toHaveText(tr(fr.admin.humanCoaches.added, { name }));
  return { name, bookingUrl };
}


/** A Profile and an Application with a Cover Letter drafted by the AI Coach, for the Candidate signed in on `page`. */
async function applicationWithCoverLetter(page: Page, requestOrigin = origin): Promise<string> {
  const profile = await page.request.post("/api/profiles", {
    data: { masterCv, searchCriteria: { targetRole: "DAF", locations: ["Lyon"] } },
    headers: { origin: requestOrigin },
  });
  expect(profile.status(), await profile.text()).toBe(201);
  const captured = await page.request.post("/api/job-offers", {
    data: {
      source: { url: `https://www.apec.fr/offres/${unique()}` },
      title: "DAF (H/F)",
      content: "Acme Industrie recrute son DAF. Vous pilotez la clôture des comptes.",
      employer: "Acme Industrie",
    },
    headers: { origin: requestOrigin },
  });
  expect(captured.status(), await captured.text()).toBe(200);
  const saved = await page.request.post("/api/applications", {
    data: { jobOfferId: (await captured.json()).id, profileId: (await profile.json()).id },
    headers: { origin: requestOrigin },
  });
  expect(saved.ok(), await saved.text()).toBe(true);
  const id = (await saved.json()).id as string;
  const drafted = await page.request.post(`/api/applications/${id}/tailored-documents`, {
    data: { document: "cover_letter" },
    headers: { origin: requestOrigin },
  });
  expect(drafted.ok(), await drafted.text()).toBe(true);
  return id;
}


test.describe("Human Coaches, Coaching Sessions and Coach Access", () => {
  test("the Back Office refuses a booking link that is not a Cal.com page", async ({ page }) => {
    await signInWithMagicLink(page, ADMINISTRATOR);
    await page.goto("/admin/coachs");
    await page.getByLabel(fr.admin.humanCoaches.name, { exact: true }).fill("Luc Bernard");
    await page.getByLabel(fr.admin.humanCoaches.email).fill(newAddress("coach"));
    await page.getByLabel(fr.admin.humanCoaches.bookingUrl).fill("https://calendly.com/luc");
    await page.getByRole("button", { name: fr.admin.humanCoaches.add }).click();
    await expect(page.getByRole("alert").filter({ hasText: fr.admin.humanCoaches.invalid })).toBeVisible();
  });

  test("the Human Coaches of the Back Office are for Administrators only", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("not-an-admin"));
    const response = await page.goto("/admin/coachs");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(fr.errorPage.notFound.title);
    await expect(page.getByLabel(fr.admin.humanCoaches.bookingUrl)).toHaveCount(0);
  });

  test("the coach space is unseen by people who are not Human Coaches", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("not-a-coach"));
    await expect(page.getByRole("link", { name: fr.account.coachSpace })).toHaveCount(0);
    const response = await page.goto("/espace-coach");
    expect(response?.status()).toBe(404);
  });
});

/** The id of the Human Coach named `name`, from the Back Office's retire form. */
async function coachIdOf(admin: Page, name: string): Promise<string> {
  await admin.goto("/admin/coachs");
  const form = admin.locator("form").filter({ has: admin.getByRole("button", { name: tr(fr.admin.humanCoaches.retire, { name }) }) });
  return (await form.locator('input[name="coachId"]').inputValue()) as string;
}

// Synthetic contract fixtures are confined to this server, never the production legal registry.
test.describe("isolated Human Coach workspace", () => {
  const OFFSET = 868;
  const origin = `http://localhost:${derivedPort(OFFSET)}`;
  let own: OwnServer;
  test.use({ baseURL: origin });
  test.beforeAll(async () => {
    test.setTimeout(180_000);
    own = await startOwnServer(OFFSET, "coach_workspace_v2", {
      JOBHUB_TARGET: "e2e",
      JOBHUB_IGNORE_ROOT_ENV: "1",
      AUTH_SECRET: "e2e-workspace-only-secret-e2e-workspace-only-secret",
      MAIL_TRANSPORT: "console",
      CAL_COM_REMINDERS_DISABLED: "true",
      ADMIN_EMAILS: ADMINISTRATOR,
      SECRETS_MASTER_KEYS: "1:ZTJlLW9ubHktbWFzdGVyLWtleS1lMmUtb25seS0wMDA=",
      AI_SCORING_PROVIDER: "mistral",
      AI_WRITING_PROVIDER: "mistral",
      AI_COACHING_PROVIDER: "mistral",
      AI_CV_PARSING_PROVIDER: "mistral",
      AI_OFFER_ANALYSIS_PROVIDER: "mistral",
      AI_OFFER_EMAIL_READING_PROVIDER: "mistral",
      MISTRAL_API_KEY: "e2e-mistral-key",
      STRIPE_SECRET_KEY: "sk_test_fake",
      STRIPE_WEBHOOK_SECRET: "whsec_test_fake",
      STRIPE_PRICE_STANDARD: "price_standard_monthly",
      STRIPE_PRICE_PREMIUM: "price_premium_monthly",
      STRIPE_PRICE_COACHING_SESSION: "price_coaching_session",
      STRIPE_PRICE_COACHING_SESSION_PREMIUM: "price_coaching_session_premium",
      STRIPE_API_URL: process.env.E2E_STRIPE_URL,
      NODE_OPTIONS: ["fake-coach-contract.mjs", "fake-coaching-legal.mjs", "fake-coaching-notification-legal.mjs", "fake-google.mjs", "fake-mistral.mjs", "fake-reference-data.mjs"].map((fake) => `--import=${path.resolve("e2e/support", fake)}`).join(" "),
    });
  });
  test.afterAll(async () => {
    await own?.stop();
  });
  const addCoach=async(admin:Page,email:string)=>{
    const coach=await addCoachInBackOffice(admin,email),database=new Pool({connectionString:own.databaseUrl});
    try{
      // Workspace scenarios start with an already moderated profile. #877's dedicated spec tests the actual queue.
      await database.query("UPDATE human_coach SET public_ready=true WHERE email=$1 AND retired_at IS NULL",[email]);
      await migrateCoachPages(database);
    }finally{await database.end();}
    return coach;
  };
  const signIn = async (page: Page, email: string) => {
    await signInByEmail(page, own, email);
    // These legacy feature scenarios start after a synthetic contract acceptance. The dedicated contract spec
    // exercises the real gate/checkbox; no fixture is part of the production legal registry.
    const database=new Pool({connectionString:own.databaseUrl});
    try {
      await database.query(`INSERT INTO coach_contract_acceptance(candidate_id,holder,kind,subject_id,version,url,sha256,origin,accepted_at)
        SELECT c.id,'e2e-fixture','coach',h.id,'2026-01-01','/espace-coach/contrat/versions/2026-01-01',$2,'web',clock_timestamp()
        FROM candidate c JOIN human_coach h ON h.email=lower(c.email) WHERE c.email=$1 AND h.retired_at IS NULL AND NOT h.contract_pending
        ON CONFLICT(candidate_id,kind,subject_id,version) DO NOTHING`,[email,"e".repeat(64)]);
    } finally {await database.end();}
  };
  const personPage = async (browser: Browser, email: string) => {
    const context = await browser.newContext({ baseURL: origin, locale: "fr-FR" });
    const page = await context.newPage();
    await signIn(page, email);
    return page;
  };
test("a Candidate grants Coach Access; the Human Coach reads their Profiles and Applications, reviews a Tailored Document, until it is revoked", async ({
    page,
    browser,
  }) => {
    const admin = await personPage(browser, ADMINISTRATOR);
    const coachEmail = newAddress("coach");
    const coach = await addCoach(admin, coachEmail);
    await admin.context().close();
    const email = newAddress("coach-access");
    await signIn(page, email);
    const applicationId = await applicationWithCoverLetter(page, origin);

    // Without Coach Access, the Human Coach sees no one.
    const coachPage = await personPage(browser, coachEmail);
    await coachPage.getByRole("link", { name: fr.account.coachSpace }).click();
    await expect(coachPage).toHaveURL(/aujourdhui$/);
    await expect(coachPage.getByRole("link", { name: email })).toHaveCount(0);

    await page.goto("/coachs");
    await expect(page.getByText(tr(hc.accessNotGranted, { name: coach.name }))).toBeVisible();
    await page.getByRole("button", { name: tr(hc.grant, { name: coach.name }) }).click();
    await expect(page.getByText(tr(hc.accessGranted, { name: coach.name }))).toBeVisible();

    // An unnamed Candidate uses the workspace placeholder rather than exposing their email.
    await coachPage.goto("/espace-coach/candidates");
    await coachPage.getByRole("link", { name: space.unnamedCandidate, exact: true }).click();
    await expect(coachPage.getByRole("heading", { level: 2 }).filter({hasText:space.unnamedCandidate})).toHaveText(space.unnamedCandidate);
    await expect(coachPage.getByText(tr(space.calledBy, { name: "Mimi" }))).toHaveCount(0);

    // Named in Mon compte › Identité (#918), « Marie Dupont · se fait appeler Mimi »; with a Preferred Name that is her Given Name, « Marie Dupont » alone (#922).
    const name = async (preferredName: string) => {
      const saved = await page.request.put("/api/account/identity", { data: { givenName: "Marie", familyName: "Dupont", preferredName }, headers: { origin } });
      expect(saved.ok(), await saved.text()).toBe(true);
    };
    await name("Mimi");
    await coachPage.goto("/espace-coach/candidates");
    const candidates = coachPage.locator(".ds-card");
    await expect(candidates.getByRole("listitem")).toContainText(`Marie Dupont · ${tr(space.calledBy, { name: "Mimi" })}`);
    await name("Marie");
    await coachPage.reload();
    await expect(candidates.getByRole("listitem")).toContainText("Marie Dupont");
    await name("Mimi");

    // The Human Coach reads the Candidate's file, read only.
    await candidates.getByRole("link", { name: "Marie Dupont" }).click();
    await expect(coachPage.getByRole("heading", { level: 2 }).filter({hasText:"Marie Dupont"})).toContainText("Marie Dupont");
    await expect(coachPage.getByText(tr(space.calledBy, { name: "Mimi" }))).toBeVisible();
    await expect(coachPage.getByText(space.readOnly)).toBeVisible();
    await expect(coachPage.getByText("Pilotage financier.")).toBeVisible();
    await coachPage.getByRole("link", { name: "DAF (H/F)", exact:true }).click();
    await expect(coachPage).toHaveURL(new RegExp(`/candidatures/${applicationId}$`));
    await expect(coachPage.getByText("Lettre de motivation (fr) pour « DAF (H/F) ».")).toBeVisible();
    await expect(coachPage.getByRole("button", { name: fr.tailoredDocuments.save })).toHaveCount(0);

    await coachPage.getByLabel(space.reviewDocument).selectOption({ label: fr.coachReviews.documents.cover_letter });
    await coachPage.getByLabel(space.reviewText).fill("Ouvrez sur votre dernier poste de DAF.");
    await coachPage.getByRole("button", { name: space.reviewSubmit }).click();
    await expect(coachPage.getByRole("status")).toHaveText(space.reviewSaved);

    // The Candidate reads the Coach Review on the Application.
    await page.goto(`/candidatures/${applicationId}/avis`);
    const reviews = page.getByRole("region", { name: fr.coachReviews.title });
    await expect(reviews).toContainText("Ouvrez sur votre dernier poste de DAF.");
    await expect(reviews).toContainText(coach.name);

    // Revoked: the Human Coach reads nothing more.
    await page.goto("/coachs");
    await page.getByRole("button", { name: tr(hc.revoke, { name: coach.name }) }).click();
    await expect(page.getByText(tr(hc.accessNotGranted, { name: coach.name }))).toBeVisible();
    const gone = await coachPage.reload();
    expect(gone?.status()).toBe(404);
    await coachPage.context().close();
  });

  async function paidFixture(page: Page, coachId: string, database: Pool) {
    const candidateId = (await (await page.request.get("/api/auth/get-session")).json()).user.id as string;
    const offers = coachingOffers(database, { price: async () => ({ amount: 9000, currency: "eur" }) });
    const quote = await offers.quote(candidateId, coachId);
    if (!quote) throw Error("Paid service fixture has no offer");
    const paid = { candidateId, coachId, quoteId: quote.id, checkoutSessionId: `cs_existing_${unique()}`, amount: 9000, currency: "eur" };
    await database.query("INSERT INTO coaching_session(stripe_checkout_session_id,candidate_id,coach_id,coaching_quote_id,amount,currency) VALUES($1,$2,$3,$4,9000,'eur')", [paid.checkoutSessionId,candidateId,coachId,quote.id]);
    await offers.attachPaid(paid);
    return candidateId;
  }
  // Permanent space: responsive navigation and access remain independent of a temporary switch.
  test("Coach space: permanent navigation, eight pages in both themes and three widths, accessible drawer, retired gate", async ({ page, browser }) => {
    test.setTimeout(180_000);
    const database = new Pool({ connectionString: own.databaseUrl });
    const admin = await personPage(browser, ADMINISTRATOR);
    const email = newAddress("coach-v2");
    const coach = await addCoach(admin, email);
    const coachId = await coachIdOf(admin, coach.name);
    await signIn(page, email);
    try {
      await page.goto("/espace-coach");
      await expect(async () => {
        await page.goto("/espace-coach");
        await expect(page).toHaveURL(/\/espace-coach\/aujourdhui$/);
      }).toPass();
      for (const width of [1280, 1024, 390]) {
        await page.setViewportSize({ width, height: 900 });
        for (const theme of ["light", "dark"] as const) {
          await showInTheme(page, theme);
          for (const [path, title] of Object.entries(fr.coachSpaceV2.pages) as [string, string][]) {
            await page.goto(`/espace-coach/${path}`);
            await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
          }
        }
      }
      await page.goto("/espace-coach/seances");
      const menu = page.getByRole("button", { name: fr.sidebar.menu, exact: true });
      await menu.click();
      const drawer = page.getByRole("dialog", { name: fr.sidebar.menu });
      await expect(drawer.getByRole("link", { name: fr.coachSpaceV2.pages.seances, exact: true })).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      expect(await drawer.evaluate((el) => el.contains(document.activeElement))).toBe(true);
      await page.keyboard.press("Escape");
      await expect(drawer).not.toBeVisible();
      await expect(menu).toBeFocused();
      await database.query("UPDATE human_coach SET retired_at = now() WHERE id = $1", [coachId]);
      expect((await page.goto("/espace-coach/seances"))?.status()).toBe(404);
      const stranger = await personPage(browser, newAddress("not-coach-v2"));
      expect((await stranger.goto("/espace-coach/aujourdhui"))?.status()).toBe(404);
      await stranger.context().close();
    } finally {
      await database.end();
      await admin.context().close();
    }
  });

  // #882: one physical instant, two viewers' clocks; Interviews still keep their existing Paris rules.
  test("a Montréal Candidate confirms the device zone and reads the same session as a Paris coach, including TZID", async ({ browser }) => {
    const admin = await personPage(browser, ADMINISTRATOR);
    const coachEmail = newAddress("coach-paris");
    const coach = await addCoach(admin, coachEmail);
    const coachId = await coachIdOf(admin, coach.name);
    const context = await browser.newContext({ baseURL: origin, locale: "fr-FR", timezoneId: "America/Montreal" });
    const candidate = await context.newPage();
    const coachPage = await personPage(browser, coachEmail);
    try {
      await signIn(candidate, newAddress("candidate-montreal"));
      await candidate.goto("/compte/preferences");
      await expect(candidate.getByLabel(fr.coachingTime.label)).toHaveValue(/America\/(?:Montreal|Toronto)/);
      await candidate.getByLabel(fr.coachingTime.label).fill("America/Montreal");
      await candidate.getByRole("button", { name: fr.coachingTime.save }).click();
      await expect(candidate.getByRole("status").filter({ hasText: fr.account.saved })).toBeVisible();
      const database = new Pool({ connectionString: own.databaseUrl });
      try { await paidFixture(candidate, coachId, database); } finally { await database.end(); }
      const read = await (await candidate.request.get("/api/coaching")).json();
      const session = read.sessions[0];
      expect(read.timeZone).toBe("America/Montreal");
      expect(
        (
          await candidate.request.patch(`/api/coaching/sessions/${session.id}`, {
            data: { scheduledAt: "2026-11-12T14:30", durationMinutes: 60 },
            headers: { origin },
          })
        ).ok(),
      ).toBe(true);
      await candidate.goto("/coachs");
      const card = candidate.locator(`#seance-${session.id}`);
      await expect(card).toContainText("08:30");
      await expect(card).toContainText("14:30");
      const calendar = await candidate.request.get(`/api/agenda/coaching-sessions/${session.id}/calendar.ics`);
      expect(calendar.ok()).toBe(true);
      expect(await calendar.text()).toContain("DTSTART;TZID=America/Montreal:20261112T083000");
      await coachPage.goto(`/espace-coach/seances/${session.id}`);
      await expect(coachPage.getByRole("main")).toContainText("14:30");
    } finally {
      await context.close();
      await coachPage.context().close();
      await admin.context().close();
    }
  });

  // #1026, « Espace coach v2 » on: on the Agenda, a Coaching Session that has ended (10 days ago) offers neither
  // « Modifier la date » nor « Annuler la séance »; one in 3 days still offers both. Dates are relative to the server's
  // clock, so the test holds at any hour.
  test("the Agenda offers neither date change nor cancellation for a Coaching Session that has ended", async ({ page, browser }) => {
    const admin = await personPage(browser, ADMINISTRATOR);
    const coach = await addCoach(admin, newAddress("coach-agenda-ended"));
    const coachId = await coachIdOf(admin, coach.name);
    await admin.context().close();
    await signIn(page, newAddress("agenda-ended"));
    const database = new Pool({ connectionString: own.databaseUrl });
    let ended = "";
    let toCome = "";
    try {
      await paidFixture(page, coachId, database);
      await paidFixture(page, coachId, database);
      [ended, toCome] = ((await (await page.request.get("/api/coaching")).json()).sessions as { id: string }[]).map((session) => session.id) as [string, string];
      await database.query("UPDATE coaching_session SET scheduled_at=now()-interval '10 days',duration_minutes=45 WHERE id=$1", [ended]);
      await database.query("UPDATE coaching_session SET scheduled_at=now()+interval '3 days',duration_minutes=60 WHERE id=$1", [toCome]);
    } finally {
      await database.end();
    }
    const itemOf = (id: string) => page.locator("li.agenda-item", { has: page.locator(`a.agenda-item-link[href="/coachs#seance-${id}"]`) });
    const actions = [tr(fr.coachingSession.editFor, { name: coach.name }), tr(fr.agendaChanges.cancelSessionFor, { name: coach.name })];

    await page.goto("/agenda?vue=liste&periode=passes");
    await expect(itemOf(ended)).toBeVisible();
    await expect(itemOf(ended)).toContainText(tr(fr.agenda.withCoach, { name: coach.name }));
    await expect(itemOf(ended).getByRole("button")).toHaveCount(0);
    await expect(itemOf(ended).getByText(fr.coachingCancellation.tooLate)).toHaveCount(0);

    await page.goto("/agenda?vue=liste");
    for (const name of actions) await expect(itemOf(toCome).getByRole("button", { name })).toBeVisible();
  });

  test("the daily workspace links a paid Candidate, privately autosaves notes, exports them, and joins a confirmed session", async ({ page, browser }) => {
    test.setTimeout(120_000);
    const database = new Pool({ connectionString: own.databaseUrl });
    const admin = await personPage(browser, ADMINISTRATOR);
    const coachEmail = newAddress("workspace-coach");
    const coach = await addCoach(admin, coachEmail);
    const coachId = await coachIdOf(admin, coach.name);
    const coachPage = await personPage(browser, coachEmail);
    try {
      await signIn(page, newAddress("workspace-candidate"));
      const applicationId = await applicationWithCoverLetter(page, origin);
      await admin.goto("/admin/coachs");
      const sellerForm = admin.locator("form").filter({ has: admin.getByRole("heading", { name: fr.coachingOffers.addSeller, exact: true }) });
      await sellerForm.getByLabel(fr.coachingOffers.coach, { exact: true }).selectOption(coachId);
      await sellerForm.getByLabel(fr.coachingOffers.sellerName).fill("Sophie Conseil");
      await sellerForm.getByLabel(fr.coachingOffers.status).fill("SAS");
      await sellerForm.getByLabel(fr.coachingOffers.siretLabel, { exact: true }).fill("12345678901234");
      await sellerForm.getByLabel(fr.coachingOffers.commission).fill("1750");
      await sellerForm.getByRole("button", { name: fr.coachingOffers.addSeller, exact: true }).click();
      await expect(admin.getByRole("heading", { name: "Sophie Conseil", exact: true })).toBeVisible();
      const sellerId = (await database.query("SELECT id FROM coaching_seller WHERE coach_id=$1", [coachId])).rows[0].id;
      expect((await database.query(`SELECT after FROM back_office_audit WHERE target=$1 AND action='added'`, [sellerId])).rows[0].after).toMatchObject({
        commissionBps: 1750,
        coachId,
      });
      const commissionForm = admin.locator("form").filter({ has: admin.getByRole("heading", { name: "Jobbbox", exact: true }) });
      await commissionForm.getByLabel(fr.coachingOffers.commission).fill("1200");
      await commissionForm.getByRole("button", { name: fr.coachingOffers.saveCommission }).click();
      await expect
        .poll(async () => (await database.query("SELECT commission_bps FROM coaching_seller WHERE kind='jobbbox'")).rows[0].commission_bps)
        .toBe(1200);
      const candidateId = await paidFixture(page, coachId, database);
      await commissionForm.getByLabel(fr.coachingOffers.commission).fill("3300");
      await commissionForm.getByRole("button", { name: fr.coachingOffers.saveCommission }).click();
      const session = (await (await page.request.get("/api/coaching")).json()).sessions[0];
      expect((await database.query("SELECT snapshot FROM coaching_session_sale WHERE session_id=$1", [session.id])).rows[0].snapshot.commissionBps).toBe(1200);

      await database.query("UPDATE coaching_session SET scheduled_at=now()+interval '5 minutes',duration_minutes=60 WHERE id=$1", [session.id]);
      await expect(async () => {
        await coachPage.goto("/espace-coach");
        await expect(coachPage).toHaveURL(/aujourdhui$/);
      }).toPass();
      await expect(coachPage.getByRole("link", { name: space.unnamedCandidate, exact: true }).first()).toBeVisible();
      await coachPage.goto(`/espace-coach/candidates/${candidateId}`);
      await expect(coachPage.getByText(fr.coachWorkspace.noAccess)).toBeVisible();
      await expect(coachPage.getByRole("heading", { name: space.profilesTitle })).toHaveCount(0);
      await coachPage.getByLabel(fr.coachWorkspace.notes).fill("Notes privées du coach, jamais à l’écran du Candidate.");
      await expect(coachPage.getByRole("status")).toHaveText(fr.coachWorkspace.noteStatus.saved);
      await coachPage.reload();
      await expect(coachPage.getByLabel(fr.coachWorkspace.notes)).toHaveValue("Notes privées du coach, jamais à l’écran du Candidate.");
      const exported = await (await page.request.get("/api/account/export")).json();
      expect(exported.privateCoachNotes).toEqual([expect.objectContaining({ text: "Notes privées du coach, jamais à l’écran du Candidate." })]);
      await page.goto("/coachs");
      await expect(page.locator(`#seance-${session.id}`)).toBeVisible();
      await expect(page.getByText("Notes privées du coach, jamais à l’écran du Candidate.")).toHaveCount(0);
      await coachPage.goto(`/espace-coach/seances/${session.id}`);
      await expect(coachPage.getByRole("heading", { name: fr.coachWorkspace.phase.during })).toBeVisible();
      await coachPage.getByLabel(fr.coachMeeting.target).fill("https://meet.google.com/abc-defg-hij");
      await coachPage.getByRole("button", { name: fr.coachMeeting.save }).click();
      await expect(coachPage.getByRole("status").filter({ hasText: fr.account.saved })).toBeVisible();
      await page.goto("/coachs");
      await expect(page.getByRole("link", { name: fr.coachMeeting.join.meet })).toBeVisible();
      // A stale date-only drawer must not send its hidden link over the coach's newer contact.
      await page.getByRole("button", { name: tr(fr.coachingSession.editFor, { name: coach.name }), exact: true }).click();
      const dateDrawer = page.getByRole("dialog", { name: tr(fr.coachingSession.title, { name: coach.name }) });
      await expect(dateDrawer.getByLabel(fr.coachingSession.videoLink)).toHaveCount(0);
      await coachPage.getByLabel(fr.coachMeeting.target).fill("https://meet.google.com/new-link-now");
      await coachPage.getByRole("button", { name: fr.coachMeeting.save }).click();
      await expect
        .poll(async () => (await database.query("SELECT video_link FROM coaching_session WHERE id=$1", [session.id])).rows[0].video_link)
        .toBe("https://meet.google.com/new-link-now");
      const dateWrite = page.waitForRequest(
        (request) => request.method() === "PATCH" && new URL(request.url()).pathname === `/api/coaching/sessions/${session.id}`,
      );
      await dateDrawer.getByRole("button", { name: fr.coachingSession.save, exact: true }).click();
      expect((await dateWrite).postDataJSON()).not.toHaveProperty("videoLink");
      await expect(dateDrawer).not.toBeVisible();
      await expect(page.getByRole("link", { name: fr.coachMeeting.join.meet })).toHaveAttribute("href", exitHref("https://meet.google.com/new-link-now"));

      // Keep both pages open across the window boundary: no navigation or manual reload to enter reading.
      await database.query("UPDATE coaching_session SET scheduled_at=now()+interval '10 minutes 3 seconds' WHERE id=$1", [session.id]);
      await coachPage.goto(`/espace-coach/seances/${session.id}`);
      await page.goto(`/coachs/seances/${session.id}`);
      await expect(coachPage.getByRole("heading", { name: fr.coachWorkspace.phase.before, exact: true })).toBeVisible();
      await expect(coachPage.locator(".shared-reading")).toHaveCount(0);
      await expect(coachPage.getByRole("heading", { name: fr.coachWorkspace.phase.during, exact: true })).toBeVisible({ timeout: 10000 });
      await expect(coachPage.locator(".shared-reading")).toBeVisible();
      await expect(page.locator(".shared-reading")).toBeVisible();
      // #873: two separate browsers follow one explicitly selected document, without Coach Access.
      await database.query("UPDATE tailored_document SET text=$2 WHERE application_id=$1 AND kind='cover_letter'", [
        applicationId,
        "Shared reading paragraph. \n".repeat(1000),
      ]);
      await page.goto(`/coachs/seances/${session.id}`);
      await page.getByLabel(fr.sharedReading.document, { exact: true }).selectOption(JSON.stringify({ kind: "cover_letter", id: applicationId }));
      await page.getByRole("button", { name: fr.sharedReading.show, exact: true }).click();
      const candidateReading = page.locator(".shared-reading-document");
      const coachReading = coachPage.locator(".shared-reading-document");
      await expect(candidateReading).toContainText("Shared reading paragraph.");
      await expect(coachReading).toContainText("Shared reading paragraph.");
      await candidateReading.focus();
      await page.keyboard.press("Control+End");
      await expect
        .poll(() => coachReading.evaluate((el) => el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight)), { timeout: 2000 })
        .toBeGreaterThan(0.9);
      const shareId = (await database.query("SELECT id FROM shared_reading WHERE session_id=$1", [session.id])).rows[0].id;
      await expect(coachPage.getByRole("link", { name: fr.designSystem.viewer.download, exact: true })).toHaveCount(0);
      await page.getByRole("button", { name: fr.sharedReading.stop, exact: true }).click();
      await expect(coachReading).toHaveCount(0);
      expect((await coachPage.request.get(`/api/coaching/shared-reading/${session.id}/document?share=${shareId}`)).status()).toBe(404);
      const profileId = (await database.query("SELECT profile_id FROM application WHERE id=$1", [applicationId])).rows[0].profile_id;
      const pdf = await page.request.get(`/api/profiles/${profileId}/master-cv/export?format=pdf&template=classic`);
      expect(pdf.ok()).toBe(true);
      await coachPage
        .locator('.shared-reading input[type="file"]')
        .setInputFiles({ name: "slides.pdf", mimeType: "application/pdf", buffer: await pdf.body() });
      await coachPage.getByRole("button", { name: fr.sharedReading.present, exact: true }).click();
      await expect(page.locator(".shared-reading .ds-viewer canvas").first()).toBeVisible();
      await expect(page.locator(".shared-reading").getByRole("link", { name: fr.designSystem.viewer.download, exact: true })).toHaveCount(0);
      const pdfShareId = (await database.query("SELECT id FROM shared_reading WHERE session_id=$1", [session.id])).rows[0].id;
      await database.query("UPDATE coaching_session SET scheduled_at=now()-interval '60 minutes'+interval '3 seconds' WHERE id=$1", [session.id]);
      await coachPage.reload();
      await expect(coachPage.getByRole("heading", { name: fr.coachWorkspace.phase.during, exact: true })).toBeVisible();
      await expect(coachPage.getByRole("heading", { name: fr.coachWorkspace.phase.after, exact: true })).toBeVisible({ timeout: 10000 });
      await expect(coachPage.getByLabel(fr.coachReports.covered)).toBeVisible();
      await expect(coachPage.locator(".shared-reading")).toBeVisible();

      await database.query("UPDATE coaching_session SET scheduled_at=now()-interval '90 minutes'+interval '3 seconds' WHERE id=$1", [session.id]);
      await page.reload();
      await coachPage.reload();
      await expect(page.locator(".shared-reading")).toBeVisible();
      await expect(page.locator(".shared-reading")).toHaveCount(0, { timeout: 10000 });
      await expect(coachPage.locator(".shared-reading")).toHaveCount(0, { timeout: 10000 });

      expect((await coachPage.request.get(`/api/coaching/shared-reading/${session.id}/document?share=${pdfShareId}`)).status()).toBe(404);
      await coachPage.goto(`/espace-coach/seances/${session.id}`);
      await coachPage.getByLabel(fr.coachReports.covered).fill("Nous avons préparé votre présentation ensemble.");
      await coachPage.getByLabel(fr.coachReports.nextSteps).fill("Préparer une candidature pour votre prochaine offre.");
      await coachPage.getByLabel(fr.coachReports.resources).fill("https://www.apec.fr/");
      await coachPage.getByRole("button", { name: fr.coachReports.save }).click();
      await expect(coachPage.getByRole("status").filter({ hasText: fr.coachReports.status.saved })).toBeVisible();
      await page.goto(`/coachs/seances/${session.id}`);
      await expect(page.getByText("Nous avons préparé votre présentation ensemble.")).toHaveCount(0);
      await coachPage.getByRole("button", { name: fr.coachReports.publish, exact: true }).click();
      await expect(coachPage.getByRole("heading", { name: fr.coachReports.published })).toBeVisible();
      await page.reload();
      await expect(page.getByText("Nous avons préparé votre présentation ensemble.", { exact: false })).toBeVisible();
      await expect(page.locator(".coach-report-author")).toContainText(coach.name);
      await expect(
        page
          .locator(".chat-message")
          .filter({ has: page.locator(".coach-report-author") })
          .locator(".provenance-line"),
      ).toHaveCount(0);
      // Native WebView uses the dedicated coach drawer too, despite the Candidate shell's global hiding rule.
      await coachPage.setExtraHTTPHeaders({ "user-agent": "Mozilla/5.0 JobbboxApp/1.0" });
      await coachPage.setViewportSize({ width: 390, height: 844 });
      await coachPage.goto("/espace-coach/seances");
      await coachPage.getByRole("button", { name: fr.sidebar.menu, exact: true }).click();
      await expect(coachPage.getByRole("dialog", { name: fr.sidebar.menu })).toBeVisible();
    } finally {
      await database.end();
      await coachPage.context().close();
      await admin.context().close();
    }
  });
});
