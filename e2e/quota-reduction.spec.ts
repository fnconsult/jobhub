import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { fakeCustomerId } from "../apps/web/src/billing/fake-stripe";
import { earliestEffectiveOn } from "../apps/web/src/quota-reductions/reduction";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";
import { subscribe } from "./support/plan";

// Issue #514 (L224-25-26): lowering Standard while Candidates pay for it is scheduled 30 days ahead, shown to each
// subscriber, who may cancel at no cost, refunded prorata. Stripe is the fake API on E2E_STRIPE_URL.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const reductions = fr.admin.quotaReductions;
const stripeUrl = process.env.E2E_STRIPE_URL!;
const ADMINISTRATOR = "back-office@e2e.jobbbox.test";

test("a reduction of Standard waits 30 days; a subscriber cancels over it, refunded prorata; the Administrator cancels it", async ({ page, browser, baseURL }) => {
  // A Standard subscriber who paid 9,99 € for a month that started ten days ago.
  const email = newAddress("quota-reduction");
  await signInWithMagicLink(page, email);
  await subscribe(page, email, "standard");
  const now = Math.floor(Date.now() / 1000);
  await fetch(`${stripeUrl}/__subscriptions/sub_fake_${fakeCustomerId(email)}/period`, {
    method: "POST",
    body: new URLSearchParams({ amount: "999", start: String(now - 10 * 86_400), end: String(now + 20 * 86_400) }),
  });

  // The Administrator lowers Standard's Job Searches: refused without a notice, then scheduled 30 days ahead.
  const admin = await (await browser.newContext({ baseURL })).newPage();
  await signInWithMagicLink(admin, ADMINISTRATOR);
  await admin.goto("/admin/quotas");
  const standard = admin.locator("form").filter({ has: admin.getByRole("heading", { name: "Offre Standard" }) });
  const jobSearches = standard.getByLabel("Recherches d'offres (par semaine)");
  const before = await jobSearches.inputValue();
  await jobSearches.fill("0");
  await standard.getByRole("button", { name: "Enregistrer l'offre Standard" }).click();
  await expect(admin.getByRole("alert")).toHaveText(reductions.errors.notice_required);

  await jobSearches.fill("0");
  await standard.getByLabel(reductions.reasonLabel).fill("Les recherches coûtent plus cher à nos fournisseurs.");
  await standard.getByLabel(reductions.effectiveOnLabel).fill(earliestEffectiveOn(new Date()));
  await standard.getByRole("button", { name: "Enregistrer l'offre Standard" }).click();
  await expect(admin.getByRole("status")).toContainText("Baisse de l'offre Standard programmée");
  // Nothing changed yet.
  await expect(jobSearches).toHaveValue(before);

  // The subscriber sees it on their subscription page, and cancels at no cost.
  await page.goto("/abonnement");
  await expect(page.getByText("Pourquoi : Les recherches coûtent plus cher à nos fournisseurs.")).toBeVisible();
  await page.getByRole("link", { name: fr.quotaReduction.resolve }).click();
  await expect(page).toHaveURL(/\/abonnement\/baisse$/);
  await page.getByRole("button", { name: fr.quotaReduction.page.confirm }).click();
  // Two thirds of the month left: 6,66 € refunded.
  await expect(page.getByRole("status")).toContainText("Votre abonnement est résilié. Nous vous remboursons 6,66");
  const refunds = await (await fetch(`${stripeUrl}/__refunds`)).json();
  expect(refunds.filter((refund: { metadata: { subscription?: string } }) => refund.metadata.subscription === `sub_fake_${fakeCustomerId(email)}`)).toEqual([
    expect.objectContaining({ amount: 666 }),
  ]);
  await page.goto("/abonnement");
  await expect(page.getByText(fr.billing.page.currentPlan.replace("{{plan}}", "Gratuite"))).toBeVisible();

  // On Offres, the reduction is listed, and cancelled before its date: Standard keeps what it has, for the other tests.
  await admin.goto("/admin/offres#baisses");
  const row = admin.getByRole("row").filter({ hasText: "Les recherches coûtent plus cher à nos fournisseurs." });
  await expect(row).toContainText("Recherches d'offres");
  await row.getByRole("button", { name: reductions.cancel.replace("{{plan}}", "Standard") }).click();
  await expect(admin.getByRole("status")).toHaveText(reductions.cancelled);
  await admin.close();
});
