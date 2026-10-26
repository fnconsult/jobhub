import { readFileSync } from "node:fs";
import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { signInWithMagicLink } from "./support/candidate";

// Issue #400: France Travail asks one token per API, each with only its own scopes, so a client
// lacking Offres d'emploi (withdrawn for new applications) still passes its connection test, which
// shows each API's state; the France Travail source then says it awaits access. Driven through the
// Back Office of the built web app (Clés, Sites de recherche, Outils); France Travail's token endpoint
// is e2e/support/fake-france-travail.mjs, whose client e2e-ft-no-offres is granted La Bonne Boite and
// ROMEO, not Offres d'emploi.
//
// In the worker project, one spec at a time: it changes the suite's FRANCE_TRAVAIL_* rows, which the
// worker specs' workers would read over their own environment, so none may run meanwhile.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const admin = fr.admin;
const keys = admin.providerSecrets;
const access = keys.apiAccess;
const sites = admin.searchSites;
const tools = admin.tools;
const origin = process.env.E2E_WEB_ORIGIN!;
const SUPER_ADMIN = "france-travail-office@e2e.jobbbox.test";
const CLIENT_ID = "FRANCE_TRAVAIL_CLIENT_ID";
const CLIENT_SECRET = "FRANCE_TRAVAIL_CLIENT_SECRET";

test.use({ baseURL: origin });

const tr = (template: string, values: Record<string, string>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");
const rowOf = (within: Page | Locator, page: Page, name: string) => within.getByRole("row").filter({ has: page.getByRole("rowheader").filter({ hasText: name }) });

async function adminPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ baseURL: origin, locale: "en-US" });
  const page = await context.newPage();
  await signInWithMagicLink(page, SUPER_ADMIN);
  return page;
}

async function replaceKey(page: Page, name: string, value: string, { saveAnyway = false } = {}) {
  await page.goto("/admin/cles");
  await page.locator("summary", { hasText: tr(keys.replaceLegend, { name }) }).click();
  await page.getByLabel(tr(keys.newValue, { name })).fill(value);
  if (saveAnyway) await page.locator(`#anyway-${name}`).check();
  await page.getByRole("button", { name: tr(keys.replace, { name }) }).click();
}

async function clearKeys(page: Page) {
  for (const name of [CLIENT_ID, CLIENT_SECRET]) {
    await page.goto("/admin/cles");
    const clear = page.getByRole("button", { name: tr(keys.clear, { name }) });
    if (await clear.count()) await clear.click();
    await expect(rowOf(page, page, name)).toContainText(keys.sources.missing);
  }
}

test.describe("France Travail: one token per API with its own scopes, a test per API, clear source states (#400)", () => {
  test.describe.configure({ mode: "serial" });

  let office: Page;

  test.beforeAll(async ({ browser }) => {
    office = await adminPage(browser);
    await clearKeys(office);
  });
  test.afterAll(async () => {
    // Leave the suite's server as it found it: no France Travail keys, so no API state either.
    try {
      await clearKeys(office);
    } finally {
      await office.context().close().catch(() => {});
    }
  });

  test("a connection test with a client lacking Offres d'emploi passes and shows each API's state", async () => {
    // The client id alone cannot be tested: saved anyway.
    await replaceKey(office, CLIENT_ID, "e2e-ft-no-offres", { saveAnyway: true });
    await expect(office.getByRole("main").getByRole("status")).toHaveText(tr(keys.savedUntested, { name: CLIENT_ID }));
    await expect(office.getByRole("region", { name: access.title })).toHaveCount(0);

    // With its secret, the test passes: La Bonne Boite validates the client, Offres d'emploi's refusal fails nothing.
    await replaceKey(office, CLIENT_SECRET, "e2e-ft-secret");
    await expect(office.getByRole("main").getByRole("status")).toHaveText(tr(keys.saved, { name: CLIENT_SECRET }));
    const states = office.getByRole("region", { name: access.title });
    await expect(rowOf(states, office, access.apis.la_bonne_boite)).toContainText(access.states.ok);
    await expect(rowOf(states, office, access.apis.offres_emploi)).toContainText(access.states.refused);
    await expect(rowOf(states, office, access.apis.romeo)).toContainText(access.states.ok);

    // The Test button of the keys in use passes too, and keeps the states.
    await rowOf(office, office, CLIENT_SECRET).getByRole("button", { name: tr(keys.test, { name: CLIENT_SECRET }) }).click();
    await expect(office.getByRole("main").getByRole("status")).toHaveText(tr(keys.testPassed, { name: CLIENT_SECRET }));
    await expect(rowOf(states, office, access.apis.offres_emploi)).toContainText(access.states.refused);
    await expect(office.getByRole("main")).not.toContainText("e2e-ft-secret");
  });

  test("the France Travail source and Tool say they await access, refused by France Travail", async () => {
    await office.goto("/admin/sites");
    const source = rowOf(office, office, sites.sources.names.france_travail);
    await expect(source).toContainText(sites.sources.awaitingAccess);
    await expect(source).toContainText(sites.sources.accessRefused);

    await office.goto("/admin/outils");
    const tool = rowOf(office.getByRole("region", { name: tools.categories.job_discovery }), office, "France Travail");
    await expect(tool).toContainText(tools.statuses.awaiting_access);
    await expect(tool).toContainText(tr(tools.accessRefused, { provider: "France Travail" }));
  });

  test("a secret France Travail does not know fails the test, with its status, and is not saved", async () => {
    await replaceKey(office, CLIENT_SECRET, "e2e-ft-wrong-secret");
    await expect(office.getByRole("main").getByRole("alert").first()).toHaveText(tr(keys.errors.test_failed, { name: CLIENT_SECRET }));
    await expect(office.getByRole("main").getByRole("alert").nth(1)).toHaveText(tr(keys.status, { status: "400" }));
    // The keys in use, and so their states, are unchanged.
    await expect(rowOf(office.getByRole("region", { name: access.title }), office, access.apis.la_bonne_boite)).toContainText(access.states.ok);
  });

  test("cleared, its keys leave no state: the source no longer awaits access", async () => {
    await clearKeys(office);
    await expect(office.getByRole("region", { name: access.title })).toHaveCount(0);
    await office.goto("/admin/sites");
    await expect(rowOf(office, office, sites.sources.names.france_travail)).not.toContainText(sites.sources.awaitingAccess);
  });
});
