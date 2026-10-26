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
// Issue #301: they change AI routing too, each change checked as the AI layer would build it: a
// route with personal data outside the EU is refused with its reason, and a model typed is tested
// with a call (the fake Mistral refuses a model named "…inexistant…", e2e/support/fake-mistral.mjs).
// Issue #300: and MAIL_FROM, refused unless it names one email sender; MAIL_TRANSPORT stays read-only. Saving one
// and the emails sent with it are in job-digest.spec.ts: the one spec that changes MAIL_FROM.
// Issue #303: they set the extension's Chrome Web Store page there, an https URL only; Mon compte's
// Outils offers it within seconds, and « coming soon » again once it is « Rétablir »'d (the e2e server
// sets no EXTENSION_STORE_URL).
// Issue #396: each setting is on the tab of its kind of Tool (?tab=), the settings only env holds on Environnement.
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
  test("a super-admin sees every Platform Setting with its source and default on its tab, an env value differing from the default flagged, and no secret", async ({ page }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    await page.goto(PATH);
    await expect(page).toHaveTitle(`${texts.title} · ${admin.title}`);
    const nav = page.getByRole("navigation", { name: admin.nav.label });
    await expect(nav.getByRole("link", { name: admin.sections.platformSettings })).toHaveAttribute("aria-current", "page");
    // Under Plateforme.
    await expect(page.getByRole("list", { name: admin.nav.groups.platform }).getByRole("link", { name: admin.sections.platformSettings })).toBeVisible();

    // The e2e server's older .env: Claude on Bedrock, from env, differing from the code's default (auto). On the IA tab (#396).
    await page.goto(`${PATH}?tab=ia`);
    const endpoint = row(page, "ANTHROPIC_ENDPOINT");
    await expect(endpoint.getByRole("cell").nth(0)).toContainText("bedrock");
    await expect(endpoint.getByRole("cell").nth(0)).toContainText(texts.differsFlag);
    await expect(endpoint.getByRole("cell").nth(1)).toHaveText(texts.sources.env);
    await expect(endpoint.getByRole("cell").nth(2)).toHaveText("auto");
    // AI routing set by env (the e2e server's Mistral routes, Bedrock): counted at the top.
    await expect(page.getByRole("status").filter({ hasText: texts.differs_other.replace("{{count}} ", "") })).toBeVisible();
    // Nothing sets the Job Digest's target: the code's default, not flagged. On the Sources tab.
    await page.goto(`${PATH}?tab=sources`);
    const target = row(page, "JOB_DIGEST_TARGET_COUNT");
    await expect(target.getByRole("cell").nth(0)).toHaveText("10");
    await expect(target.getByRole("cell").nth(1)).toHaveText(texts.sources.default);

    // The settings only env holds, on Environnement, each with why it stays there: secrets as set, the master keys by version.
    await page.goto(`${PATH}?tab=environnement`);
    await expect(row(page, "AUTH_SECRET").getByRole("cell").nth(0)).toHaveText(texts.envOnly.set);
    await expect(row(page, "AUTH_SECRET").getByRole("cell").nth(1)).toHaveText(texts.environment.kinds.bootstrap);
    await expect(row(page, "SECRETS_MASTER_KEYS").getByRole("cell").nth(0)).toHaveText(tr(texts.envOnly.keyVersions, { versions: "1" }));
    await expect(row(page, "JOBHUB_TARGET").getByRole("cell").nth(0)).toHaveText("e2e");
    // MAIL_TRANSPORT=console is expected in e2e: no warning.
    await expect(row(page, "MAIL_TRANSPORT").getByRole("cell").nth(0)).toHaveText("console");
    await expect(row(page, "MAIL_TRANSPORT").getByRole("cell").nth(1)).toHaveText(texts.environment.kinds.read_only);
    await expect(page.getByText(texts.envOnly.mailToConsole)).toHaveCount(0);
    const databaseUrl = await row(page, "DATABASE_URL").getByRole("cell").nth(0).innerText();
    expect(new URL(databaseUrl).password).toBe("");
    // Links to the settings with a section of their own; the keys are on each provider's sheet now.
    for (const section of ["planQuotas", "guardrails", "coachCost"]) {
      await expect(page.getByRole("main").getByRole("link", { name: admin.sections[section], exact: true })).toBeVisible();
    }

    for (const tab of ["recherche-web", "ia", "sources", "enrichissement", "e-mail", "paiement", "connexion", "extension", "environnement"]) {
      const html = await (await page.request.get(`${PATH}?tab=${tab}`)).text();
      for (const secret of SECRETS) expect(html, tab).not.toContain(secret);
      const password = new URL(process.env.E2E_DATABASE_URL!).password;
      if (password) expect(html, tab).not.toContain(`:${password}@`);
    }
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
      await page.goto(`${PATH}?tab=sources`);
      await expect(page.getByText(texts.editIntro)).toBeVisible();
      const setting = row(page, EDITED);
      const field = setting.getByRole("textbox", { name: tr(texts.newValue, { name: EDITED }) });
      await expect(setting).toContainText(tr(texts.accepted, { rule: tr(texts.rules.whole, { min: "0", max: "100" }) }));
      // MAIL_TRANSPORT stays env's, read-only: no field.
      await expect(row(page, "MAIL_TRANSPORT").getByRole("textbox")).toHaveCount(0);

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
      await page.goto(`${PATH}?tab=sources`);
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

  test.describe("editing AI routing, checked on save (#301)", () => {
    const AI_SETTINGS = ["ANTHROPIC_ENDPOINT", "BEDROCK_REGION", "AI_SCORING_PROVIDER", "AI_SCORING_MODEL"];
    // Whatever happens, the specs sharing this server find the AI routing as env leaves it.
    test.afterAll(async () => {
      const client = new Client({ connectionString: process.env.E2E_DATABASE_URL });
      await client.connect();
      try {
        await client.query("DELETE FROM platform_setting WHERE name = ANY($1::text[])", [AI_SETTINGS]);
        await client.query("SELECT pg_notify('platform_settings_changed', '')");
      } finally {
        await client.end();
      }
    });

    /** Saves `value` as `name` in its row: picked from its list, or typed. */
    async function save(page: Page, name: string, value: string) {
      const setting = row(page, name);
      const label = tr(texts.newValue, { name });
      // A choice is a list; a text field is a textbox, a model's a combobox (its known models suggested).
      const field = setting.getByLabel(label);
      if ((await setting.locator("select").count()) > 0) await field.selectOption(value);
      else await field.fill(value);
      await setting.getByRole("button", { name: texts.save }).click();
    }

    const refusedNotice = (name: string, reason: string) => tr(texts.notices.refused, { name, reason: fr.failureReasons[reason] });

    test("switching ANTHROPIC_ENDPOINT from bedrock to auto is saved and « Rétablir » goes back to env's, both in the Journal", async ({ page }) => {
      await signInWithMagicLink(page, SUPER_ADMIN);
      await page.goto(`${PATH}?tab=ia`);
      const setting = row(page, "ANTHROPIC_ENDPOINT");
      await expect(setting).toContainText(tr(texts.accepted, { rule: tr(texts.rules.choice, { values: "auto, bedrock, vertex, direct" }) }));

      await save(page, "ANTHROPIC_ENDPOINT", "auto");
      await expect(page.getByRole("status").filter({ hasText: "ANTHROPIC_ENDPOINT" })).toHaveText(tr(texts.notices.saved, { name: "ANTHROPIC_ENDPOINT" }));
      await expect(setting.getByRole("cell").nth(0)).toHaveText("auto");
      await expect(setting.getByRole("cell").nth(1)).toContainText(texts.sources.back_office);

      await setting.getByRole("button", { name: texts.restore }).click();
      await expect(page.getByRole("status").filter({ hasText: "ANTHROPIC_ENDPOINT" })).toHaveText(tr(texts.notices.restored, { name: "ANTHROPIC_ENDPOINT" }));
      await expect(setting.getByRole("cell").nth(0)).toContainText("bedrock");
      await expect(setting.getByRole("cell").nth(1)).toHaveText(texts.sources.env);

      await page.goto("/admin/journal?section=platform_settings");
      const entries = page.getByRole("row").filter({ hasText: "ANTHROPIC_ENDPOINT" }).filter({ hasText: SUPER_ADMIN });
      const value = texts.journalFields.value;
      await expect(entries.filter({ hasText: admin.journal.actions.updated })).toContainText(tr(admin.journal.changed, { field: value, before: "bedrock", after: "auto" }));
      await expect(entries.filter({ hasText: admin.journal.actions.restored_to_default })).toContainText(tr(admin.journal.changed, { field: value, before: "auto", after: "bedrock" }));
    });

    test("a task with personal data routed outside the EU is refused on save with the reason shown, and in the Journal", async ({ page }) => {
      await signInWithMagicLink(page, SUPER_ADMIN);
      await page.goto(`${PATH}?tab=ia`);
      // Claude on Bedrock in a US region: no task runs on Claude here, so this alone is accepted.
      await save(page, "BEDROCK_REGION", "us-east-1");
      await expect(page.getByRole("status").filter({ hasText: "BEDROCK_REGION" })).toHaveText(tr(texts.notices.saved, { name: "BEDROCK_REGION" }));

      // Scoring reads the Candidate's CV: it may not go there.
      await save(page, "AI_SCORING_PROVIDER", "anthropic");
      const notice = page.getByRole("alert").filter({ hasText: "AI_SCORING_PROVIDER" });
      await expect(notice).toContainText(refusedNotice("AI_SCORING_PROVIDER", "data_residency"));
      await expect(notice).toContainText("bedrock us-east-1");
      await expect(row(page, "AI_SCORING_PROVIDER").getByRole("cell").nth(0)).toContainText("mistral");
      await expect(row(page, "AI_SCORING_PROVIDER").getByRole("cell").nth(1)).toHaveText(texts.sources.env);

      await row(page, "BEDROCK_REGION").getByRole("button", { name: texts.restore }).click();
      await expect(page.getByRole("status").filter({ hasText: "BEDROCK_REGION" })).toHaveText(tr(texts.notices.restored, { name: "BEDROCK_REGION" }));

      await page.goto("/admin/journal?section=platform_settings&outcome=failed");
      const refused = page.getByRole("row").filter({ hasText: "AI_SCORING_PROVIDER" }).filter({ hasText: SUPER_ADMIN });
      await expect(refused).toHaveCount(1);
      await expect(refused).toContainText(tr(admin.journal.failed, { tried: admin.journal.actions.updated, reason: fr.failureReasons.data_residency }));
    });

    test("a typed model that does not exist fails its test call and is not saved", async ({ page }) => {
      await signInWithMagicLink(page, SUPER_ADMIN);
      await page.goto(`${PATH}?tab=ia`);
      const setting = row(page, "AI_SCORING_MODEL");
      await expect(setting).toContainText(tr(texts.accepted, { rule: tr(texts.rules.model, { provider: "mistral" }) }));
      // The provider's known models are offered, any other can be typed.
      await expect(setting.locator("datalist option[value='mistral-large-latest']")).toHaveCount(1);

      await save(page, "AI_SCORING_MODEL", "mistral-inexistant-9");
      const notice = page.getByRole("alert").filter({ hasText: "AI_SCORING_MODEL" });
      await expect(notice).toContainText(refusedNotice("AI_SCORING_MODEL", "test_failed"));
      await expect(notice).toContainText("Invalid model");
      await expect(setting.getByRole("cell").nth(0)).toHaveText(texts.empty);
      await expect(setting.getByRole("cell").nth(1)).toHaveText(texts.sources.default);

      await page.goto("/admin/journal?section=platform_settings&outcome=failed");
      const refused = page.getByRole("row").filter({ hasText: "AI_SCORING_MODEL" }).filter({ hasText: SUPER_ADMIN });
      await expect(refused).toHaveCount(1);
      await expect(refused).toContainText(tr(admin.journal.failed, { tried: admin.journal.actions.updated, reason: fr.failureReasons.test_failed }));
      await expect(refused).not.toContainText("mistral-inexistant-9");
    });
  });

  test.describe("editing the extension's store page (#303)", () => {
    const STORE = "EXTENSION_STORE_URL";
    const PAGE = "https://chromewebstore.google.com/detail/jobbbox/abcdefghijklmnopabcdefghijklmnop";
    // Whatever happens, the specs sharing this server find no store page, as env leaves it.
    test.afterAll(async () => {
      const client = new Client({ connectionString: process.env.E2E_DATABASE_URL });
      await client.connect();
      try {
        await client.query("DELETE FROM platform_setting WHERE name = $1", [STORE]);
        await client.query("SELECT pg_notify('platform_settings_changed', '')");
      } finally {
        await client.end();
      }
    });

    test("a saved https URL is offered in Mon compte without a restart, a non-https one is refused, « Rétablir » shows « coming soon » again, all in the Journal", async ({ page, browser }) => {
      const candidate = await personPage(browser, newAddress("store-page"));
      const extension = candidate.getByRole("region", { name: fr.account.tools.extensionTitle });
      const install = extension.getByRole("link", { name: fr.account.tools.install });
      await candidate.goto("/compte/outils");
      await expect(extension.getByText(fr.account.tools.soon)).toBeVisible();
      await expect(install).toHaveCount(0);

      await signInWithMagicLink(page, SUPER_ADMIN);
      await page.goto(`${PATH}?tab=extension`);
      const setting = row(page, STORE);
      const field = setting.getByRole("textbox", { name: tr(texts.newValue, { name: STORE }) });
      await expect(setting).toContainText(tr(texts.accepted, { rule: texts.rules.url }));
      await expect(setting.getByRole("cell").nth(1)).toHaveText(texts.sources.default);

      await field.fill("http://chromewebstore.google.com/detail/jobbbox");
      await setting.getByRole("button", { name: texts.save }).click();
      await expect(page.getByRole("alert").filter({ hasText: STORE })).toHaveText(tr(texts.notices.invalid, { name: STORE, rule: texts.rules.url }));
      await expect(setting.getByRole("cell").nth(0)).toHaveText(texts.empty);

      await field.fill(PAGE);
      await setting.getByRole("button", { name: texts.save }).click();
      await expect(page.getByRole("status").filter({ hasText: STORE })).toHaveText(tr(texts.notices.saved, { name: STORE }));
      await expect(setting.getByRole("cell").nth(0)).toHaveText(PAGE);
      await expect(setting.getByRole("cell").nth(1)).toContainText(texts.sources.back_office);

      // Mon compte reads it through the resolver: in use within seconds, no restart.
      await expect(async () => {
        await candidate.reload();
        await expect(install).toHaveAttribute("href", PAGE, { timeout: 1_000 });
      }).toPass({ timeout: 15_000 });
      await expect(extension.getByText(fr.account.tools.soon)).toHaveCount(0);

      await setting.getByRole("button", { name: texts.restore }).click();
      await expect(page.getByRole("status").filter({ hasText: STORE })).toHaveText(tr(texts.notices.restored, { name: STORE }));
      await expect(setting.getByRole("cell").nth(0)).toHaveText(texts.empty);
      await expect(setting.getByRole("cell").nth(1)).toHaveText(texts.sources.default);

      await expect(async () => {
        await candidate.reload();
        await expect(extension.getByText(fr.account.tools.soon)).toBeVisible({ timeout: 1_000 });
      }).toPass({ timeout: 15_000 });
      await expect(install).toHaveCount(0);

      await page.goto("/admin/journal?section=platform_settings");
      const value = texts.journalFields.value;
      const entries = page.getByRole("row").filter({ hasText: STORE }).filter({ hasText: SUPER_ADMIN });
      const saved = entries.filter({ hasText: admin.journal.actions.updated }).filter({ hasText: admin.journal.outcomes.succeeded });
      await expect(saved).toHaveCount(1);
      await expect(saved).toContainText(tr(admin.journal.changed, { field: value, before: admin.journal.empty, after: PAGE }));
      const restored = entries.filter({ hasText: admin.journal.actions.restored_to_default });
      await expect(restored).toHaveCount(1);
      await expect(restored).toContainText(tr(admin.journal.changed, { field: value, before: PAGE, after: admin.journal.empty }));
      const refused = entries.filter({ hasText: admin.journal.actions.refused });
      await expect(refused).toHaveCount(1);
      await expect(refused).toContainText(tr(admin.journal.failed, { tried: admin.journal.actions.updated, reason: fr.failureReasons.invalid_value }));
      await expect(refused).not.toContainText("http://chromewebstore.google.com");
    });
  });

  test("a sender MAIL_FROM does not take is refused and in the Journal without it; MAIL_TRANSPORT has no field (#300)", async ({ page }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    await page.goto(`${PATH}?tab=e-mail`);
    const setting = row(page, "MAIL_FROM");
    const before = (await setting.getByRole("cell").nth(0).innerText()).trim();
    await expect(setting).toContainText(tr(texts.accepted, { rule: texts.rules.sender }));
    await expect(row(page, "MAIL_TRANSPORT").getByRole("textbox")).toHaveCount(0);
    await expect(row(page, "MAIL_TRANSPORT").getByRole("button")).toHaveCount(0);

    const refusedSender = `Jobbbox <refused-${Date.now()}>`;
    await setting.getByRole("textbox", { name: tr(texts.newValue, { name: "MAIL_FROM" }) }).fill(refusedSender);
    await setting.getByRole("button", { name: texts.save }).click();
    await expect(page.getByRole("alert").filter({ hasText: "MAIL_FROM" })).toHaveText(tr(texts.notices.invalid, { name: "MAIL_FROM", rule: texts.rules.sender }));
    await expect(setting.getByRole("cell").nth(0)).toHaveText(before);

    await page.goto("/admin/journal?section=platform_settings&outcome=failed");
    const refused = page.getByRole("row").filter({ hasText: "MAIL_FROM" }).filter({ hasText: SUPER_ADMIN }).filter({ hasText: admin.journal.actions.refused });
    await expect(refused.first()).toContainText(tr(admin.journal.failed, { tried: admin.journal.actions.updated, reason: fr.failureReasons.invalid_value }));
    await expect(refused.first()).toContainText(tr(admin.journal.fieldAtFault, { field: texts.journalFields.value }));
    await expect(page.getByRole("main")).not.toContainText(refusedSender);
  });

  test("Support reads Paramètres; another role is denied it, and that is in the Journal", async ({ page, browser }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    const support = newAddress("settings-support");
    const supportPage = await personPage(browser, support);
    await grant(page, support, "support");
    const plans = newAddress("settings-plans");
    const plansPage = await personPage(browser, plans);
    await grant(page, plans, "plans-manager");

    expect((await supportPage.goto(`${PATH}?tab=ia`))?.status()).toBe(200);
    await expect(supportPage.getByRole("heading", { level: 1 })).toHaveText(texts.title);
    await expect(row(supportPage, "ANTHROPIC_ENDPOINT").getByRole("cell").nth(1)).toHaveText(texts.sources.env);
    // Support sees the settings without the edit controls (#299).
    await expect(supportPage.getByRole("textbox")).toHaveCount(0);
    await expect(supportPage.getByRole("button", { name: texts.save })).toHaveCount(0);
    await expect(supportPage.getByRole("button", { name: texts.restore })).toHaveCount(0);
    await supportPage.goto(`${PATH}?tab=sources`);
    await expect(row(supportPage, EDITED).getByRole("cell").nth(0)).toHaveText(/\d/);
    await expect(supportPage.getByRole("button", { name: texts.save })).toHaveCount(0);
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
