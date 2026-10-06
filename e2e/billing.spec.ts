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

  test("the subscription page is for signed-in Candidates only", async ({ page }) => {
    await page.goto("/abonnement");
    await expect(page).toHaveURL(/\/connexion$/);
  });
});

test.describe("back office", () => {
  test("is hidden from Candidates", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("curious"));
    await expect(page.getByRole("link", { name: fr.account.admin })).toHaveCount(0);
    const response = await page.goto("/admin/quotas");
    expect(response?.status()).toBe(404);
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
