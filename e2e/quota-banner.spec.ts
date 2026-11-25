/**
 * #1115 — « Quota atteint »: while a Tool's provider refuses it for its quota, every Back Office page opens on a banner
 * for every Administrator, whatever their roles: the Tool, its state and since when, a link to its configuration and
 * one to its provider's billing page. The states are read from the recorded calls (#1114): a refusal is written into
 * AI Usage here, as the AI layer records one. The banner shows on every Back Office page, so this spec runs on a server
 * of its own: on the suite's, it would change the pages (and the screenshots) of every other spec running at the time.
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
const texts = fr.admin.quotaBanner;
// Its own permanent super-admin, on its own server.
const SUPER_ADMIN = "quota-banner-office@e2e.jobbbox.test";
const PORT_OFFSET = 1115;
const BACK_OFFICE_ROLES = ["super-admin", "plans-manager", "coach-manager", "playbook-editor", "help-editor", "platform-manager", "support"];
/** The pages the banner is checked on: the Dashboard, Outils, Paramètres and one unrelated to the Tools, the Journal. */
const PAGES = ["/admin", "/admin/outils", "/admin/parametres", "/admin/activite/actions"];
const MISTRAL_BILLING = "https://console.mistral.ai/billing";

let own: OwnServer;
let database: Pool;

const tr = (template: string, values: Record<string, string>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");

/** A call to Mistral recorded just now: accepted, or refused for `reason`. */
async function recordMistralCall(reason: "quota_exhausted" | null) {
  await database.query(
    `INSERT INTO ai_usage (at, task, provider, endpoint, model, input_tokens, output_tokens, cost_eur, ok, duration_ms, outcome, reason)
     VALUES (now(), 'offer_analysis', 'mistral', 'api.mistral.ai', 'mistral-small-latest', 0, 0, 0, $1, 300, $2, $3)`,
    [reason === null, reason === null ? "ok" : "failed", reason],
  );
}

/** `email` signed in on the spec's server, in a context of its own. */
async function signedIn(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext({ baseURL: own.origin, locale: "fr-FR", colorScheme: "light" })).newPage();
  await signInByEmail(page, own, email);
  return page;
}

const banner = (page: Page) => page.locator('[data-alert="quota"]');

/** Opens the Back Office page at `path`, checking it was drawn: its own title, not the error page's. */
async function open(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1 }), path).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: fr.errorPage.error.title }), `${path} drawn`).toHaveCount(0);
}

test.beforeAll(async () => {
  own = await startOwnServer(PORT_OFFSET, "quota_banner", {
    JOBHUB_TARGET: "e2e",
    JOBHUB_IGNORE_ROOT_ENV: "1",
    ADMIN_EMAILS: SUPER_ADMIN,
    AUTH_SECRET: "quota-banner-e2e-secret-quota-banner-e2e-secret",
    MAIL_TRANSPORT: "console",
    AI_SCORING_PROVIDER: "mistral",
    AI_WRITING_PROVIDER: "mistral",
    AI_COACHING_PROVIDER: "mistral",
    MISTRAL_API_KEY: "e2e-mistral-key",
    // The Journal reads the Plans, kept in Stripe: the suite's fake Stripe.
    STRIPE_SECRET_KEY: "sk_test_fake",
    STRIPE_WEBHOOK_SECRET: "whsec_test_fake",
    STRIPE_PRICE_STANDARD: "price_standard_monthly",
    STRIPE_PRICE_PREMIUM: "price_premium_monthly",
    STRIPE_API_URL: process.env.E2E_STRIPE_URL!,
    NODE_OPTIONS: ["fake-mistral.mjs", "fake-reference-data.mjs"].map((file) => `--import=${path.resolve("e2e/support", file)}`).join(" "),
  });
  database = new Pool({ connectionString: own.databaseUrl });
});

test.afterAll(async () => {
  await database?.end();
  await own?.stop();
});

test.describe.configure({ mode: "serial" });

test("no banner while no Tool has reached its quota; once Mistral's is used up, it heads every Back Office page until a call is accepted again", async ({ browser }) => {
  test.setTimeout(240_000);
  const page = await signedIn(browser, SUPER_ADMIN);

  for (const path of PAGES) {
    await open(page, path);
    await expect(banner(page), `no banner on ${path}`).toHaveCount(0);
  }

  await recordMistralCall("quota_exhausted");
  for (const path of PAGES) {
    await open(page, path);
    const quota = banner(page);
    await expect(quota, `the banner on ${path}`).toBeVisible();
    await expect(quota).toHaveAttribute("role", "status");
    await expect(quota).toHaveAttribute("data-tone", "warn");
    await expect(quota.getByText(texts.title, { exact: true })).toBeVisible();
    await expect(quota.getByRole("listitem")).toHaveCount(1);
    await expect(quota.getByRole("listitem")).toContainText(`Mistral AI : ${texts.states.quota_exhausted} depuis le `);
    // At the head of the page: the first thing in its <main>.
    await expect(page.locator("main > :first-child")).toHaveClass("quota-banner");
  }

  // Its two links: Mistral's sheet in Paramètres, where its key is entered, and its billing page, through the Exit Page.
  await page.goto("/admin/activite/actions");
  const billing = banner(page).getByRole("link", { name: `${tr(texts.billing, { tool: "Mistral AI" })} ${texts.newTab}` });
  await expect(billing).toHaveAttribute("href", `/admin/sortie?url=${encodeURIComponent(MISTRAL_BILLING)}`);
  await expect(billing).toHaveAttribute("target", "_blank");
  const exit = await page.context().newPage();
  await exit.goto(`/admin/sortie?url=${encodeURIComponent(MISTRAL_BILLING)}`);
  await expect(exit.getByRole("link", { name: tr(fr.errorPage.exit.continue, { site: "console.mistral.ai" }) })).toHaveAttribute("href", MISTRAL_BILLING);
  await exit.close();

  await banner(page).getByRole("link", { name: tr(texts.configure, { tool: "Mistral AI" }) }).click();
  await expect(page).toHaveURL(`${own.origin}/admin/parametres?tab=ia&fournisseur=mistral`);
  await expect(page.getByRole("dialog")).toContainText("Mistral AI");

  // Accessible, in light and in dark: axe, and every text of the banner at AA.
  for (const theme of ["light", "dark"] as const) {
    await page.goto("/admin");
    await showInTheme(page, theme);
    const results = await new AxeBuilder({ page }).include('[data-alert="quota"]').withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map((node) => node.target.join(" ")) })), theme).toEqual([]);
    await expectTextContrast(page, `the quota banner in ${theme}`);
  }

  // A call accepted: the state is ok again, and the banner is gone at the next page.
  await recordMistralCall(null);
  for (const path of PAGES) {
    await open(page, path);
    await expect(banner(page), `no banner on ${path} once ok`).toHaveCount(0);
  }
});

test("every Back Office Role sees the banner, in its reader's language, linking to the configuration only where they may go", async ({ browser }) => {
  test.setTimeout(240_000);
  const email = newAddress("quota-banner-role");
  const page = await signedIn(browser, email);
  const { id } = (await database.query<{ id: string }>("SELECT id FROM candidate WHERE lower(email) = lower($1)", [email])).rows[0]!;
  await recordMistralCall("quota_exhausted");

  for (const role of BACK_OFFICE_ROLES) {
    await database.query("DELETE FROM administrator_role WHERE candidate_id = $1", [id]);
    await database.query("INSERT INTO administrator_role (candidate_id, role) VALUES ($1, $2)", [id, role]);
    await page.goto("/admin");
    await setUpTwoStepVerificationIfAsked(page);
    if (!page.url().endsWith("/admin")) await page.goto("/admin");
    const quota = banner(page);
    await expect(quota, role).toBeVisible();
    await expect(quota.getByRole("link", { name: new RegExp(tr(texts.billing, { tool: "Mistral AI" })) }), role).toBeVisible();
    const configures = ["super-admin", "platform-manager", "support"].includes(role);
    await expect(quota.getByRole("link", { name: tr(texts.configure, { tool: "Mistral AI" }) }), role).toHaveCount(configures ? 1 : 0);
  }

  // In English for a reader who reads the app in English.
  const switched = await page.request.post("/api/auth/update-user", { data: { interfaceLanguage: "en" }, headers: { origin: own.origin } });
  expect(switched.ok()).toBe(true);
  await page.goto("/admin");
  const quota = banner(page);
  await expect(quota.getByText(en.admin.quotaBanner.title, { exact: true })).toBeVisible();
  await expect(quota.getByRole("listitem")).toContainText(`Mistral AI: ${en.admin.quotaBanner.states.quota_exhausted} since `);
  await expect(quota.getByRole("link", { name: `${tr(en.admin.quotaBanner.billing, { tool: "Mistral AI" })} ${en.admin.quotaBanner.newTab}` })).toBeVisible();

  await recordMistralCall(null);
});
