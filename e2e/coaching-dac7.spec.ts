/**
 * #887 — DAC7: the annual declaration of the Sellers' income, end to end through the public entry points. A Coach gives
 * their fiscal identity in « Revenus » (#878), sells two sessions in two quarters of 2026 through Stripe Connect (the fake
 * Stripe, e2e/support), is paid out by the worker's monthly job, and in January 2027 (the server's clock moved by
 * e2e/support/fake-clock.mjs) an Administrator prepares the year in the Back Office. What the export says is read against what
 * #878 paid.
 */
import path from "node:path";
import os from "node:os";
import { mkdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { Pool } from "pg";
import { test, expect, type Browser, type Page } from "@playwright/test";
import { startOwnServer, signInByEmail, type OwnServer } from "./support/own-server";
import { setUpTwoStepVerificationIfAsked } from "./support/candidate";
import { newAddress, emailsIn } from "./support/mailbox";
import { orderToStripe } from "./support/stripe-checkout";
import { fakeClock, type Clock } from "./support/fake-clock";
import { scheduledPayoutAt } from "../apps/web/src/coaching-connect/earnings";
import { migrateCoachPages } from "../apps/web/src/coach-pages";
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8")),
  ADMIN = "dac7-office@e2e.jobbbox.test",
  NAME = "Coach DAC7",
  SECRET = "whsec_dac7_e2e",
  SIRET = "12345678901234",
  IBAN = "FR7630006000011234567890189",
  OPERATOR = { legalName: "Jobbbox Test SAS", tin: "123456789", platformName: "Jobbbox", street: "1 rue de l’Opérateur", postalCode: "75002", city: "Paris" },
  CLOCK_FILE = path.join(os.tmpdir(), `jobhub-e2e-dac7-clock-${process.pid}`);
let own: OwnServer, database: Pool, clock: Clock;
const stripeUrl = () => process.env.E2E_STRIPE_URL!;
async function account(browser: Browser, email: string) {
  const page = await (await browser.newContext({ baseURL: own.origin, locale: "fr-FR" })).newPage();
  await signInByEmail(page, own, email);
  return page;
}
/** The worker's monthly payout, run once as of `iso`. */
async function monthly(iso: string) {
  await clock.stripe(iso);
  const run = spawnSync(path.resolve("node_modules/.bin/tsx"), ["e2e/support/connect-monthly.ts", iso], {
    env: {
      ...process.env,
      NODE_OPTIONS: "",
      DATABASE_URL: own.databaseUrl,
      APP_URL: own.origin,
      STRIPE_SECRET_KEY: "sk_test_fake",
      STRIPE_CONNECT_WEBHOOK_SECRET: SECRET,
      STRIPE_API_URL: stripeUrl(),
    },
    encoding: "utf8",
  });
  expect(run.status, run.stderr).toBe(0);
}
/** A Candidate buys the Coach's session on `iso` and Stripe's signed webhook records it. */
async function sale(buyer: Page, iso: string, accountId: string, coachId: string) {
  await clock.stripe(iso);
  await buyer.goto("/coachs");
  const checkout = await orderToStripe(buyer, "/api/coaching/checkout", fr.humanCoaches.book.replace("{{name}}", NAME));
  expect(checkout.status()).toBe(303);
  const { id: context, checkout_id } = (await database.query("SELECT id,checkout_id FROM coaching_connect_payment WHERE coach_id=$1 AND paid_at IS NULL", [coachId])).rows[0];
  await fetch(`${stripeUrl()}/__connect/pay`, { method: "POST", body: new URLSearchParams({ session: checkout_id }) });
  const state = await (await fetch(`${stripeUrl()}/__connect/state`)).json(),
    session = state.sessions.find((item: { value: { id: string } }) => item.value.id === checkout_id).value;
  const payload = JSON.stringify({ id: `evt_${context}`, object: "event", type: "checkout.session.completed", account: accountId, data: { object: session } });
  const webhook = await buyer.request.post("/api/coaching/connect/webhook", {
    data: payload,
    headers: { "stripe-signature": clock.sign(payload, SECRET), "content-type": "application/json" },
  });
  expect(webhook.status()).toBe(200);
  await expect.poll(async () => (await database.query("SELECT 1 FROM coaching_connect_payment WHERE id=$1 AND paid_at IS NOT NULL", [context])).rowCount).toBe(1);
}
test.beforeAll(async () => {
  mkdirSync(path.dirname(CLOCK_FILE), { recursive: true });
  clock = fakeClock(CLOCK_FILE, stripeUrl());
  own = await startOwnServer(887, "coaching_dac7", {
    JOBHUB_TARGET: "e2e",
    JOBHUB_IGNORE_ROOT_ENV: "1",
    ADMIN_EMAILS: ADMIN,
    AUTH_SECRET: "dac7-e2e-secret-dac7-e2e-secret-dac7-e2e-secret",
    MAIL_TRANSPORT: "console",
    SECRETS_MASTER_KEYS: "1:ZTJlLW9ubHktbWFzdGVyLWtleS1lMmUtb25seS0wMDA=",
    AI_SCORING_PROVIDER: "mistral",
    AI_WRITING_PROVIDER: "mistral",
    AI_COACHING_PROVIDER: "mistral",
    MISTRAL_API_KEY: "e2e-mistral-key",
    STRIPE_SECRET_KEY: "sk_test_fake",
    STRIPE_WEBHOOK_SECRET: "whsec_test_fake",
    STRIPE_CONNECT_WEBHOOK_SECRET: SECRET,
    STRIPE_PRICE_STANDARD: "price_standard_monthly",
    STRIPE_PRICE_PREMIUM: "price_premium_monthly",
    STRIPE_PRICE_COACHING_SESSION: "price_coaching_session",
    STRIPE_PRICE_COACHING_SESSION_PREMIUM: "price_coaching_session_premium",
    STRIPE_API_URL: stripeUrl(),
    E2E_CLOCK_FILE: CLOCK_FILE,
    NODE_OPTIONS: ["fake-clock.mjs", "fake-coach-contract.mjs", "fake-coaching-legal.mjs", "fake-google.mjs", "fake-mistral.mjs", "fake-reference-data.mjs"]
      .map((file) => `--import=${path.resolve("e2e/support", file)}`)
      .join(" "),
  });
  database = new Pool({ connectionString: own.databaseUrl });
});
test.afterAll(async () => {
  // The fake Stripe is the suite's, and this worker's globals the next specs': back on the real time for them.
  await clock?.reset().catch(() => undefined);
  await database?.end();
  await own?.stop();
});
test("a Seller's fiscal identity is collected at onboarding, and the year's DAC7 export, prepared by an Administrator, matches what #878 paid", async ({ browser }) => {
  test.setTimeout(420000);
  // The preparation is 2026's alone (coaching-tax/index.ts), and its story begins with the suite's real clock, in the year to report.
  test.skip(new Date().getFullYear() !== 2026, "DAC7's export covers 2026 only; the story needs a real date in 2026");
  const coachEmail = newAddress("dac7-coach"),
    buyerEmail = newAddress("dac7-buyer"),
    stripe = stripeUrl();
  const coachId = (
    await database.query("INSERT INTO human_coach(name,email,booking_url,bio,public_ready) VALUES($1,$2,$3,$4,true) RETURNING id", [
      NAME,
      coachEmail,
      "https://cal.com/dac7-fixture",
      "Profil professionnel déjà approuvé pour ce scénario fiscal.",
    ])
  ).rows[0].id;
  await migrateCoachPages(database);
  let admin = await account(browser, ADMIN),
    owner = await account(browser, coachEmail),
    buyer = await account(browser, buyerEmail);
  try {
    // The Administrator creates the Seller and its Coaching Offer (90 € a session, 20 % Commission).
    await admin.goto("/admin/coachs");
    const sellerForm = admin.locator("form").filter({ has: admin.getByRole("heading", { name: fr.coachingOffers.addSeller, exact: true }) });
    await sellerForm.getByLabel(fr.coachingOffers.kind, { exact: true }).selectOption("human_coach");
    await sellerForm.getByLabel(fr.coachingOffers.coach, { exact: true }).selectOption(coachId);
    await sellerForm.getByLabel(fr.coachingOffers.sellerName, { exact: true }).fill("DAC7 Coach EI");
    await sellerForm.getByLabel(fr.coachingOffers.status, { exact: true }).fill("Entreprise individuelle");
    await sellerForm.getByLabel(fr.coachingOffers.siretLabel, { exact: true }).fill(SIRET);
    await sellerForm.getByLabel(fr.coachingOffers.commission, { exact: true }).fill("2000");
    await sellerForm.getByRole("button", { name: fr.coachingOffers.addSeller, exact: true }).click();
    await expect.poll(async () => Number((await database.query("SELECT count(*) FROM coaching_seller WHERE coach_id=$1", [coachId])).rows[0].count)).toBe(1);
    const sellerId = (await database.query("SELECT id FROM coaching_seller WHERE coach_id=$1", [coachId])).rows[0].id;
    await admin.reload();
    const offerForm = admin.locator("form").filter({ has: admin.locator(`input[name="coachId"][value="${coachId}"]`) });
    await offerForm.getByLabel(fr.coachingOffers.seller, { exact: true }).selectOption(sellerId);
    await offerForm.getByLabel(fr.coachingOffers.duration, { exact: true }).fill("90");
    await offerForm.getByLabel(fr.coachingOffers.amount, { exact: true }).fill("9000");
    await offerForm.getByRole("button", { name: fr.coachingOffers.save, exact: true }).click();
    await expect.poll(async () => (await database.query("SELECT seller_id FROM coaching_offer WHERE coach_id=$1", [coachId])).rows[0].seller_id).toBe(sellerId);

    // Criterion 1: identity, address, NIF, SIRET and IBAN are collected in « Revenus » before Connect onboarding opens.
    await owner.goto("/espace-coach/revenus");
    await setUpTwoStepVerificationIfAsked(owner);
    await owner.getByRole("checkbox", { name: fr.coachContract.agree.replace("{{version}}", "2026-01-01") }).check();
    await owner.getByRole("button", { name: fr.coachContract.accept, exact: true }).click();
    await expect(owner).toHaveURL(/espace-coach\/aujourdhui$/);
    await owner.goto("/espace-coach/revenus");
    // Without it, Stripe is not reached: the Connect account is not opened.
    await owner.getByRole("button", { name: fr.coachConnect.start, exact: true }).click();
    await owner.waitForLoadState("networkidle");
    expect((await database.query("SELECT count(*)::int AS n FROM coaching_connect_account WHERE seller_id=$1", [sellerId])).rows[0].n).toBe(0);
    expect(owner.url()).not.toContain("connect.stripe.test");
    await owner.goto("/espace-coach/revenus");
    const fiscalForm = owner.locator("form").filter({ has: owner.getByRole("button", { name: fr.coachTax.saveIdentity, exact: true }) });
    for (const field of ["legalName", "firstName", "lastName", "birthDate", "residence", "tin", "tinCountry", "siret", "street", "postalCode", "city", "addressCountry", "iban", "accountHolder"])
      await expect(fiscalForm.getByLabel(fr.coachTax.fields[field], { exact: true })).toBeVisible();
    const values: Record<string, string> = {
      legalName: "DAC7 Coach EI",
      firstName: "Synthetic",
      lastName: "Coach",
      birthDate: "1980-01-01",
      residence: "FR",
      tin: SIRET,
      tinCountry: "FR",
      siret: SIRET,
      street: "1 rue Test",
      postalCode: "75001",
      city: "Paris",
      addressCountry: "FR",
      iban: IBAN,
      accountHolder: "Synthetic Coach",
    };
    for (const [field, value] of Object.entries(values)) await fiscalForm.getByLabel(fr.coachTax.fields[field], { exact: true }).fill(value);
    const saved = owner.waitForResponse((response) => response.url().endsWith("/api/account/coaching/tax-identity") && response.request().method() === "PUT");
    await fiscalForm.getByRole("button", { name: fr.coachTax.saveIdentity, exact: true }).click();
    expect((await saved).ok()).toBe(true);
    await expect(fiscalForm.getByRole("status")).toHaveText(fr.coachTax.saved);
    // Kept sealed: neither the IBAN nor the NIF is readable in the database.
    const sealed = JSON.stringify((await database.query("SELECT * FROM coaching_tax_identity")).rows);
    expect(sealed).not.toContain(IBAN);
    expect(sealed).not.toContain("Synthetic");
    await owner.reload();
    await expect(owner.getByRole("button", { name: fr.coachConnect.start, exact: true })).toBeVisible();
    let destination = "";
    await owner.route(
      (url) => url.pathname === "/espace-coach/revenus",
      async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        const response = await route.fetch({ maxRedirects: 0 }),
          headers = response.headers();
        destination = headers["x-action-redirect"] ?? headers.location ?? "";
        const local = `${own.origin}/espace-coach/revenus?connect=fixture`;
        if (headers["x-action-redirect"]) headers["x-action-redirect"] = `${local};push`;
        if (headers.location) headers.location = local;
        await route.fulfill({ response, headers });
      },
    );
    await owner.getByRole("button", { name: fr.coachConnect.start, exact: true }).click();
    await expect.poll(() => destination).toContain("connect.stripe.test");
    await owner.unrouteAll({ behavior: "wait" });
    const accountId = (await database.query("SELECT account_id FROM coaching_connect_account WHERE seller_id=$1", [sellerId])).rows[0].account_id;
    await fetch(`${stripe}/__connect/activate`, { method: "POST", body: new URLSearchParams({ account: accountId }) });

    // A Seller far below any threshold: two sessions, 180 € in all, sold in Q1 and Q2 of 2026 as Stripe dates them (the
    // server books them as they arrive) and paid out together by the worker's monthly job, once their Withdrawal period is over.
    await sale(buyer, "2026-02-10T10:00:00Z", accountId, coachId);
    await sale(buyer, "2026-05-20T10:00:00Z", accountId, coachId);
    // The first monthly boundary after both Withdrawal periods (1st of the month at noon): December this year, or January's.
    const lastPaid = (await database.query("SELECT max(paid_at) AS at FROM coaching_connect_payment WHERE coach_id=$1", [coachId])).rows[0].at as Date;
    await monthly(scheduledPayoutAt(lastPaid).toISOString());
    const batches = (
      await database.query<{ amount: number; paidAt: Date }>(`SELECT amount,paid_at AS "paidAt" FROM coaching_connect_batch WHERE seller_id=$1 AND state='paid' ORDER BY paid_at`, [sellerId])
    ).rows;
    expect(batches.map((batch) => batch.amount)).toEqual([14400]);

    // The year is not closed yet: an Administrator cannot prepare 2026 in November.
    await admin.goto("/admin/coachs/dac7");
    await admin.getByLabel(fr.coachTax.year, { exact: true }).fill("2026");
    for (const [field, value] of Object.entries(OPERATOR)) await admin.getByLabel(fr.coachTax.operator[field], { exact: true }).fill(value);
    await admin.getByRole("button", { name: fr.coachTax.prepare, exact: true }).click();
    await expect(admin.getByText(fr.coachTax.prepareError, { exact: true })).toBeVisible();
    await expect(admin.getByRole("article")).toHaveCount(0);

    // Criterion 2: on 15 January the Administrator prepares the year, from the Back Office only.
    await clock.server("2027-01-15T09:00:00Z");
    await admin.context().close();
    admin = await account(browser, ADMIN);
    owner = await account(browser, coachEmail);
    buyer = await account(browser, buyerEmail);
    for (const denied of [owner, buyer]) {
      expect((await denied.request.get("/admin/coachs/dac7", { maxRedirects: 0 })).status()).not.toBe(200);
      expect((await denied.request.get("/api/admin/coaching/tax/00000000-0000-4000-8000-000000000000")).status()).not.toBe(200);
    }
    await admin.goto("/admin/coachs/dac7");
    await admin.getByLabel(fr.coachTax.year, { exact: true }).fill("2026");
    for (const [field, value] of Object.entries(OPERATOR)) await admin.getByLabel(fr.coachTax.operator[field], { exact: true }).fill(value);
    await admin.getByRole("button", { name: fr.coachTax.prepare, exact: true }).click();
    const report = admin.getByRole("article").filter({ hasText: fr.coachTax.copyTitle.replace("{{year}}", "2026") });
    await expect(report).toBeVisible();
    await expect(admin.getByText(fr.coachTax.prepareError, { exact: true })).toHaveCount(0);
    const reportId = (await database.query("SELECT id FROM coaching_tax_report WHERE year=2026 AND superseded_at IS NULL")).rows[0].id;

    // The file, in the DGFiP's 2026 layout, named as it expects; a prepared draft, never filed by Jobbbox.
    const draft = await admin.request.get(`/api/admin/coaching/tax/${reportId}?draft=1`);
    expect(draft.status()).toBe(200);
    expect(draft.headers()["content-type"]).toContain("application/xml");
    expect(draft.headers()["content-disposition"]).toMatch(/filename="DRAFT-[^"]+\.xml"/);
    expect(draft.headers()["cache-control"]).toBe("private, no-store");
    const xml = await draft.text();
    expect(xml).toContain("<?xml");
    expect(xml).toContain("DPI_OECD"); // the DGFiP's DAC7 message type
    expect(xml).toContain(OPERATOR.tin);
    expect(xml).toContain(SIRET);
    expect(xml).toContain(IBAN);
    expect(xml).toContain("1 rue Test");
    // Criterion 3: no threshold: two sessions and 144 € of income are reported all the same.
    expect(xml).toContain('<dpi:ConsQ1 currCode="EUR">72</dpi:ConsQ1>');
    expect(xml).toContain('<dpi:ConsQ2 currCode="EUR">72</dpi:ConsQ2>');
    expect(xml).toContain("<dpi:NumbQ1>1</dpi:NumbQ1>");
    expect(xml).toContain("<dpi:NumbQ2>1</dpi:NumbQ2>");
    expect(xml).toContain('<dpi:FeesQ1 currCode="EUR">18</dpi:FeesQ1>');
    // Without the official schema in the build, the structure is not validated: only the draft is offered.
    await expect(report.getByRole("link", { name: fr.coachTax.downloadDraft, exact: true })).toBeVisible();
    await report.getByRole("button", { name: fr.coachTax.validateSchema, exact: true }).click();
    await expect(report.getByText(fr.coachTax.schemaPending, { exact: true })).toBeVisible();
    expect((await admin.request.get(`/api/admin/coaching/tax/${reportId}`)).status()).toBe(409);

    // Criterion 4: the export of the year against #878's payouts and Coach Earnings.
    const reconciliation = await admin.request.get(`/api/admin/coaching/tax/${reportId}?reconciliation=1`);
    expect(reconciliation.status()).toBe(200);
    expect(reconciliation.headers()["content-disposition"]).toContain("dac7-reconciliation-2026.json");
    const { sellers } = await reconciliation.json();
    expect(sellers).toHaveLength(1);
    expect(sellers[0].sellerId).toBe(sellerId);
    // A payout of 2027 (when the real date is late in the year) is the next year's remittance, not 2026's.
    const quarterOf = (date: Date) =>
      Number(date.toLocaleString("en-CA", { timeZone: "Europe/Paris", year: "numeric" })) === 2026 ? Math.ceil(Number(date.toLocaleString("en-CA", { timeZone: "Europe/Paris", month: "numeric" })) / 3) : 0;
    type Quarter = { quarter: number; consideration: number; fees: number; activities: number; bankPayouts: number };
    const quarters: Quarter[] = sellers[0].quarters;
    for (const q of quarters)
      expect(q.bankPayouts, `bank payouts of Q${q.quarter}`).toBe(batches.filter((batch) => quarterOf(batch.paidAt) === q.quarter).reduce((sum, batch) => sum + batch.amount, 0));
    // Income by the quarter of the sale (Stripe's dates), bank payouts apart by the quarter of the payout.
    expect(quarters.map((q) => [q.consideration, q.fees, q.activities])).toEqual([
      [7200, 1800, 1],
      [7200, 1800, 1],
      [0, 0, 0],
      [0, 0, 0],
    ]);
    // Everything credited is what was paid out (nothing is due any more), never twice.
    expect(quarters.reduce((sum, q) => sum + q.consideration, 0)).toBe(batches.reduce((sum, batch) => sum + batch.amount, 0));
    // …and the payout Coach Earnings shows the Seller for the month it was paid.
    await owner.goto(`/espace-coach/revenus?mois=${new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit" }).format(batches[0]!.paidAt)}`);
    await expect(owner.getByRole("main")).toContainText("144,00");

    // The Seller's own copy: listed in « Revenus » and downloaded as a PDF, closed to anyone else. The notification email
    // waits for a validated file: none is sent while the schema is unavailable.
    expect((await database.query("SELECT count(*)::int AS n FROM coaching_tax_copy WHERE report_id=$1 AND seller_id=$2", [reportId, sellerId])).rows[0].n).toBe(1);
    await owner.goto("/espace-coach/revenus");
    const copy = owner.getByRole("link", { name: fr.coachTax.copyTitle.replace("{{year}}", "2026"), exact: true });
    await expect(copy).toBeVisible();
    const pdf = await owner.request.get(await copy.getAttribute("href").then((href) => href!));
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-type"]).toBe("application/pdf");
    expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
    expect((await buyer.request.get(`/api/account/coaching/tax/${reportId}/${sellerId}`)).status()).toBe(404);
    expect(emailsIn(own.output(), coachEmail).filter((mail) => mail.subject.includes(fr.coachTax.copyTitle.replace("{{year}}", "2026")))).toHaveLength(0);
  } finally {
    await admin.context().close();
    await owner.context().close();
    await buyer.context().close();
  }
});
