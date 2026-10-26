import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { Client } from "pg";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #396 (ADR-0042): Paramètres in tabs by kind of Tool (Recherche web, IA, Sources, Enrichissement de contacts,
// E-mail, Paiement, Connexion), then Extension and, last, Environnement, the tab in the address. It absorbs Clés (each
// key on its provider's sheet, a side panel), Connexion (its tab) and Sites de recherche (Sources, Recherche web,
// Extension), whose old addresses redirect. The keys changed here are Kaspr's, which nothing else in the suite uses (the
// fake Kaspr accepts keys starting e2e-kaspr-valid-, e2e/support/fake-contact-provider.mjs). Tavily, whose key the suite's
// server lacks, is never actually made active here: since #399 that change is saved (ADR-0042: it warns, never blocks)
// and would leave every parallel spec without a web search; active-provider.test.ts covers it.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const admin = fr.admin;
const texts = admin.platformSettings;
const keys = admin.providerSecrets;
const origin = process.env.E2E_WEB_ORIGIN!;
// Its own permanent super-admin: two sign-ins of one address at once can pick up each other's link.
const SUPER_ADMIN = "parametres-office@e2e.jobbbox.test";
const PATH = "/admin/parametres";
const KEY = "KASPR_API_KEY";
const KASPR_SHEET = `${PATH}?tab=enrichissement&fournisseur=kaspr`;

/** Each tab, by its address, with a heading it shows. */
const TABS = [
  ["recherche-web", "web_search", admin.searchSites.discoverySites.title],
  ["ia", "ai", texts.providers.title],
  ["sources", "sources", texts.sources.title],
  ["enrichissement", "contact_enrichment", texts.providers.title],
  ["e-mail", "email", texts.providers.title],
  ["paiement", "billing", texts.providers.title],
  ["connexion", "sign_in", admin.signInProviders.ssoTitle],
  ["extension", "extension", admin.searchSites.jobSites.title],
  ["environnement", "environment", texts.environment.retired.title],
] as const;

const unique = () => `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
const tr = (template: string, values: Record<string, string>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");
const tabs = (page: Page) => page.getByRole("navigation", { name: texts.tabsLabel });
const sheet = (page: Page) => page.locator("aside[data-sheet]");

/** WCAG 2.1 A and AA, on the page's main region (the sidebar is checked elsewhere). */
async function expectAccessible(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`), label).toEqual([]);
}

async function personPage(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext({ baseURL: origin, locale: "en-US" });
  const page = await context.newPage();
  await signInWithMagicLink(page, email);
  return page;
}

test.describe("Paramètres in tabs (#396)", () => {
  test.afterAll(async () => {
    // Leave the suite's server as it found it: no Kaspr key, the web search on its default provider.
    const client = new Client({ connectionString: process.env.E2E_DATABASE_URL });
    await client.connect();
    try {
      await client.query("DELETE FROM provider_secret WHERE name = $1", [KEY]);
      await client.query("SELECT pg_notify('provider_secrets_changed', '')");
      await client.query("DELETE FROM platform_setting WHERE name = 'AI_WEB_SEARCH_PROVIDER'");
      await client.query("SELECT pg_notify('platform_settings_changed', '')");
    } finally {
      await client.end();
    }
  });

  test("each tab renders for a super-admin, its address kept on reload, and passes axe", async ({ page }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    await page.goto(PATH);
    // No tab named: the first one, Recherche web.
    await expect(tabs(page).getByRole("link", { name: texts.tabs.web_search })).toHaveAttribute("aria-current", "page");
    await expect(tabs(page).getByRole("link")).toHaveText(TABS.map(([, id]) => texts.tabs[id]));
    // Clés, Connexion and Sites de recherche are no longer in the sidebar.
    const nav = page.getByRole("navigation", { name: admin.nav.label });
    for (const gone of ["providerSecrets", "signInProviders", "searchSites"]) await expect(nav.getByRole("link", { name: admin.sections[gone], exact: true })).toHaveCount(0);

    for (const [slug, id, heading] of TABS) {
      await tabs(page).getByRole("link", { name: texts.tabs[id] }).click();
      await page.waitForURL(`${origin}${PATH}?tab=${slug}`);
      await page.reload();
      await expect(tabs(page).getByRole("link", { name: texts.tabs[id] }), slug).toHaveAttribute("aria-current", "page");
      await expect(page.getByRole("heading", { level: 2, name: heading, exact: true }), slug).toBeVisible();
      await expectAccessible(page, slug);
    }

    // The active web search provider, then every possible one with its key's state, its sheet a click away.
    await page.goto(`${PATH}?tab=recherche-web`);
    await expect(page.locator("[data-active-provider]")).toHaveText("Perplexity");
    const perplexity = page.locator('tr[data-provider="perplexity"]');
    await expect(perplexity).toContainText(texts.providers.activeFlag);
    await expect(perplexity).toContainText("PERPLEXITY_API_KEY");
    await expect(perplexity).toContainText(keys.sources.env);
    await expect(perplexity).toContainText(admin.aiUsage.tasks.web_search);
    await perplexity.getByRole("link", { name: tr(texts.providers.open, { name: "Perplexity" }) }).click();
    await expect(page).toHaveURL(`${origin}${PATH}?tab=recherche-web&fournisseur=perplexity`);
    await expect(sheet(page).getByRole("heading", { level: 2 })).toHaveText("Perplexity");
    await expect(sheet(page).getByRole("link", { name: texts.sheet.toolPage })).toHaveAttribute("href", "/admin/outils/perplexity");
    await expectAccessible(page, "sheet");
    await sheet(page).getByRole("link", { name: texts.sheet.close }).click();
    await expect(sheet(page)).toHaveCount(0);

    // « + Ajouter », preselected from the tab.
    await page.goto(`${PATH}?tab=extension`);
    await page.getByRole("link", { name: texts.add.button }).click();
    await expect(page.getByLabel(texts.add.type)).toHaveValue("job_site");
    await expect(page.locator("[data-add-panel]").getByLabel(admin.searchSites.jobSites.pattern)).toBeVisible();
    await expectAccessible(page, "add panel");
    await page.getByLabel(texts.add.type).selectOption("model");
    await page.getByRole("button", { name: texts.add.choose }).click();
    await expect(page.getByLabel(texts.add.modelSetting)).toBeVisible();

    // The Environnement tab says why each setting stays in env.
    await page.goto(`${PATH}?tab=environnement`);
    await expect(page.locator('tr[data-setting="DATABASE_URL"]')).toContainText(texts.environment.kinds.bootstrap);
  });

  test("the old addresses go to the right tab, and a provider's sheet for a key", async ({ page }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    for (const [old, now] of [
      ["/admin/cles", `${PATH}?tab=recherche-web`],
      ["/admin/cles?key=STRIPE_WEBHOOK_SECRET", `${PATH}?tab=paiement&fournisseur=stripe`],
      ["/admin/cles?key=FANTASTIC_JOBS_API_KEY", `${PATH}?tab=sources&fournisseur=fantastic-jobs`],
      ["/admin/connexion", `${PATH}?tab=connexion`],
      ["/admin/sites", `${PATH}?tab=sources`],
    ]) {
      await page.goto(old);
      await expect(page, old).toHaveURL(`${origin}${now}`);
    }
    await expect(page.getByRole("heading", { level: 2, name: texts.sources.title })).toBeVisible();
  });

  test("a key replaced from its provider's sheet is tested and recorded as before, never shown", async ({ page }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    const valid = `e2e-kaspr-valid-${unique()}`;
    await page.goto(KASPR_SHEET);
    const key = sheet(page).locator(`[data-key="${KEY}"]`);
    await expect(key).toContainText(keys.sources.missing);
    await key.locator("summary", { hasText: tr(keys.replaceLegend, { name: KEY }) }).click();
    await key.getByLabel(tr(keys.newValue, { name: KEY })).fill(valid);
    await key.getByRole("button", { name: tr(keys.replace, { name: KEY }) }).click();

    // Back on the sheet: tested before it was saved, its source and last 4 characters, its last test passed.
    await expect(page).toHaveURL(new RegExp(`fournisseur=kaspr`));
    await expect(sheet(page).getByRole("status")).toHaveText(tr(keys.saved, { name: KEY }));
    await expect(key).toContainText(keys.sources.database);
    await expect(key).toContainText(`…${valid.slice(-4)}`);
    await expect(key).toContainText(tr(texts.providers.testPassed, { at: "" }).trim().replace(/,$/, ""));
    await key.getByRole("button", { name: tr(keys.test, { name: KEY }) }).click();
    await expect(sheet(page).getByRole("status")).toHaveText(tr(keys.testPassed, { name: KEY }));
    // The tab's table shows the same: source and last 4 characters.
    await page.goto(`${PATH}?tab=enrichissement`);
    await expect(page.locator('tr[data-provider="kaspr"]')).toContainText(`…${valid.slice(-4)}`);
    expect(await page.content()).not.toContain(valid);

    await page.goto("/admin/journal?section=provider_secrets");
    const entries = page.getByRole("row").filter({ hasText: KEY }).filter({ hasText: SUPER_ADMIN });
    await expect(entries.first()).toContainText(admin.journal.actions.tested);
    await expect(entries.nth(1)).toContainText(admin.journal.secret.replaced);
    expect(await page.content()).not.toContain(valid);

    await page.goto(KASPR_SHEET);
    await key.getByRole("button", { name: tr(keys.clear, { name: KEY }) }).click();
    await expect(sheet(page).getByRole("status")).toHaveText(tr(keys.cleared, { name: KEY }));
    await expect(key).toContainText(keys.sources.missing);
  });

  test("« Rendre actif » a web search provider without its key warns first, never blocks (#399)", async ({ page }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    await page.goto(`${PATH}?tab=recherche-web`);
    // Tavily, not Brave: the Company Dossier spec (#405) enters a Brave key meanwhile.
    const tavily = page.locator('tr[data-provider="tavily"]');
    // A Provider Secret since #399: shown as the Provider Secrets are, « Absente ».
    await expect(tavily).toContainText(keys.sources.missing);
    const makeActive = tavily.getByRole("button", { name: `${texts.providers.makeActive} : Tavily` });
    await expect(makeActive).toBeEnabled();
    await expect(makeActive).toHaveAccessibleDescription(texts.providers.noKeyWarning);
    // Not clicked: saved since #399 (web search alone unavailable, active-provider.test.ts), it would leave the parallel
    // specs without a web search.
    await expect(page.locator("[data-active-provider]")).toHaveText("Perplexity");
  });

  test("Support reads every tab and changes nothing; axe passes", async ({ page, browser }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    const support = newAddress("parametres-support");
    const supportPage = await personPage(browser, support);
    await page.goto("/admin/administrateurs");
    await page.getByLabel(admin.administrators.grantEmail).fill(support);
    await page.getByRole("checkbox", { name: admin.roles.support }).check();
    await page.getByRole("button", { name: admin.administrators.grant }).click();
    await expect(page.getByRole("status")).toBeVisible();

    for (const [slug, , heading] of TABS) {
      expect((await supportPage.goto(`${PATH}?tab=${slug}`))?.status(), slug).toBe(200);
      await expect(supportPage.getByRole("heading", { level: 2, name: heading, exact: true }), slug).toBeVisible();
      await expect(supportPage.getByText(admin.readOnly), slug).toBeVisible();
      // Nothing to send: no form, no « + Ajouter », no « Rendre actif », every control shown disabled.
      await expect(supportPage.getByRole("main").locator("form"), slug).toHaveCount(0);
      await expect(supportPage.getByRole("link", { name: texts.add.button }), slug).toHaveCount(0);
      await expect(supportPage.getByRole("button", { name: new RegExp(texts.providers.makeActive) }), slug).toHaveCount(0);
      for (const button of await supportPage.getByRole("main").getByRole("button").all()) await expect(button, slug).toBeDisabled();
      await expectAccessible(supportPage, `Support, ${slug}`);
    }
    // A provider's sheet: its key's state without its value, source nor actions.
    await supportPage.goto(`${PATH}?tab=ia&fournisseur=mistral`);
    await expect(sheet(supportPage).locator('[data-key="MISTRAL_API_KEY"]')).toContainText(texts.providers.keySet);
    await expect(sheet(supportPage)).toContainText(texts.sheet.readOnlyKeys);
    await expect(sheet(supportPage).getByRole("button")).toHaveCount(0);
    expect(await supportPage.content()).not.toContain("e2e-mistral-key");
  });
});
