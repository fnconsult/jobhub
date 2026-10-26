import { readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { approveAtGoogle, signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #233: the Back Office's Outils section lists every external tool the app calls, by
// category, with whether it is configured and its last 30 days' calls; each Tool's page lists
// its latest calls, never what they said nor a key. Super-admins and Support only. The e2e
// server runs on Mistral (faked in-process) with MISTRAL_API_KEY, without Brave's key.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const admin = fr.admin;
const tools = admin.tools;
const assistantTexts = fr.backOfficeAssistant;
const page404 = fr.notFound.title;
// Its own permanent super-admin: two sign-ins of one address at once can pick up each other's link.
const SUPER_ADMIN = "tools-office@e2e.jobbbox.test";
/** The Provider Secret the e2e server runs with (playwright.config.ts): never shown. */
const MISTRAL_KEY = "e2e-mistral-key";
const origin = process.env.E2E_WEB_ORIGIN!;

const tr = (template: string, values: Record<string, string>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");
const toolsTable = (page: Page, category: string) => page.getByRole("table", { name: tools.categories[category] });
const toolRow = (page: Page, category: string, name: string) => toolsTable(page, category).getByRole("row").filter({ has: page.getByRole("rowheader", { name: new RegExp(`^${name}`) }) });

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

test.describe("Tools (Outils)", () => {
  test("a super-admin sees every Tool by category, whether it is configured and its calls; a Tool's page lists its latest calls without what they said", async ({ page }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    // One AI call on Mistral: the Back Office Assistant answering.
    await page.goto("/admin/outils");
    const question = `Quels outils ? ${Date.now()} ${MISTRAL_KEY}`;
    await page.getByRole("button", { name: assistantTexts.open, exact: true }).click();
    const assistant = page.getByRole("complementary", { name: assistantTexts.title });
    await assistant.getByLabel(fr.coachPanel.messageLabel).fill(question);
    await assistant.getByRole("button", { name: fr.backOfficeAssistant.send, exact: true }).click();
    await expect(assistant.getByRole("list", { name: assistantTexts.messagesLabel }).locator("> li")).toHaveCount(2);

    await page.goto("/admin/outils");
    await expect(page).toHaveTitle(`${tools.title} · ${admin.title}`);
    await expect(page.getByRole("navigation", { name: admin.nav.label }).getByRole("link", { name: admin.sections.tools })).toHaveAttribute("aria-current", "page");
    for (const category of ["ai_model", "web_search", "job_discovery", "company_data", "contact_enrichment", "billing", "mail", "sign_in", "geolocation", "reference_data"]) {
      await expect(page.getByRole("heading", { level: 2, name: tools.categories[category] })).toBeVisible();
    }
    for (const name of ["Perplexity", "Brave Search", "Tavily", "Linkup"]) await expect(toolRow(page, "web_search", name)).toBeVisible();
    for (const name of ["France Travail", "Greenhouse", "Lever", "Ashby", "APEC"]) await expect(toolRow(page, "job_discovery", name)).toBeVisible();

    // Configured from its key, linked to its provider's sheet in Paramètres (#396); Brave's key is missing (France Travail's keys are entered by its access spec, #400); a public API needs none.
    const mistral = toolRow(page, "ai_model", "Mistral AI");
    await expect(mistral).toContainText(tools.statuses.configured);
    await expect(mistral.getByRole("link", { name: "MISTRAL_API_KEY" })).toHaveAttribute("href", "/admin/parametres?tab=ia&fournisseur=mistral");
    await expect(toolRow(page, "web_search", "Brave Search")).toContainText(tools.statuses.key_missing);
    await expect(toolRow(page, "web_search", "Brave Search")).toContainText(tr(tools.missingKeys, { keys: "BRAVE_SEARCH_API_KEY" }));
    await expect(toolRow(page, "job_discovery", "Greenhouse")).toContainText(tools.statuses.no_key_needed);
    // The Assistant's call counts in Mistral's last 30 days (recorded just after its reply: a reload may be needed).
    await expect(async () => {
      await page.reload();
      await expect(mistral.getByRole("cell").nth(4)).not.toHaveText("0", { timeout: 1_000 });
    }).toPass();
    await expect(page.getByRole("main")).not.toContainText(MISTRAL_KEY);

    await mistral.getByRole("link", { name: "Mistral AI" }).click();
    await expect(page).toHaveURL(/\/admin\/outils\/mistral$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Mistral AI");
    await expect(page.getByRole("definition").filter({ hasText: tools.residencies.eu })).toBeVisible();
    const calls = page.getByRole("table", { name: tr(tools.callsCaption, { name: "Mistral AI" }) });
    // Each call's own cost, not a 30-day figure.
    await expect(calls.getByRole("columnheader")).toHaveText([tools.at, tools.operation, tools.outcome, tools.duration, tools.callCost]);
    // The guardrail's call can be recorded before the Assistant's, and either one makes Mistral's
    // count above non-zero: the Assistant's own call may still be on its way, so reload until it lands.
    await expect(async () => {
      await page.reload();
      await expect(calls.getByRole("row").filter({ hasText: "back_office_assistant · " }).first()).toContainText(tools.ok, { timeout: 1_000 });
    }).toPass();
    await expect(page.getByRole("main")).not.toContainText(question.slice(0, 20));
    await expect(page.getByRole("main")).not.toContainText(MISTRAL_KEY);
    await page.getByRole("link", { name: tools.back }).click();
    await expect(page).toHaveURL(/\/admin\/outils$/);

    // Another Tool's page, and an id that is no Tool.
    await page.goto("/admin/outils/stripe");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Stripe");
    expect((await page.goto("/admin/outils/linkedin"))?.status()).toBe(404);
  });

  test("a Tool's state accounts for its Platform Settings, and its page lists them read-only, linked to their row on Paramètres (#304)", async ({ page }) => {
    const settings = admin.platformSettings;
    await signInWithMagicLink(page, SUPER_ADMIN);
    await page.goto("/admin/outils");
    // The e2e server runs with ANTHROPIC_ENDPOINT=bedrock from env (playwright.config.ts): Claude's Tools carry the « env » badge.
    const envBadge = tr(tools.envBadgeLabel, { settings: "ANTHROPIC_ENDPOINT" });
    await expect(toolRow(page, "ai_model", "Claude \\(AWS Bedrock\\)").getByTitle(envBadge)).toHaveText(new RegExp(`^${tools.envBadge}`));
    await expect(toolRow(page, "ai_model", "Mistral AI").getByTitle(envBadge)).toHaveCount(0);
    // Off: Claude on Vertex on another endpoint, Lusha while Apollo is the provider chosen, Brevo while mails go to the console.
    await expect(toolRow(page, "ai_model", "Claude \\(Google Vertex AI\\)")).toContainText(tools.statuses.disabled);
    await expect(toolRow(page, "contact_enrichment", "Lusha")).toContainText(tools.statuses.disabled);
    await expect(toolRow(page, "contact_enrichment", "Apollo")).toContainText(tools.statuses.configured);
    await expect(toolRow(page, "mail", "Brevo \\(API\\)")).toContainText(tools.statuses.disabled);

    await page.goto("/admin/outils/anthropic-bedrock");
    const table = page.getByRole("table", { name: tr(tools.settingsCaption, { name: "Claude (AWS Bedrock)" }) });
    const endpoint = table.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "ANTHROPIC_ENDPOINT" }) });
    await expect(endpoint).toContainText("bedrock");
    await expect(endpoint).toContainText(settings.sources.env);
    await expect(endpoint).toContainText(settings.differsFlag);
    await expect(table.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "BEDROCK_REGION" }) })).toContainText(settings.sources.default);
    // Paramètres stays the only place it is changed: nothing to edit here.
    await expect(page.getByRole("main").getByRole("textbox")).toHaveCount(0);
    await endpoint.getByRole("link", { name: "ANTHROPIC_ENDPOINT" }).click();
    await expect(page).toHaveURL(/\/admin\/parametres\?tab=ia#setting-ANTHROPIC_ENDPOINT$/);
    await expect(page.locator("#setting-ANTHROPIC_ENDPOINT")).toContainText("bedrock");

    // A setting only env holds, as Paramètres shows it: the Stripe Prices.
    await page.goto("/admin/outils/stripe");
    const prices = page.getByRole("table", { name: tr(tools.settingsCaption, { name: "Stripe" }) });
    await expect(prices.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "STRIPE_PRICE_STANDARD" }) })).toContainText("price_standard_monthly");
    await expect(prices.getByRole("link", { name: "STRIPE_PRICE_STANDARD" })).toHaveAttribute("href", "/admin/parametres?tab=environnement#setting-STRIPE_PRICE_STANDARD");
  });

  test("a Stripe call shows on Stripe's page and in the Journal with the Outils filter, beside the Back Office changes, never what it carried (#234)", async ({ page }) => {
    const journal = admin.journal;
    await signInWithMagicLink(page, SUPER_ADMIN);
    // A webhook delivery Stripe did not sign: refused, and recorded as a failed call.
    const forged = await page.request.post("/api/billing/webhook", { data: '{"id":"evt_forged_e2e"}', headers: { "stripe-signature": "t=1,v1=forged", "content-type": "application/json" } });
    expect(forged.status()).toBe(400);

    await page.goto("/admin/outils/stripe");
    const calls = page.getByRole("table", { name: tr(tools.callsCaption, { name: "Stripe" }) });
    await expect(async () => {
      await page.reload();
      await expect(calls.getByRole("row").filter({ hasText: "webhooks.constructEvent" }).first()).toContainText(tools.failed, { timeout: 1_000 });
    }).toPass();
    await expect(page.getByRole("main")).not.toContainText("evt_forged_e2e");

    await page.goto("/admin/journal");
    await page.getByRole("navigation", { name: journal.filter }).getByRole("link", { name: journal.tools, exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/journal\?section=tools$/);
    await expect(page.getByRole("navigation", { name: journal.filter }).getByRole("link", { name: journal.tools, exact: true })).toHaveAttribute("aria-current", "page");
    const lines = page.getByRole("table", { name: journal.toolsCaption });
    const stripeCall = lines.getByRole("row").filter({ hasText: "webhooks.constructEvent" }).first();
    await expect(stripeCall).toContainText(journal.byJobbbox);
    await expect(stripeCall.getByRole("link", { name: "Stripe" })).toHaveAttribute("href", "/admin/outils/stripe");
    // Newest first, whatever they are.
    const times = await lines.locator("tbody time").evaluateAll((elements) => elements.map((element) => element.getAttribute("datetime")!));
    expect(times).toEqual([...times].sort().reverse());
    await expect(page.getByRole("main")).not.toContainText("evt_forged_e2e");
  });

  test("every place suggestion asks geo.api.gouv.fr, listed under Géolocalisation, and each of its calls is traced (#235)", async ({ page, request }) => {
    // Anonymous visitors get no suggestion.
    expect((await request.get(`${origin}/api/places?q=loire`)).status()).toBe(401);
    await signInWithMagicLink(page, SUPER_ADMIN);
    // A query of its own, so the API is asked (not this server's cache): communes, départements and régions.
    const query = `loire ${Date.now()}`;
    const suggested = await page.request.get(`/api/places?q=${encodeURIComponent("loire")}`);
    expect(suggested.status()).toBe(200);
    expect((await suggested.json()).places).toEqual([
      { name: "Loire-sur-Rhône (69)", kind: "commune" },
      { name: "Loire", kind: "departement" },
      { name: "Loire-Atlantique", kind: "departement" },
      { name: "Pays de la Loire", kind: "region" },
    ]);
    // Fewer than three characters: nothing is asked.
    expect((await (await page.request.get("/api/places?q=lo")).json()).places).toEqual([]);
    expect((await (await page.request.get(`/api/places?q=${encodeURIComponent(query)}`)).json()).places).toEqual([]);

    await page.goto("/admin/outils");
    const geo = toolRow(page, "geolocation", "geo.api.gouv.fr");
    await expect(geo).toContainText(tools.statuses.no_key_needed);
    await expect(async () => {
      await page.reload();
      await expect(geo.getByRole("cell").nth(4)).not.toHaveText("0", { timeout: 1_000 });
    }).toPass();
    await geo.getByRole("link", { name: "geo.api.gouv.fr" }).click();
    await expect(page).toHaveURL(/\/admin\/outils\/geo-api-gouv$/);
    await expect(page.getByRole("definition").filter({ hasText: tools.residencies.eu })).toBeVisible();
    const calls = page.getByRole("table", { name: tr(tools.callsCaption, { name: "geo.api.gouv.fr" }) });
    for (const operation of ["GET /communes", "GET /departements", "GET /regions"]) {
      await expect(calls.getByRole("row").filter({ hasText: operation }).first()).toContainText(tools.ok);
    }
    // Never the place asked for.
    await expect(page.getByRole("main")).not.toContainText(query);
  });

  test("the Sectors' and Domains' labels come from INSEE and France Travail's ROME open data, listed under Référentiels, each call traced (#236)", async ({ page, request }) => {
    // Anonymous visitors get no labels.
    expect((await request.get(`${origin}/api/reference-data`)).status()).toBe(401);
    await signInWithMagicLink(page, SUPER_ADMIN);
    // Read from the reference data, which asked both sources (faked) the first time it was read.
    const labels = await (await page.request.get("/api/reference-data")).json();
    expect(labels.sectors).toHaveLength(21);
    expect(labels.subsectors).toHaveLength(88);
    expect(labels.sectors).toContainEqual({ code: "K", label: { fr: "Activités financières et d'assurance", en: "Financial and insurance activities" } });
    expect(labels.domains).toContainEqual({ code: "M13", parent: "M", label: { fr: "Direction d'entreprise" } });

    await page.goto("/admin/outils");
    await expect(page.getByRole("heading", { level: 2, name: tools.categories.reference_data })).toBeVisible();
    for (const [id, name, operation] of [
      ["insee-naf", "INSEE (rdf.insee.fr)", "GET /sparql"],
      ["rome-open-data", "ROME open data (France Travail)", "GET /api-nomenclatureemploi/v1/open-data/json"],
    ] as const) {
      await page.goto("/admin/outils");
      const row = toolRow(page, "reference_data", name.replace(/[()]/g, "\\$&"));
      await expect(row).toContainText(tools.statuses.no_key_needed);
      // Recorded just after the call: a reload may be needed.
      await expect(async () => {
        await page.reload();
        await expect(row.getByRole("cell").nth(4)).not.toHaveText("0", { timeout: 1_000 });
      }).toPass();
      await row.getByRole("link", { name }).click();
      await expect(page).toHaveURL(new RegExp(`/admin/outils/${id}$`));
      await expect(page.getByRole("definition").filter({ hasText: tools.residencies.eu })).toBeVisible();
      const calls = page.getByRole("table", { name: tr(tools.callsCaption, { name }) });
      await expect(calls.getByRole("row").filter({ hasText: operation }).first()).toContainText(tools.ok);
    }
  });

  test("a Google sign-in and a refused key test are each one call on their Tool's page and in the Journal, never who signed in nor what was sent (#234)", async ({ page, browser }) => {
    const journal = admin.journal;
    const keys = admin.providerSecrets;
    const candidateEmail = newAddress("traced-person");
    const sub = `google-sub-${Date.now()}`;
    const candidate = await browser.newContext({ baseURL: origin });
    const candidatePage = await candidate.newPage();
    await approveAtGoogle(candidatePage, { sub, email: candidateEmail, email_verified: true, name: "Traced Person" }, origin);
    await candidatePage.goto("/connexion");
    await candidatePage.getByRole("button", { name: fr.signIn.continueWith.replace("{{provider}}", "Google") }).click();
    await expect(candidatePage).toHaveURL(`${origin}/compte`);
    const candidateId = (await (await candidatePage.request.get("/api/auth/get-session")).json()).user.id as string;
    await candidate.close();

    await signInWithMagicLink(page, SUPER_ADMIN);
    // A key its provider refuses: tested, so one connection-test call to Lusha.
    await page.goto("/admin/parametres?tab=enrichissement&fournisseur=lusha");
    await page.locator("summary", { hasText: tr(keys.replaceLegend, { name: "LUSHA_API_KEY" }) }).click();
    await page.getByLabel(tr(keys.newValue, { name: "LUSHA_API_KEY" })).fill(`e2e-traced-secret-${Date.now()}`);
    await page.getByRole("button", { name: tr(keys.replace, { name: "LUSHA_API_KEY" }) }).click();
    await expect(page.locator("aside[data-sheet]").getByRole("alert").first()).toHaveText(tr(keys.errors.test_failed, { name: "LUSHA_API_KEY" }));

    for (const [id, name] of [["google", "Google"], ["lusha", "Lusha"]] as const) {
      await page.goto(`/admin/outils/${id}`);
      const calls = page.getByRole("table", { name: tr(tools.callsCaption, { name }) });
      await expect(async () => {
        await page.reload();
        await expect(calls.getByRole("row").nth(1)).toBeVisible({ timeout: 1_000 });
      }).toPass();
      const text = await page.getByRole("main").innerText();
      for (const forbidden of [candidateEmail, candidateId, sub, "e2e-traced-secret", "Traced Person"]) expect(text, `${name} page`).not.toContain(forbidden);
    }
    await page.goto("/admin/outils/lusha");
    await expect(page.getByRole("table", { name: tr(tools.callsCaption, { name: "Lusha" }) }).getByRole("row").filter({ hasText: "connection_test" }).first()).toContainText(tools.failed);

    await page.goto("/admin/journal?section=tools");
    const lines = page.getByRole("table", { name: journal.toolsCaption });
    await expect(lines.getByRole("row").filter({ hasText: "connection_test" }).first()).toBeVisible();
    await expect(lines.getByRole("link", { name: "Google", exact: true }).first()).toHaveAttribute("href", "/admin/outils/google");
    const all = await page.getByRole("main").innerText();
    for (const forbidden of [candidateEmail, candidateId, sub, "e2e-traced-secret"]) expect(all, "Journal").not.toContain(forbidden);
  });

  test("Support reads the Tools without a way into Clés but with its way into Paramètres; other roles and Candidates get a 404", async ({ page, browser }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    const support = newAddress("tools-support");
    const plans = newAddress("tools-plans");
    const candidate = newAddress("tools-candidate");
    const [supportPage, plansPage, candidatePage] = await Promise.all([personPage(browser, support), personPage(browser, plans), personPage(browser, candidate)]);
    await grant(page, support, "support");
    await grant(page, plans, "plans-manager");

    expect((await supportPage.goto("/admin/outils"))?.status()).toBe(200);
    const mistral = toolRow(supportPage, "ai_model", "Mistral AI");
    await expect(mistral).toContainText("MISTRAL_API_KEY");
    await expect(mistral.getByRole("link", { name: "MISTRAL_API_KEY" })).toHaveCount(0);
    expect((await supportPage.goto("/admin/outils/mistral"))?.status()).toBe(200);
    // Support reads Paramètres: a Tool's settings are linked to it (#304).
    await expect(supportPage.getByRole("main").getByRole("link", { name: "AI_IDENTITY_MODEL" })).toHaveAttribute("href", "/admin/parametres?tab=ia#setting-AI_IDENTITY_MODEL");

    for (const other of [plansPage, candidatePage]) {
      for (const path of ["/admin/outils", "/admin/outils/mistral"]) {
        expect((await other.goto(path))?.status(), path).toBe(404);
        await expect(other.getByRole("heading", { level: 1 })).toHaveText(page404);
      }
    }
  });
});
