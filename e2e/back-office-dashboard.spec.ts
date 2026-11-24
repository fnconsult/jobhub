import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import pg from "pg";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #408: the Back Office's home is the Dashboard, the sidebar's first entry. Its Job discovery block (web search
// spend against the alert threshold, the runs' cost against their budget, stop reasons, cost by item) shows only to
// the roles that read Consommation IA: super-admins, Technique and Support; a Plans manager sees none of it. Its « API »
// block (#1116), each configured Tool's quota state, shows to every role.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const admin = fr.admin;
const texts = admin.dashboard.jobDiscovery;
// Its own permanent super-admin: two sign-ins of one address at once can pick up each other's link.
const SUPER_ADMIN = "dashboard-office@e2e.jobbbox.test";
const origin = process.env.E2E_WEB_ORIGIN!;

/** A signed-in page of its own (cookies apart), as for another person on another computer. */
async function personPage(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext({ baseURL: origin, locale: "en-US" });
  const page = await context.newPage();
  await signInWithMagicLink(page, email);
  return page;
}

/** The super-admin grants `role` to the account with `email` on the Administrateurs page. */
async function grant(superAdmin: Page, email: string, role: string) {
  await superAdmin.goto("/admin/administrateurs");
  await superAdmin.getByLabel(admin.administrators.grantEmail).fill(email);
  await superAdmin.getByRole("checkbox", { name: admin.roles[role] }).check();
  await superAdmin.getByRole("button", { name: admin.administrators.grant }).click();
  await expect(superAdmin.getByRole("status")).toBeVisible();
}

/** A Perplexity web search recorded in AI Usage just now, its one billed call at €0.00086: this month's spend. */
async function recordWebSearch() {
  const database = new pg.Pool({ connectionString: process.env.E2E_DATABASE_URL });
  try {
    const { rows } = await database.query<{ id: string }>(
      `INSERT INTO ai_usage (at, task, provider, endpoint, model, input_tokens, output_tokens, cost_eur, ok, duration_ms, outcome)
       VALUES (now(), 'web_search', 'perplexity', 'e2e', 'perplexity-search', 0, 0, 0, true, 300, 'ok') RETURNING id`,
    );
    await database.query(`INSERT INTO ai_tool_usage (usage_id, name, count, ok, duration_ms, cost_eur) VALUES ($1, 'web_search', 1, true, 300, 0.00086)`, [rows[0]!.id]);
  } finally {
    await database.end();
  }
}

const api = admin.dashboard.api;

/**
 * Mistral refused for its quota (« quota épuisé »), then, once `between` is done, accepted again; both calls are removed
 * afterwards. They are dated an hour ahead: the other specs' Mistral calls, made meanwhile, neither end nor hide the state.
 */
async function mistralQuotaExhausted(between: () => Promise<void>, after: () => Promise<void>) {
  const database = new pg.Pool({ connectionString: process.env.E2E_DATABASE_URL });
  const insert = async (at: string, ok: boolean) => {
    const { rows } = await database.query<{ id: string }>(
      `INSERT INTO ai_usage (at, task, provider, endpoint, model, input_tokens, output_tokens, cost_eur, ok, duration_ms, outcome, reason)
       VALUES (now() + $1::interval, 'scoring', 'mistral', 'e2e', 'mistral-small-latest', 0, 0, 0, $2, 10, $3, $4) RETURNING id`,
      [at, ok, ok ? "ok" : "failed", ok ? null : "quota_exhausted"],
    );
    return rows[0]!.id;
  };
  const ids: string[] = [];
  try {
    ids.push(await insert("1 hour", false));
    await between();
    ids.push(await insert("1 hour 1 minute", true));
    await after();
  } finally {
    await database.query(`DELETE FROM ai_usage WHERE id = ANY($1::uuid[])`, [ids]);
    await database.end();
  }
}

const apiBlock = (page: Page) => page.getByRole("region", { name: new RegExp(`^${api.title} ·`) });
/** A Tool's card in the « API » block. */
const toolCard = (page: Page, name: string) => apiBlock(page).locator("[data-stat]").filter({ has: page.getByRole("term").filter({ hasText: name }) });
const block = (page: Page) => page.getByRole("region", { name: new RegExp(`^${texts.title}`) });
const nav = (page: Page) => page.getByRole("navigation", { name: admin.nav.label });

test.describe("Back Office Dashboard", () => {
  test("a super-admin sees the Job discovery block: its figures, its charts with tooltips and table views, and links to their detail", async ({ page }) => {
    await recordWebSearch();
    await signInWithMagicLink(page, SUPER_ADMIN);
    await page.goto("/admin");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(admin.dashboard.title);
    await expect(page).toHaveTitle(`${admin.dashboard.title} · ${admin.title}`);
    const home = nav(page).getByRole("link").first();
    await expect(home).toHaveText(admin.nav.dashboard);
    await expect(home).toHaveAttribute("aria-current", "page");

    const figures = block(page);
    await expect(figures).toBeVisible();
    for (const label of [texts.webSpend, texts.averageRun, texts.costPerNewOffer, texts.runs, texts.fellBack, texts.failedCalls]) {
      await expect(figures.getByRole("term").filter({ hasText: new RegExp(`^${label}$`) })).toBeVisible();
    }
    // The spend this month: at least the search just recorded, so never nothing.
    await expect(figures.getByRole("definition").first()).not.toHaveText("0,00 €");
    for (const caption of [texts.dailyTitle, texts.cumulativeTitle, texts.stopsTitle, texts.itemsTitle]) {
      await expect(figures.getByRole("figure", { name: caption })).toBeVisible();
    }

    // The daily spend per Search provider: Perplexity in its legend, today's column says its spend on hover.
    const daily = figures.getByRole("figure", { name: texts.dailyTitle });
    await expect(daily.getByRole("listitem").filter({ hasText: "Perplexity" })).toBeVisible();
    const today = daily.getByRole("group", { name: texts.dailyTitle }).getByRole("img").last();
    await today.hover();
    await expect(daily.getByRole("tooltip")).toContainText("Perplexity");
    // The same, from the keyboard: the columns are one tab stop, the arrows move between them.
    const first = daily.getByRole("group", { name: texts.dailyTitle }).getByRole("img").first();
    await first.focus();
    await expect(daily.getByRole("tooltip")).toBeVisible();
    await page.keyboard.press("End");
    await expect(today).toBeFocused();

    // Every value is in its table view too.
    await daily.getByText(admin.dashboard.tableView).click();
    const table = daily.getByRole("table", { name: texts.dailyTitle });
    await expect(table.getByRole("columnheader", { name: "Perplexity" })).toBeVisible();

    // Its detail for the same month, and its settings.
    const month = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit" }).format(new Date());
    await expect(figures.getByRole("link", { name: texts.aiUsageLink })).toHaveAttribute("href", `/admin/consommation-ia?periode=${month}`);
    await expect(figures.getByRole("link", { name: texts.webSearchSettingsLink })).toHaveAttribute("href", /\/admin\/parametres\?tab=/);

    const results = await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map((node) => node.target.join(" ")) }))).toEqual([]);
  });

  test("the « API » block says each configured Tool's quota state: « OK », then « quota épuisé » with its links, then « OK » after an accepted call (#1116)", async ({ page }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    await page.goto("/admin");

    // Mistral, the suite's AI provider, is configured: « OK » while its provider accepts its calls.
    const mistral = toolCard(page, "Mistral AI");
    await expect(apiBlock(page)).toBeVisible();
    await expect(mistral).toContainText(api.states.ok);
    await expect(mistral).toContainText(api.okSub);
    // Tavily has no key here: it is not listed.
    await expect(toolCard(page, "Tavily")).toHaveCount(0);

    await mistralQuotaExhausted(
      async () => {
        await page.reload();
        await expect(mistral).toContainText(api.states.quota_exhausted);
        await expect(mistral).toContainText(api.since.replace(" {{date}}", ""));
        await expect(mistral.getByRole("link", { name: api.configLabel.replace("{{tool}}", "Mistral AI") })).toHaveAttribute("href", "/admin/parametres?tab=ia&fournisseur=mistral");
        const billing = mistral.getByRole("link", { name: api.billingLabel.replace("{{tool}}", "Mistral AI") });
        // Through the Back Office's Exit Page, like every link out of Jobbbox.
        await expect(billing).toHaveAttribute("href", `/admin/sortie?url=${encodeURIComponent("https://console.mistral.ai/billing")}`);
        await expect(billing).toHaveAttribute("target", "_blank");

        // Its table view says the same.
        await apiBlock(page).getByText(admin.dashboard.tableView).click();
        const row = apiBlock(page).getByRole("table", { name: api.tableTitle }).getByRole("row").filter({ hasText: "Mistral AI" });
        await expect(row).toContainText(api.states.quota_exhausted);

        const results = await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
        expect(results.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map((node) => node.target.join(" ")) }))).toEqual([]);
      },
      async () => {
        await page.reload();
        await expect(mistral).toContainText(api.states.ok);
        await expect(mistral).not.toContainText(api.states.quota_exhausted);
      },
    );
  });

  test("a Plans manager sees the « API » block alone, everything « OK » included; Support sees every block", async ({ page, browser }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    const plansManager = newAddress("dashboard-plans");
    const support = newAddress("dashboard-support");
    const plansPage = await personPage(browser, plansManager);
    const supportPage = await personPage(browser, support);
    await grant(page, plansManager, "plans-manager");
    await grant(page, support, "support");

    await plansPage.goto("/admin");
    await expect(plansPage.getByRole("heading", { level: 1 })).toHaveText(admin.dashboard.title);
    await expect(nav(plansPage).getByRole("link").first()).toHaveText(admin.nav.dashboard);
    await expect(apiBlock(plansPage)).toBeVisible();
    await expect(toolCard(plansPage, "Mistral AI")).toContainText(api.states.ok);
    // Neither Paramètres nor Outils for a Plans manager: the billing link alone.
    await expect(toolCard(plansPage, "Mistral AI").getByRole("link")).toHaveCount(1);
    await expect(block(plansPage)).toHaveCount(0);
    await expect(plansPage.getByRole("main")).not.toContainText(texts.webSpend);

    await supportPage.goto("/admin");
    await expect(apiBlock(supportPage)).toBeVisible();
    await expect(block(supportPage)).toBeVisible();
  });
});
