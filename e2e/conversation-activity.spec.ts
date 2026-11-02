import path from "node:path";
import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import pg from "pg";
import { newAddress } from "./support/mailbox";
import { signInByEmail, startOwnServer, type OwnServer } from "./support/own-server";

// Issue #607 (ADR-0070): under « Conversation au centre », « Activité » in the Top Bar of the home page and the menus opens
// and closes the Activité column beside the conversation, never over it, with no heading nor ✕: the Context bar, then AI
// Activity. The Context bar says the conversation's messages out of the 40 the AI Coach reads and the jetons of its context
// out of the 12k ceiling, as the server estimated the context it sent; from 80 % it says the coach reads only the latest
// messages and offers « Effacer la conversation » behind a confirming Dialog. The switch changes every Candidate's pages,
// so this spec runs on a server of its own (own-server.ts), the switch on from its environment. The AI Coach is faked
// inside it (fake-mistral.mjs), and so are the reference data's sources (fake-reference-data.mjs).
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const texts = fr.conversationFirst;
const bar = fr.contextBar;
/** Inside the suite's own range of derived ports (e2e/support/ports.ts), apart from the other specs' servers. */
const PORT_OFFSET = 607;

let server: OwnServer;

async function query<T extends pg.QueryResultRow>(sql: string, values: unknown[]): Promise<T[]> {
  const db = new pg.Client({ connectionString: server.databaseUrl });
  await db.connect();
  try {
    return (await db.query<T>(sql, values)).rows;
  } finally {
    await db.end();
  }
}

async function signedIn(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext({ baseURL: server.origin, locale: "en-US", viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  await signInByEmail(page, server, email);
  return page;
}

const conversation = (page: Page) => page.getByRole("region", { name: texts.label });
const messages = (page: Page) => conversation(page).getByRole("list", { name: fr.coachPanel.messagesLabel }).getByRole("listitem");
const topBar = (page: Page) => page.getByRole("banner");
const activityButton = (page: Page) => topBar(page).getByRole("button", { name: fr.fiche.activity, exact: true });
const column = (page: Page) => page.getByRole("complementary", { name: fr.fiche.activity, exact: true });
const contextBar = (page: Page) => column(page).getByRole("group", { name: bar.title });

async function send(page: Page, text: string) {
  await conversation(page).getByRole("textbox", { name: fr.coachPanel.messageLabel }).fill(text);
  await conversation(page).getByRole("button", { name: fr.coachPanel.send, exact: true }).click();
}

test.describe.configure({ mode: "serial" });

test.describe("« Conversation au centre »: the Activité column and the Context bar (#607)", () => {
  test.beforeAll(async () => {
    test.setTimeout(180_000);
    server = await startOwnServer(PORT_OFFSET, "conversation_activity", {
      JOBHUB_TARGET: "e2e",
      JOBHUB_IGNORE_ROOT_ENV: "1",
      AUTH_SECRET: "e2e-conversation-activity-e2e-conversation-activity",
      MAIL_TRANSPORT: "console",
      CONVERSATION_FIRST: "true",
      AI_SCORING_PROVIDER: "mistral",
      AI_WRITING_PROVIDER: "mistral",
      AI_COACHING_PROVIDER: "mistral",
      AI_CV_PARSING_PROVIDER: "mistral",
      AI_OFFER_ANALYSIS_PROVIDER: "mistral",
      AI_OFFER_EMAIL_READING_PROVIDER: "mistral",
      MISTRAL_API_KEY: "e2e-mistral-key",
      STRIPE_SECRET_KEY: "sk_test_fake",
      STRIPE_WEBHOOK_SECRET: "whsec_test_fake",
      STRIPE_PRICE_STANDARD: "price_standard_monthly",
      STRIPE_PRICE_PREMIUM: "price_premium_monthly",
      STRIPE_PRICE_COACHING_SESSION: "price_coaching_session",
      STRIPE_PRICE_COACHING_SESSION_PREMIUM: "price_coaching_session_premium",
      STRIPE_API_URL: process.env.E2E_STRIPE_URL,
      NODE_OPTIONS: ["fake-google.mjs", "fake-mistral.mjs", "fake-reference-data.mjs"].map((fake) => `--import=${path.resolve("e2e/support", fake)}`).join(" "),
    });
  });

  test.afterAll(async () => {
    await server?.stop();
  });

  test("the home page: « Activité » opens the column beside the conversation, the Context bar counting what the server sent", async ({ browser }) => {
    const page = await signedIn(browser, newAddress("conversation-activity"));
    await page.goto("/");

    // « Activité » in place of AI Activity's button; the column closed.
    await expect(activityButton(page)).toHaveAttribute("aria-expanded", "false");
    await expect(topBar(page).getByRole("button", { name: new RegExp(`^${fr.aiActivity.label}`) })).toHaveCount(0);
    await expect(column(page)).toHaveCount(0);

    // Opened: beside the conversation, never over it, with no heading nor ✕; the Context bar empty before the first message.
    await activityButton(page).click();
    await expect(activityButton(page)).toHaveAttribute("aria-expanded", "true");
    await expect(contextBar(page)).toContainText("0 / 40 messages · 0 / 12k jetons");
    await expect(column(page).getByRole("heading", { level: 2 })).toHaveCount(0);
    await expect(column(page).getByRole("button", { name: fr.aiActivity.close })).toHaveCount(0);
    const thread = await conversation(page).locator(".page-conversation-thread").boundingBox();
    const beside = await column(page).boundingBox();
    expect(beside!.x).toBeGreaterThanOrEqual(thread!.x + thread!.width);

    // A reply: its messages, and the jetons of the context it was sent, never « tokens ».
    await send(page, "Comment préparer mon entretien ?");
    await expect(messages(page)).toHaveCount(3);
    await expect(contextBar(page)).toContainText(/(^|\D)2 \/ 40 messages · [\d,]+k? \/ 12k jetons/);
    await expect(contextBar(page)).not.toContainText("tokens");
    await expect(contextBar(page).getByRole("button", { name: bar.clear })).toHaveCount(0);
    const axe = await new AxeBuilder({ page }).include(".activity-column").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(axe.violations.map(({ id }) => id)).toEqual([]);

    // Closed again.
    await activityButton(page).click();
    await expect(column(page)).toHaveCount(0);
  });

  test("from 80 %, the coach reads only the latest messages: « Effacer la conversation », after a confirming Dialog", async ({ browser }) => {
    const page = await signedIn(browser, newAddress("conversation-activity-full"));
    await page.goto("/");
    await send(page, "Premier message");
    await expect(messages(page)).toHaveCount(3);
    await expect(page).toHaveURL(/\/conversations\/[0-9a-f-]{36}$/);
    const id = page.url().split("/").pop()!;
    // 32 more messages: 34 of the 40 the coach reads.
    await query(
      `INSERT INTO coach_message (conversation_id, author, text) SELECT $1, CASE WHEN n % 2 = 0 THEN 'candidate' ELSE 'coach' END, 'Message ' || n FROM generate_series(1, 32) n`,
      [id],
    );

    await page.reload();
    await activityButton(page).click();
    await expect(contextBar(page)).toContainText("34 / 40 messages");
    await expect(contextBar(page)).toContainText(bar.nearlyFull);
    await contextBar(page).getByRole("button", { name: bar.clear }).click();
    const dialog = page.getByRole("alertdialog", { name: texts.clearTitle });
    await expect(dialog.getByRole("button", { name: fr.designSystem.cancel })).toBeFocused();
    await dialog.getByRole("button", { name: texts.clear }).click();

    await expect(conversation(page).getByRole("status").filter({ hasText: texts.cleared })).toBeVisible();
    await expect(contextBar(page)).toContainText("0 / 40 messages · 0 / 12k jetons");
    expect(await query("SELECT 1 FROM coach_conversation WHERE id = $1", [id])).toEqual([]);
  });

  test("a menu's page: « Activité » opens the same column", async ({ browser }) => {
    const page = await signedIn(browser, newAddress("conversation-activity-menu"));
    await page.goto("/candidatures");
    await activityButton(page).click();
    await expect(contextBar(page)).toContainText("0 / 40 messages");
  });
});
