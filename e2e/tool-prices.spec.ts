import { readFileSync } from "node:fs";
import { expect as baseExpect, test, type Browser, type Page } from "@playwright/test";
import { Client } from "pg";
import { signInWithMagicLink } from "./support/candidate";
import { openApplication } from "./support/company-dossier";

// Issue #403 (ADR-0042): each Tool's billed unit has a price, its list price in code by default, overridden on the Tool's
// sheet in Paramètres; AI Usage records each call at the price in use. Here a super-admin overrides Perplexity's (the
// suite's Search provider, faked by e2e/support/fake-company-sources.mjs) price per "fast" Search API call: a foreign
// employer's Company Dossier, built from web search, is recorded at the list price before and at the new price after.
// The new price is small (twice the list price) so the specs searching meanwhile keep within their run budgets; it is
// restored afterwards.
const expect = baseExpect.configure({ timeout: 15_000 });

const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const texts = fr.admin.platformSettings;
const t = fr.companyDossier;
const origin = process.env.E2E_WEB_ORIGIN!;
// Its own permanent super-admin: two sign-ins of one address at once can pick up each other's link.
const SUPER_ADMIN = "prices-office@e2e.jobbbox.test";
const PRICE = "PERPLEXITY_FAST_SEARCH_PRICE_USD";
const SHEET = "/admin/parametres?tab=recherche-web&fournisseur=perplexity";
const EUR_PER_USD = 0.86;

const tr = (template: string, values: Record<string, string>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");

async function withDatabase<T>(work: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: process.env.E2E_DATABASE_URL });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

/** What AI Usage recorded each Perplexity web search since `since` cost, in €. */
const perplexitySearchCosts = (since: Date) =>
  withDatabase(async (client) => {
    const { rows } = await client.query<{ cost: number }>(
      `SELECT t.cost_eur AS cost FROM ai_tool_usage t JOIN ai_usage u ON u.id = t.usage_id
        WHERE u.provider = 'perplexity' AND t.name = 'web_search' AND t.ok AND u.at >= $1 ORDER BY u.at`,
      [since],
    );
    return rows.map((row) => row.cost);
  });

/** A new Candidate builds the Company Dossier of a foreign employer: from web search (Perplexity). */
async function buildWebDossier(browser: Browser) {
  const context = await browser.newContext({ baseURL: origin, locale: "en-US" });
  const page = await context.newPage();
  const dossier = await openApplication(page, "Globex Robotics GmbH");
  await dossier.getByRole("button", { name: t.build }).click();
  await expect(dossier.getByText(t.reliability.less_reliable)).toBeVisible();
  await context.close();
}

/** Every web search recorded since `since` cost `usd` per call, at €0.86 per $; there was at least one. */
async function expectRecordedAt(since: Date, usd: number) {
  await expect.poll(async () => (await perplexitySearchCosts(since)).length).toBeGreaterThan(0);
  for (const cost of await perplexitySearchCosts(since)) expect(cost).toBeCloseTo(usd * EUR_PER_USD, 9);
}

const row = (page: Page, name: string) => page.locator(`[data-sheet] tr[data-setting="${name}"]`);

test.describe("prices of the Tools' billed units (#403)", () => {
  test.afterAll(async () => {
    // Leave the suite's server at the list price.
    await withDatabase(async (client) => {
      await client.query("DELETE FROM platform_setting WHERE name = $1", [PRICE]);
      await client.query("SELECT pg_notify('platform_settings_changed', '')");
    });
  });

  test("overriding Perplexity's price changes the next call's recorded cost", async ({ browser, page }) => {
    // At the list price: $0.001 a "fast" call.
    const first = new Date();
    await buildWebDossier(browser);
    await expectRecordedAt(first, 0.001);

    // Perplexity's sheet shows the price, its list price with its source and date, and changes it.
    await signInWithMagicLink(page, SUPER_ADMIN);
    await page.goto(SHEET);
    const sheet = page.locator("[data-sheet='perplexity']");
    await expect(sheet.getByRole("heading", { name: texts.sheet.pricesTitle })).toBeVisible();
    await expect(sheet.locator(`li[data-list-price="${PRICE}"]`)).toContainText(tr(texts.sheet.listPrice, { name: PRICE, price: "0.001", unit: texts.sheet.units.call, date: "2026-10-27" }));
    await expect(sheet.locator(`li[data-list-price="${PRICE}"]`).getByRole("link", { name: texts.sheet.listPriceSource })).toHaveAttribute("href", "https://docs.perplexity.ai/docs/getting-started/pricing");
    const price = row(page, PRICE);
    await expect(price.getByRole("cell").nth(1)).toContainText(texts.sources.default);
    await price.getByRole("textbox", { name: tr(texts.newValue, { name: PRICE }) }).fill("0.002");
    await price.getByRole("button", { name: texts.save }).click();
    await expect(page.getByRole("status").filter({ hasText: PRICE })).toHaveText(tr(texts.notices.saved, { name: PRICE }));
    await expect(row(page, PRICE).getByRole("cell").nth(0)).toHaveText("0.002");
    await expect(row(page, PRICE).getByRole("cell").nth(1)).toContainText(texts.sources.back_office);
    await expect(row(page, PRICE).getByRole("cell").nth(1)).toContainText(SUPER_ADMIN);

    // The next call is recorded at it.
    const next = new Date();
    await buildWebDossier(browser);
    await expectRecordedAt(next, 0.002);
  });
});
