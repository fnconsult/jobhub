import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signInWithMagicLink } from "./support/candidate";

// Issue #407 (ADR-0042, amends ADR-0040): in the Back Office, a setting's, source's, warning's or figure's label is an
// Explainable label, dotted-underlined like a HelpTerm: it opens the Back Office Assistant with « Explique-moi « … »
// ici. » sent, and the item's context (page, tab, value, source, state) with it. The AI is faked inside the server
// (e2e/support/fake-mistral.mjs): told an item's context, the assistant answers with its value and its source.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const texts = fr.admin.platformSettings;
const assistantTexts = fr.backOfficeAssistant;
// Its own permanent super-admin: two sign-ins of one address at once can pick up each other's link.
const SUPER_ADMIN = "explain-office@e2e.jobbbox.test";
const PATH = "/admin/parametres";

const tr = (template: string, values: Record<string, string>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");
const assistant = (page: Page) => page.getByRole("complementary", { name: assistantTexts.title });
/** The last message of the conversation (a reply holds lists of its own: only the messages count). */
const lastReply = (page: Page) => assistant(page).getByRole("list", { name: assistantTexts.messagesLabel }).locator("> li").last();
const explainable = (page: Page, label: string) => page.getByRole("main").getByRole("button", { name: label, exact: true });

/** Starts a new conversation, so each explanation is read on its own. */
async function newConversation(page: Page) {
  if ((await assistant(page).count()) === 0) return;
  await assistant(page).getByRole("button").first().click();
  await page.getByRole("menuitem", { name: fr.coachPanel.newConversation }).click();
}

/** Clicks the Explainable label `label`: the assistant opens, the question sent, and answers with the item's `value` and `source`. */
async function explains(page: Page, label: string, value: string, source: string) {
  await newConversation(page);
  await explainable(page, label).click();
  await expect(assistant(page)).toBeVisible();
  const question = tr(assistantTexts.explain.question, { label });
  await expect(assistant(page).getByRole("list", { name: assistantTexts.messagesLabel })).toContainText(question);
  await expect(lastReply(page)).toContainText(`« ${label} »`);
  await expect(lastReply(page)).toContainText(`valeur ${value}`);
  await expect(lastReply(page)).toContainText(`source ${source}`);
}

/** WCAG 2.1 A and AA, on the page's main region. */
async function expectAccessible(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`), label).toEqual([]);
}

test.describe("Explainable labels", () => {
  test("clicking « Pays » opens the Assistant with the question and an answer mentioning the setting's value and source", async ({ page }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    await page.goto(`${PATH}?tab=recherche-web`);
    // The web search's country (JOB_DISCOVERY_COUNTRY), a Platform Setting on Recherche web: env leaves it to the code's FR.
    await expect(page.locator('tr[data-setting="JOB_DISCOVERY_COUNTRY"]')).toHaveCount(1);
    await explains(page, texts.labels.JOB_DISCOVERY_COUNTRY, "FR", texts.sources.default);
  });

  test("a setting's label explains its value and source: a value from env, then one from the code (fake AI)", async ({ page }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    await page.goto(`${PATH}?tab=sources`);
    // The e2e server sets JOB_DISCOVERY_BUDGET_SECONDS=75 in env (playwright.config.ts); the others keep the code's default.
    await explains(page, texts.labels.JOB_DISCOVERY_BUDGET_SECONDS, "75", texts.sources.env);
    await explains(page, texts.labels.JOB_DISCOVERY_BUDGET_JOB_OFFERS, "30", texts.sources.default);
    // A source's row explains it too: its name, whether it is on and why it is unavailable.
    await newConversation(page);
    await page.locator('tr[data-source="fantastic_jobs"]').getByRole("button", { name: fr.admin.searchSites.sources.names.fantastic_jobs, exact: true }).click();
    await expect(lastReply(page)).toContainText(`« ${fr.admin.searchSites.sources.names.fantastic_jobs} »`);
  });

  test("asked from the inbound domain's label on the Email intake sheet, the Assistant explains the MX setup (fake AI) (#448)", async ({ page }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    await page.goto("/admin/parametres?tab=sources&fournisseur=email-intake");
    const label = texts.labels.EMAIL_INTAKE_DOMAIN;
    await newConversation(page);
    await page.locator('[data-sheet="email-intake"] tr[data-setting="EMAIL_INTAKE_DOMAIN"]').getByRole("button", { name: label, exact: true }).click();
    await expect(assistant(page)).toBeVisible();
    await expect(assistant(page).getByRole("list", { name: assistantTexts.messagesLabel })).toContainText(tr(assistantTexts.explain.question, { label }));
    // The fake AI answers with the MX lines it was told: the MTA host that receives the intake domain's mail.
    await expect(lastReply(page)).toContainText("MX");
    await expect(lastReply(page)).toContainText("mx.jobbbox.ai");
  });

  test("an Explainable label is keyboard reachable, named by its label, and the page passes axe", async ({ page }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    await page.goto(`${PATH}?tab=sources`);
    const label = texts.labels.JOB_DIGEST_MIN_MATCH_SCORE;
    const button = explainable(page, label);
    await expect(button).toHaveCount(1);
    await expect(button).toHaveClass(/help-term/);
    // In the tab order: Tab from the element before it lands on it, and Enter asks.
    await page.locator('tr[data-setting="JOB_DIGEST_MIN_MATCH_SCORE"]').locator("th").evaluate((cell) => {
      cell.setAttribute("tabindex", "-1");
      (cell as HTMLElement).focus();
    });
    await page.keyboard.press("Tab");
    await expect(button).toBeFocused();
    await expectAccessible(page, "Sources, with its Explainable labels");
    await page.keyboard.press("Enter");
    await expect(assistant(page)).toBeVisible();
    await expect(lastReply(page)).toContainText(`« ${label} »`);
    await expectAccessible(page, "Sources, the assistant open");
    // The Environnement tab's intro explains why its settings stay in env.
    await page.goto(`${PATH}?tab=environnement`);
    await expect(explainable(page, texts.envOnly.why)).toBeVisible();
    await expectAccessible(page, "Environnement");
  });
});
