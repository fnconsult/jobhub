import { readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #233: the Back Office's Outils section lists every external tool the app calls, by
// category, with whether it is configured and its last 30 days' calls; each Tool's page lists
// its latest calls, never what they said nor a key. Super-admins and Support only. The e2e
// server runs on Mistral (faked in-process) with MISTRAL_API_KEY, without France Travail's keys.
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
    await assistant.getByRole("button", { name: fr.coachPanel.send }).click();
    await expect(assistant.getByRole("list", { name: assistantTexts.messagesLabel }).locator("> li")).toHaveCount(2);

    await page.goto("/admin/outils");
    await expect(page).toHaveTitle(`${tools.title} · ${admin.title}`);
    await expect(page.getByRole("navigation", { name: admin.nav.label }).getByRole("link", { name: admin.sections.tools })).toHaveAttribute("aria-current", "page");
    for (const category of ["ai_model", "web_search", "job_discovery", "company_data", "contact_enrichment", "billing", "mail", "sign_in"]) {
      await expect(page.getByRole("heading", { level: 2, name: tools.categories[category] })).toBeVisible();
    }
    for (const name of ["Perplexity", "Brave Search", "Tavily", "Linkup"]) await expect(toolRow(page, "web_search", name)).toBeVisible();
    for (const name of ["France Travail", "Greenhouse", "Lever", "Ashby", "APEC"]) await expect(toolRow(page, "job_discovery", name)).toBeVisible();

    // Configured from its key, linked to Clés; France Travail's keys are missing; a public API needs none.
    const mistral = toolRow(page, "ai_model", "Mistral AI");
    await expect(mistral).toContainText(tools.statuses.configured);
    await expect(mistral.getByRole("link", { name: "MISTRAL_API_KEY" })).toHaveAttribute("href", "/admin/cles?key=MISTRAL_API_KEY");
    await expect(toolRow(page, "job_discovery", "France Travail")).toContainText(tools.statuses.key_missing);
    await expect(toolRow(page, "job_discovery", "France Travail")).toContainText(tr(tools.missingKeys, { keys: "FRANCE_TRAVAIL_CLIENT_ID, FRANCE_TRAVAIL_CLIENT_SECRET" }));
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
    await expect(calls.getByRole("row").filter({ hasText: "back_office_assistant · " }).first()).toContainText(tools.ok);
    await expect(page.getByRole("main")).not.toContainText(question.slice(0, 20));
    await expect(page.getByRole("main")).not.toContainText(MISTRAL_KEY);
    await page.getByRole("link", { name: tools.back }).click();
    await expect(page).toHaveURL(/\/admin\/outils$/);

    // A Tool whose calls are not traced yet, and an id that is no Tool.
    await page.goto("/admin/outils/stripe");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Stripe");
    expect((await page.goto("/admin/outils/linkedin"))?.status()).toBe(404);
  });

  test("Support reads the Tools without a way into Clés; other roles and Candidates get a 404", async ({ page, browser }) => {
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

    for (const other of [plansPage, candidatePage]) {
      for (const path of ["/admin/outils", "/admin/outils/mistral"]) {
        expect((await other.goto(path))?.status(), path).toBe(404);
        await expect(other.getByRole("heading", { level: 1 })).toHaveText(page404);
      }
    }
  });
});
