import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { SIGNALEMENT_GLYPHS } from "../apps/web/src/components/signalement-glyphs";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #345 (ADR-0035): Signalement from the Coach Panel. A Question to the team is offered only after help that did
// not satisfy the Candidate: « Non » under an AI Coach reply, the AI Coach unavailable, or a reply it marked as one it
// could not answer. A Help Article's « Non » leads to the coach first. The panel's foot has « Signaler un problème » and
// « Proposer une idée »; the Top Bar has no Signalement button. Driven in the browser; the AI Coach is faked inside the
// server (fake-mistral.mjs): "E2E_AI_DOWN" in a message makes it unavailable, "E2E_COACH_CANNOT_ANSWER" has it mark its
// reply as one it could not answer. « Mes signalements » (#377) and the Back Office's list (#376) read the Candidate's
// Signalements as the Data export does: checked there.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const s = fr.signalement;
const help = fr.coachPanel.help;
const team = fr.coachPanel.team;
const article = (id: string) => readFileSync(`packages/help/articles/fr/${id}.md`, "utf8");
const QUOTA_FAQ = /^title: (.+)$/m.exec(article("faq-quota-renewal"))![1]!;

const panelOf = (page: Page) => page.getByRole("complementary", { name: fr.coachPanel.title });
const boxOf = (page: Page) => panelOf(page).getByLabel(fr.coachPanel.messageLabel);
const messagesOf = (page: Page) => panelOf(page).getByRole("list", { name: fr.coachPanel.messagesLabel }).locator("> li");
const askTeamOf = (page: Page) => panelOf(page).getByRole("button", { name: team.ask, exact: true });
const questionDialogOf = (page: Page) => page.getByRole("dialog", { name: s.question.title });
const dialogOf = (page: Page) => page.getByRole("dialog", { name: s.title });
const exportedSignalements = async (page: Page) => (await (await page.request.get("/api/account/export")).json()).signalements as Record<string, unknown>[];

async function openPanel(page: Page) {
  await page.getByRole("button", { name: fr.coachPanel.open, exact: true }).click();
  await expect(boxOf(page)).toBeFocused();
}

async function ask(page: Page, question: string) {
  await boxOf(page).fill(question);
  await panelOf(page).getByRole("button", { name: fr.coachPanel.send, exact: true }).click();
}

async function expectNoAxeViolations(page: Page, selector: string) {
  const results = await new AxeBuilder({ page }).include(selector).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map((node) => node.target.join(" ")) }))).toEqual([]);
}

test.describe("Signalement from the Coach Panel (#345)", () => {
  test("« Non » under a coach reply offers « Poser la question à l'équipe »; sent, it is a Question with the question and the coach reply", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("coach-signalement-question"));
    await openPanel(page);
    const question = "Comment changer l'adresse e-mail de mon compte ?";
    await ask(page, question);

    // The disclosure, the question and the reply, with « Cela répond à votre question ? Oui / Non » under it.
    await expect(messagesOf(page)).toHaveCount(3);
    const reply = messagesOf(page).nth(2);
    const coachReply = (await reply.locator("p").first().textContent())!.trim();
    const feedback = reply.getByRole("group", { name: team.answered });
    await expect(feedback).toBeVisible();
    await expect(askTeamOf(page)).toHaveCount(0);
    await feedback.getByRole("button", { name: team.no, exact: true }).click();
    await expect(askTeamOf(page)).toBeVisible();
    await expect(askTeamOf(page)).toBeFocused();
    await expectNoAxeViolations(page, "aside.coach-panel");

    await askTeamOf(page).click();
    const dialog = questionDialogOf(page);
    await expect(dialog).toBeVisible();
    // ⓘ in the title, no type to choose, the question prefilled and editable.
    await expect(dialog.locator(".signalement-title svg path")).toHaveAttribute("d", SIGNALEMENT_GLYPHS.info);
    await expect(dialog.getByRole("radio")).toHaveCount(0);
    const message = dialog.getByRole("textbox", { name: s.question.label });
    await expect(message).toHaveValue(question);
    await expect(message).toBeFocused();
    // Joint automatiquement: the exchange first, then the usual context, then nothing else of the conversation.
    const attached = dialog.locator(".signalement-context");
    await expect(attached).toContainText(s.question.exchange);
    await expect(attached).toContainText(s.question.nothingElse);
    const text = (await attached.textContent())!;
    expect(text.indexOf(s.question.exchange)).toBeLessThan(text.indexOf(s.question.context));
    expect(text.indexOf(s.question.context)).toBeLessThan(text.indexOf(s.question.nothingElse));
    await expectNoAxeViolations(page, "[role=dialog]");

    await message.fill(`${question} Le coach ne connaît pas mon cas.`);
    await dialog.getByRole("button", { name: s.send, exact: true }).click();
    await expect(dialog.getByRole("status")).toContainText(s.thanks);
    await dialog.getByRole("button", { name: s.close, exact: true }).click();
    await expect(askTeamOf(page)).toBeFocused();

    // Kept as a Question, with a copy of the question and the coach's reply: what « Mes signalements » and the Back Office list.
    expect(await exportedSignalements(page)).toEqual([
      expect.objectContaining({
        type: "question",
        message: `${question} Le coach ne connaît pas mon cas.`,
        attachedQuestion: question,
        attachedCoachReply: coachReply,
        status: "nouveau",
      }),
    ]);

    // « Oui » thanks, and offers no one.
    await ask(page, "Et pour mon numéro de téléphone ?");
    await expect(messagesOf(page)).toHaveCount(5);
    const second = messagesOf(page).nth(4);
    await second.getByRole("button", { name: team.yes, exact: true }).click();
    await expect(second).toContainText(team.thanks);
    await expect(second.getByRole("button", { name: team.ask })).toHaveCount(0);
  });

  test("with the AI Coach unavailable the message offers the team directly; a reply it could not answer offers it without « Non »", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("coach-signalement-unavailable"));
    await openPanel(page);
    const down = "Comment négocier mon salaire ? E2E_AI_DOWN";
    await ask(page, down);
    await expect(panelOf(page).getByRole("alert")).toBeVisible({ timeout: 30_000 });
    // The unavailable message stands for the coach's reply.
    const unavailable = (await panelOf(page).getByRole("alert").textContent())!.trim();
    // No more link to the article on making a Signalement: the team is offered here.
    await expect(panelOf(page).getByRole("button", { name: "Faire un signalement" })).toHaveCount(0);
    await askTeamOf(page).click();
    await expect(questionDialogOf(page).getByRole("textbox", { name: s.question.label })).toHaveValue(down);
    await questionDialogOf(page).getByRole("button", { name: s.send, exact: true }).click();
    await expect(questionDialogOf(page).getByRole("status")).toContainText(s.thanks);
    await page.keyboard.press("Escape");
    expect(await exportedSignalements(page)).toEqual([
      expect.objectContaining({ type: "question", attachedQuestion: down, attachedCoachReply: unavailable }),
    ]);

    // A reply the AI Coach marked as one it could not answer: the team at once, no « Oui / Non ».
    await boxOf(page).fill("J'ai été prélevé deux fois ce mois-ci. E2E_COACH_CANNOT_ANSWER");
    await panelOf(page).getByRole("button", { name: fr.coachPanel.send, exact: true }).click();
    const reply = messagesOf(page).last();
    await expect(reply.getByRole("button", { name: team.ask, exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(reply.getByRole("group", { name: team.answered })).toHaveCount(0);
    await expect(reply).not.toContainText("[sans-reponse]");
    await expect(reply).toContainText(team.couldNotAnswer);
  });

  test("a Help Article's « Non » offers the coach, not the team", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("coach-signalement-article"));
    await openPanel(page);
    await boxOf(page).fill("quota");
    await panelOf(page).getByRole("list", { name: help.suggestions }).getByRole("button", { name: QUOTA_FAQ }).click();
    const card = panelOf(page).getByRole("article", { name: QUOTA_FAQ });
    await expect(card).toBeVisible();
    await expect(card.getByRole("button", { name: help.no })).toBeVisible();
    await expect(askTeamOf(page)).toHaveCount(0);

    await card.getByRole("button", { name: help.no }).click();
    await expect(boxOf(page)).toBeFocused();
    await expect(boxOf(page)).toHaveValue(`À propos de « ${QUOTA_FAQ} » : `);
    await expect(askTeamOf(page)).toHaveCount(0);
  });

  test("both foot links open the dialog with their type; at phone width the Top Bar holds only Menu, the title, « Activité IA » and « Aide »", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("coach-signalement-foot"));
    await page.goto("/candidatures");
    await openPanel(page);

    const foot = panelOf(page).locator(".coach-panel-foot");
    await foot.getByRole("button", { name: team.reportProblem, exact: true }).click();
    await expect(dialogOf(page)).toBeVisible();
    await expect(dialogOf(page).getByRole("radio", { name: s.types.bug })).toBeChecked();
    await expect(dialogOf(page).getByLabel(s.label.bug)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(foot.getByRole("button", { name: team.reportProblem, exact: true })).toBeFocused();

    await foot.getByRole("button", { name: team.suggestIdea, exact: true }).click();
    await expect(dialogOf(page).getByRole("radio", { name: s.types.idee })).toBeChecked();
    await expect(dialogOf(page).locator(".signalement-title svg path")).toHaveAttribute("d", SIGNALEMENT_GLYPHS.shapes);
    await dialogOf(page).getByLabel(s.label.idee).fill("Pouvoir exporter mes conversations avec le coach.");
    await dialogOf(page).getByRole("button", { name: s.send, exact: true }).click();
    await expect(dialogOf(page).getByRole("status")).toContainText(s.thanks);
    await page.keyboard.press("Escape");
    expect(await exportedSignalements(page)).toEqual([expect.objectContaining({ type: "idee", message: "Pouvoir exporter mes conversations avec le coach.", attachedQuestion: null })]);
    await panelOf(page).getByRole("button", { name: fr.coachPanel.close }).click();

    await page.setViewportSize({ width: 375, height: 812 });
    const topbar = page.locator(".topbar");
    await expect(topbar.getByRole("button", { name: fr.coachPanel.openShort, exact: true })).toBeVisible();
    const names = await topbar.locator("button:visible, a:visible").evaluateAll((elements) => elements.map((element) => element.getAttribute("title") ?? (element as HTMLElement).innerText.trim()));
    expect(names).toEqual([fr.sidebar.menu, fr.aiActivity.label, fr.coachPanel.openShort]);
    await expect(topbar.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(topbar.getByRole("button", { name: s.open })).toHaveCount(0);

    // On a phone the panel's foot is the way in, with the Sidebar drawer's icon.
    await topbar.getByRole("button", { name: fr.coachPanel.openShort, exact: true }).click();
    await foot.getByRole("button", { name: team.reportProblem, exact: true }).click();
    await expect(dialogOf(page).getByRole("radio", { name: s.types.bug })).toBeChecked();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  });
});
