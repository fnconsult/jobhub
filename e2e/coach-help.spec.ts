import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";
import { showSystemPrompt, systemPromptShown } from "./support/system-prompt";

// Issue #342 (ADR-0035): the Coach Panel's single box. While the Candidate types, Help Articles are suggested above the
// box without AI; one opens as a card that lives in the browser only; the AI Coach is told its title alone; when the
// AI Coach cannot answer, the help still does. The button reads « Aide et coach », « Aide » on phones.
// Driven in the browser; the AI Coach is faked inside the server (fake-mistral.mjs): "E2E_AI_DOWN" in a message makes it
// unavailable, "E2E_SHOW_CONTEXT#…" prints the system prompt it was sent.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const help = fr.coachPanel.help;
const article = (id: string) => readFileSync(`packages/help/articles/fr/${id}.md`, "utf8");
const titleOf = (id: string) => /^title: (.+)$/m.exec(article(id))![1]!;
const bodyOf = (id: string) => article(id).split(/^---$/m)[2]!.trim();
const QUOTA_FAQ = titleOf("faq-quota-renewal");

const panelOf = (page: Page) => page.getByRole("complementary", { name: fr.coachPanel.title });
const boxOf = (page: Page) => panelOf(page).getByLabel(fr.coachPanel.messageLabel);
const suggestionsOf = (page: Page) => panelOf(page).getByRole("list", { name: help.suggestions });
const messagesOf = (page: Page) => panelOf(page).getByRole("list", { name: fr.coachPanel.messagesLabel }).locator("> li");
const cardOf = (page: Page, title: string) => panelOf(page).getByRole("article", { name: title });

async function openPanel(page: Page) {
  await page.getByRole("button", { name: fr.coachPanel.open, exact: true }).click();
  await expect(boxOf(page)).toBeFocused();
}

/** Every request the page makes to the server's API from now on. */
function apiCalls(page: Page): () => string[] {
  const calls: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/")) calls.push(`${request.method()} ${url.pathname}`);
  });
  return () => calls;
}

async function expectNoAxeViolations(page: Page, selector: string) {
  const results = await new AxeBuilder({ page }).include(selector).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map((node) => node.target.join(" ")) }))).toEqual([]);
}

test.describe("the Coach Panel's single box: help first, the AI Coach for the rest (#342)", () => {
  test("typing « quota » shows the quota FAQ before anything is sent, with no network call to the AI", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("coach-help-quota"));
    await openPanel(page);
    // An empty conversation: help comes first, the page in view's article, three frequent questions.
    await expect(messagesOf(page)).toHaveCount(1);
    await expect(panelOf(page)).toContainText(help.greeting);
    await expect(panelOf(page).getByRole("heading", { name: help.onThisPage })).toBeVisible();
    await expect(panelOf(page).getByRole("button", { name: new RegExp(`^${help.readMore}`) })).toBeVisible();
    await expect(panelOf(page).getByRole("heading", { name: help.oftenAsked })).toBeVisible();
    await expect(panelOf(page).getByRole("button", { name: QUOTA_FAQ })).toBeVisible();
    await expect(panelOf(page).getByRole("button", { name: fr.coachPanel.send, exact: true })).toBeVisible();

    const calls = apiCalls(page);
    await boxOf(page).pressSequentially("quota");

    await expect(suggestionsOf(page).getByRole("button", { name: QUOTA_FAQ })).toBeVisible();
    await expect(panelOf(page).getByText(help.suggestions, { exact: true })).toBeVisible();
    await expect(suggestionsOf(page).getByRole("button")).toHaveCount(2);
    // Screen readers hear how many, politely.
    await expect(panelOf(page).locator('[aria-live="polite"]').filter({ hasText: "2 articles dans l'aide" })).toHaveCount(1);
    expect(calls()).toEqual([]);

    // Under 3 characters, nothing is suggested.
    await boxOf(page).fill("qu");
    await expect(suggestionsOf(page)).toHaveCount(0);
    expect(calls()).toEqual([]);
  });

  test("an opened article is gone after reloading the conversation, and the request to the AI Coach contains only its title", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("coach-help-card"));
    await openPanel(page);
    await boxOf(page).fill("quota");
    await suggestionsOf(page).getByRole("button", { name: QUOTA_FAQ }).click();

    const card = cardOf(page, QUOTA_FAQ);
    await expect(card).toBeVisible();
    await expect(card).toContainText(help.cardLabel);
    await expect(card).toContainText(bodyOf("faq-quota-renewal").split("\n")[0]!.slice(0, 40));
    await expect(card.getByRole("heading", { name: QUOTA_FAQ })).toBeFocused();

    // « Non, demander au coach » starts a question about it.
    await card.getByRole("button", { name: help.no }).click();
    await expect(boxOf(page)).toBeFocused();
    await expect(boxOf(page)).toHaveValue(`À propos de « ${QUOTA_FAQ} » : `);
    const show = showSystemPrompt();
    await boxOf(page).pressSequentially(`et si je dépasse ? ${show}`);
    const sent = page.waitForRequest((request) => request.method() === "POST" && new URL(request.url()).pathname === "/api/coach");
    await panelOf(page).getByRole("button", { name: fr.coachPanel.send, exact: true }).click();

    const body = (await sent).postDataJSON();
    expect(body.helpArticle).toEqual({ id: "faq-quota-renewal", title: QUOTA_FAQ });
    expect(JSON.stringify(body)).not.toContain(bodyOf("faq-quota-renewal").slice(0, 40));
    // The disclosure, the card, the question and the reply. Wait for the reply before reading the system prompt: the
    // choice of Playbook Agents prints its own prompt first, and the log's latest line must be the reply's.
    await expect(messagesOf(page)).toHaveCount(4);
    const system = await systemPromptShown(show);
    expect(system).toContain(`« ${QUOTA_FAQ} »`);
    expect(system).not.toContain(bodyOf("faq-quota-renewal").slice(0, 40));

    await page.reload();
    await openPanel(page);
    await expect(messagesOf(page)).toHaveCount(3);
    await expect(cardOf(page, QUOTA_FAQ)).toHaveCount(0);
    await expect(messagesOf(page).nth(1)).toContainText(`À propos de « ${QUOTA_FAQ} »`);
  });

  test("with AI faked as unavailable, sending shows the matching articles, or the Signalement when there are none", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("coach-help-unavailable"));
    await openPanel(page);
    await boxOf(page).fill("Quand mon quota se renouvelle-t-il ? E2E_AI_DOWN");
    await panelOf(page).getByRole("button", { name: fr.coachPanel.send, exact: true }).click();

    await expect(panelOf(page).getByRole("alert")).toBeVisible({ timeout: 30_000 });
    await expect(panelOf(page)).toContainText(help.unavailableHelp);
    const offered = panelOf(page).locator(".help-unanswered").getByRole("button");
    await expect(offered.first()).toHaveText(QUOTA_FAQ);
    expect(await offered.count()).toBeLessThanOrEqual(3);
    await offered.first().click();
    await expect(cardOf(page, QUOTA_FAQ)).toBeVisible();

    await boxOf(page).fill("Comment négocier mon salaire ? E2E_AI_DOWN");
    await panelOf(page).getByRole("button", { name: fr.coachPanel.send, exact: true }).click();
    await expect(panelOf(page).getByRole("button", { name: help.signalement })).toBeVisible({ timeout: 30_000 });
    await expect(panelOf(page)).toContainText(help.noHelp);
    await expect(panelOf(page)).not.toContainText(help.unavailableHelp);
  });

  test("keyboard: arrow keys move through the suggestions, Enter opens one, Escape returns to the box; focus is visible and axe passes", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("coach-help-keyboard"));
    await openPanel(page);
    await boxOf(page).pressSequentially("quota");
    const suggestions = suggestionsOf(page).getByRole("button");
    await expect(suggestions).toHaveCount(2);

    await page.keyboard.press("ArrowDown");
    await expect(suggestions.nth(0)).toBeFocused();
    const outline = await suggestions.nth(0).evaluate((element) => getComputedStyle(element).outlineStyle);
    expect(outline).not.toBe("none");
    await page.keyboard.press("ArrowDown");
    await expect(suggestions.nth(1)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(suggestions.nth(0)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(boxOf(page)).toBeFocused();
    await expect(panelOf(page)).toBeVisible();

    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    const second = (await suggestions.nth(1).locator(".coach-help-suggestion-title").textContent())!;
    await page.keyboard.press("Enter");
    await expect(cardOf(page, second).getByRole("heading", { name: second })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(boxOf(page)).toBeFocused();
    await expect(panelOf(page)).toBeVisible();

    await expectNoAxeViolations(page, "aside.coach-panel");
  });

  test("phone width: the panel takes the whole screen and the button reads « Aide »", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await signInWithMagicLink(page, newAddress("coach-help-phone"));
    const button = page.getByRole("button", { name: fr.coachPanel.openShort, exact: true });
    await expect(button).toBeVisible();
    await expect(button).toHaveText(fr.coachPanel.openShort, { useInnerText: true });

    await button.click();
    const box = (await panelOf(page).boundingBox())!;
    expect(box.x).toBe(0);
    expect(box.width).toBe(375);
    expect(box.y).toBe(0);
    expect(box.height).toBe(812);
    await boxOf(page).fill("quota");
    await expect(suggestionsOf(page).getByRole("button", { name: QUOTA_FAQ })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

    // Wider, it reads « Aide et coach ».
    await panelOf(page).getByRole("button", { name: fr.coachPanel.close }).click();
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.getByRole("button", { name: fr.coachPanel.open, exact: true })).toBeVisible();
  });
});
