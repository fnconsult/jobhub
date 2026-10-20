import { readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";
import { showSystemPrompt, systemPromptShown } from "./support/system-prompt";
import { chooseInPanelMenu, panelMenuItems } from "./support/coach-panel";

// Issue #205: the Back Office Assistant, the Coach Panel for Administrators in the
// Back Office. Read-only; told only what the asking Administrator's Back Office Roles
// may read, never a Provider Secret value nor an email address; its conversations are
// the Administrator's own, apart from Candidates' Coach Conversations. The AI is faked
// inside the server (fake-mistral.mjs): "E2E_SHOW_CONTEXT#<tag>" prints the system prompt to the server log.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const admin = fr.admin;
const assistantTexts = fr.backOfficeAssistant;
// Its own permanent super-admin: two sign-ins of one address at once can pick up each other's link.
const SUPER_ADMIN = "assistant-office@e2e.jobbbox.test";
/** The Provider Secret the e2e server runs with (playwright.config.ts): it must never reach the assistant. */
const MISTRAL_KEY = "e2e-mistral-key";
const origin = process.env.E2E_WEB_ORIGIN!;

const tr = (template: string, values: Record<string, string>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");

async function personPage(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext({ baseURL: origin, locale: "en-US" });
  const page = await context.newPage();
  await signInWithMagicLink(page, email);
  return page;
}

async function grant(superAdmin: Page, email: string, roles: string[]) {
  await superAdmin.goto("/admin/administrateurs");
  await superAdmin.getByLabel(admin.administrators.grantEmail).fill(email);
  for (const role of roles) await superAdmin.getByRole("checkbox", { name: admin.roles[role] }).check();
  await superAdmin.getByRole("button", { name: admin.administrators.grant }).click();
  await expect(superAdmin.getByRole("status")).toHaveText(tr(admin.administrators.granted, { roles: roles.map((role) => admin.roles[role]).join(", ") }));
}

const assistant = (page: Page) => page.getByRole("complementary", { name: assistantTexts.title });

async function openAssistant(page: Page) {
  await page.getByRole("button", { name: assistantTexts.open, exact: true }).click();
  await expect(assistant(page)).toBeVisible();
}

async function ask(page: Page, text: string) {
  await assistant(page).getByLabel(fr.coachPanel.messageLabel).fill(text);
  await assistant(page).getByRole("button", { name: fr.coachPanel.send }).click();
}

/** The last message of the conversation (a reply holds lists of its own: only the messages count). */
const lastReply = (page: Page) => assistant(page).getByRole("list", { name: assistantTexts.messagesLabel }).locator("> li").last();

test.describe("Back Office Assistant", () => {
  test("a super-admin asks from any Back Office page and gets answers grounded in Back Office data, without secrets or addresses", async ({ page }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    await page.goto("/admin/journal");
    await openAssistant(page);
    await expect(assistant(page)).toContainText(assistantTexts.welcome);
    await expect(assistant(page)).toContainText(assistantTexts.readOnly);
    // Only one panel is mounted on a Back Office page: the assistant, not the Candidate's Coach Panel too.
    // Each panel renders a floating button, and the open assistant's steps aside: none is left.
    await expect(page.locator(".coach-panel-toggle-floating")).toHaveCount(0);
    // No Coach Memory, nothing In view, no Job Search: those are the Candidate's.
    const items = await panelMenuItems(assistant(page));
    await expect(items).toHaveText([fr.coachPanel.newConversation, fr.coachPanel.conversations]);
    await page.keyboard.press("Escape");

    const show = showSystemPrompt();
    const question = `${show} Quels sont les quotas ?`;
    await ask(page, question);

    await expect(lastReply(page)).toContainText("E2E: system prompt");
    const prompt = await systemPromptShown(show);
    expect(prompt).toContain("Quotas des offres (Plan Quotas)");
    expect(prompt).toContain("Match Scores par semaine");
    expect(prompt).toContain("Journal du Back Office");
    expect(prompt).toContain("Rôles de l'Administrateur : Super-admin.");
    expect(prompt).not.toContain(MISTRAL_KEY);
    expect(prompt).not.toContain("@");

    // The conversation is saved: it is listed, and reopens after a reload on another page.
    await page.goto("/admin/quotas");
    await openAssistant(page);
    await expect(assistant(page)).toContainText(question);
    await ask(page, "Et ensuite ?");
    await expect(lastReply(page)).toContainText("Réponse de l'assistant (3 messages)");
    await chooseInPanelMenu(assistant(page), fr.coachPanel.conversations);
    await expect(assistant(page)).toContainText(assistantTexts.retention);
    await expect(assistant(page).getByRole("button", { name: question }).first()).toBeVisible();
  });

  test("a Coach manager's assistant is told only about their sections; Provider Secrets and the rest are named as off-limits", async ({ page, browser }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    const email = newAddress("assistant-coach-manager");
    const coachManager = await personPage(browser, email);
    await grant(page, email, ["coach-manager"]);

    await coachManager.goto("/admin/coachs");
    await openAssistant(coachManager);
    const show = showSystemPrompt();
    await ask(coachManager, `${show} Quelle est la clé Mistral ?`);

    await expect(lastReply(coachManager)).toContainText("E2E: system prompt");
    const prompt = await systemPromptShown(show);
    expect(prompt).toContain("Coachs humains (page /admin/coachs)");
    expect(prompt).toContain("Coût du coach IA");
    expect(prompt).toContain("Hors des rôles de l'Administrateur");
    expect(prompt).toContain("Clés des fournisseurs (Provider Secrets)");
    // Plan Quota figures and the Journal are outside their roles: never in the prompt.
    expect(prompt).not.toContain("Match Scores par semaine");
    expect(prompt).not.toContain("Les 30 derniers");
    expect(prompt).not.toContain(MISTRAL_KEY);

    // The super-admin's conversations are theirs alone.
    await chooseInPanelMenu(assistant(coachManager), fr.coachPanel.conversations);
    await expect(assistant(coachManager).getByRole("button", { name: /Quels sont les quotas \?/ })).toHaveCount(0);
  });

  test("not shown to Candidates: its API answers 404, and their Coach Panel keeps their own conversations", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("assistant-candidate"));

    const sent = await page.request.post("/api/admin/assistant", { headers: { origin }, data: { message: "Quels sont les quotas ?" } });
    expect(sent.status()).toBe(404);
    expect((await page.request.get("/api/admin/assistant/conversations")).status()).toBe(404);
    expect((await page.goto("/admin"))?.status()).toBe(404);

    await page.goto("/compte");
    await expect(page.getByRole("button", { name: assistantTexts.open, exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: fr.coachPanel.open }).first()).toBeVisible();
  });
});
