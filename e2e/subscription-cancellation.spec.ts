import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { fakeCustomerId, FAKE_STRIPE_PRICES, signedEvent, subscriptionEvent } from "../apps/web/src/billing/fake-stripe";
import { signInWithMagicLink } from "./support/candidate";
import { emailsTo, newAddress } from "./support/mailbox";
import { subscribe } from "./support/plan";

// Issue #513: « Résilier votre contrat » on the subscription page (C. conso. L215-1-1): three clicks at most, the
// cancellation scheduled in Stripe (the fake on E2E_STRIPE_URL) at the end of the paid period, an acknowledgement
// emailed once, and the Plan kept until Stripe ends the subscription.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const en = JSON.parse(readFileSync("packages/shared/src/i18n/locales/en.json", "utf8"));
const stripeUrl = process.env.E2E_STRIPE_URL!;
const periodEnd = new Date("2026-11-15T09:00:00Z");

async function deliverWebhook(page: Page, event: unknown) {
  const { payload, signature } = signedEvent(event);
  const delivered = await page.request.post("/api/billing/webhook", { data: payload, headers: { "stripe-signature": signature, "content-type": "application/json" } });
  expect(delivered.status()).toBe(200);
}

/** A Candidate signed in on `page`, on Standard, whose paid period ends at `periodEnd` in Stripe. */
async function standardSubscriber(page: Page, label: string) {
  const email = newAddress(label);
  const customer = fakeCustomerId(email);
  await signInWithMagicLink(page, email);
  await subscribe(page, email, "standard");
  const response = await fetch(`${stripeUrl}/__subscriptions/sub_fake_${customer}/period`, { method: "POST", body: new URLSearchParams({ end: String(periodEnd.getTime() / 1000) }) });
  expect(response.ok).toBe(true);
  return { email, customer };
}

const acknowledgements = (email: string, subject: string) => emailsTo(email).filter((mail) => mail.subject === subject);

test.describe("Cancelling the contract from the subscription page", () => {
  test("a Standard Candidate cancels in three clicks, sees the end date, gets one acknowledgement, and is on Free once Stripe ends it", async ({ page }) => {
    const { email, customer } = await standardSubscriber(page, "resiliation");
    await page.goto("/abonnement");
    await expect(page.getByText(fr.billing.page.manageHelp)).toBeVisible();

    // 1: the button beside the way to Stripe.
    await page.getByRole("link", { name: fr.billing.cancellation.action }).click();
    await expect(page).toHaveURL(/\/abonnement\/resiliation$/);
    await expect(page.getByRole("heading", { level: 2, name: fr.billing.cancellation.title })).toBeVisible();
    await expect(page.getByText("Standard", { exact: true })).toBeVisible();
    await expect(page.getByText("15 novembre 2026", { exact: true })).toBeVisible();
    await expect(page.getByText("Vous gardez l'offre Standard jusqu'au 15 novembre 2026, fin de la période déjà payée. Aucun prélèvement ne suivra")).toBeVisible();

    // 2: confirmed, without a questionnaire or an offer in the way.
    await page.getByRole("button", { name: fr.billing.cancellation.confirm }).click();
    await expect(page).toHaveURL(/\/abonnement\?resiliation=enregistree$/);
    await expect(page.getByRole("status")).toContainText("Votre résiliation est enregistrée. Vous gardez l'offre Standard jusqu'au 15 novembre 2026");
    await expect(page.getByRole("status")).toContainText(fr.billing.cancellation.receiptSent);
    await expect(page.getByText("Votre offre actuelle : Standard jusqu'au 15 novembre 2026")).toBeVisible();
    await expect(page.getByRole("link", { name: fr.billing.cancellation.action })).toHaveCount(0);

    const calls = await (await fetch(`${stripeUrl}/__calls`)).json();
    const updates = calls.filter((call: { method: string; path: string }) => call.method === "POST" && call.path === `/v1/subscriptions/sub_fake_${customer}`);
    expect(updates.map((call: { params: Record<string, string> }) => call.params)).toEqual([{ cancel_at_period_end: "true" }]);

    await expect.poll(() => acknowledgements(email, fr.billing.cancellation.email.subject).length).toBe(1);
    const [receipt] = acknowledgements(email, fr.billing.cancellation.email.subject);
    expect(receipt!.text).toMatch(/Demande reçue le \d+ \S+ \d{4} à \d{2}:\d{2}/);
    expect(receipt!.text).toContain("Fin du contrat : 15 novembre 2026");

    // Sent again (a second tab, the back button): nothing more is scheduled or sent.
    const again = await page.request.post("/api/billing/cancellation", { headers: { origin: process.env.E2E_WEB_ORIGIN! }, maxRedirects: 0 });
    expect(again.status()).toBe(303);
    expect(new URL(again.headers().location!).search).toBe("");
    await page.goto("/abonnement/resiliation");
    await expect(page.getByText(fr.billing.cancellation.nothing)).toBeVisible();

    // Stripe reports the change, then ends the subscription at the end of the period: Free.
    const standard = { customer, price: FAKE_STRIPE_PRICES.standard, currentPeriodEnd: periodEnd, cancelAtPeriodEnd: true };
    const later = (seconds: number) => new Date(Date.now() + seconds * 1000);
    await deliverWebhook(page, subscriptionEvent("customer.subscription.updated", { ...standard, status: "active" }, later(10)));
    await page.goto("/abonnement");
    await expect(page.getByText("Votre offre actuelle : Standard jusqu'au 15 novembre 2026")).toBeVisible();
    await deliverWebhook(page, subscriptionEvent("customer.subscription.deleted", { ...standard, status: "canceled" }, later(20)));
    await page.goto("/abonnement");
    await expect(page.getByText("Votre offre actuelle : Gratuite")).toBeVisible();
    expect(acknowledgements(email, fr.billing.cancellation.email.subject)).toHaveLength(1);
  });

  test("the button, the confirmation and the acknowledgement are in English for a Candidate who chose English", async ({ page }) => {
    const { email } = await standardSubscriber(page, "cancellation-en");
    await page.goto("/compte/preferences");
    await page.getByLabel(fr.account.interfaceLanguage).selectOption("en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await page.goto("/abonnement");

    await page.getByRole("link", { name: en.billing.cancellation.action }).click();
    await expect(page.getByText("November 15, 2026", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: en.billing.cancellation.confirm }).click();

    await expect(page.getByRole("status")).toContainText("Your cancellation is recorded. You keep the Standard Plan until November 15, 2026");
    await expect.poll(() => acknowledgements(email, en.billing.cancellation.email.subject).length).toBe(1);
    expect(acknowledgements(email, en.billing.cancellation.email.subject)[0]!.text).toContain("End of the contract: November 15, 2026");
  });

  test("a Free Candidate has no contract to cancel", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("resiliation-free"));
    await page.goto("/abonnement");
    await expect(page.getByText("Votre offre actuelle : Gratuite")).toBeVisible();
    await expect(page.getByRole("link", { name: fr.billing.cancellation.action })).toHaveCount(0);

    await page.goto("/abonnement/resiliation");
    await expect(page.getByText(fr.billing.cancellation.nothing)).toBeVisible();
    await expect(page.getByRole("button", { name: fr.billing.cancellation.confirm })).toHaveCount(0);
  });
});
