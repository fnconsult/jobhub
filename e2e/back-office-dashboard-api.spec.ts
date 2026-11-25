/**
 * #1116 — the Dashboard's « API » block: every Administrator, whatever their roles, sees on /admin the quota state of
 * each configured Tool with a quota (#1114), « OK » included, with since when, its renewal date when its provider gave
 * one, and the « Quota atteint » banner's two links (#1115). The states are read from the recorded calls: a refusal is
 * written into AI Usage here, as the AI layer records one. Like e2e/quota-banner.spec.ts, it runs on a server of its
 * own: on the suite's, specs side by side record refused calls, and the block's states would be theirs too.
 */
import path from "node:path";
import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { Pool } from "pg";
import { startOwnServer, signInByEmail, type OwnServer } from "./support/own-server";
import { setUpTwoStepVerificationIfAsked } from "./support/candidate";
import { newAddress } from "./support/mailbox";
import { showInTheme, expectTextContrast } from "./support/theme";

const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const en = JSON.parse(readFileSync("packages/shared/src/i18n/locales/en.json", "utf8"));
const api = fr.admin.dashboard.api;
// Its own permanent super-admin, on its own server.
const SUPER_ADMIN = "dashboard-api-office@e2e.jobbbox.test";
const PORT_OFFSET = 1116;
const BACK_OFFICE_ROLES = ["super-admin", "plans-manager", "coach-manager", "playbook-editor", "help-editor", "platform-manager", "support"];
const MISTRAL_BILLING = "https://console.mistral.ai/billing";

let own: OwnServer;
let database: Pool;

const tr = (template: string, values: Record<string, string>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");

/** A call to Mistral recorded just now: accepted, or refused for its quota with the renewal date its provider gave. */
async function recordMistralCall(refused: { renewsAt: Date } | null) {
  await database.query(
    `INSERT INTO ai_usage (at, task, provider, endpoint, model, input_tokens, output_tokens, cost_eur, ok, duration_ms, outcome, reason, renews_at)
     VALUES (now(), 'offer_analysis', 'mistral', 'api.mistral.ai', 'mistral-small-latest', 0, 0, 0, $1, 300, $2, $3, $4)`,
    [refused === null, refused === null ? "ok" : "failed", refused === null ? null : "quota_exhausted", refused?.renewsAt ?? null],
  );
}

/** `email` signed in on the spec's server, in a context of its own. */
async function signedIn(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext({ baseURL: own.origin, locale: "fr-FR", colorScheme: "light" })).newPage();
  await signInByEmail(page, own, email);
  return page;
}

const apiBlock = (page: Page, title = api.title) => page.getByRole("region", { name: new RegExp(`^${title} ·`) });
/** A Tool's card in the « API » block. */
const toolCard = (page: Page, name: string) => apiBlock(page).locator("[data-stat]").filter({ has: page.getByRole("term").filter({ hasText: name }) });

test.beforeAll(async () => {
  own = await startOwnServer(PORT_OFFSET, "dashboard_api", {
    JOBHUB_TARGET: "e2e",
    JOBHUB_IGNORE_ROOT_ENV: "1",
    ADMIN_EMAILS: SUPER_ADMIN,
    AUTH_SECRET: "dashboard-api-e2e-secret-dashboard-api-e2e-secret",
    MAIL_TRANSPORT: "console",
    AI_SCORING_PROVIDER: "mistral",
    AI_WRITING_PROVIDER: "mistral",
    AI_COACHING_PROVIDER: "mistral",
    // Mistral configured; Tavily and every other Tool with a quota without its key.
    MISTRAL_API_KEY: "e2e-mistral-key",
    NODE_OPTIONS: ["fake-mistral.mjs", "fake-reference-data.mjs"].map((file) => `--import=${path.resolve("e2e/support", file)}`).join(" "),
  });
  database = new Pool({ connectionString: own.databaseUrl });
});

test.afterAll(async () => {
  await database?.end();
  await own?.stop();
});

test.describe.configure({ mode: "serial" });

test("the « API » block says Mistral « OK », then « quota épuisé » with since when, its renewal and its links, then « OK » after an accepted call", async ({ browser }) => {
  test.setTimeout(240_000);
  const page = await signedIn(browser, SUPER_ADMIN);
  await page.goto("/admin");

  // Configured and accepted: « OK ». Tavily has no key here: not listed.
  const mistral = toolCard(page, "Mistral AI");
  await expect(apiBlock(page)).toBeVisible();
  await expect(mistral.getByRole("definition").first()).toHaveText(api.states.ok);
  await expect(mistral).toContainText(api.okSub);
  await expect(toolCard(page, "Tavily")).toHaveCount(0);
  // Not a status of its own: the page's status messages stay the page's (#1115's banner is the one quota status).
  await expect(apiBlock(page).getByRole("status")).toHaveCount(0);

  const renewsAt = new Date(Date.now() + 7 * 24 * 3600_000);
  await recordMistralCall({ renewsAt });
  await page.reload();
  await expect(mistral.getByRole("definition").first()).toHaveText(api.states.quota_exhausted);
  await expect(mistral).toContainText(api.since.replace(" {{date}}", ""));
  await expect(mistral).toContainText(api.renewsAt.replace(" {{date}}", ""));
  await expect(mistral).not.toContainText(api.okSub);

  // Its two links, the banner's: Mistral's sheet in Paramètres, and its billing page in a new tab, through the Exit Page.
  await expect(mistral.getByRole("link", { name: tr(api.configLabel, { tool: "Mistral AI" }) })).toHaveAttribute("href", "/admin/parametres?tab=ia&fournisseur=mistral");
  const billing = mistral.getByRole("link", { name: tr(api.billingLabel, { tool: "Mistral AI" }) });
  await expect(billing).toHaveAttribute("href", `/admin/sortie?url=${encodeURIComponent(MISTRAL_BILLING)}`);
  await expect(billing).toHaveAttribute("target", "_blank");
  await expect(billing).toHaveText(api.billing);

  // Its table view says the same.
  await apiBlock(page).getByText(fr.admin.dashboard.tableView).click();
  const row = apiBlock(page).getByRole("table", { name: api.tableTitle }).getByRole("row").filter({ hasText: "Mistral AI" });
  await expect(row).toContainText(api.states.quota_exhausted);
  await expect(row.getByRole("link", { name: tr(api.billingLabel, { tool: "Mistral AI" }) })).toHaveAttribute("href", `/admin/sortie?url=${encodeURIComponent(MISTRAL_BILLING)}`);

  // Accessible, in light and in dark: axe on the block, every text of the page at AA.
  for (const theme of ["light", "dark"] as const) {
    await showInTheme(page, theme);
    const results = await new AxeBuilder({ page }).include(".dashboard-api").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map((node) => node.target.join(" ")) })), theme).toEqual([]);
    await expectTextContrast(page, `the « API » block in ${theme}`);
  }

  // A call accepted: « OK » again, its links still there.
  await recordMistralCall(null);
  await page.reload();
  await expect(mistral.getByRole("definition").first()).toHaveText(api.states.ok);
  await expect(mistral).not.toContainText(api.states.quota_exhausted);
  await expect(mistral.getByRole("link", { name: tr(api.billingLabel, { tool: "Mistral AI" }) })).toBeVisible();
});

test("every Back Office Role sees the block, everything « OK », in its reader's language, linking to the configuration only where they may go", async ({ browser }) => {
  test.setTimeout(240_000);
  const email = newAddress("dashboard-api-role");
  const page = await signedIn(browser, email);
  const { id } = (await database.query<{ id: string }>("SELECT id FROM candidate WHERE lower(email) = lower($1)", [email])).rows[0]!;

  for (const role of BACK_OFFICE_ROLES) {
    await database.query("DELETE FROM administrator_role WHERE candidate_id = $1", [id]);
    await database.query("INSERT INTO administrator_role (candidate_id, role) VALUES ($1, $2)", [id, role]);
    await page.goto("/admin");
    await setUpTwoStepVerificationIfAsked(page);
    if (!page.url().endsWith("/admin")) await page.goto("/admin");
    const mistral = toolCard(page, "Mistral AI");
    await expect(apiBlock(page), role).toBeVisible();
    await expect(mistral.getByRole("definition").first(), role).toHaveText(api.states.ok);
    await expect(mistral.getByRole("link", { name: tr(api.billingLabel, { tool: "Mistral AI" }) }), role).toBeVisible();
    const configures = ["super-admin", "platform-manager", "support"].includes(role);
    await expect(mistral.getByRole("link", { name: tr(api.configLabel, { tool: "Mistral AI" }) }), role).toHaveCount(configures ? 1 : 0);
  }

  // In English for a reader who reads the app in English.
  const switched = await page.request.post("/api/auth/update-user", { data: { interfaceLanguage: "en" }, headers: { origin: own.origin } });
  expect(switched.ok()).toBe(true);
  await page.goto("/admin");
  const english = en.admin.dashboard.api;
  const mistral = apiBlock(page, english.title).locator("[data-stat]").filter({ hasText: "Mistral AI" });
  await expect(mistral.getByRole("definition").first()).toHaveText(english.states.ok);
  await expect(mistral).toContainText(english.okSub);
  await expect(mistral.getByRole("link", { name: tr(english.billingLabel, { tool: "Mistral AI" }) })).toHaveText(english.billing);
});
