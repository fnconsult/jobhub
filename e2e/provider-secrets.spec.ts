import { readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #208: Provider Secrets. Super-admins enter third-party keys in the Back
// Office, on each provider's sheet in Paramètres since #396 (formerly the Clés section): each is tested with its provider, encrypted,
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

/** Lusha's sheet, on Paramètres' Enrichissement de contacts tab (#396): its key is the one these specs change. */
const SHEET = "/admin/parametres?tab=enrichissement&fournisseur=lusha";
const sheetOf = (page: Page) => page.locator('aside[data-sheet="lusha"]');
/** A key on the sheet open in `page`. */
const row = (page: Page, name: string) => page.locator(`aside[data-sheet] [data-key="${name}"]`);

/** Pastes `value` as the new value of `name` on Lusha's sheet, ticking "save anyway" if asked, and submits. */
async function replace(page: Page, name: string, value: string, { saveAnyway = false } = {}) {
  await page.goto(SHEET);
  await page.locator("summary", { hasText: tr(keys.replaceLegend, { name }) }).click();
  await page.getByLabel(tr(keys.newValue, { name })).fill(value);
  if (saveAnyway) await page.locator(`#anyway-${name}`).check();
  await page.getByRole("button", { name: tr(keys.replace, { name }) }).click();
}

/** Everything the server has said so far, and the page's HTML: a value must be in neither. */
async function expectNowhere(page: Page, ...values: string[]) {
  const html = await (await page.request.get(SHEET)).text();
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

test.describe("Provider Secrets (on a provider's sheet in Paramètres)", () => {
  test.afterEach(async ({ page }) => {
    // Leave the suite's server as it found it: no Lusha key.
    await page.goto(SHEET);
    const clear = page.getByRole("button", { name: tr(keys.clear, { name: NAME }) });
    if (await clear.count()) await clear.click();
  });

  test("a super-admin sees each key's source on its provider's sheet, and never a value", async ({ page }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    // Clés is no longer in the sidebar: its old address opens the sheet of the provider a key is for (#396).
    await page.goto("/admin");
    await expect(page.getByRole("navigation", { name: admin.nav.label }).getByRole("link", { name: admin.sections.providerSecrets })).toHaveCount(0);
    await page.goto("/admin/cles?key=MISTRAL_API_KEY");
    await expect(page).toHaveURL(/\/admin\/parametres\?tab=ia&fournisseur=mistral$/);
    await expect(page).toHaveTitle(`${fr.admin.platformSettings.title} · ${admin.title}`);
    await expect(row(page, "MISTRAL_API_KEY")).toContainText(keys.sources.env);
    await page.goto("/admin/parametres?tab=paiement&fournisseur=stripe");
    await expect(row(page, "STRIPE_SECRET_KEY")).toContainText(keys.sources.env);
    await expect(row(page, "STRIPE_WEBHOOK_SECRET")).toContainText(keys.sources.env);
    await page.goto(SHEET);
    await expect(row(page, NAME)).toContainText(keys.sources.missing);
    await expect(row(page, NAME)).toContainText(keys.missingHelp);
    // The suite's env keys (e2e-mistral-key, sk_test_fake...) are never shown.
    await expectNowhere(page, "e2e-mistral-key", "sk_test_fake", "whsec_test_fake");
    for (const sheet of ["/admin/parametres?tab=ia&fournisseur=mistral", "/admin/parametres?tab=paiement&fournisseur=stripe"]) {
      const html = await (await page.request.get(sheet)).text();
      for (const value of ["e2e-mistral-key", "sk_test_fake", "whsec_test_fake"]) expect(html).not.toContain(value);
    }
  });

  test("a key its provider refuses is not saved; 'save anyway' saves it and is recorded; clearing goes back to env", async ({ page }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    const refused = `e2e-lusha-refused-${unique()}`;

    await replace(page, NAME, refused);
    await expect(sheetOf(page).getByRole("alert").first()).toHaveText(tr(keys.errors.test_failed, { name: NAME }));
    await expect(sheetOf(page).getByRole("alert").nth(1)).toHaveText(tr(keys.status, { status: "401" }));
    await expect(row(page, NAME)).toContainText(keys.sources.missing);

    await replace(page, NAME, refused, { saveAnyway: true });
    await expect(sheetOf(page).getByRole("status")).toHaveText(tr(keys.savedUntested, { name: NAME }));
    await expect(row(page, NAME)).toContainText(keys.sources.database);
    await expect(row(page, NAME)).toContainText(`…${refused.slice(-4)}`);
    await expect(row(page, NAME)).toContainText(SUPER_ADMIN);

    // The Test button checks the key in use: the database's.
    await row(page, NAME).getByRole("button", { name: tr(keys.test, { name: NAME }) }).click();
    await expect(sheetOf(page).getByRole("alert").first()).toHaveText(tr(keys.testFailed, { name: NAME }));

    await row(page, NAME).getByRole("button", { name: tr(keys.clear, { name: NAME }) }).click();
    await expect(sheetOf(page).getByRole("status")).toHaveText(tr(keys.cleared, { name: NAME }));
    await expect(row(page, NAME)).toContainText(keys.sources.missing);

    await page.goto("/admin/journal?section=provider_secrets");
    const entries = page.getByRole("row").filter({ hasText: NAME });
    await expect(entries.first()).toContainText(admin.journal.actions.cleared);
    // The Test button's failed test, then the save anyway, then the save its test refused (#263).
    await expect(entries.nth(1)).toContainText(admin.journal.actions.tested);
    await expect(entries.nth(1)).toContainText(admin.journal.outcomes.failed);
    await expect(entries.nth(1)).toContainText(fr.failureReasons.test_failed);
    await expect(entries.nth(2)).toContainText(admin.journal.actions.replaced_despite_failed_test);
    await expect(entries.nth(2)).toContainText(admin.journal.secret.replaced_despite_failed_test);
    await expect(entries.nth(2)).toContainText(admin.journal.outcomes.succeeded);
    await expect(entries.nth(3)).toContainText(admin.journal.actions.refused);
    await expect(entries.nth(3)).toContainText(tr(admin.journal.failed, { tried: admin.journal.actions.replaced, reason: fr.failureReasons.test_failed }));
    await expect(entries.nth(3)).toContainText(tr(admin.journal.fieldAtFault, { field: admin.journal.value }));

    // Only the failures, still of this section; each one's technical detail on demand.
    await page.getByRole("navigation", { name: admin.journal.outcomeFilter }).getByRole("link", { name: admin.journal.outcomeFilters.failed }).click();
    await expect(page).toHaveURL(/\/admin\/journal\?section=provider_secrets&outcome=failed$/);
    await expect(entries).toHaveCount(2);
    const detail = entries.nth(1).locator("details");
    await expect(detail.getByText(admin.journal.technical.status)).toBeHidden();
    await detail.getByText(admin.journal.technicalDetail).click();
    await expect(detail.getByText(admin.journal.technical.status)).toBeVisible();
    await expect(detail.getByRole("definition").filter({ hasText: /^401$/ })).toBeVisible();
    await expectNowhere(page, refused);
  });

  test("an empty or too-long value is refused by the form and leaves no entry in the Journal (#263)", async ({ page }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    const entries = () => page.request.get("/admin/journal?section=provider_secrets").then((response) => response.text());
    const count = (html: string) => (html.match(new RegExp(NAME, "g")) ?? []).length;
    const before = count(await entries());

    // Empty: the browser's own `required` is bypassed, as a hand-made request would.
    await page.goto(SHEET);
    await page.locator("summary", { hasText: tr(keys.replaceLegend, { name: NAME }) }).click();
    await page.locator(`#value-${NAME}`).evaluate((input) => input.removeAttribute("required"));
    await page.getByRole("button", { name: tr(keys.replace, { name: NAME }) }).click();
    await expect(sheetOf(page).getByRole("alert").first()).toHaveText(keys.errors.empty);

    // Too long (over 4096 characters).
    await replace(page, NAME, "x".repeat(4097));
    await expect(sheetOf(page).getByRole("alert").first()).toHaveText(keys.errors.too_long);
    await expect(row(page, NAME)).toContainText(keys.sources.missing);

    expect(count(await entries()), "Journal entries").toBe(before);
    await expectNowhere(page, "x".repeat(4097));
  });

  test("a key that passes its test is used over env, and never sent back: page, Journal, log, data export", async ({ page }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    const valid = `e2e-lusha-valid-${unique()}`;

    await replace(page, NAME, valid);
    await expect(sheetOf(page).getByRole("status")).toHaveText(tr(keys.saved, { name: NAME }));
    await expect(row(page, NAME)).toContainText(keys.sources.database);
    // The field is write-only: empty again.
    await page.locator("summary", { hasText: tr(keys.replaceLegend, { name: NAME }) }).click();
    await expect(page.getByLabel(tr(keys.newValue, { name: NAME }))).toHaveValue("");
    await row(page, NAME).getByRole("button", { name: tr(keys.test, { name: NAME }) }).click();
    await expect(sheetOf(page).getByRole("status")).toHaveText(tr(keys.testPassed, { name: NAME }));

    await page.goto("/admin/journal?section=provider_secrets");
    // The Test button's passed test (#263), then the replacement.
    const entries = page.getByRole("row").filter({ hasText: NAME });
    await expect(entries.first()).toContainText(admin.journal.actions.tested);
    await expect(entries.first()).toContainText(admin.journal.outcomes.succeeded);
    await expect(entries.nth(1)).toContainText(admin.journal.secret.replaced);

    await page.goto("/compte/donnees");
    const section = page.getByRole("region", { name: fr.accountData.title });
    const [file] = await Promise.all([page.waitForEvent("download"), section.getByRole("link", { name: fr.accountData.export }).click()]);
    const exported = readFileSync((await file.path())!, "utf8");
    expect(exported).toContain(SUPER_ADMIN);
    expect(exported).not.toContain(valid);
    expect(exported).not.toContain(NAME);

    await expectNowhere(page, valid);
  });

  test("only super-admins change them: Support reads the sheet without its key's actions, Candidates get a 404, and a hand-made save changes nothing", async ({ page, browser }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    const support = newAddress("keys-support");
    const supportPage = await personPage(browser, support);
    await page.goto("/admin/administrateurs");
    await page.getByLabel(admin.administrators.grantEmail).fill(support);
    await page.getByRole("checkbox", { name: admin.roles.support }).check();
    await page.getByRole("button", { name: admin.administrators.grant }).click();
    await expect(page.getByRole("status")).toBeVisible();

    expect((await supportPage.goto(SHEET))?.status()).toBe(200);
    await expect(row(supportPage, NAME)).toContainText(fr.admin.platformSettings.providers.keyMissing);
    await expect(sheetOf(supportPage)).toContainText(fr.admin.platformSettings.sheet.readOnlyKeys);
    await expect(sheetOf(supportPage).getByRole("button")).toHaveCount(0);
    await expect(sheetOf(supportPage).locator("summary")).toHaveCount(0);
    const candidate = await personPage(browser, newAddress("keys-candidate"));
    expect((await candidate.goto("/admin/cles"))?.status()).toBe(404);

    // Support replays the super-admin's replace form by hand.
    await page.goto(SHEET);
    // Folded away (in a closed <details>), so found by its fields rather than its button's role.
    const form = sheetOf(page).locator("form").filter({ has: page.locator(`input[name="name"][value="${NAME}"]`) }).filter({ has: page.locator('input[name="value"]') });
    const actionField = await form.locator('input[name^="$ACTION_ID_"]').getAttribute("name");
    expect(actionField).toBeTruthy();
    const forged = await supportPage.request.post(SHEET, {
      headers: { origin },
      multipart: { [actionField!]: "", tab: "enrichissement", fournisseur: "lusha", name: NAME, value: `e2e-lusha-valid-${unique()}`, saveAnyway: "on" },
      maxRedirects: 0,
    });
    expect(forged.status()).toBe(404);
    await page.goto(SHEET);
    await expect(row(page, NAME)).toContainText(keys.sources.missing);
  });
});
