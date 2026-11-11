import path from "node:path";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { test, expect, type Browser } from "@playwright/test";
import { startOwnServer, signInByEmail, type OwnServer } from "./support/own-server";
import { setUpTwoStepVerificationIfAsked } from "./support/candidate";
import { newAddress, emailsIn } from "./support/mailbox";
import { orderToStripe } from "./support/stripe-checkout";
import { migrateCoachPages } from "../apps/web/src/coach-pages";
import { signedEvent } from "../apps/web/src/billing/fake-stripe";
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8")),
  ADMIN = "connect-office@e2e.jobbbox.test",
  NAME = "Coach Stripe Connect",
  SECRET = "whsec_connect_e2e";
let own: OwnServer, database: Pool;
async function account(browser: Browser, email: string) {
  const page = await (await browser.newContext({ baseURL: own.origin, locale: "fr-FR" })).newPage();
  await signInByEmail(page, own, email);
  return page;
}
test.beforeAll(async () => {
  own = await startOwnServer(878, "coaching_connect", {
    JOBHUB_TARGET: "e2e",
    JOBHUB_IGNORE_ROOT_ENV: "1",
    ADMIN_EMAILS: ADMIN,
    AUTH_SECRET: "connect-e2e-secret-connect-e2e-secret-connect",
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
    STRIPE_API_URL: process.env.E2E_STRIPE_URL,
    NODE_OPTIONS: ["fake-coach-contract.mjs", "fake-coaching-legal.mjs", "fake-google.mjs", "fake-mistral.mjs", "fake-reference-data.mjs"]
      .map((file) => `--import=${path.resolve("e2e/support", file)}`)
      .join(" "),
  });
  database = new Pool({ connectionString: own.databaseUrl });
});
test.afterAll(async () => {
  await database?.end();
  await own?.stop();
});
test("hosted Connect onboarding gates a third-party purchase, paid webhooks are scoped/idempotent, and Withdrawal refunds its account and Commission", async ({
  browser,
}) => {
  test.setTimeout(180000);
  const stripe = process.env.E2E_STRIPE_URL!,
    coachEmail = newAddress("connect-coach"),
    buyerEmail = newAddress("connect-buyer");
  const coachId = (
    await database.query("INSERT INTO human_coach(name,email,booking_url,bio,public_ready) VALUES($1,$2,$3,$4,true) RETURNING id", [
      NAME,
      coachEmail,
      "https://cal.com/connect-fixture",
      "Profil professionnel déjà approuvé pour ce scénario de paiement.",
    ])
  ).rows[0].id;
  await migrateCoachPages(database);
  const admin = await account(browser, ADMIN),
    owner = await account(browser, coachEmail),
    buyer = await account(browser, buyerEmail);
  try {
    await admin.goto("/admin/coachs");
    const sellerForm = admin.locator("form").filter({ has: admin.getByRole("heading", { name: fr.coachingOffers.addSeller, exact: true }) });
    await sellerForm.getByLabel(fr.coachingOffers.kind, { exact: true }).selectOption("human_coach");
    await sellerForm.getByLabel(fr.coachingOffers.coach, { exact: true }).selectOption(coachId);
    await sellerForm.getByLabel(fr.coachingOffers.sellerName, { exact: true }).fill("Connect Coach EI");
    await sellerForm.getByLabel(fr.coachingOffers.status, { exact: true }).fill("Entreprise individuelle");
    await sellerForm.getByLabel(fr.coachingOffers.siretLabel, { exact: true }).fill("12345678901234");
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
    await buyer.goto("/coachs");
    expect(await buyer.getByRole("button", { name: fr.humanCoaches.book.replace("{{name}}", NAME) }).count()).toBe(0);
    await owner.goto("/espace-coach/revenus");
    await setUpTwoStepVerificationIfAsked(owner);
    await owner.getByRole("checkbox", { name: fr.coachContract.agree.replace("{{version}}", "2026-01-01") }).check();
    await owner.getByRole("button", { name: fr.coachContract.accept, exact: true }).click();
    await expect(owner).toHaveURL(/espace-coach\/aujourdhui$/);
    await owner.goto("/espace-coach/revenus");
    const fiscalForm = owner.locator("form").filter({ has: owner.getByRole("button", { name: fr.coachTax.saveIdentity, exact: true }) });
    const values = {
      legalName: "Connect Coach EI",
      firstName: "Synthetic",
      lastName: "Coach",
      birthDate: "1980-01-01",
      residence: "FR",
      tin: "12345678901234",
      tinCountry: "FR",
      siret: "12345678901234",
      street: "1 rue Test",
      postalCode: "75001",
      city: "Paris",
      addressCountry: "FR",
      iban: "FR7630006000011234567890189",
      accountHolder: "Synthetic Coach",
    };
    for (const [field, value] of Object.entries(values)) await fiscalForm.getByLabel(fr.coachTax.fields[field], { exact: true }).fill(value);
    const savedTax = owner.waitForResponse(
      (response) => response.url().endsWith("/api/account/coaching/tax-identity") && response.request().method() === "PUT",
    );
    await fiscalForm.getByRole("button", { name: fr.coachTax.saveIdentity, exact: true }).click();
    expect((await savedTax).ok()).toBe(true);
    await expect(fiscalForm.getByRole("status")).toHaveText(fr.coachTax.saved);
    expect(
      (
        await buyer.request.put("/api/account/coaching/tax-identity", {
          headers: { origin: own.origin },
          data: { sellerId, year: 2026, identity: { ...values, kind: "individual" } },
        })
      ).status(),
    ).toBe(400);
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
    await expect(owner).toHaveURL(/connect=fixture/);
    await owner.unrouteAll({ behavior: "wait" });
    const accountId = (await database.query("SELECT account_id FROM coaching_connect_account WHERE seller_id=$1", [sellerId])).rows[0].account_id;
    await fetch(`${stripe}/__connect/activate`, { method: "POST", body: new URLSearchParams({ account: accountId }) });
    await buyer.goto("/coachs");
    const checkout = await orderToStripe(buyer, "/api/coaching/checkout", fr.humanCoaches.book.replace("{{name}}", NAME));
    expect(checkout.status()).toBe(303);
    expect(checkout.headers().location).toContain("checkout.stripe.test");
    const contexts = (await database.query("SELECT id,checkout_id FROM coaching_connect_payment WHERE coach_id=$1", [coachId])).rows;
    expect(contexts).toHaveLength(1);
    const context = contexts[0];
    await fetch(`${stripe}/__connect/pay`, { method: "POST", body: new URLSearchParams({ session: context.checkout_id }) });
    const state = await (await fetch(`${stripe}/__connect/state`)).json(),
      session = state.sessions.find((item: { value: { id: string } }) => item.value.id === context.checkout_id).value;
    const event = { id: `evt_${context.id}`, object: "event", type: "checkout.session.completed", account: accountId, data: { object: session } },
      signed = signedEvent(event, SECRET);
    expect(
      (
        await buyer.request.post("/api/coaching/connect/webhook", {
          data: signed.payload,
          headers: { "stripe-signature": "invalid", "content-type": "application/json" },
        })
      ).status(),
    ).toBe(400);
    const forged = signedEvent({ ...event, account: "acct_foreign" }, SECRET);
    expect(
      (
        await buyer.request.post("/api/coaching/connect/webhook", {
          data: forged.payload,
          headers: { "stripe-signature": forged.signature, "content-type": "application/json" },
        })
      ).status(),
    ).toBe(200);
    expect((await database.query("SELECT count(*)::int AS n FROM coaching_session")).rows[0].n).toBe(0);
    const deliveries = await Promise.all(
      [1, 2].map(() =>
        buyer.request.post("/api/coaching/connect/webhook", {
          data: signed.payload,
          headers: { "stripe-signature": signed.signature, "content-type": "application/json" },
        }),
      ),
    );
    expect(deliveries.map((r) => r.status())).toEqual([200, 200]);
    expect((await database.query("SELECT count(*)::int AS n FROM coaching_session")).rows[0].n).toBe(1);
    const sale = (await database.query("SELECT snapshot FROM coaching_session_sale")).rows[0].snapshot;
    expect(sale).toMatchObject({ amount: 9000, commissionBps: 2000, durationMinutes: 90, seller: { id: sellerId } });
    await expect.poll(() => emailsIn(own.output(), buyerEmail).filter((mail) => mail.text.includes("Connect Coach EI")).length).toBe(1);
    await buyer.goto("/agenda");
    await buyer.getByRole("link", { name: fr.withdrawals.agenda.label.replace("{{name}}", NAME) }).click();
    await buyer.getByLabel(fr.withdrawals.page.name).fill("Marie Connect");
    await buyer.getByRole("button", { name: fr.withdrawals.page.confirm }).click();
    await expect(buyer.getByRole("status")).toContainText(/Montant remboursé : 90,00\s€/);
    const calls = await (await fetch(`${stripe}/__calls`)).json(),
      refund = calls
        .filter((c: { path: string; params: Record<string, string> }) => c.path === "/v1/refunds" && c.params.payment_intent === session.payment_intent)
        .at(-1);
    expect((await database.query("SELECT status FROM withdrawal_refund")).rows[0].status).toBe("succeeded");
    expect(refund.account).toBe(accountId);
    expect(refund.params.refund_application_fee).toBe("true");
    expect((await database.query("SELECT withdrawn_at FROM coaching_session")).rows[0].withdrawn_at).not.toBeNull();
    const exported = await buyer.request.get("/api/account/export");
    expect(exported.status()).toBe(200);
    expect(JSON.stringify(await exported.json())).not.toContain(accountId);
  } finally {
    await admin.context().close();
    await owner.context().close();
    await buyer.context().close();
  }
});
