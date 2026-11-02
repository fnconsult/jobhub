import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import pg from "pg";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";
import { activityOf, activityUnderWayOf, closeActivity, openActivity, toConversation } from "./support/conversation";

// Issue #333: AI Activity live, for an AI Coach reply. While the reply is on its way, « Activité »'s glyph in the Top Bar is
// live (#603); AI Activity has a section for it, with its step and a stop icon, on the page it was asked from, and under
// « En cours ailleurs » with a link back once the Candidate moves on. Stopped from AI Activity, every AI call of the reply
// is aborted (AI Usage `stopped`); stopped or failed, it is shown in light red, in words. AI Activity's live region says
// the start and the end, never a step, and leaves both to the page's conversation while it is shown (#608). The AI is
// faked inside the server (fake-mistral.mjs): "E2E_COACH_SLOW=<ms>" makes the reply take that long, "E2E_AI_DOWN" makes
// Mistral answer 503.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const ANNOUNCEMENTS: string[] = Object.values(fr.aiActivity.live.announce as Record<string, Record<string, string>>).flatMap((byKind) => Object.values(byKind));

const stopIconOf = (region: Locator) => region.getByRole("button", { name: fr.aiActivity.live.stop.coach_reply, exact: true });
/** Where the page's AI Activity shows: an object's Fiche, in its Activity group, or the Activité column. */
const paneOf = (page: Page) => activityOf(page);
const coachPanelOf = (page: Page) => page.getByRole("region", { name: fr.conversationFirst.label });

async function query<T extends pg.QueryResultRow>(sql: string, values: unknown[]): Promise<T[]> {
  const db = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL });
  await db.connect();
  try {
    return (await db.query<T>(sql, values)).rows;
  } finally {
    await db.end();
  }
}

/** Asks the AI Coach in the page's conversation, the reply left on its way. */
async function ask(page: Page, message: string) {
  await toConversation(page);
  const panel = coachPanelOf(page);
  await panel.getByLabel(fr.coachPanel.messageLabel).fill(message);
  await panel.getByRole("button", { name: fr.coachPanel.send, exact: true }).click();
  await expect(panel.getByRole("button", { name: fr.coachPanel.stop, exact: true })).toBeVisible();
}

/** Records everything AI Activity's live region says from now on, while the app is not loaded again. */
async function listenToAnnouncements(page: Page) {
  await page.evaluate(() => {
    const said: string[] = [];
    (window as unknown as { said: string[] }).said = said;
    const region = document.querySelector(".ai-activity-announcer")!;
    new MutationObserver(() => region.textContent && said.push(region.textContent)).observe(region, { childList: true, characterData: true, subtree: true });
  });
}
const announcements = (page: Page) => page.evaluate(() => (window as unknown as { said: string[] }).said);

async function dangerSurface(locator: Locator): Promise<string> {
  return locator.evaluate((element) => {
    const probe = document.createElement("div");
    probe.style.background = "var(--color-danger-surface)";
    element.append(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  });
}

async function expectNoAxeViolations(page: Page, selector: string) {
  const results = await new AxeBuilder({ page }).include(selector).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map((node) => node.target.join(" ")) }))).toEqual([]);
}

test.describe("AI Activity live: an AI Coach reply (#333)", () => {
  test("« Activité » is live while the reply is on its way; AI Activity has it here, then « En cours ailleurs »; stopped from there", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("ai-activity-live-coach"));
    await page.goto("/candidatures");
    await listenToAnnouncements(page);
    const askedAt = new Date();

    await ask(page, "Comment préparer mon entretien ? E2E_COACH_SLOW=30000");

    // The closed button: its glyph live, think then write. It moves, its strokes drawn anew frame after frame.
    const glyph = activityUnderWayOf(page);
    await expect(glyph).toBeVisible();
    const strokesOf = () => glyph.evaluate((svg) => [...svg.querySelectorAll("path")].map((path) => path.getAttribute("d") ?? "").join("|"));
    const drawn = await strokesOf();
    await expect.poll(strokesOf, { timeout: 5_000 }).not.toBe(drawn);
    await expectNoAxeViolations(page, "header.topbar");

    // AI Activity: the reply on this page, its step running, its stop icon.
    await openActivity(page);
    const reply = paneOf(page).locator(".ai-activity-live");
    await expect(reply).toContainText(fr.aiActivity.kinds.coach_reply);
    await expect(reply).toContainText(/En cours · \d/);
    await expect(reply.getByRole("list", { name: fr.aiActivity.live.steps })).toContainText(fr.aiActivity.steps.think_write);
    await expect(stopIconOf(reply)).toHaveAttribute("title", fr.aiActivity.live.stop.coach_reply);
    await expect(paneOf(page).locator(".ai-activity-elsewhere")).toHaveCount(0);
    await expectNoAxeViolations(page, ".fiche-activity");

    // Another page, a conversation of its own: the reply is « En cours ailleurs », with a link back to where it was asked.
    await page.getByRole("navigation", { name: fr.sidebar.label }).getByRole("link", { name: fr.sidebar.agenda }).click();
    await expect(page).toHaveURL(/\/agenda/);
    await expect(activityUnderWayOf(page)).toBeVisible();
    await openActivity(page);
    const elsewhere = paneOf(page).locator(".ai-activity-elsewhere");
    await expect(elsewhere.getByRole("heading", { name: fr.aiActivity.live.elsewhere })).toBeVisible();
    await expect(elsewhere.getByRole("link", { name: fr.aiActivity.live.open.coach_reply })).toHaveAttribute("href", "/candidatures");

    // Stopped from there: the AI call is aborted, and the reply is shown stopped, in light red.
    await stopIconOf(elsewhere).click();
    const stopped = elsewhere.locator(".ai-activity-live");
    await expect(stopped).toContainText(/Arrêtée à \d{2}:\d{2}/);
    expect(await stopped.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(await dangerSurface(stopped));
    await expect(stopIconOf(stopped)).toHaveCount(0);
    await expect(stopped.getByRole("listitem").filter({ hasText: fr.aiActivity.steps.think_write })).toContainText(fr.aiActivity.live.stepStopped);
    await expect
      .poll(async () => (await query(`SELECT 1 FROM ai_usage WHERE task = 'coaching' AND at >= $1 AND reason = 'stopped'`, [askedAt])).length)
      .toBeGreaterThan(0);
    await expect(activityUnderWayOf(page)).toHaveCount(0);
    await expectNoAxeViolations(page, ".fiche-activity");

    // Asked in the page's conversation, its start was the conversation's to say; its end, the Candidate gone to another
    // page, AI Activity's. Never a step.
    const said = await announcements(page);
    expect(said).toEqual([fr.aiActivity.live.announce.stopped.coach_reply]);
    for (const text of said) expect(ANNOUNCEMENTS).toContain(text);
  });

  test("stopped from AI Activity beside the conversation; a failed reply is shown in light red with its Failure Reason in words", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("ai-activity-live-coach-fail"));
    await page.goto("/candidatures");

    await ask(page, "Une question longue E2E_COACH_SLOW=30000");
    await openActivity(page);
    await stopIconOf(paneOf(page).locator(".ai-activity-live")).click();
    await expect(paneOf(page).locator(".ai-activity-live")).toContainText(/Arrêtée à \d{2}:\d{2}/);
    await expect(stopIconOf(paneOf(page))).toHaveCount(0);
    await closeActivity(page);

    // The conversation says it too.
    await expect(coachPanelOf(page).getByRole("list", { name: fr.coachPanel.messagesLabel }).locator("> li").last()).toContainText(fr.coachPanel.stopped);

    // A failed reply: the stopped one before it gives way.
    const panel = coachPanelOf(page);
    await panel.getByLabel(fr.coachPanel.messageLabel).fill("Bonjour E2E_AI_DOWN");
    await panel.getByRole("button", { name: fr.coachPanel.send, exact: true }).click();
    await expect(panel.getByRole("alert")).toContainText(fr.failureReasons.provider_unavailable);

    await openActivity(page);
    const failed = paneOf(page).locator(".ai-activity-live");
    await expect(failed).toHaveCount(1);
    await expect(failed).toContainText(/Échec à \d{2}:\d{2}/);
    await expect(failed).toContainText(fr.failureReasons.provider_unavailable);
    expect(await failed.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(await dangerSurface(failed));
    await expect(failed).not.toContainText("503");
    await expectNoAxeViolations(page, ".fiche-activity");
  });
});
