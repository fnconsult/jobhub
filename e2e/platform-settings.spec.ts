import { readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { Client } from "pg";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #298 (ADR-0033): the Back Office's Paramètres section, under Plateforme, lists every
// Platform Setting with its value in use, its source (Back Office, env, code default) and the
// code default, a value from env that differs from the default flagged; then the settings only
// env holds, secrets never shown. Super-admins and Support only. The e2e server runs with
// ANTHROPIC_ENDPOINT=bedrock, like an older .env (playwright.config.ts).
// Issue #299: super-admins change the Job Digest's and Job discovery's settings there, or
// « Rétablir » them; each save, restore and refused value is in the Journal. Support only reads.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const admin = fr.admin;
const texts = admin.platformSettings;
const page404 = fr.notFound.title;
// Its own permanent super-admin: two sign-ins of one address at once can pick up each other's link.
const SUPER_ADMIN = "settings-office@e2e.jobbbox.test";
const PATH = "/admin/parametres";
/** What the e2e server holds that must never reach a page (playwright.config.ts). */
const SECRETS = ["e2e-only-secret-e2e-only-secret-e2e-only", "ZTJlLW9ubHktbWFzdGVyLWtleS1lMmUtb25seS0wMDA=", "e2e-mistral-key", "sk_test_fake", "whsec_test_fake"];
const origin = process.env.E2E_WEB_ORIGIN!;

const tr = (template: string, values: Record<string, string>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");
const row = (page: Page, name: string) => page.locator(`tr[data-setting="${name}"]`);
/** The setting this spec changes: barely below its default (60), so a worker spec running meanwhile is unaffected. */
const EDITED = "JOB_DIGEST_MIN_MATCH_SCORE";
/** The one editable setting the e2e server has from env (playwright.config.ts): 75, the code's default being 90. */
const FROM_ENV = "JOB_DISCOVERY_BUDGET_SECONDS";

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
  await expect(superAdmin.getByRole("status")).toHaveText(tr(admin.administrators.granted, { roles: admin.roles[role] }));
}

test.describe("Platform Settings (Paramètres)", () => {
  test("a super-admin sees every Platform Setting with its source and default, an env value differing from the default flagged, and no secret", async ({ page }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    await page.goto(PATH);
    await expect(page).toHaveTitle(`${texts.title} · ${admin.title}`);
    const nav = page.getByRole("navigation", { name: admin.nav.label });
    await expect(nav.getByRole("link", { name: admin.sections.platformSettings })).toHaveAttribute("aria-current", "page");
    // Under Plateforme.
    await expect(page.getByRole("list", { name: admin.nav.groups.platform }).getByRole("link", { name: admin.sections.platformSettings })).toBeVisible();

    for (const group of ["ai_routing", "email", "job_digest", "job_discovery", "enriched_contacts", "extension"]) {
      await expect(page.getByRole("heading", { level: 2, name: texts.groups[group] })).toBeVisible();
    }

    // The e2e server's older .env: Claude on Bedrock, from env, differing from the code's default (auto).
    const endpoint = row(page, "ANTHROPIC_ENDPOINT");
    await expect(endpoint.getByRole("cell").nth(0)).toContainText("bedrock");
    await expect(endpoint.getByRole("cell").nth(0)).toContainText(texts.differsFlag);
    await expect(endpoint.getByRole("cell").nth(1)).toHaveText(texts.sources.env);
    await expect(endpoint.getByRole("cell").nth(2)).toHaveText("auto");
    // Nothing sets the Job Digest's target: the code's default, not flagged.
    const target = row(page, "JOB_DIGEST_TARGET_COUNT");
    await expect(target.getByRole("cell").nth(0)).toHaveText("10");
    await expect(target.getByRole("cell").nth(1)).toHaveText(texts.sources.default);
    // AI routing set by env (the e2e server's Mistral routes, Bedrock): counted at the top.
    await expect(page.getByRole("status")).toContainText(texts.differs_other.replace("{{count}} ", ""));

    // The settings only env holds: secrets as set, the master keys by version.
    await expect(row(page, "AUTH_SECRET").getByRole("cell")).toHaveText(texts.envOnly.set);
    await expect(row(page, "SECRETS_MASTER_KEYS").getByRole("cell")).toHaveText(tr(texts.envOnly.keyVersions, { versions: "1" }));
    await expect(row(page, "JOBHUB_TARGET").getByRole("cell")).toHaveText("e2e");
    // MAIL_TRANSPORT=console is expected in e2e: no warning.
    await expect(row(page, "MAIL_TRANSPORT").getByRole("cell")).toHaveText("console");
    await expect(page.getByText(texts.envOnly.mailToConsole)).toHaveCount(0);
    const databaseUrl = await row(page, "DATABASE_URL").getByRole("cell").innerText();
    expect(new URL(databaseUrl).password).toBe("");

    // Links to the settings with a section of their own.
    for (const section of ["planQuotas", "guardrails", "coachCost", "providerSecrets"]) {
      await expect(page.getByRole("main").getByRole("link", { name: admin.sections[section], exact: true })).toBeVisible();
    }

    const html = await (await page.request.get(PATH)).text();
    for (const secret of SECRETS) expect(html).not.toContain(secret);
    const password = new URL(process.env.E2E_DATABASE_URL!).password;
    if (password) expect(html).not.toContain(`:${password}@`);
  });

  test.describe("editing the Job Digest's and Job discovery's settings (#299)", () => {
    // Whatever happens, the worker specs sharing this database find the setting as env and the code leave it.
    test.afterAll(async () => {
      const client = new Client({ connectionString: process.env.E2E_DATABASE_URL });
      await client.connect();
      try {
        await client.query("DELETE FROM platform_setting WHERE name = ANY($1::text[])", [[EDITED, FROM_ENV]]);
        await client.query("SELECT pg_notify('platform_settings_changed', '')");
      } finally {
        await client.end();
      }
    });

    test("a super-admin changes a setting, a value out of its bounds is refused, « Rétablir » goes back to the code's default, all in the Journal", async ({ page }) => {
      await signInWithMagicLink(page, SUPER_ADMIN);
      await page.goto(PATH);
      await expect(page.getByText(texts.editIntro)).toBeVisible();
      const setting = row(page, EDITED);
      const field = setting.getByRole("textbox", { name: tr(texts.newValue, { name: EDITED }) });
      await expect(setting).toContainText(tr(texts.accepted, { rule: tr(texts.rules.whole, { min: "0", max: "100" }) }));
      // AI routing is not editable yet: no field.
      await expect(row(page, "ANTHROPIC_ENDPOINT").getByRole("textbox")).toHaveCount(0);

      await field.fill("59");
      await setting.getByRole("button", { name: texts.save }).click();
      await expect(page.getByRole("status").filter({ hasText: EDITED })).toHaveText(tr(texts.notices.saved, { name: EDITED }));
      await expect(setting.getByRole("cell").nth(0)).toHaveText("59");
      await expect(setting.getByRole("cell").nth(1)).toContainText(texts.sources.back_office);
      await expect(setting.getByRole("cell").nth(1)).toContainText(SUPER_ADMIN);

      await field.fill("120");
      await setting.getByRole("button", { name: texts.save }).click();
      await expect(page.getByRole("alert").filter({ hasText: EDITED })).toHaveText(tr(texts.notices.invalid, { name: EDITED, rule: tr(texts.rules.whole, { min: "0", max: "100" }) }));
      await expect(setting.getByRole("cell").nth(0)).toHaveText("59");

      await setting.getByRole("button", { name: texts.restore }).click();
      await expect(page.getByRole("status").filter({ hasText: EDITED })).toHaveText(tr(texts.notices.restored, { name: EDITED }));
      await expect(setting.getByRole("cell").nth(0)).toHaveText("60");
      await expect(setting.getByRole("cell").nth(1)).toHaveText(texts.sources.default);
      await expect(setting.getByRole("button", { name: texts.restore })).toHaveCount(0);

      await page.goto("/admin/journal?section=platform_settings");
      const entries = page.getByRole("row").filter({ hasText: EDITED }).filter({ hasText: SUPER_ADMIN });
      const value = admin.platformSettings.journalFields.value;
      const source = admin.platformSettings.journalFields.source;
      const saved = entries.filter({ hasText: admin.journal.outcomes.succeeded }).filter({ hasText: admin.journal.actions.updated });
      await expect(saved).toHaveCount(1);
      await expect(saved).toContainText(tr(admin.journal.changed, { field: value, before: "60", after: "59" }));
      await expect(saved).toContainText(tr(admin.journal.changed, { field: source, before: texts.sources.default, after: texts.sources.back_office }));
      const restored = entries.filter({ hasText: admin.journal.actions.restored_to_default });
      await expect(restored).toHaveCount(1);
      await expect(restored).toContainText(tr(admin.journal.changed, { field: value, before: "59", after: "60" }));
      const refused = entries.filter({ hasText: admin.journal.actions.refused });
      await expect(refused).toHaveCount(1);
      await expect(refused).toContainText(tr(admin.journal.failed, { tried: admin.journal.actions.updated, reason: fr.failureReasons.invalid_value }));
      await expect(refused).toContainText(tr(admin.journal.fieldAtFault, { field: value }));
      await expect(refused).not.toContainText("120");
    });

    test("« Rétablir » falls back to the value env holds, not the code's default, and the source follows; the Journal has the before and after of each step", async ({ page }) => {
      await signInWithMagicLink(page, SUPER_ADMIN);
      await page.goto(PATH);
      const setting = row(page, FROM_ENV);
      const field = setting.getByRole("textbox", { name: tr(texts.newValue, { name: FROM_ENV }) });
      await expect(setting.getByRole("cell").nth(0)).toContainText("75");
      await expect(setting.getByRole("cell").nth(1)).toHaveText(texts.sources.env);
      await expect(setting.getByRole("cell").nth(2)).toHaveText("90");
      await expect(setting.getByRole("button", { name: texts.restore })).toHaveCount(0);

      await field.fill("120");
      await setting.getByRole("button", { name: texts.save }).click();
      await expect(page.getByRole("status").filter({ hasText: FROM_ENV })).toHaveText(tr(texts.notices.saved, { name: FROM_ENV }));
      await expect(setting.getByRole("cell").nth(0)).toHaveText("120");
      await expect(setting.getByRole("cell").nth(1)).toContainText(texts.sources.back_office);

      await setting.getByRole("button", { name: texts.restore }).click();
      await expect(page.getByRole("status").filter({ hasText: FROM_ENV })).toHaveText(tr(texts.notices.restored, { name: FROM_ENV }));
      await expect(setting.getByRole("cell").nth(0)).toContainText("75");
      await expect(setting.getByRole("cell").nth(1)).toHaveText(texts.sources.env);
      await expect(setting.getByRole("button", { name: texts.restore })).toHaveCount(0);

      await page.goto("/admin/journal?section=platform_settings");
      const value = texts.journalFields.value;
      const source = texts.journalFields.source;
      const entries = page.getByRole("row").filter({ hasText: FROM_ENV }).filter({ hasText: SUPER_ADMIN });
      const saved = entries.filter({ hasText: admin.journal.actions.updated });
      await expect(saved).toHaveCount(1);
      await expect(saved).toContainText(tr(admin.journal.changed, { field: value, before: "75", after: "120" }));
      await expect(saved).toContainText(tr(admin.journal.changed, { field: source, before: texts.sources.env, after: texts.sources.back_office }));
      const restored = entries.filter({ hasText: admin.journal.actions.restored_to_default });
      await expect(restored).toHaveCount(1);
      await expect(restored).toContainText(tr(admin.journal.changed, { field: value, before: "120", after: "75" }));
      await expect(restored).toContainText(tr(admin.journal.changed, { field: source, before: texts.sources.back_office, after: texts.sources.env }));
    });
  });

  test("Support reads Paramètres; another role is denied it, and that is in the Journal", async ({ page, browser }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    const support = newAddress("settings-support");
    const supportPage = await personPage(browser, support);
    await grant(page, support, "support");
    const plans = newAddress("settings-plans");
    const plansPage = await personPage(browser, plans);
    await grant(page, plans, "plans-manager");

    expect((await supportPage.goto(PATH))?.status()).toBe(200);
    await expect(supportPage.getByRole("heading", { level: 1 })).toHaveText(texts.title);
    await expect(row(supportPage, "ANTHROPIC_ENDPOINT").getByRole("cell").nth(1)).toHaveText(texts.sources.env);
    // Support sees the settings without the edit controls (#299).
    await expect(row(supportPage, EDITED).getByRole("cell").nth(0)).toHaveText(/\d/);
    await expect(supportPage.getByRole("textbox")).toHaveCount(0);
    await expect(supportPage.getByRole("button", { name: texts.save })).toHaveCount(0);
    await expect(supportPage.getByRole("button", { name: texts.restore })).toHaveCount(0);
    // Support cannot open Clés: no link to it.
    await expect(supportPage.getByRole("main").getByRole("link", { name: admin.sections.providerSecrets, exact: true })).toHaveCount(0);

    expect((await plansPage.goto(PATH))?.status()).toBe(404);
    await expect(plansPage.getByRole("heading", { level: 1 })).toHaveText(page404);
    await page.goto(`/admin/journal?section=platform_settings&outcome=failed`);
    const denied = page.getByRole("row").filter({ hasText: plans });
    await expect(denied).toHaveCount(1);
    await expect(denied).toContainText(admin.journal.sections.platform_settings);
    await expect(denied).toContainText(PATH);
    await expect(denied).toContainText(admin.journal.actions.denied);
  });
});
