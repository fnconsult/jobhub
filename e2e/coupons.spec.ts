import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { fakeCustomerId, FAKE_STRIPE_PRICES, signedEvent, subscriptionEvent } from "../apps/web/src/billing/fake-stripe";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #207: Coupons, Stripe promotion codes created from the Back Office (Codes promo) in the fake
// Stripe (E2E_STRIPE_URL). A shared link /abonnement?code=… tells the Candidate what the code gives and
// carries it to Checkout; a Plan it is not for refuses it, back on the page with the way on without it;
// an invalid one says so and Checkout still works. The
// subscription page shows the discount the subscription gets. Deactivated, the code no longer works.
// Create and deactivate are in the Journal. Which roles reach the section: back-office-roles.spec.ts.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const coupons = fr.admin.coupons;
const stripeUrl = process.env.E2E_STRIPE_URL!;
const ADMINISTRATOR = "back-office@e2e.jobbbox.test";
const tr = (template: string, values: Record<string, string>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");
/** Intl puts (narrow) no-break spaces in amounts; read them as plain spaces. */
const plain = (text: string) => text.replace(/[\u202f\u00a0]/g, " ");

async function checkoutCalls(customer: string): Promise<{ params: Record<string, string> }[]> {
  const calls = await (await fetch(`${stripeUrl}/__calls`)).json();
  return calls.filter((call: { path: string; params: Record<string, string> }) => call.path === "/v1/checkout/sessions" && call.params.customer === customer);
}

async function lastCheckout(customer: string): Promise<Record<string, string>> {
  return (await checkoutCalls(customer)).at(-1)!.params;
}

/** Chooses a Plan on the subscription page; Stripe's Checkout page is not loaded. */
async function choose(page: Page, plan: string) {
  await toCheckout(page, `Choisir l'offre ${plan}`);
}

/** Clicks a button that sends the browser to Stripe Checkout; Stripe's page is not loaded. */
async function toCheckout(page: Page, button: string) {
  await page.route("https://*.stripe.test/**", (route) => route.fulfill({ body: "Stripe" }));
  const [response] = await Promise.all([
    page.waitForResponse((r) => new URL(r.url()).pathname === "/api/billing/checkout"),
    page.getByRole("button", { name: button }).click(),
  ]);
  expect(response.status()).toBe(303);
  expect(response.headers().location).toMatch(/^https:\/\/checkout\.stripe\.test\//);
  // Let the browser finish following the redirect, or it interrupts the next page.goto.
  await page.waitForURL((url) => url.hostname === "checkout.stripe.test" || url.protocol === "chrome-error:", { waitUntil: "commit" });
}

test.describe("Coupons", () => {
  test.describe.configure({ mode: "serial" });

  test("a coupon created in the Back Office is shared by link, applied at Checkout to its Plans, shown on the subscription, then deactivated", async ({ page, browser }) => {
    await signInWithMagicLink(page, ADMINISTRATOR);
    await page.goto("/admin");
    await page.getByRole("link", { name: fr.admin.sections.coupons }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(coupons.title);

    const create = page.locator("form").filter({ has: page.getByRole("heading", { name: coupons.createTitle }) });
    const fill = async (code: string, plans: string[]) => {
      await create.getByLabel(coupons.code, { exact: true }).fill(code);
      await create.getByLabel(coupons.kinds.percent).check();
      await create.getByLabel(coupons.value, { exact: true }).fill("50");
      await create.getByLabel(coupons.durations.repeating).check();
      await create.getByLabel(coupons.durationInMonths, { exact: true }).fill("3");
      for (const plan of plans) await create.getByLabel(plan, { exact: true }).check();
    };
    // No Plan ticked: refused, and nothing is created in Stripe.
    await fill("printemps-e2e", []);
    await create.getByRole("button", { name: coupons.create }).click();
    await expect(page.getByRole("alert").filter({ hasText: coupons.errors.no_plan })).toBeVisible();

    await fill("printemps-e2e", ["Standard"]);
    await create.getByRole("button", { name: coupons.create }).click();
    await expect(page.getByRole("status")).toHaveText(tr(coupons.created, { code: "PRINTEMPS-E2E" }));
    const row = page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "PRINTEMPS-E2E" }) });
    expect(plain(await row.innerText())).toContain("−50 % pendant 3 mois");
    await expect(row).toContainText("Standard");
    await expect(row).toContainText(coupons.status.active);
    await expect(row).toContainText("/abonnement?code=PRINTEMPS-E2E");

    // The shared link, in lower case: what the code gives, and on which Plan; applied at Checkout to Standard.
    const candidate = await (await browser.newContext({ baseURL: process.env.E2E_WEB_ORIGIN, locale: "fr-FR" })).newPage();
    const email = newAddress("coupon");
    const customer = fakeCustomerId(email);
    await signInWithMagicLink(candidate, email);
    await candidate.goto("/abonnement?code=printemps-e2e");
    expect(plain(await candidate.getByRole("status").innerText())).toBe("Code PRINTEMPS-E2E : −50 % pendant 3 mois, valable sur Standard. Il s'appliquera au paiement.");
    await choose(candidate, "Standard");
    const promotionCode = (await lastCheckout(customer))["discounts[0][promotion_code]"];
    expect(promotionCode).toMatch(/^promo_/);
    expect(await lastCheckout(customer)).toMatchObject({ payment_method_collection: "if_required" });
    expect(await lastCheckout(customer)).not.toHaveProperty("allow_promotion_codes");

    // Premium is not one of its Plans: refused, back on the subscription page, nothing sent to Checkout;
    // the Candidate chooses to go on without it, with the field to type a code.
    const checkouts = (await checkoutCalls(customer)).length;
    await candidate.goto("/abonnement?code=PRINTEMPS-E2E");
    await candidate.getByRole("button", { name: "Choisir l'offre Premium" }).click();
    await expect(candidate).toHaveURL(/codeRefused=not_for_plan/);
    await expect(candidate.getByRole("alert").filter({ hasText: tr(fr.billing.page.codeRefused.not_for_plan, { plan: "Premium" }) })).toBeVisible();
    expect(await checkoutCalls(customer)).toHaveLength(checkouts);
    await toCheckout(candidate, tr(fr.billing.page.continueWithoutCode, { plan: "Premium" }));
    expect(await lastCheckout(customer)).toMatchObject({ allow_promotion_codes: "true", "line_items[0][price]": FAKE_STRIPE_PRICES.premium });
    expect(await lastCheckout(customer)).not.toHaveProperty("discounts[0][promotion_code]");

    // An unknown code says so; choosing a Plan still works, without a discount.
    await candidate.goto("/abonnement?code=INCONNU");
    await expect(candidate.getByRole("alert").filter({ hasText: fr.billing.page.codeInvalid })).toBeVisible();
    await choose(candidate, "Standard");
    expect(await lastCheckout(customer)).toMatchObject({ allow_promotion_codes: "true" });

    // Subscribed with the code: the subscription page shows the discount, until when.
    const { payload, signature } = signedEvent(subscriptionEvent("customer.subscription.created", { customer, price: FAKE_STRIPE_PRICES.standard, status: "active", id: "sub_coupon_e2e" }));
    expect((await candidate.request.post("/api/billing/webhook", { data: payload, headers: { "stripe-signature": signature, "content-type": "application/json" } })).status()).toBe(200);
    await fetch(`${stripeUrl}/__subscriptions/sub_coupon_e2e/discount`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ promotion_code: promotionCode!, end: String(Date.parse("2027-01-15T10:00:00Z") / 1000) }),
    });
    await candidate.goto("/abonnement");
    await expect(candidate.getByText("Votre offre actuelle : Standard")).toBeVisible();
    await expect(candidate.getByText(/^Réduction en cours/)).toHaveText(/Réduction en cours : −50\s%\sjusqu'au 15 janvier 2027/);

    // Deactivated: it no longer works for anyone; the Candidate's discount runs its course.
    await page.goto("/admin/codes-promo");
    await page.getByRole("button", { name: tr(coupons.deactivate, { code: "PRINTEMPS-E2E" }) }).click();
    await expect(page.getByRole("status")).toHaveText(tr(coupons.deactivated, { code: "PRINTEMPS-E2E" }));
    await expect(row).toContainText(coupons.status.inactive);
    await expect(page.getByRole("button", { name: tr(coupons.deactivate, { code: "PRINTEMPS-E2E" }) })).toHaveCount(0);
    const other = await (await browser.newContext({ baseURL: process.env.E2E_WEB_ORIGIN, locale: "fr-FR" })).newPage();
    await signInWithMagicLink(other, newAddress("coupon-late"));
    await other.goto("/abonnement?code=PRINTEMPS-E2E");
    await expect(other.getByRole("alert").filter({ hasText: fr.billing.page.codeInvalid })).toBeVisible();

    // Both changes are in the Journal, under Codes promo.
    await page.goto("/admin/journal?section=coupons");
    const entries = page.getByRole("row").filter({ hasText: "PRINTEMPS-E2E" });
    await expect(entries).toHaveCount(2);
    await expect(entries.first()).toContainText(`${coupons.fields.active} : ${coupons.yes} → ${coupons.no}`);
    await expect(entries.last()).toContainText(fr.admin.journal.actions.added);
  });
});
