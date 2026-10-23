import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";
import { chooseInPanelMenu } from "./support/coach-panel";

// Issue #324 (AI Act art. 50(1)): the AI Coach says it is an AI, not a person. Every new
// Coach Conversation opens with a fixed first message, never an AI reply; a « Coach IA »
// badge sits by the message box and « Coach IA » is the Coach Panel's title, at every width.
// Driven in the browser through the Coach Panel; the AI Coach is faked inside the server (fake-mistral.mjs).
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const en = JSON.parse(readFileSync("packages/shared/src/i18n/locales/en.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;

const panelOf = (page: Page, texts: typeof fr) => page.getByRole("complementary", { name: texts.coachPanel.title });
const messagesOf = (page: Page, texts: typeof fr) => panelOf(page, texts).getByRole("list", { name: texts.coachPanel.messagesLabel }).locator("> li");
/** The badge by the message box. */
const badgeOf = (page: Page, texts: typeof fr) => panelOf(page, texts).locator("form").getByText(texts.coachPanel.badge, { exact: true });

/** Counts the messages sent to the AI Coach from now on. */
function countCoachCalls(page: Page): () => number {
  let calls = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/coach") calls += 1;
  });
  return () => calls;
}

async function ask(page: Page, text: string) {
  await panelOf(page, fr).getByLabel(fr.coachPanel.messageLabel).fill(text);
  await panelOf(page, fr).getByRole("button", { name: fr.coachPanel.send }).click();
}

test.describe("the AI Coach says it is an AI", () => {
  test("a new conversation opens with the fixed message before any reply, with no AI call, and keeps it once saved", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("ai-disclosure"));
    const coachCalls = countCoachCalls(page);
    await page.getByRole("button", { name: fr.coachPanel.open, exact: true }).click();

    const messages = messagesOf(page, fr);
    await expect(messages).toHaveCount(1);
    await expect(messages.first()).toContainText(fr.coachPanel.aiDisclosure);
    await expect(panelOf(page, fr)).not.toContainText(fr.coachPanel.welcome);
    // Real text, read by screen readers: it is in the accessibility tree, as are the title and the badge.
    const tree = await panelOf(page, fr).ariaSnapshot();
    expect(tree).toContain(fr.coachPanel.aiDisclosure);
    expect(tree).toContain(`heading "${fr.coachPanel.title}" [level=2]`);
    expect(tree.split(fr.coachPanel.badge).length).toBeGreaterThanOrEqual(3);
    await expect(panelOf(page, fr).getByRole("heading", { level: 2, name: fr.coachPanel.title })).toBeVisible();
    await expect(badgeOf(page, fr)).toBeVisible();
    expect(coachCalls()).toBe(0);

    await ask(page, "Bonjour");
    await expect(messages).toHaveCount(3);
    await expect(messages.first()).toContainText(fr.coachPanel.aiDisclosure);
    expect(coachCalls()).toBe(1);

    // Reopened after a reload, the saved conversation still opens with it.
    await page.reload();
    await page.getByRole("button", { name: fr.coachPanel.open, exact: true }).click();
    await expect(messages).toHaveCount(3);
    await expect(messages.first()).toContainText(fr.coachPanel.aiDisclosure);

    // And so does the next new one.
    await chooseInPanelMenu(panelOf(page, fr), fr.coachPanel.newConversation);
    await expect(messages).toHaveCount(1);
    await expect(messages.first()).toContainText(fr.coachPanel.aiDisclosure);
  });

  test("in English, the message, the badge and the title are in English", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("ai-disclosure-en"));
    const switched = await page.request.post("/api/auth/update-user", { data: { interfaceLanguage: "en" }, headers: { origin } });
    expect(switched.ok()).toBe(true);
    await page.reload();
    const coachCalls = countCoachCalls(page);
    await page.getByRole("button", { name: en.coachPanel.open, exact: true }).click();

    await expect(messagesOf(page, en).first()).toContainText(en.coachPanel.aiDisclosure);
    await expect(panelOf(page, en).getByRole("heading", { level: 2, name: en.coachPanel.title })).toBeVisible();
    await expect(badgeOf(page, en)).toBeVisible();
    expect(coachCalls()).toBe(0);
  });

  test("the badge and the title are visible at every width, the phone's full screen included", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("ai-disclosure-widths"));
    for (const viewport of [
      { width: 375, height: 812 },
      { width: 768, height: 1024 },
      { width: 1280, height: 800 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto("/compte");
      await page.getByRole("button", { name: fr.coachPanel.open, exact: true }).click();
      await expect(panelOf(page, fr).getByRole("heading", { level: 2, name: fr.coachPanel.title }), `title at ${viewport.width}px`).toBeInViewport({ ratio: 1 });
      await expect(badgeOf(page, fr), `badge at ${viewport.width}px`).toBeInViewport({ ratio: 1 });
      await expect(messagesOf(page, fr).first(), `message at ${viewport.width}px`).toContainText(fr.coachPanel.aiDisclosure);
    }
  });

  test("a conversation saved before shows the badge, but no first message is added to it", async ({ page }) => {
    const email = newAddress("ai-disclosure-before");
    await signInWithMagicLink(page, email);
    const db = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL });
    await db.connect();
    try {
      // As a conversation saved before #324 was: no AI disclosure.
      const { rows } = await db.query(
        `INSERT INTO coach_conversation (candidate_id, title) SELECT id, 'Ancienne conversation' FROM candidate WHERE email = $1 RETURNING id`,
        [email],
      );
      await db.query(`INSERT INTO coach_message (conversation_id, author, text) VALUES ($1, 'candidate', 'Bonjour'), ($1, 'coach', 'Bonjour Marie.')`, [rows[0].id]);
    } finally {
      await db.end();
    }

    await page.getByRole("button", { name: fr.coachPanel.open, exact: true }).click();
    await chooseInPanelMenu(panelOf(page, fr), fr.coachPanel.conversations);
    await panelOf(page, fr).getByRole("button", { name: "Ancienne conversation" }).click();

    const messages = messagesOf(page, fr);
    await expect(messages).toHaveCount(3);
    await expect(panelOf(page, fr)).not.toContainText(fr.coachPanel.aiDisclosure);
    await expect(badgeOf(page, fr)).toBeVisible();
    await expect(panelOf(page, fr).getByRole("heading", { level: 2, name: fr.coachPanel.title })).toBeVisible();
  });
});
