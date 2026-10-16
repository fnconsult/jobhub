import { readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #205: the Back Office Assistant, the Coach Panel for Administrators in the
// Back Office. Read-only; told only what the asking Administrator's Back Office Roles
// may read, never a Provider Secret value nor an email address; its conversations are
// the Administrator's own, apart from Candidates' Coach Conversations. The AI is faked
// inside the server (fake-mistral.mjs): "E2E_SHOW_CONTEXT" gets the system prompt back.
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
    // No Coach Memory, nothing In view, no Job Search: those are the Candidate's.
    await expect(assistant(page).getByRole("button", { name: fr.coachMemory.open })).toHaveCount(0);

    await ask(page, "E2E_SHOW_CONTEXT Quels sont les quotas ?");

    await expect(lastReply(page)).toContainText("Quotas des offres (Plan Quotas)");
    await expect(lastReply(page)).toContainText("Match Scores par mois");
    await expect(lastReply(page)).toContainText("Journal du Back Office");
    await expect(lastReply(page)).toContainText("Rôles de l'Administrateur : Super-admin.");
    await expect(lastReply(page)).not.toContainText(MISTRAL_KEY);
    await expect(lastReply(page)).not.toContainText("@");

    // The conversation is saved: it is listed, and reopens after a reload on another page.
    await page.goto("/admin/quotas");
    await openAssistant(page);
    await expect(assistant(page)).toContainText("E2E_SHOW_CONTEXT Quels sont les quotas ?");
    await ask(page, "Et ensuite ?");
    await expect(lastReply(page)).toContainText("Réponse de l'assistant (3 messages)");
    await assistant(page).getByRole("button", { name: fr.coachPanel.conversations }).click();
    await expect(assistant(page)).toContainText(assistantTexts.retention);
    await expect(assistant(page).getByRole("button", { name: "E2E_SHOW_CONTEXT Quels sont les quotas ?" })).toBeVisible();
  });

  test("a Coach manager's assistant is told only about their sections; Provider Secrets and the rest are named as off-limits", async ({ page, browser }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    const email = newAddress("assistant-coach-manager");
    const coachManager = await personPage(browser, email);
    await grant(page, email, ["coach-manager"]);

    await coachManager.goto("/admin/coachs");
    await openAssistant(coachManager);
    await ask(coachManager, "E2E_SHOW_CONTEXT Quelle est la clé Mistral ?");

    const reply = lastReply(coachManager);
    await expect(reply).toContainText("Coachs humains (page /admin/coachs)");
    await expect(reply).toContainText("Coût du coach IA");
    await expect(reply).toContainText("Hors des rôles de l'Administrateur");
    await expect(reply).toContainText("Clés des fournisseurs (Provider Secrets)");
    // Plan Quota figures and the Journal are outside their roles: never in the prompt.
    await expect(reply).not.toContainText("Match Scores par mois");
    await expect(reply).not.toContainText("Les 30 derniers");
    await expect(reply).not.toContainText(MISTRAL_KEY);

    // The super-admin's conversations are theirs alone.
    await assistant(coachManager).getByRole("button", { name: fr.coachPanel.conversations }).click();
    await expect(assistant(coachManager).getByRole("button", { name: "E2E_SHOW_CONTEXT Quels sont les quotas ?" })).toHaveCount(0);
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
