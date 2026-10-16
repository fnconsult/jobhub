import { readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #208: Provider Secrets. Super-admins enter third-party keys in the Back
// Office's Clés section (Plateforme): each is tested with its provider, encrypted,
// and used over env's; cleared, env's is used again. A value is never sent back:
// not in the page, the Journal, the server log, nor the Administrator's data export.
// The specs change only Lusha's key, which the suite's server does not use (its
// Enriched Contacts run on Apollo); the fake Lusha accepts keys starting
// e2e-lusha-valid- and echoes any other back in its refusal.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const admin = fr.admin;
const keys = admin.providerSecrets;
const origin = process.env.E2E_WEB_ORIGIN!;
// Its own permanent super-admin: two sign-ins of one address at once can pick up each other's link.
const SUPER_ADMIN = "keys-office@e2e.jobbbox.test";
const NAME = "LUSHA_API_KEY";

const unique = () => `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
const tr = (template: string, values: Record<string, string>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");

const row = (page: Page, name: string) => page.getByRole("row").filter({ has: page.getByRole("rowheader").filter({ hasText: name }) });

/** Pastes `value` as the new value of `name`, ticking "save anyway" if asked, and submits. */
async function replace(page: Page, name: string, value: string, { saveAnyway = false } = {}) {
  await page.goto("/admin/cles");
  await page.getByText(tr(keys.replaceLegend, { name }), { exact: true }).click();
  await page.getByLabel(tr(keys.newValue, { name })).fill(value);
  if (saveAnyway) await page.locator(`#anyway-${name}`).check();
  await page.getByRole("button", { name: tr(keys.replace, { name }) }).click();
}

/** Everything the server has said so far, and the page's HTML: a value must be in neither. */
async function expectNowhere(page: Page, ...values: string[]) {
  const html = await (await page.request.get("/admin/cles")).text();
  const log = readFileSync(process.env.E2E_SERVER_LOG!, "utf8");
  for (const value of values) {
    expect(html, "page").not.toContain(value);
    expect(await page.content(), "page").not.toContain(value);
    expect(log, "server log").not.toContain(value);
  }
}

async function personPage(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext({ baseURL: origin, locale: "en-US" });
  const page = await context.newPage();
  await signInWithMagicLink(page, email);
  return page;
}

test.describe("Provider Secrets (the Clés section)", () => {
  test.afterEach(async ({ page }) => {
    // Leave the suite's server as it found it: no Lusha key.
    await page.goto("/admin/cles");
    const clear = page.getByRole("button", { name: tr(keys.clear, { name: NAME }) });
    if (await clear.count()) await clear.click();
  });

  test("a super-admin sees each key's source, under Plateforme, and never a value", async ({ page }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    await page.goto("/admin");
    await page.getByRole("navigation", { name: admin.nav.label }).getByRole("link", { name: admin.sections.providerSecrets }).click();

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(keys.title);
    await expect(page).toHaveTitle(`${keys.title} · ${admin.title}`);
    await expect(row(page, "MISTRAL_API_KEY")).toContainText(keys.sources.env);
    await expect(row(page, NAME)).toContainText(keys.sources.missing);
    await expect(row(page, NAME)).toContainText(keys.missingHelp);
    await expect(row(page, "STRIPE_SECRET_KEY")).toContainText(keys.sources.env);
    // The suite's env keys (e2e-mistral-key, sk_test_fake...) are never shown.
    await expectNowhere(page, "e2e-mistral-key", "sk_test_fake", "whsec_test_fake");
  });

  test("a key its provider refuses is not saved; 'save anyway' saves it and is recorded; clearing goes back to env", async ({ page }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    const refused = `e2e-lusha-refused-${unique()}`;

    await replace(page, NAME, refused);
    await expect(page.getByRole("main").getByRole("alert").first()).toHaveText(tr(keys.errors.test_failed, { name: NAME }));
    await expect(page.getByRole("main").getByRole("alert").nth(1)).toHaveText(tr(keys.status, { status: "401" }));
    await expect(row(page, NAME)).toContainText(keys.sources.missing);

    await replace(page, NAME, refused, { saveAnyway: true });
    await expect(page.getByRole("main").getByRole("status")).toHaveText(tr(keys.savedUntested, { name: NAME }));
    await expect(row(page, NAME)).toContainText(keys.sources.database);
    await expect(row(page, NAME)).toContainText(`…${refused.slice(-4)}`);
    await expect(row(page, NAME)).toContainText(SUPER_ADMIN);

    // The Test button checks the key in use: the database's.
    await row(page, NAME).getByRole("button", { name: tr(keys.test, { name: NAME }) }).click();
    await expect(page.getByRole("main").getByRole("alert").first()).toHaveText(tr(keys.testFailed, { name: NAME }));

    await row(page, NAME).getByRole("button", { name: tr(keys.clear, { name: NAME }) }).click();
    await expect(page.getByRole("main").getByRole("status")).toHaveText(tr(keys.cleared, { name: NAME }));
    await expect(row(page, NAME)).toContainText(keys.sources.missing);

    await page.goto("/admin/journal?section=provider_secrets");
    const entries = page.getByRole("row").filter({ hasText: NAME });
    await expect(entries.first()).toContainText(admin.journal.actions.cleared);
    await expect(entries.nth(1)).toContainText(admin.journal.actions.replaced_despite_failed_test);
    await expect(entries.nth(1)).toContainText(admin.journal.secret.replaced_despite_failed_test);
    await expectNowhere(page, refused);
  });

  test("a key that passes its test is used over env, and never sent back: page, Journal, log, data export", async ({ page }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    const valid = `e2e-lusha-valid-${unique()}`;

    await replace(page, NAME, valid);
    await expect(page.getByRole("main").getByRole("status")).toHaveText(tr(keys.saved, { name: NAME }));
    await expect(row(page, NAME)).toContainText(keys.sources.database);
    // The field is write-only: empty again.
    await page.getByText(tr(keys.replaceLegend, { name: NAME }), { exact: true }).click();
    await expect(page.getByLabel(tr(keys.newValue, { name: NAME }))).toHaveValue("");
    await row(page, NAME).getByRole("button", { name: tr(keys.test, { name: NAME }) }).click();
    await expect(page.getByRole("main").getByRole("status")).toHaveText(tr(keys.testPassed, { name: NAME }));

    await page.goto("/admin/journal?section=provider_secrets");
    await expect(page.getByRole("row").filter({ hasText: NAME }).first()).toContainText(admin.journal.secret.replaced);

    await page.goto("/compte");
    const section = page.getByRole("region", { name: fr.accountData.title });
    const [file] = await Promise.all([page.waitForEvent("download"), section.getByRole("link", { name: fr.accountData.export }).click()]);
    const exported = readFileSync((await file.path())!, "utf8");
    expect(exported).toContain(SUPER_ADMIN);
    expect(exported).not.toContain(valid);
    expect(exported).not.toContain(NAME);

    await expectNowhere(page, valid);
  });

  test("only super-admins reach it: Support and Candidates get a 404, and a hand-made save changes nothing", async ({ page, browser }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    const support = newAddress("keys-support");
    const supportPage = await personPage(browser, support);
    await page.goto("/admin/administrateurs");
    await page.getByLabel(admin.administrators.grantEmail).fill(support);
    await page.getByRole("checkbox", { name: admin.roles.support }).check();
    await page.getByRole("button", { name: admin.administrators.grant }).click();
    await expect(page.getByRole("status")).toBeVisible();

    await supportPage.goto("/admin");
    await expect(supportPage.getByRole("navigation", { name: admin.nav.label }).getByRole("link", { name: admin.sections.providerSecrets })).toHaveCount(0);
    expect((await supportPage.goto("/admin/cles"))?.status()).toBe(404);
    const candidate = await personPage(browser, newAddress("keys-candidate"));
    expect((await candidate.goto("/admin/cles"))?.status()).toBe(404);

    // Support replays the super-admin's replace form by hand.
    await page.goto("/admin/cles");
    const form = page.locator("form").filter({ has: page.getByRole("button", { name: tr(keys.replace, { name: NAME }) }) });
    const actionField = await form.locator('input[name^="$ACTION_ID_"]').getAttribute("name");
    expect(actionField).toBeTruthy();
    const forged = await supportPage.request.post("/admin/cles", {
      headers: { origin },
      multipart: { [actionField!]: "", name: NAME, value: `e2e-lusha-valid-${unique()}`, saveAnyway: "on" },
      maxRedirects: 0,
    });
    expect(forged.status()).toBe(404);
    await page.goto("/admin/cles");
    await expect(row(page, NAME)).toContainText(keys.sources.missing);
  });
});
