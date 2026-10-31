import { readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { checkoutSessionEvent, signedEvent } from "../apps/web/src/billing/fake-stripe";
import { signInWithMagicLink } from "./support/candidate";
import { emailsTo, newAddress, waitForEmail } from "./support/mailbox";

// Issue #511: a paid Coaching Session not held yet is refunded and cancelled from the Agenda (« Renoncer au contrat ici »),
// and a refund Stripe refuses shows in the Back Office, « Rétractations », where Support tries it again.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;
const stripeUrl = process.env.E2E_STRIPE_URL!;
// Its own Administrator: two sign-ins of one address at once can pick up each other's link.
const ADMINISTRATOR = "withdrawals-office@e2e.jobbbox.test";

const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const tr = (template: string, values: Record<string, string>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");

async function personPage(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext({ baseURL: origin, locale: "en-US" });
  const page = await context.newPage();
  await signInWithMagicLink(page, email);
  return page;
}

/** The Administrator adds a Human Coach; returns their name and id. */
async function addCoach(admin: Page, email: string) {
  const name = `Sophie Martin ${unique()}`;
  await admin.goto("/admin/coachs");
  await admin.getByLabel(fr.admin.humanCoaches.name).fill(name);
  await admin.getByLabel(fr.admin.humanCoaches.email).fill(email);
  await admin.getByLabel(fr.admin.humanCoaches.bookingUrl).fill(`https://cal.com/sophie-${unique()}/seance`);
  await admin.getByLabel(fr.admin.humanCoaches.bio).fill("Ancienne DRH dans l'industrie.");
  await admin.getByRole("button", { name: fr.admin.humanCoaches.add }).click();
  await expect(admin.getByRole("status")).toHaveText(tr(fr.admin.humanCoaches.added, { name }));
  const form = admin.locator("form").filter({ has: admin.getByRole("button", { name: tr(fr.admin.humanCoaches.retire, { name }) }) });
  return { name, id: await form.locator('input[name="coachId"]').inputValue() };
}

/** The Candidate signed in on `page` pays a Coaching Session (90 €) through Checkout and Stripe's signed webhook; returns the PaymentIntent. */
async function paidSession(page: Page, coachId: string) {
  const checkout = await page.request.post("/api/coaching/checkout", { form: { coachId }, headers: { origin }, maxRedirects: 0 });
  expect(checkout.status()).toBe(303);
  const calls: { path: string; params: Record<string, string> }[] = await (await fetch(`${stripeUrl}/__calls`)).json();
  const started = calls.filter((call) => call.path === "/v1/checkout/sessions" && call.params["metadata[coach_id]"] === coachId).at(-1)!.params;
  const id = `cs_e2e_${unique()}`;
  const paid = await fetch(`${stripeUrl}/__checkout_sessions/${id}/payment`, { method: "POST", body: new URLSearchParams({ amount: "9000" }) });
  const { payment_intent: paymentIntent } = (await paid.json()) as { payment_intent: string };
  const { payload, signature } = signedEvent(
    checkoutSessionEvent("checkout.session.completed", { id, candidateId: started["metadata[candidate_id]"]!, coachId, amount: 9000, currency: "eur", paymentStatus: "paid" }),
  );
  const delivered = await page.request.post("/api/billing/webhook", { data: payload, headers: { "stripe-signature": signature, "content-type": "application/json" } });
  expect(delivered.status()).toBe(200);
  return paymentIntent;
}

const refundsOf = async (paymentIntent: string) =>
  ((await (await fetch(`${stripeUrl}/__refunds`)).json()) as { payment_intent: string; amount: number; status: string }[]).filter((refund) => refund.payment_intent === paymentIntent);

async function withdrawFromAgenda(page: Page, coachName: string) {
  await page.goto("/agenda");
  await page.getByRole("link", { name: tr(fr.withdrawals.agenda.label, { name: coachName }) }).click();
  await expect(page).toHaveURL(/\/abonnement\/retractation\?contrat=coaching-session/);
  await page.getByLabel(fr.withdrawals.page.name).fill("Marie Dupont");
  await page.getByRole("button", { name: fr.withdrawals.page.confirm }).click();
}

test.describe.configure({ mode: "serial" });

test.describe("Withdrawal from a Coaching Session (#511)", () => {
  test("a paid Coaching Session not held yet is refunded in full and cancelled from the Agenda", async ({ page, browser }) => {
    const admin = await personPage(browser, ADMINISTRATOR);
    const coach = await addCoach(admin, newAddress("coach"));
    const email = newAddress("retractation-seance");
    await signInWithMagicLink(page, email);
    const paymentIntent = await paidSession(page, coach.id);
    const before = emailsTo(email).length;

    await withdrawFromAgenda(page, coach.name);
    await expect(page.getByRole("status")).toContainText(`Séance de coaching avec ${coach.name}`);
    await expect(page.getByRole("status")).toContainText(/Montant remboursé : 90,00\s€/);
    expect(await refundsOf(paymentIntent)).toEqual([expect.objectContaining({ amount: 9000, status: "succeeded" })]);

    const receipt = await waitForEmail(email, before);
    expect(receipt.subject).toBe(fr.withdrawals.email.subject);
    expect(receipt.text).toMatch(/Nous avons bien reçu votre rétractation le \d{1,2} \S+ \d{4} à \d{2}:\d{2}\./);
    expect(receipt.text).toMatch(/Montant remboursé : 90,00\s€/);

    // Cancelled: gone from the Agenda, nothing left to withdraw from.
    await page.goto("/agenda");
    await expect(page.getByRole("link", { name: tr(fr.withdrawals.agenda.label, { name: coach.name }) })).toHaveCount(0);
    await page.goto("/abonnement/retractation?contrat=coaching-session:unknown");
    await expect(page.getByRole("button", { name: fr.withdrawals.page.confirm })).toHaveCount(0);
    await admin.context().close();
  });

  test("a refund Stripe refuses appears in the Back Office as failed and Support tries it again", async ({ page, browser }) => {
    const admin = await personPage(browser, ADMINISTRATOR);
    const coach = await addCoach(admin, newAddress("coach"));
    const email = newAddress("retractation-echec");
    await signInWithMagicLink(page, email);
    const paymentIntent = await paidSession(page, coach.id);

    // This PaymentIntent's refunds only: the fake Stripe is shared with the specs running beside this one (withdrawal.spec.ts).
    await fetch(`${stripeUrl}/__refunds/refuse`, { method: "POST", body: new URLSearchParams({ payment_intent: paymentIntent, code: "charge_disputed" }) });
    try {
      await withdrawFromAgenda(page, coach.name);
      await expect(page.getByRole("status")).toContainText(`Séance de coaching avec ${coach.name}`);
      expect(await refundsOf(paymentIntent)).toEqual([]);

      await admin.goto("/admin/retractations");
      const row = admin.getByRole("row").filter({ hasText: email });
      await expect(row.getByText(fr.admin.withdrawals.states.failed)).toBeVisible();
      await expect(row.getByText(/charge_disputed/)).toBeVisible();
      await expect(row.getByRole("button", { name: fr.admin.withdrawals.retry })).toBeVisible();

      // Still refused: stays failed, one more attempt.
      await row.getByRole("button", { name: fr.admin.withdrawals.retry }).click();
      await expect(admin.getByText(fr.admin.withdrawals.retried.failed)).toBeVisible();
      await expect(admin.getByRole("row").filter({ hasText: email }).getByText(tr(fr.admin.withdrawals.attempts_other, { count: "2" }))).toBeVisible();
    } finally {
      await fetch(`${stripeUrl}/__refunds/refuse`, { method: "POST", body: new URLSearchParams({ payment_intent: paymentIntent }) });
    }

    // Stripe works again: the retry goes through.
    await admin.goto("/admin/retractations");
    await admin.getByRole("row").filter({ hasText: email }).getByRole("button", { name: fr.admin.withdrawals.retry }).click();
    await expect(admin.getByText(fr.admin.withdrawals.retried.succeeded)).toBeVisible();
    await expect(admin.getByRole("row").filter({ hasText: email }).getByText(fr.admin.withdrawals.states.succeeded)).toBeVisible();
    expect(await refundsOf(paymentIntent)).toEqual([expect.objectContaining({ amount: 9000, status: "succeeded" })]);
    await admin.context().close();
  });
});
