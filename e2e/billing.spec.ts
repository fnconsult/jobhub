import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { fakeCustomerId, FAKE_STRIPE_PRICES, signedEvent, subscriptionEvent } from "../apps/web/src/billing/fake-stripe";
import { renderedTexts } from "./support/accessibility";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";
import { subscribe } from "./support/plan";

// Issue #22: Plans, Stripe billing (checkout, customer portal, webhooks) and
// Plan Quotas edited in the back office. Stripe is the fake API on E2E_STRIPE_URL.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const en = JSON.parse(readFileSync("packages/shared/src/i18n/locales/en.json", "utf8"));
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
  // Let the browser finish following the redirect, or it interrupts the test's next page.goto.
  await page.waitForURL((url) => url.hostname.endsWith(".stripe.test") || url.protocol === "chrome-error:");
  return response.headers().location;
}

async function deliverWebhook(page: Page, event: unknown) {
  const { payload, signature } = signedEvent(event);
  return page.request.post("/api/billing/webhook", { data: payload, headers: { "stripe-signature": signature, "content-type": "application/json" } });
}

/** The comparison table's row for one quota: its label, then the Free, Standard and Premium values. */
async function planRow(page: Page, label: string) {
  // A Plan offered by plans.spec.ts while this runs is ranked after these three.
  return (await page.getByRole("row", { name: new RegExp(`^${label}`) }).getByRole("cell").allInnerTexts()).slice(0, 3);
}

async function currentPlanIs(page: Page, plan: string) {
  await page.goto("/abonnement");
  await expect(page.getByText(`Votre offre actuelle : ${plan}`)).toBeVisible();
}

test.describe("Plans and Stripe billing", () => {
  test("a Free Candidate subscribes to Standard through Stripe Checkout and gets its quotas", async ({ page }) => {
    const email = newAddress("abonnement");
    await signInWithMagicLink(page, email);
    await page.getByRole("link", { name: fr.sidebar.subscription }).click();
    await expect(page).toHaveURL(/\/abonnement$/);
    // A Section of Mon compte (ADR-0024), at its own address.
    await expect(page.getByRole("heading", { level: 2, name: fr.billing.page.title })).toBeVisible();
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

  // Issue #169: Stripe sends the Candidate back before (or while) its webhook arrives.
  test("back from Stripe Checkout, the subscription page shows the new Plan once Stripe confirms it, without a reload", async ({ page }) => {
    const email = newAddress("checkout-refresh");
    await signInWithMagicLink(page, email);
    await page.goto("/abonnement?checkout=success");
    await expect(page.getByRole("status")).toHaveText(fr.billing.page.checkoutSuccess);
    await expect(page.getByText("Votre offre actuelle : Gratuite")).toBeVisible();
    await page.evaluate(() => ((window as unknown as { notReloaded: boolean }).notReloaded = true));

    await subscribe(page, email, "standard");

    await expect(page.getByText("Votre offre actuelle : Standard")).toBeVisible({ timeout: 15_000 });
    expect(await page.evaluate(() => (window as unknown as { notReloaded?: boolean }).notReloaded)).toBe(true);
    await expect(page.getByRole("button", { name: fr.billing.page.manage })).toBeVisible();
  });

  // Issue #169: a cancellation scheduled in the customer portal keeps the Plan until the end of the paid period.
  test("a Candidate who cancelled in the customer portal sees until when the Plan is kept, then Free once it ends", async ({ page }) => {
    const email = newAddress("cancel-at-period-end");
    const customer = fakeCustomerId(email);
    await signInWithMagicLink(page, email);
    await subscribe(page, email, "premium");
    await currentPlanIs(page, "Premium");

    const later = (seconds: number) => new Date(Date.now() + seconds * 1000);
    const premium = { customer, price: FAKE_STRIPE_PRICES.premium, currentPeriodEnd: new Date("2026-11-15T09:00:00Z") };
    const cancelled = subscriptionEvent("customer.subscription.updated", { ...premium, status: "active", cancelAtPeriodEnd: true }, later(10));
    expect((await deliverWebhook(page, cancelled)).status()).toBe(200);
    await currentPlanIs(page, "Premium jusqu'au 15 novembre 2026");

    // Renewed after all: no end date any more.
    await deliverWebhook(page, subscriptionEvent("customer.subscription.updated", { ...premium, status: "active" }, later(20)));
    await currentPlanIs(page, "Premium");
    await expect(page.getByText(/jusqu'au/)).toHaveCount(0);

    // Cancelled again, and the period is over: Free, as an immediate cancellation does.
    await deliverWebhook(page, subscriptionEvent("customer.subscription.updated", { ...premium, status: "active", cancelAtPeriodEnd: true }, later(30)));
    await deliverWebhook(page, subscriptionEvent("customer.subscription.deleted", { ...premium, status: "canceled", cancelAtPeriodEnd: true }, later(40)));
    await currentPlanIs(page, "Gratuite");
    await expect(page.getByText(/jusqu'au/)).toHaveCount(0);
  });

  // Issue #103: the comparison prices each Plan from its Stripe Price (the fake's: 19 € and 39 € a month).
  test("the Plans show what they cost, in the Candidate's Interface Language", async ({ page }) => {
    const email = newAddress("plan-prices");
    await signInWithMagicLink(page, email);
    await page.goto("/abonnement");
    const prices = async (label: string) => (await planRow(page, label)).map((cell) => cell.replace(/\s/g, " "));
    expect(await prices(fr.billing.page.price)).toEqual(["0 € / mois", "19 € / mois", "39 € / mois"]);

    await page.goto("/compte/preferences");
    await page.getByLabel(fr.account.interfaceLanguage).selectOption("en");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(en.account.title);
    await page.goto("/abonnement");
    expect(await prices(en.billing.page.price)).toEqual(["€0 / month", "€19 / month", "€39 / month"]);
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
    expect(header.slice(1, 4)).toEqual(["Gratuite", "Standard", "Premium"]);
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

  // Issue #104: invoices live in the Stripe customer portal (ADR-0014).
  test("a Candidate who pays finds their invoices in the Stripe customer portal, and still does once back on Free", async ({ page, baseURL }) => {
    const email = newAddress("invoices");
    await signInWithMagicLink(page, email);
    await page.goto("/abonnement");
    await expect(page.getByText("Votre offre actuelle : Gratuite")).toBeVisible();
    // Never charged: nothing to find there.
    await expect(page.getByRole("button", { name: fr.billing.page.invoices })).toHaveCount(0);
    await expect(page.getByText(fr.billing.page.invoicesHelp)).toHaveCount(0);

    await subscribe(page, email, "standard");
    await currentPlanIs(page, "Standard");
    await expect(page.getByText(fr.billing.page.invoicesHelp)).toBeVisible();
    expect(await formRedirect(page, "/api/billing/portal", fr.billing.page.invoices)).toMatch(/^https:\/\/billing\.stripe\.test\//);
    const portal = (await stripeCalls("/v1/billing_portal/sessions")).filter((call) => call.params.customer === fakeCustomerId(email));
    expect(portal).toHaveLength(1);

    // Cancelled: back on Free, but the invoices already paid are still there.
    const later = new Date(Date.now() + 60_000);
    await deliverWebhook(page, subscriptionEvent("customer.subscription.deleted", { customer: fakeCustomerId(email), price: FAKE_STRIPE_PRICES.standard, status: "canceled" }, later));
    await currentPlanIs(page, "Gratuite");
    await expect(page.getByRole("button", { name: fr.billing.page.invoices })).toBeVisible();
    await expect(page.getByRole("button", { name: fr.billing.page.manage })).toHaveCount(0);

    // In English too.
    const switched = await page.request.post("/api/auth/update-user", { data: { interfaceLanguage: "en" }, headers: { origin: baseURL! } });
    expect(switched.status()).toBe(200);
    await page.goto("/abonnement");
    await expect(page.getByRole("button", { name: en.billing.page.invoices })).toBeVisible();
    await expect(page.getByText(en.billing.page.invoicesHelp)).toBeVisible();
  });

  test("a Candidate whose payment failed is told so in the workspace and on the subscription page, until it is paid", async ({ page }) => {
    // Issue #102: past_due keeps the Plan while Stripe retries; the Candidate updates their payment method in the portal.
    const email = newAddress("past-due");
    const customer = fakeCustomerId(email);
    await signInWithMagicLink(page, email);
    await subscribe(page, email, "standard");
    const failed = () => page.getByRole("status").filter({ hasText: fr.billing.paymentFailed.message });

    await page.goto("/compte");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(failed()).toHaveCount(0);

    const later = (seconds: number) => new Date(Date.now() + seconds * 1000);
    const standard = { customer, price: FAKE_STRIPE_PRICES.standard };
    expect((await deliverWebhook(page, subscriptionEvent("customer.subscription.updated", { ...standard, status: "past_due" }, later(10)))).status()).toBe(200);

    // A banner in the signed-in workspace, which does not stop the Candidate from working.
    await page.goto("/compte");
    await expect(failed()).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.goto("/candidatures");
    await expect(failed()).toBeVisible();
    // The banner's text meets the accessibility floor (ADR-0009), at every width.
    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: 900 });
      const texts = (await renderedTexts(page)).filter((t) => [fr.billing.paymentFailed.message, fr.billing.paymentFailed.action].includes(t.text));
      expect(texts).toHaveLength(2);
      for (const t of texts) {
        expect.soft(t.fontSizePx, `font size of "${t.text}"`).toBeGreaterThanOrEqual(16);
        expect.soft(t.contrast, `contrast of "${t.text}"`).toBeGreaterThanOrEqual(4.5);
      }
      const banner = await failed().boundingBox();
      expect(banner!.x).toBeGreaterThanOrEqual(0);
      expect(banner!.x + banner!.width).toBeLessThanOrEqual(width);
    }

    // The same message next to the current Plan, once.
    await page.goto("/abonnement");
    await expect(page.getByText("Votre offre actuelle : Standard")).toBeVisible();
    await expect(failed()).toHaveCount(1);
    await expect(failed().getByRole("button", { name: fr.billing.paymentFailed.action })).toBeVisible();

    // The banner leads to the Stripe customer portal, where the payment method is updated.
    await page.goto("/compte");
    expect(await formRedirect(page, "/api/billing/portal", fr.billing.paymentFailed.action)).toMatch(/^https:\/\/billing\.stripe\.test\//);
    expect((await stripeCalls("/v1/billing_portal/sessions")).filter((call) => call.params.customer === customer)).toHaveLength(1);

    // Paid again: the banner goes.
    expect((await deliverWebhook(page, subscriptionEvent("customer.subscription.updated", { ...standard, status: "active" }, later(20)))).status()).toBe(200);
    await page.goto("/compte");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(failed()).toHaveCount(0);
    await currentPlanIs(page, "Standard");
    await expect(failed()).toHaveCount(0);
  });

  test("the payment failed notice is shown in English to a Candidate who chose English", async ({ page }) => {
    const email = newAddress("past-due-en");
    await signInWithMagicLink(page, email);
    await subscribe(page, email, "standard");
    const event = subscriptionEvent("customer.subscription.updated", { customer: fakeCustomerId(email), price: FAKE_STRIPE_PRICES.standard, status: "past_due" }, new Date(Date.now() + 10_000));
    expect((await deliverWebhook(page, event)).status()).toBe(200);
    await page.goto("/compte/preferences");
    await page.getByLabel(fr.account.interfaceLanguage).selectOption("en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    const notice = page.getByRole("status").filter({ hasText: en.billing.paymentFailed.message });
    await expect(notice).toHaveCount(1);
    await expect(notice.getByRole("button", { name: en.billing.paymentFailed.action })).toBeVisible();
    await page.goto("/abonnement");
    await expect(notice).toHaveCount(1);
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

// In this file because the back office tests briefly change the Free Plan's Match Score quota.
test.describe("Plan Quotas on Match Scores", () => {
  const cv = {
    fullName: "Marie Dupont",
    headline: "Directrice financière",
    email: "marie.dupont@example.fr",
    phone: "",
    location: "Lyon",
    summary: "",
    experience: [{ title: "Directrice financière", employer: "Groupe Seb", location: "Lyon", period: "2005 – 2024", description: "" }],
    education: [],
    skills: ["IFRS", "SAP"],
    languages: [],
  };

  async function captureOffer(page: Page, origin: string): Promise<string> {
    const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const captured = await page.request.post("/api/job-offers", {
      data: { source: { url: `https://www.apec.fr/offres/daf-${tag}` }, title: "DAF H/F", content: `DAF pour un groupe industriel (réf. ${tag}).`, location: "Lyon" },
      headers: { origin },
    });
    expect(captured.status(), await captured.text()).toBe(200);
    return (await captured.json()).id;
  }

  test("a Free Candidate gets 3 Match Scores a month, then a 402 with the Upgrade Prompt; Standard lifts the limit", async ({ page, baseURL }) => {
    const email = newAddress("match-quota");
    await signInWithMagicLink(page, email);
    const jobOfferId = await captureOffer(page, baseURL!);
    const score = (data: object) => page.request.post("/api/match-score", { data, headers: { origin: baseURL! } });

    // Requests that cannot be scored use nothing.
    expect((await score({ jobOfferId: "00000000-0000-4000-8000-000000000000", cv })).status()).toBe(404);
    expect((await score({ jobOfferId })).status()).toBe(400);

    for (let i = 0; i < 3; i++) expect((await score({ jobOfferId, cv })).status()).toBe(200);
    const refused = await score({ jobOfferId, cv });
    expect(refused.status()).toBe(402);
    expect(await refused.json()).toEqual({
      error: "quota_exceeded",
      quota: "matchScores",
      plan: "free",
      limit: 3,
      upgradeTo: "standard",
      prompt: {
        title: fr.billing.quotaReached.title,
        message: "Vous avez utilisé les 3 Match Scores compris ce mois-ci dans l'offre Gratuite. Avec l'offre Standard, vous pouvez en faire davantage.",
        upgradeTo: "standard",
        action: "Découvrir l'offre Standard",
        href: "/abonnement",
      },
    });
    await page.goto("/abonnement");
    await expect(page.locator("dl div").filter({ hasText: "Match Scores" }).locator("dd")).toHaveText("3 sur 3");

    await subscribe(page, email, "standard");
    expect((await score({ jobOfferId, cv })).status()).toBe(200);
  });

  test("a Guest's Match Scores are not counted against any Plan", async ({ playwright, page, baseURL }) => {
    await signInWithMagicLink(page, newAddress("match-quota-capture"));
    const jobOfferId = await captureOffer(page, baseURL!);
    const guest = await playwright.request.newContext({ baseURL });
    for (let i = 0; i < 4; i++) {
      expect((await guest.post("/api/match-score", { data: { jobOfferId, cv }, headers: { origin: baseURL! } })).status()).toBe(200);
    }
    await guest.dispose();
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
    // Anonymous visitors are sent to the Back Office sign-in (#209).
    await expect(page).toHaveURL(/\/connexion\/back-office$/);
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
