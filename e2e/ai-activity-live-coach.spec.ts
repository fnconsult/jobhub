import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import pg from "pg";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #333: AI Activity live, for an AI Coach reply. While the reply is on its way, the top bar's button shows its step
// (the Activity's glyph and its label) with a stop icon; the pane has a section for it, on the page it was asked from, and
// under « En cours ailleurs » with a link back once the Candidate moves on. Stopped from AI Activity, every AI call of the
// reply is aborted (AI Usage `stopped`); stopped or failed, it is shown in light red, in words. AI Activity's live region says
// the start and the end, never a step, and leaves both to the Coach Panel while it is open. The AI is faked inside the server
// (fake-mistral.mjs): "E2E_COACH_SLOW=<ms>" makes the reply take that long, "E2E_AI_DOWN" makes Mistral answer 503.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const ANNOUNCEMENTS: string[] = Object.values(fr.aiActivity.live.announce as Record<string, Record<string, string>>).flatMap((byKind) => Object.values(byKind));

const aiActivityButton = (page: Page) => page.getByRole("banner").getByRole("button", { name: new RegExp(`^${fr.aiActivity.label}`) });
const stopIconOf = (region: Locator) => region.getByRole("button", { name: fr.aiActivity.live.stop.coach_reply, exact: true });
const paneOf = (page: Page) => page.getByRole("complementary", { name: fr.aiActivity.label });
const coachPanelOf = (page: Page) => page.getByRole("complementary", { name: fr.coachPanel.title });

async function query<T extends pg.QueryResultRow>(sql: string, values: unknown[]): Promise<T[]> {
  const db = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL });
  await db.connect();
  try {
    return (await db.query<T>(sql, values)).rows;
  } finally {
    await db.end();
  }
}

/** Asks the AI Coach from the page in view, then closes the Coach Panel while the reply is on its way. */
async function askThenClose(page: Page, message: string) {
  await page.getByRole("button", { name: fr.coachPanel.open, exact: true }).click();
  const panel = coachPanelOf(page);
  await panel.getByLabel(fr.coachPanel.messageLabel).fill(message);
  await panel.getByRole("button", { name: fr.coachPanel.send, exact: true }).click();
  await expect(panel.getByRole("button", { name: fr.coachPanel.stop, exact: true })).toBeVisible();
  await panel.getByRole("button", { name: fr.coachPanel.close }).click();
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
  test("the button shows the reply's step and a stop icon; the pane has it here, then « En cours ailleurs »; stopped from the pane", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("ai-activity-live-coach"));
    await page.goto("/candidatures");
    await listenToAnnouncements(page);
    const askedAt = new Date();

    await askThenClose(page, "Comment préparer mon entretien ? E2E_COACH_SLOW=30000");

    // The closed button: the glyph and the step under way, a stop icon beside it.
    const button = aiActivityButton(page);
    await expect(button).toContainText(fr.aiActivity.steps.think_write);
    const glyph = button.locator("svg.activity-glyph");
    await expect(glyph).toBeVisible();
    // Think then write: it moves, its strokes drawn anew frame after frame.
    const strokesOf = () => glyph.evaluate((svg) => [...svg.querySelectorAll("path")].map((path) => path.getAttribute("d") ?? "").join("|"));
    const drawn = await strokesOf();
    await expect.poll(strokesOf, { timeout: 5_000 }).not.toBe(drawn);
    await expect(stopIconOf(page.getByRole("banner"))).toHaveAttribute("title", fr.aiActivity.live.stop.coach_reply);
    await expectNoAxeViolations(page, "header.topbar");

    // The pane: the reply on this page, its step running, its stop icon.
    await button.click();
    const reply = paneOf(page).locator(".ai-activity-live");
    await expect(reply).toContainText(fr.aiActivity.kinds.coach_reply);
    await expect(reply).toContainText(/En cours · \d/);
    await expect(reply.getByRole("list", { name: fr.aiActivity.live.steps })).toContainText(fr.aiActivity.steps.think_write);
    await expect(paneOf(page).locator(".ai-activity-elsewhere")).toHaveCount(0);
    await expectNoAxeViolations(page, "aside.ai-activity-pane");

    // Another page: the reply is « En cours ailleurs », with a link back to where it was asked.
    await page.getByRole("navigation", { name: fr.sidebar.label }).getByRole("link", { name: fr.sidebar.agenda }).click();
    await expect(page).toHaveURL(/\/agenda/);
    await expect(aiActivityButton(page)).toContainText(fr.aiActivity.steps.think_write);
    await aiActivityButton(page).click();
    const elsewhere = paneOf(page).locator(".ai-activity-elsewhere");
    await expect(elsewhere.getByRole("heading", { name: fr.aiActivity.live.elsewhere })).toBeVisible();
    await expect(elsewhere.getByRole("link", { name: fr.aiActivity.live.open.coach_reply })).toHaveAttribute("href", "/candidatures");

    // Stopped from the pane: the AI call is aborted, and the reply is shown stopped, in light red.
    await stopIconOf(elsewhere).click();
    const stopped = elsewhere.locator(".ai-activity-live");
    await expect(stopped).toContainText(/Arrêtée à \d{2}:\d{2}/);
    expect(await stopped.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(await dangerSurface(stopped));
    await expect(stopIconOf(stopped)).toHaveCount(0);
    await expect(stopped.getByRole("listitem").filter({ hasText: fr.aiActivity.steps.think_write })).toContainText(fr.aiActivity.live.stepStopped);
    await expect
      .poll(async () => (await query(`SELECT 1 FROM ai_usage WHERE task = 'coaching' AND at >= $1 AND reason = 'stopped'`, [askedAt])).length)
      .toBeGreaterThan(0);
    await expect(stopIconOf(page.getByRole("banner"))).toHaveCount(0);
    await expectNoAxeViolations(page, "aside.ai-activity-pane");

    // Asked with the Coach Panel open, its start was the panel's to say; its end, the panel closed, AI Activity's. Never a step.
    const said = await announcements(page);
    expect(said).toEqual([fr.aiActivity.live.announce.stopped.coach_reply]);
    for (const text of said) expect(ANNOUNCEMENTS).toContain(text);
  });

  test("stopped from the closed button; a failed reply is shown in light red with its Failure Reason in words", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("ai-activity-live-coach-fail"));
    await page.goto("/candidatures");

    await askThenClose(page, "Une question longue E2E_COACH_SLOW=30000");
    await stopIconOf(page.getByRole("banner")).click();
    await expect(stopIconOf(page.getByRole("banner"))).toHaveCount(0);
    await aiActivityButton(page).click();
    await expect(paneOf(page).locator(".ai-activity-live")).toContainText(/Arrêtée à \d{2}:\d{2}/);
    await paneOf(page).getByRole("button", { name: fr.aiActivity.close }).click();

    // The Coach Panel says it too.
    await page.getByRole("button", { name: fr.coachPanel.open, exact: true }).click();
    await expect(coachPanelOf(page).getByRole("list", { name: fr.coachPanel.messagesLabel }).locator("> li").last()).toContainText(fr.coachPanel.stopped);
    await coachPanelOf(page).getByRole("button", { name: fr.coachPanel.close }).click();

    // A failed reply: the stopped one before it gives way.
    await page.getByRole("button", { name: fr.coachPanel.open, exact: true }).click();
    const panel = coachPanelOf(page);
    await panel.getByLabel(fr.coachPanel.messageLabel).fill("Bonjour E2E_AI_DOWN");
    await panel.getByRole("button", { name: fr.coachPanel.send, exact: true }).click();
    await expect(panel.getByRole("alert")).toContainText(fr.failureReasons.provider_unavailable);
    await panel.getByRole("button", { name: fr.coachPanel.close }).click();

    await aiActivityButton(page).click();
    const failed = paneOf(page).locator(".ai-activity-live");
    await expect(failed).toHaveCount(1);
    await expect(failed).toContainText(/Échec à \d{2}:\d{2}/);
    await expect(failed).toContainText(fr.failureReasons.provider_unavailable);
    expect(await failed.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(await dangerSurface(failed));
    await expect(failed).not.toContainText("503");
    await expectNoAxeViolations(page, "aside.ai-activity-pane");
  });
});
