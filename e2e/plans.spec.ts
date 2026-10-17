import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { fakeCustomerId, FAKE_STRIPE_PRICES, FAKE_STRIPE_PRODUCTS, signedEvent, subscriptionEvent } from "../apps/web/src/billing/fake-stripe";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #206: Plans defined by Administrators in the Back Office (Offres). A new Plan, tied to
// a Stripe product of the fake Stripe (E2E_STRIPE_URL), starts hidden; offered, it is compared
// on /abonnement and sold at its product's default price; any price of its product applies it;
// hidden again, it leaves the comparison while its subscriber keeps it. Every change is in the
// Journal. The Plan is hidden again at the end, so the other specs compare Free, Standard and Premium.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const plans = fr.admin.plans;
const stripeUrl = process.env.E2E_STRIPE_URL!;
const ADMINISTRATOR = "back-office@e2e.jobbbox.test";
const tr = (template: string, values: Record<string, string>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");

async function checkoutCalls(customer: string): Promise<{ params: Record<string, string> }[]> {
  const calls = await (await fetch(`${stripeUrl}/__calls`)).json();
  return calls.filter((call: { path: string; params: Record<string, string> }) => call.path === "/v1/checkout/sessions" && call.params.customer === customer);
}

const planForm = (page: Page, name: string) => page.locator("form").filter({ has: page.getByRole("heading", { name: tr(plans.edit, { plan: name }) }) });
const comparedPlans = async (page: Page) => (await page.getByRole("table").getByRole("columnheader").allInnerTexts()).slice(1);

test.describe("Plans in the Back Office", () => {
  test.describe.configure({ mode: "serial" });

  test("a Plan created hidden is offered, sold at its product's default price, followed by the webhook, then hidden again", async ({ page, browser }) => {
    await signInWithMagicLink(page, ADMINISTRATOR);
    await page.goto("/admin");
    await page.getByRole("link", { name: fr.admin.sections.plans }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(plans.title);
    await expect(page.getByRole("table").getByRole("rowheader")).toHaveText(["Gratuite", "Standard", "Premium"]);
    // Free is built in: no product, no "offered" box, no buttons to move it.
    const free = planForm(page, "Gratuite");
    await expect(free.getByLabel(plans.product)).toHaveCount(0);
    await expect(free.getByLabel(plans.offeredLabel)).toHaveCount(0);
    await expect(page.getByRole("button", { name: tr(plans.moveUp, { plan: "Gratuite" }) })).toHaveCount(0);

    // A price ID where the product belongs is refused, before anything is created.
    const create = page.locator("form").filter({ has: page.getByRole("heading", { name: plans.createTitle }) });
    await create.getByLabel(plans.key).fill("essentiel");
    await create.getByLabel(plans.nameFr).fill("Essentiel");
    await create.getByLabel(plans.nameEn).fill("Essential");
    await create.getByLabel(plans.product).fill(FAKE_STRIPE_PRICES.essential);
    await create.getByRole("button", { name: plans.create }).click();
    await expect(page.getByRole("alert").filter({ hasText: plans.errors.not_a_product_id })).toBeVisible();

    await create.getByLabel(plans.key).fill("essentiel");
    await create.getByLabel(plans.nameFr).fill("Essentiel");
    await create.getByLabel(plans.nameEn).fill("Essential");
    await create.getByLabel(plans.product).fill(FAKE_STRIPE_PRODUCTS.essential);
    await create.getByRole("button", { name: plans.create }).click();
    await expect(page.getByRole("status")).toHaveText(tr(plans.created, { plan: "Essentiel" }));
    const row = page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "Essentiel" }) });
    await expect(row).toContainText(plans.status.hidden);
    await expect(row).toContainText(FAKE_STRIPE_PRODUCTS.essential);

    // Hidden: not compared on /abonnement.
    const candidatePage = await (await browser.newContext({ baseURL: process.env.E2E_WEB_ORIGIN, locale: "fr-FR" })).newPage();
    const email = newAddress("plans-essentiel");
    const customer = fakeCustomerId(email);
    await signInWithMagicLink(candidatePage, email);
    await candidatePage.goto("/abonnement");
    expect(await comparedPlans(candidatePage)).not.toContain("Essentiel");

    try {
      // Offered: compared after Premium (it is ranked highest), at its product's default price, and sold at it.
      await planForm(page, "Essentiel").getByLabel(plans.offeredLabel).check();
      await planForm(page, "Essentiel").getByRole("button", { name: tr(plans.save, { plan: "Essentiel" }) }).click();
      await expect(page.getByRole("status")).toHaveText(tr(plans.saved, { plan: "Essentiel" }));
      await candidatePage.goto("/abonnement");
      expect(await comparedPlans(candidatePage)).toEqual(["Gratuite", "Standard", "Premium", "Essentiel"]);
      const prices = (await candidatePage.getByRole("row", { name: new RegExp(`^${fr.billing.page.price}`) }).getByRole("cell").allInnerTexts()).map((cell) => cell.replace(/\s/g, " "));
      expect(prices[3]).toBe("29 € / mois");
      const checkout = await candidatePage.request.post("/api/billing/checkout", { form: { plan: "essentiel" }, headers: { origin: process.env.E2E_WEB_ORIGIN! }, maxRedirects: 0 });
      expect(checkout.status()).toBe(303);
      expect(checkout.headers().location).toMatch(/^https:\/\/checkout\.stripe\.test\//);
      expect((await checkoutCalls(customer)).at(-1)?.params["line_items[0][price]"]).toBe(FAKE_STRIPE_PRICES.essential);

      // Any price of its product applies it: here a yearly one switched to in the customer portal.
      const { payload, signature } = signedEvent(
        subscriptionEvent("customer.subscription.created", { customer, price: "price_essential_yearly", product: FAKE_STRIPE_PRODUCTS.essential, status: "active" }),
      );
      const delivered = await candidatePage.request.post("/api/billing/webhook", { data: payload, headers: { "stripe-signature": signature, "content-type": "application/json" } });
      expect(delivered.status()).toBe(200);
      await candidatePage.goto("/abonnement");
      await expect(candidatePage.getByText("Votre offre actuelle : Essentiel")).toBeVisible();
    } finally {
      // Hidden again: off the comparison; its subscriber keeps it.
      await page.goto("/admin/offres");
      await planForm(page, "Essentiel").getByLabel(plans.offeredLabel).uncheck();
      await planForm(page, "Essentiel").getByRole("button", { name: tr(plans.save, { plan: "Essentiel" }) }).click();
      await expect(page.getByRole("status")).toHaveText(tr(plans.saved, { plan: "Essentiel" }));
    }
    await candidatePage.goto("/abonnement");
    expect(await comparedPlans(candidatePage)).toEqual(["Gratuite", "Standard", "Premium"]);
    await expect(candidatePage.getByText("Votre offre actuelle : Essentiel")).toBeVisible();

    // Free cannot be hidden, even by a form sent by hand.
    await page.goto("/admin/offres");
    await free.locator('input[name="offered"]').evaluate((input: HTMLInputElement) => input.remove());
    await free.getByRole("button", { name: tr(plans.save, { plan: "Gratuite" }) }).click();
    await expect(page.getByRole("alert").filter({ hasText: plans.errors.free_plan_built_in })).toBeVisible();

    // Every change is in the Journal, under Offres.
    await page.goto(`/admin/journal?section=plans`);
    const entries = page.getByRole("row").filter({ hasText: "Essentiel" });
    await expect(entries).toHaveCount(3);
    await expect(entries.first()).toContainText(`${plans.fields.status} : ${plans.status.offered} → ${plans.status.hidden}`);
    await expect(entries.last()).toContainText(fr.admin.journal.actions.added);
  });
});
