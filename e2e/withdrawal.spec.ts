import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { fakeCustomerId, FAKE_STRIPE_PRICES, signedEvent, subscriptionEvent } from "../apps/web/src/billing/fake-stripe";
import { signInWithMagicLink } from "./support/candidate";
import { emailsTo, newAddress, waitForEmail } from "./support/mailbox";

// Issue #511: « Renoncer au contrat ici », a Withdrawal from a Plan within 14 days of subscribing: the subscription
// ends at once, the payment is refunded in full in Stripe (the fake one on E2E_STRIPE_URL), the Candidate is back on
// Free, and the acknowledgement is emailed with the date and time.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const stripeUrl = process.env.E2E_STRIPE_URL!;
const DAY_MS = 24 * 3600_000;

/**
 * Puts the Candidate signed in on `page` on Standard, started `daysAgo` days ago, the way it happens for real: a Stripe
 * Checkout, then Stripe's signed webhook, and its first invoice paid (19 €). Returns the subscription's id.
 */
async function subscribedDaysAgo(page: Page, email: string, daysAgo: number) {
  const origin = process.env.E2E_WEB_ORIGIN!;
  const checkout = await page.request.post("/api/billing/checkout", { form: { plan: "standard" }, headers: { origin }, maxRedirects: 0 });
  expect(checkout.status()).toBe(303);
  const customer = fakeCustomerId(email);
  const startDate = new Date(Date.now() - daysAgo * DAY_MS);
  const event = subscriptionEvent("customer.subscription.created", { customer, price: FAKE_STRIPE_PRICES.standard, status: "active", startDate }, startDate);
  const { payload, signature } = signedEvent(event);
  expect((await page.request.post("/api/billing/webhook", { data: payload, headers: { "stripe-signature": signature, "content-type": "application/json" } })).status()).toBe(200);
  const subscriptionId = `sub_fake_${customer}`;
  const paid = await fetch(`${stripeUrl}/__subscriptions/${subscriptionId}/invoices`, { method: "POST", body: new URLSearchParams({ amount: "1900" }) });
  const { payment_intent: paymentIntent } = (await paid.json()) as { payment_intent: string };
  return { subscriptionId, paymentIntent };
}

test.describe("Withdrawal from a Plan (#511)", () => {
  test("a Candidate subscribed 3 days ago withdraws: refunded in full, back on Free, acknowledged with the date and time", async ({ page }) => {
    const email = newAddress("retractation");
    await signInWithMagicLink(page, email);
    const { subscriptionId, paymentIntent } = await subscribedDaysAgo(page, email, 3);

    await page.goto("/abonnement");
    await expect(page.getByText("Votre offre actuelle : Standard")).toBeVisible();
    await page.getByRole("link", { name: fr.withdrawals.page.title }).click();

    await expect(page).toHaveURL(/\/abonnement\/retractation\?contrat=plan$/);
    await expect(page.getByRole("heading", { level: 2, name: fr.withdrawals.page.title })).toBeVisible();
    await expect(page.getByText("Offre Standard")).toBeVisible();
    await expect(page.getByText(/19,00\s€/)).toBeVisible();
    await page.getByLabel(fr.withdrawals.page.name).fill("Marie Dupont");
    await expect(page.getByRole("radio", { name: `À l'adresse de mon compte (${email})` })).toBeChecked();
    const before = emailsTo(email).length;
    await page.getByRole("button", { name: fr.withdrawals.page.confirm }).click();

    await expect(page.getByRole("status")).toContainText("Votre rétractation (Offre Standard) est enregistrée le");
    await expect(page.getByRole("status")).toContainText(/Montant remboursé : 19,00\s€/);
    await expect(page.getByRole("status")).toContainText(`Un accusé de réception a été envoyé à ${email}.`);

    // In Stripe: cancelled now, not at the end of the period, and refunded in full.
    const calls = (await (await fetch(`${stripeUrl}/__calls`)).json()) as { method: string; path: string }[];
    expect(calls.filter((call) => call.path === `/v1/subscriptions/${subscriptionId}`).map((call) => call.method)).toContain("DELETE");
    const refunds = (await (await fetch(`${stripeUrl}/__refunds`)).json()) as { payment_intent: string; amount: number; status: string }[];
    expect(refunds.filter((refund) => refund.payment_intent === paymentIntent)).toEqual([expect.objectContaining({ amount: 1900, status: "succeeded" })]);

    // The acknowledgement, on a durable medium: what, when (date and time), and the amount refunded.
    const receipt = await waitForEmail(email, before);
    expect(receipt.subject).toBe(fr.withdrawals.email.subject);
    expect(receipt.text).toMatch(/Nous avons bien reçu votre rétractation le \d{1,2} \S+ \d{4} à \d{2}:\d{2}\./);
    expect(receipt.text).toContain("Offre Standard");
    expect(receipt.text).toContain("Marie Dupont");
    expect(receipt.text).toMatch(/Montant remboursé : 19,00\s€/);

    // Back on Free, with nothing more to withdraw from.
    await page.goto("/abonnement");
    await expect(page.getByText("Votre offre actuelle : Gratuite")).toBeVisible();
    await expect(page.getByRole("link", { name: fr.withdrawals.page.title })).toHaveCount(0);
  });

  test("a Candidate subscribed 15 days ago no longer sees « Renoncer au contrat ici »", async ({ page }) => {
    const email = newAddress("retractation-tard");
    await signInWithMagicLink(page, email);
    await subscribedDaysAgo(page, email, 15);

    await page.goto("/abonnement");
    await expect(page.getByText("Votre offre actuelle : Standard")).toBeVisible();
    await expect(page.getByRole("link", { name: fr.withdrawals.page.title })).toHaveCount(0);

    await page.goto("/abonnement/retractation?contrat=plan");
    await expect(page.getByText(fr.withdrawals.page.nothing)).toBeVisible();
    await expect(page.getByRole("button", { name: fr.withdrawals.page.confirm })).toHaveCount(0);
  });
});
