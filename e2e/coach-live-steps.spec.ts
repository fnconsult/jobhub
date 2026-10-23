import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import pg from "pg";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #328: before each AI Coach reply the Coach Panel shows each step live (its Activity's glyph and its label), then
// the reply and its line. While a reply is on its way « Envoyer » becomes « Arrêter »: a Stop aborts the AI call (AI Usage
// records it `stopped`), saves no reply, keeps the question and says « Réponse arrêtée » in light red. A failed reply says
// its translated Failure Reason, never the technical message. The AI is faked inside the server (fake-mistral.mjs):
// "E2E_COACH_SLOW=<ms>" makes the reply take that long, "E2E_AI_DOWN" makes Mistral answer 503.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));

const panelOf = (page: Page) => page.getByRole("complementary", { name: fr.coachPanel.title });
const messagesOf = (panel: Locator) => panel.getByRole("list", { name: fr.coachPanel.messagesLabel }).locator("> li");
const stepOf = (panel: Locator) => panel.locator(".coach-panel-step");

async function openPanel(page: Page, who: string): Promise<{ email: string; panel: Locator }> {
  const email = newAddress(who);
  await signInWithMagicLink(page, email);
  await page.getByRole("button", { name: fr.coachPanel.open, exact: true }).click();
  return { email, panel: panelOf(page) };
}

async function ask(panel: Locator, text: string) {
  await panel.getByLabel(fr.coachPanel.messageLabel).fill(text);
  await panel.getByRole("button", { name: fr.coachPanel.send, exact: true }).click();
}

async function query<T extends pg.QueryResultRow>(sql: string, values: unknown[]): Promise<T[]> {
  const db = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL });
  await db.connect();
  try {
    return (await db.query<T>(sql, values)).rows;
  } finally {
    await db.end();
  }
}

/** The Candidate's saved messages, oldest first. */
const savedMessages = (email: string) =>
  query<{ author: string; text: string }>(
    `SELECT m.author, m.text FROM coach_message m JOIN coach_conversation c ON c.id = m.conversation_id JOIN candidate ON candidate.id = c.candidate_id
      WHERE candidate.email = $1 ORDER BY m.seq`,
    [email],
  );

test.describe("each step of an AI Coach reply live, and Stop", () => {
  test("a reply shows each step live (its glyph and label, never announced), then the reply and its line", async ({ page }) => {
    const { panel } = await openPanel(page, "live-steps");

    await ask(panel, "Comment préparer mon entretien ? E2E_COACH_SLOW=2500");

    // The step under way: the reply being written, its Activity's glyph beside its label.
    const step = stepOf(panel);
    await expect(step).toContainText(fr.aiActivity.steps.think_write);
    await expect(step.locator("svg.activity-glyph")).toBeVisible();
    // Only the start and the end are announced: the step line is not a live region.
    expect(await step.evaluate((element) => element.closest("[aria-live], [role=status], [role=alert]"))).toBeNull();
    await expect(panel.getByRole("status")).toHaveText(fr.coachPanel.thinking);
    await expect(panel.getByRole("button", { name: fr.coachPanel.stop, exact: true })).toBeVisible();
    const axe = await new AxeBuilder({ page }).include("aside.coach-panel").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(axe.violations.map(({ id }) => id)).toEqual([]);

    const messages = messagesOf(panel);
    await expect(messages).toHaveCount(3);
    await expect(messages.last()).toContainText("Je ne vois aucun profil.");
    await expect(messages.last().locator(".provenance-line")).toContainText("Mistral Large");
    await expect(step).toHaveCount(0);
    await expect(panel.getByRole("button", { name: fr.coachPanel.send, exact: true })).toBeEnabled();
  });

  test("Stop aborts the AI call (AI Usage: stopped), keeps the question with no reply, says « Réponse arrêtée », and « Envoyer » comes back", async ({ page }) => {
    const { email, panel } = await openPanel(page, "live-stop");
    const askedAt = new Date();

    await ask(panel, "Une question longue à traiter E2E_COACH_SLOW=30000");
    await expect(stepOf(panel)).toContainText(fr.aiActivity.steps.think_write);
    await panel.getByRole("button", { name: fr.coachPanel.stop, exact: true }).click();

    const messages = messagesOf(panel);
    await expect(messages).toHaveCount(3);
    await expect(messages.nth(1)).toContainText("Une question longue à traiter");
    const stopped = messages.last();
    await expect(stopped).toContainText(fr.coachPanel.stopped);
    // In very light red, with the tokens and time spent on that line.
    expect(await stopped.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
      await stopped.evaluate((element) => {
        const probe = document.createElement("div");
        probe.style.background = "var(--color-danger-surface)";
        element.append(probe);
        const color = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return color;
      }),
    );
    await expect(stopped).toContainText(/\d+(,\d)?k? .*· \d+(,\d)? ?(ms|s|min)/);
    await expect(panel.getByRole("button", { name: fr.coachPanel.send, exact: true })).toBeVisible();
    await expect(panel.getByRole("button", { name: fr.coachPanel.stop, exact: true })).toHaveCount(0);

    // The AI request was aborted: AI Usage records it stopped. The question is saved, no reply.
    await expect
      .poll(async () => (await query<{ reason: string }>(`SELECT reason FROM ai_usage WHERE task = 'coaching' AND at >= $1 AND reason = 'stopped'`, [askedAt])).length)
      .toBeGreaterThan(0);
    await expect.poll(() => savedMessages(email)).toEqual([{ author: "candidate", text: "Une question longue à traiter E2E_COACH_SLOW=30000" }]);

    // The conversation goes on in the same conversation, and reopens with the question.
    await ask(panel, "Et maintenant ?");
    await expect(messagesOf(panel)).toHaveCount(5);
    await expect.poll(async () => (await savedMessages(email)).map((message) => message.author)).toEqual(["candidate", "candidate", "coach"]);
    await page.reload();
    await page.getByRole("button", { name: fr.coachPanel.open, exact: true }).click();
    await expect(messagesOf(panelOf(page))).toHaveCount(4);
  });

  test("Stop during the input Guardrail check aborts it at once (AI Usage: stopped), and a message sent right after follows the stopped question", async ({ page }) => {
    const { email, panel } = await openPanel(page, "live-stop-guardrail");
    const askedAt = new Date();

    // The input check takes 12 s (past its 8 s timeout) unless it is aborted.
    await ask(panel, "Salut E2E_GUARDRAIL_SLOW");
    await expect(stepOf(panel)).toBeVisible();
    await panel.getByRole("button", { name: fr.coachPanel.stop, exact: true }).click();
    await expect(messagesOf(panel).last()).toContainText(fr.coachPanel.stopped);

    // Sent at once, before the stopped question may be saved: it waits for it, then is answered in the same conversation.
    await ask(panel, "Bonjour");
    await expect(messagesOf(panel)).toHaveCount(5);
    await expect(panel.getByRole("alert")).toHaveCount(0);
    expect(await savedMessages(email)).toEqual([
      { author: "candidate", text: "Salut E2E_GUARDRAIL_SLOW" },
      { author: "candidate", text: "Bonjour" },
      { author: "coach", text: expect.any(String) },
    ]);
    // The check's AI request was aborted, well before its timeout: AI Usage records it stopped.
    const stoppedChecks = () => query(`SELECT 1 FROM ai_usage WHERE task = 'guardrail' AND at >= $1 AND reason = 'stopped'`, [askedAt]);
    await expect.poll(async () => (await stoppedChecks()).length, { timeout: 3_000 }).toBe(1);
  });

  test("a failed reply says its translated Failure Reason in light red, never the technical message", async ({ page }) => {
    const { email, panel } = await openPanel(page, "live-failure");

    await ask(panel, "Bonjour E2E_AI_DOWN");

    const failure = panel.getByRole("alert");
    await expect(failure).toContainText(fr.failureReasons.provider_unavailable);
    await expect(failure).not.toContainText("upstream unavailable");
    await expect(failure).not.toContainText("503");
    await expect(failure).toHaveClass(/notice-failed/);
    // The message is given back to send again; nothing is saved.
    await expect(panel.getByLabel(fr.coachPanel.messageLabel)).toHaveValue("Bonjour E2E_AI_DOWN");
    await expect(panel.getByRole("button", { name: fr.coachPanel.send, exact: true })).toBeEnabled();
    expect(await savedMessages(email)).toEqual([]);
  });
});
