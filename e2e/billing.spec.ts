import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { fakeCustomerId, FAKE_STRIPE_PRICES, signedEvent, subscriptionEvent } from "../apps/web/src/billing/fake-stripe";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #22: Plans, Stripe billing (checkout, customer portal, webhooks) and
// Plan Quotas edited in the back office. Stripe is the fake API on E2E_STRIPE_URL.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const stripeUrl = process.env.E2E_STRIPE_URL!;
const ADMINISTRATOR = "back-office@e2e.jobbbox.test";

async function stripeCalls(path: string): Promise<{ params: Record<string, string> }[]> {
  const calls = await (await fetch(`${stripeUrl}/__calls`)).json();
  return calls.filter((call: { path: string }) => call.path === path);
}

/** Submits a form by its button; returns where the server sends the browser (Stripe's pages are not loaded). */
async function formRedirect(page: Page, path: string, button: string) {
  await page.route("https://*.stripe.test/**", (route) => route.fulfill({ body: "Stripe" }));
  const [response] = await Promise.all([
    page.waitForResponse((r) => new URL(r.url()).pathname === path),
    page.getByRole("button", { name: button }).click(),
  ]);
  expect(response.status()).toBe(303);
  return response.headers().location;
}

async function deliverWebhook(page: Page, event: unknown) {
  const { payload, signature } = signedEvent(event);
  return page.request.post("/api/billing/webhook", { data: payload, headers: { "stripe-signature": signature, "content-type": "application/json" } });
}

/** The comparison table's row for one quota: its label, then the Free, Standard and Premium values. */
async function planRow(page: Page, label: string) {
  return page.getByRole("row", { name: new RegExp(`^${label}`) }).getByRole("cell").allInnerTexts();
}

async function currentPlanIs(page: Page, plan: string) {
  await page.goto("/abonnement");
  await expect(page.getByText(`Votre offre actuelle : ${plan}`)).toBeVisible();
}

test.describe("Plans and Stripe billing", () => {
  test("a Free Candidate subscribes to Standard through Stripe Checkout and gets its quotas", async ({ page }) => {
    const email = newAddress("abonnement");
    await signInWithMagicLink(page, email);
    await page.getByRole("link", { name: fr.account.plan }).click();
    await expect(page).toHaveURL(/\/abonnement$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(fr.billing.page.title);
    await expect(page.getByText("Votre offre actuelle : Gratuite")).toBeVisible();
    await expect(page.getByRole("row", { name: /Match Scores/ })).toContainText("3 par mois");

    expect(await formRedirect(page, "/api/billing/checkout", "Choisir l'offre Standard")).toMatch(/^https:\/\/checkout\.stripe\.test\//);
    const [checkout] = (await stripeCalls("/v1/checkout/sessions")).filter((call) => call.params.customer === fakeCustomerId(email));
    expect(checkout?.params).toMatchObject({ mode: "subscription", "line_items[0][price]": FAKE_STRIPE_PRICES.standard, locale: "fr" });

    const delivered = await deliverWebhook(
      page,
      subscriptionEvent("customer.subscription.created", { customer: fakeCustomerId(email), price: FAKE_STRIPE_PRICES.standard, status: "active" }),
    );
    expect(delivered.status()).toBe(200);

    await page.goto("/abonnement?checkout=success");
    await expect(page.getByRole("status")).toHaveText(fr.billing.page.checkoutSuccess);
    await expect(page.getByText("Votre offre actuelle : Standard")).toBeVisible();

    expect(await formRedirect(page, "/api/billing/portal", fr.billing.page.manage)).toMatch(/^https:\/\/billing\.stripe\.test\//);
  });

  test("the webhook refuses deliveries Stripe did not sign", async ({ page }) => {
    const event = subscriptionEvent("customer.subscription.created", { customer: "cus_x", price: FAKE_STRIPE_PRICES.premium, status: "active" });
    const forged = signedEvent(event, "whsec_someone_else");
    const response = await page.request.post("/api/billing/webhook", { data: forged.payload, headers: { "stripe-signature": forged.signature } });
    expect(response.status()).toBe(400);
  });

  test("the Plans start with the agreed quotas, and a new Candidate is on Free", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("quotas"));
    await page.goto("/abonnement");
    await expect(page.getByText("Votre offre actuelle : Gratuite")).toBeVisible();
    const header = await page.getByRole("table").getByRole("columnheader").allInnerTexts();
    expect(header.slice(1)).toEqual(["Gratuite", "Standard", "Premium"]);
    expect(await planRow(page, "Profils")).toEqual(["1", "3", "Illimité"]);
    expect(await planRow(page, "Match Scores")).toEqual(["3 par mois", "Illimité", "Illimité"]);
    expect(await planRow(page, "ATS Scores")).toEqual(["1 par mois", "Illimité", "Illimité"]);
    expect(await planRow(page, "Job Digest")).toEqual(["Non compris", "Chaque semaine", "Chaque jour"]);
    expect(await planRow(page, "Contacts enrichis")).toEqual(["Non compris", "Non compris", "20 par mois"]);

    // This month's usage, counted against the Free Plan's limits.
    const usage = page.locator("dl");
    await expect(usage.locator("div").filter({ hasText: "Match Scores" }).locator("dd")).toHaveText("0 sur 3");
    await expect(usage.locator("div").filter({ hasText: "ATS Scores" }).locator("dd")).toHaveText("0 sur 1");
    await expect(usage).not.toContainText("Contacts enrichis");
    await expect(page.getByRole("button", { name: fr.billing.page.manage })).toHaveCount(0);
  });

  test("Premium through Checkout; the Plan then follows every subscription change Stripe reports", async ({ page }) => {
    const email = newAddress("premium");
    const customer = fakeCustomerId(email);
    await signInWithMagicLink(page, email);
    await page.goto("/abonnement");
    expect(await formRedirect(page, "/api/billing/checkout", "Choisir l'offre Premium")).toMatch(/^https:\/\/checkout\.stripe\.test\//);
    const [checkout] = (await stripeCalls("/v1/checkout/sessions")).filter((call) => call.params.customer === customer);
    expect(checkout?.params).toMatchObject({ mode: "subscription", "line_items[0][price]": FAKE_STRIPE_PRICES.premium });

    // The checkout redirect alone grants nothing: only the signed webhook does.
    await page.goto("/abonnement?checkout=success");
    await expect(page.getByText("Votre offre actuelle : Gratuite")).toBeVisible();

    const t0 = Date.now();
    const at = (seconds: number) => new Date(t0 + seconds * 1000);
    const premium = { customer, price: FAKE_STRIPE_PRICES.premium };
    expect((await deliverWebhook(page, subscriptionEvent("customer.subscription.created", { ...premium, status: "active" }, at(0)))).status()).toBe(200);
    await currentPlanIs(page, "Premium");
    await expect(page.locator("dl div").filter({ hasText: "Contacts enrichis" }).locator("dd")).toHaveText("0 sur 20");
    await expect(page.locator("dl div").filter({ hasText: "Match Scores" }).locator("dd")).toHaveText("0 (illimité)");
    await expect(page.getByRole("button", { name: /^Choisir l'offre/ })).toHaveCount(0);

    // Changed to Standard in the customer portal.
    expect(await formRedirect(page, "/api/billing/portal", fr.billing.page.manage)).toMatch(/^https:\/\/billing\.stripe\.test\//);
    const portal = (await stripeCalls("/v1/billing_portal/sessions")).filter((call) => call.params.customer === customer);
    expect(portal).toHaveLength(1);
    await deliverWebhook(page, subscriptionEvent("customer.subscription.updated", { customer, price: FAKE_STRIPE_PRICES.standard, status: "active" }, at(10)));
    await currentPlanIs(page, "Standard");

    // A late, older delivery does not undo a newer change.
    await deliverWebhook(page, subscriptionEvent("customer.subscription.updated", { ...premium, status: "active" }, at(5)));
    await currentPlanIs(page, "Standard");

    // Stripe retrying a payment keeps the Plan; an unpaid subscription drops to Free.
    await deliverWebhook(page, subscriptionEvent("customer.subscription.updated", { customer, price: FAKE_STRIPE_PRICES.standard, status: "past_due" }, at(20)));
    await currentPlanIs(page, "Standard");
    await deliverWebhook(page, subscriptionEvent("customer.subscription.updated", { customer, price: FAKE_STRIPE_PRICES.standard, status: "unpaid" }, at(30)));
    await currentPlanIs(page, "Gratuite");

    // Back on Premium, then cancelled.
    await deliverWebhook(page, subscriptionEvent("customer.subscription.updated", { ...premium, status: "active" }, at(40)));
    await currentPlanIs(page, "Premium");
    await deliverWebhook(page, subscriptionEvent("customer.subscription.deleted", { ...premium, status: "canceled" }, at(50)));
    await currentPlanIs(page, "Gratuite");
    await expect(page.getByRole("button", { name: "Choisir l'offre Premium" })).toBeVisible();
  });

  test("the webhook refuses deliveries without a signature", async ({ page }) => {
    const event = subscriptionEvent("customer.subscription.created", { customer: "cus_x", price: FAKE_STRIPE_PRICES.premium, status: "active" });
    const response = await page.request.post("/api/billing/webhook", { data: JSON.stringify(event), headers: { "content-type": "application/json" } });
    expect(response.status()).toBe(400);
  });

  test("checkout and the portal answer signed-in Candidates posting from Jobbbox only", async ({ page, baseURL }) => {
    const anonymous = await page.request.post("/api/billing/checkout", { form: { plan: "standard" }, maxRedirects: 0 });
    expect(anonymous.status()).toBe(303);
    expect(new URL(anonymous.headers().location!).pathname).toBe("/connexion");
    const anonymousPortal = await page.request.post("/api/billing/portal", { maxRedirects: 0 });
    expect(new URL(anonymousPortal.headers().location!).pathname).toBe("/connexion");

    const email = newAddress("cross-site");
    await signInWithMagicLink(page, email);
    const forged = await page.request.post("/api/billing/checkout", {
      form: { plan: "standard" },
      headers: { origin: "https://evil.example" },
      maxRedirects: 0,
    });
    expect(new URL(forged.headers().location!).pathname).toBe("/connexion");

    const free = await page.request.post("/api/billing/checkout", { form: { plan: "free" }, headers: { origin: baseURL! }, maxRedirects: 0 });
    expect(new URL(free.headers().location!).pathname).toBe("/abonnement");
    const checkouts = (await stripeCalls("/v1/checkout/sessions")).filter((call) => call.params.customer === fakeCustomerId(email));
    expect(checkouts).toHaveLength(0);
  });

  test("the subscription page is for signed-in Candidates only", async ({ page }) => {
    await page.goto("/abonnement");
    await expect(page).toHaveURL(/\/connexion$/);
  });
});

test.describe("back office", () => {
  test("is hidden from Candidates", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("curious"));
    await expect(page.getByRole("link", { name: fr.account.admin })).toHaveCount(0);
    for (const path of ["/admin", "/admin/quotas"]) {
      const response = await page.goto(path);
      expect(response?.status()).toBe(404);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(fr.notFound.title);
      await expect(page).toHaveTitle(`${fr.notFound.title} · ${fr.app.name}`);
    }
  });

  test("lets an Administrator edit a Plan's quotas, applied at once on the subscription page", async ({ page }) => {
    await signInWithMagicLink(page, ADMINISTRATOR);
    await page.getByRole("link", { name: fr.account.admin }).click();
    await page.getByRole("link", { name: fr.admin.sections.planQuotas }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(fr.admin.planQuotas.title);

    const free = page.locator("form").filter({ has: page.getByRole("heading", { name: "Offre Gratuite" }) });
    await free.getByLabel("Match Scores (par mois)").fill("5");
    await free.getByRole("button", { name: "Enregistrer l'offre Gratuite" }).click();
    await expect(page.getByRole("status")).toHaveText("Quotas de l'offre Gratuite enregistrés.");
    await expect(free.getByLabel("Match Scores (par mois)")).toHaveValue("5");

    await page.goto("/abonnement");
    await expect(page.getByRole("row", { name: /Match Scores/ })).toContainText("5 par mois");

    // Put the starting quota back for the other tests.
    await page.goto("/admin/quotas");
    await free.getByLabel("Match Scores (par mois)").fill("3");
    await free.getByRole("button", { name: "Enregistrer l'offre Gratuite" }).click();
    await expect(page.getByRole("status")).toBeVisible();
  });

  test("is reached after signing in, and lists Plan Quotas and Human Coaches", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/connexion$/);
    await signInWithMagicLink(page, ADMINISTRATOR);
    await page.goto("/admin");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(fr.admin.title);
    await expect(page.getByRole("link", { name: fr.admin.sections.planQuotas })).toBeVisible();
    await expect(page.getByText(fr.admin.sections.humanCoaches)).toBeVisible();
  });

  test("shows each Plan's starting quotas, and can make a quota unlimited or change the Job Digest", async ({ page }) => {
    await signInWithMagicLink(page, ADMINISTRATOR);
    await page.goto("/admin/quotas");
    const plan = (name: string) => page.locator("form").filter({ has: page.getByRole("heading", { name: `Offre ${name}` }) });
    const values = async (name: string) => ({
      profiles: await plan(name).getByLabel("Profils").inputValue(),
      matchScores: await plan(name).getByLabel("Match Scores (par mois)").inputValue(),
      atsScores: await plan(name).getByLabel("ATS Scores (par mois)").inputValue(),
      enrichedContacts: await plan(name).getByLabel("Contacts enrichis (par mois)").inputValue(),
      jobDigest: await plan(name).getByLabel("Job Digest").inputValue(),
    });
    expect(await values("Gratuite")).toEqual({ profiles: "1", matchScores: "3", atsScores: "1", enrichedContacts: "0", jobDigest: "none" });
    expect(await values("Standard")).toEqual({ profiles: "3", matchScores: "", atsScores: "", enrichedContacts: "0", jobDigest: "weekly" });
    expect(await values("Premium")).toEqual({ profiles: "", matchScores: "", atsScores: "", enrichedContacts: "20", jobDigest: "daily" });

    await plan("Standard").getByLabel("Profils").fill("");
    await plan("Standard").getByLabel("Job Digest").selectOption("daily");
    await plan("Standard").getByRole("button", { name: "Enregistrer l'offre Standard" }).click();
    await expect(page.getByRole("status")).toHaveText("Quotas de l'offre Standard enregistrés.");
    await page.goto("/abonnement");
    expect(await planRow(page, "Profils")).toEqual(["1", "Illimité", "Illimité"]);
    expect(await planRow(page, "Job Digest")).toEqual(["Non compris", "Chaque jour", "Chaque jour"]);

    // Put the starting quotas back for the other tests.
    await page.goto("/admin/quotas");
    await plan("Standard").getByLabel("Profils").fill("3");
    await plan("Standard").getByLabel("Job Digest").selectOption("weekly");
    await plan("Standard").getByRole("button", { name: "Enregistrer l'offre Standard" }).click();
    await expect(page.getByRole("status")).toBeVisible();
    expect(await values("Standard")).toEqual({ profiles: "3", matchScores: "", atsScores: "", enrichedContacts: "0", jobDigest: "weekly" });
  });

  test("refuses invalid quotas", async ({ page }) => {
    await signInWithMagicLink(page, ADMINISTRATOR);
    await page.goto("/admin/quotas");
    const free = page.locator("form").filter({ has: page.getByRole("heading", { name: "Offre Gratuite" }) });
    await free.getByLabel("Profils").evaluate((input: HTMLInputElement) => input.removeAttribute("pattern"));
    await free.getByLabel("Profils").fill("-2");
    await free.getByRole("button", { name: "Enregistrer l'offre Gratuite" }).click();
    await expect(page.getByRole("alert").filter({ hasText: fr.admin.planQuotas.invalid })).toBeVisible();
  });
});
