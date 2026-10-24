import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #344 (ADR-0035): what the help missed reaches a person. A Candidate's question to the AI Coach that no Help
// Article matched, and that the AI Coach marked as about using Jobbbox, is kept redacted, never linked to the Candidate,
// in « Questions sans réponse ». Help editors and super-admins mark it « Article écrit » or « Écarter »; Support reads.
// The AI Coach is faked inside the server (fake-mistral.mjs): it marks a message speaking of being blocked or of quotas
// as about using Jobbbox; "E2E_AI_DOWN" in a message makes it unavailable.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const admin = fr.admin;
const texts = admin.unansweredQuestions;
const page404 = fr.notFound.title;
const SUPER_ADMIN = "help-office@e2e.jobbbox.test";
const PATH = "/admin/questions-sans-reponse";
const origin = process.env.E2E_WEB_ORIGIN!;

const tr = (template: string, values: Record<string, string>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");

/** A word of letters alone, its own to each run: no Help Article holds it, and Redaction never takes it for a phone number. */
const tag = () => Array.from({ length: 10 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join("");

const panelOf = (page: Page) => page.getByRole("complementary", { name: fr.coachPanel.title });
const boxOf = (page: Page) => panelOf(page).getByLabel(fr.coachPanel.messageLabel);
const messagesOf = (page: Page) => panelOf(page).getByRole("list", { name: fr.coachPanel.messagesLabel }).locator("> li");
const suggestionsOf = (page: Page) => panelOf(page).getByRole("list", { name: fr.coachPanel.help.suggestions });
const rowOf = (page: Page, text: string) => page.getByRole("row").filter({ hasText: text });

/** A signed-in page of its own (cookies apart), as for another person on another computer. */
async function personPage(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext({ baseURL: origin, locale: "en-US" });
  const page = await context.newPage();
  await signInWithMagicLink(page, email);
  return page;
}

/** The Candidate asks the AI Coach `question` in the Coach Panel and waits for the reply. */
async function ask(page: Page, question: string) {
  const before = await messagesOf(page).count();
  await boxOf(page).fill(question);
  await panelOf(page).getByRole("button", { name: fr.coachPanel.send, exact: true }).click();
  // The disclosure comes with a new conversation's first reply.
  await expect(messagesOf(page)).toHaveCount(before === 0 ? 3 : before + 2);
}

/** The super-admin grants `role` to the account with `email`. */
async function grant(superAdmin: Page, email: string, role: string) {
  await superAdmin.goto("/admin/administrateurs");
  await superAdmin.getByLabel(admin.administrators.grantEmail).fill(email);
  await superAdmin.getByRole("checkbox", { name: admin.roles[role] }).check();
  await superAdmin.getByRole("button", { name: admin.administrators.grant }).click();
  await expect(superAdmin.getByRole("status")).toHaveText(tr(admin.administrators.granted, { roles: admin.roles[role] }));
}

/** A Candidate asks a question the help misses, about using Jobbbox: it becomes an Unanswered Question. */
async function missedQuestion(browser: Browser, ref: string): Promise<string> {
  const question = `Pourquoi suis-je bloqué à cinq analyses ? ${ref}`;
  const candidate = await personPage(browser, newAddress(`unanswered-${ref}`));
  await candidate.goto("/candidatures");
  await candidate.getByRole("button", { name: fr.coachPanel.open, exact: true }).click();
  await ask(candidate, question);
  await candidate.context().close();
  return question;
}

test.describe("Unanswered Questions: recorded redacted, « Questions sans réponse », Help editor role (#344)", () => {
  test("a question about quotas no article matched is kept once and counted; « réécris mon CV » and a failed reply are not", async ({ page, browser }) => {
    const ref = tag();
    const question = `Pourquoi suis-je bloqué à cinq analyses ? ${ref}`;
    await signInWithMagicLink(page, newAddress("unanswered-candidate"));
    await page.goto("/candidatures");
    await page.getByRole("button", { name: fr.coachPanel.open, exact: true }).click();

    // No Help Article is suggested for it before it is sent.
    await boxOf(page).fill(question);
    await expect(panelOf(page).getByRole("button", { name: fr.coachPanel.send, exact: true })).toBeEnabled();
    await expect(suggestionsOf(page)).toHaveCount(0);
    await ask(page, question);
    // The AI Coach's mark is never shown.
    await expect(panelOf(page)).not.toContainText("[jobbbox:");
    await ask(page, question);
    await ask(page, `Réécris mon CV ${ref}`);
    // The AI Coach unavailable: nothing is recorded.
    const failedRef = tag();
    await boxOf(page).fill(`Pourquoi suis-je bloqué à cinq analyses ? ${failedRef} E2E_AI_DOWN`);
    await panelOf(page).getByRole("button", { name: fr.coachPanel.send, exact: true }).click();
    await expect(panelOf(page).getByRole("alert")).toBeVisible({ timeout: 30_000 });

    const office = await personPage(browser, SUPER_ADMIN);
    await office.goto(PATH);
    await expect(office.getByRole("heading", { level: 1 })).toHaveText(texts.title);
    const row = rowOf(office, ref);
    await expect(row).toHaveCount(1);
    await expect(row.getByRole("rowheader")).toHaveText(question);
    // The page it was asked from, and the Interface Language.
    await expect(row.getByRole("cell").nth(0)).toHaveText(`/candidatures · ${texts.languages.fr}`);
    await expect(row.getByRole("cell").nth(1)).toHaveText("2");
    await expect(row.getByRole("cell").nth(4)).toContainText(texts.answer);
    await expect(rowOf(office, "Réécris")).toHaveCount(0);
    await expect(rowOf(office, failedRef)).toHaveCount(0);
    // Nothing on the page names the Candidate.
    await expect(office.getByRole("main")).not.toContainText("unanswered-candidate");
    await office.context().close();
  });

  test("a Help editor marks one « Article écrit », recorded in the Journal; Support reads without acting; a Playbook editor never sees it", async ({ page, browser }) => {
    const ref = tag();
    const question = await missedQuestion(browser, ref);
    await signInWithMagicLink(page, SUPER_ADMIN);
    const helpEditorEmail = newAddress("help-editor");
    const supportEmail = newAddress("help-support");
    const playbookEditorEmail = newAddress("help-playbook-editor");
    const helpEditor = await personPage(browser, helpEditorEmail);
    const support = await personPage(browser, supportEmail);
    const playbookEditor = await personPage(browser, playbookEditorEmail);
    await grant(page, helpEditorEmail, "help-editor");
    await grant(page, supportEmail, "support");
    await grant(page, playbookEditorEmail, "playbook-editor");

    // Support reads: the question, read-only, its buttons disabled.
    await support.goto(PATH);
    await expect(support.getByRole("main")).toContainText(admin.readOnly);
    await expect(rowOf(support, ref).getByRole("button", { name: tr(texts.markWrittenLabel, { question }) })).toBeDisabled();

    // Support's « Article écrit », sent by hand as the Help editor's form would send it, is refused and changes nothing.
    await helpEditor.goto(PATH);
    const form = helpEditor.locator("form").filter({ has: helpEditor.getByRole("button", { name: tr(texts.markWrittenLabel, { question }) }) });
    const actionField = await form.locator('input[name^="$ACTION_ID_"]').getAttribute("name");
    const id = await form.locator('input[name="id"]').inputValue();
    expect(actionField).toBeTruthy();
    const forged = await support.request.post(PATH, { headers: { origin }, multipart: { [actionField!]: "", id, status: "written", route: "", language: "" }, maxRedirects: 0 });
    expect(forged.status()).toBe(404);
    await support.reload();
    await expect(rowOf(support, ref)).toHaveCount(1);

    // A Playbook editor's roles do not cover it: not in the sidebar, and 404.
    await playbookEditor.goto("/admin");
    await expect(playbookEditor.getByRole("navigation", { name: admin.nav.label }).getByRole("link", { name: admin.sections.unansweredQuestions })).toHaveCount(0);
    const response = await playbookEditor.goto(PATH);
    expect(response?.status()).toBe(404);
    await expect(playbookEditor.getByRole("heading", { level: 1 })).toHaveText(page404);

    // The Help editor sees « Questions sans réponse » under Contenu, alone, and marks it.
    await helpEditor.goto("/admin");
    const nav = helpEditor.getByRole("navigation", { name: admin.nav.label });
    await expect(nav.getByRole("heading", { name: admin.nav.groups.content })).toBeVisible();
    await nav.getByRole("link", { name: admin.sections.unansweredQuestions }).click();
    await expect(helpEditor).toHaveTitle(`${texts.title} · ${admin.title}`);
    await expect(helpEditor.getByRole("main")).not.toContainText(admin.readOnly);
    const results = await new AxeBuilder({ page: helpEditor }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map((node) => node.target.join(" ")) }))).toEqual([]);
    await rowOf(helpEditor, ref).getByRole("button", { name: tr(texts.markWrittenLabel, { question }) }).click();
    await expect(helpEditor.getByRole("main").getByRole("status")).toHaveText(texts.marked.written);
    await expect(rowOf(helpEditor, ref)).toHaveCount(0);

    // In the Journal: who, the question, its status before and after.
    await page.goto("/admin/journal");
    const entry = page.getByRole("row").filter({ hasText: ref }).first();
    await expect(entry).toContainText(helpEditorEmail);
    await expect(entry).toContainText(admin.journal.sections.unanswered_questions);
    await expect(entry).toContainText(texts.statuses.open);
    await expect(entry).toContainText(texts.statuses.written);

    for (const each of [helpEditor, support, playbookEditor]) await each.context().close();
  });

  test("a super-admin dismisses one, and filters by page and by language", async ({ page, browser }) => {
    const ref = tag();
    const question = await missedQuestion(browser, ref);
    await signInWithMagicLink(page, SUPER_ADMIN);

    await page.goto(PATH);
    await page.getByRole("navigation", { name: texts.languageFilter }).getByRole("link", { name: texts.languages.en }).click();
    await expect(rowOf(page, ref)).toHaveCount(0);
    await page.getByRole("navigation", { name: texts.languageFilter }).getByRole("link", { name: texts.languages.fr }).click();
    await expect(page.getByRole("navigation", { name: texts.languageFilter }).getByRole("link", { name: texts.languages.fr })).toHaveAttribute("aria-current", "page");
    const candidatures = page.getByRole("navigation", { name: texts.routeFilter }).getByRole("link", { name: "/candidatures", exact: true });
    await candidatures.click();
    await expect(candidatures).toHaveAttribute("aria-current", "page");
    await expect(rowOf(page, ref)).toHaveCount(1);

    await rowOf(page, ref).getByRole("button", { name: tr(texts.dismissLabel, { question }) }).click();
    await expect(page.getByRole("main").getByRole("status")).toHaveText(texts.marked.dismissed);
    await expect(rowOf(page, ref)).toHaveCount(0);
    // The filters are kept.
    await expect(page).toHaveURL(/page=%2Fcandidatures&langue=fr/);
  });
});
