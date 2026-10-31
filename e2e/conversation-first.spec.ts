import path from "node:path";
import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import pg from "pg";
import { newAddress } from "./support/mailbox";
import { signInByEmail, startOwnServer, type OwnServer } from "./support/own-server";

// Issue #601 (ADR-0070): behind the Platform Setting « Conversation au centre », off by default, the Candidate's home page
// is a new Free conversation: the Introduction in its first message, the Quick actions as suggestions above the box at the
// page's foot, replies in the thread. The Sidebar has « Nouvelle conversation » and « Coach » with the Free conversations;
// the Top Bar « Effacer » (a confirming Dialog) in place of « Aide et coach ». The switch changes every Candidate's pages,
// so this spec runs on a server of its own (own-server.ts). The AI Coach is faked inside it (fake-mistral.mjs), and so are
// the reference data's sources its context reads (fake-reference-data.mjs): nothing reaches the real ones.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const texts = fr.conversationFirst;
const settings = fr.admin.platformSettings;
const SUPER_ADMIN = "conversation-office@e2e.jobbbox.test";
const SETTING = "CONVERSATION_FIRST";
/** Inside the suite's own range of derived ports (e2e/support/ports.ts), apart from the other specs' servers. */
const PORT_OFFSET = 601;
const tr = (template: string, values: Record<string, string>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");

let server: OwnServer;

/** A browser page of its own (cookies apart), signed in as `email` on the spec's server. */
async function signedIn(browser: Browser, email: string, colorScheme: "light" | "dark" = "light"): Promise<Page> {
  const context = await browser.newContext({ baseURL: server.origin, locale: "en-US", colorScheme });
  const page = await context.newPage();
  await signInByEmail(page, server, email);
  return page;
}

const conversation = (page: Page) => page.getByRole("region", { name: texts.label });
const messages = (page: Page) => conversation(page).getByRole("list", { name: fr.coachPanel.messagesLabel }).getByRole("listitem");
const topBar = (page: Page) => page.getByRole("banner");
const sidebar = (page: Page) => page.locator(".sidebar-docked").getByRole("navigation", { name: fr.sidebar.label });

async function send(page: Page, text: string) {
  await conversation(page).getByRole("textbox", { name: fr.coachPanel.messageLabel }).fill(text);
  await conversation(page).getByRole("button", { name: fr.coachPanel.send, exact: true }).click();
}

async function freeConversationsOf(email: string): Promise<string[]> {
  const db = new pg.Client({ connectionString: server.databaseUrl });
  await db.connect();
  try {
    const { rows } = await db.query<{ title: string }>(
      `SELECT c.title FROM coach_conversation c JOIN candidate ON candidate.id = c.candidate_id WHERE candidate.email = $1 AND c.subject_kind IS NULL ORDER BY c.title`,
      [email],
    );
    return rows.map((row) => row.title);
  } finally {
    await db.end();
  }
}

test.describe.configure({ mode: "serial" });

test.describe("« Conversation au centre »: the home page is a conversation (#601)", () => {
  test.beforeAll(async () => {
    test.setTimeout(180_000);
    server = await startOwnServer(PORT_OFFSET, "conversation_first", {
      JOBHUB_TARGET: "e2e",
      JOBHUB_IGNORE_ROOT_ENV: "1",
      AUTH_SECRET: "e2e-conversation-secret-e2e-conversation-secret",
      MAIL_TRANSPORT: "console",
      ADMIN_EMAILS: SUPER_ADMIN,
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
      // The AI Coach's context reads the Sectors' and Domains' labels (#236): faked like the suite's server's, or a reply
      // waits on INSEE and France Travail, which may take longer than a test does to answer.
      NODE_OPTIONS: ["fake-google.mjs", "fake-mistral.mjs", "fake-reference-data.mjs"].map((fake) => `--import=${path.resolve("e2e/support", fake)}`).join(" "),
    });
  });

  test.afterAll(async () => {
    await server?.stop();
  });

  test("switched off by default: the home page and the Top Bar are as before", async ({ browser }) => {
    const page = await signedIn(browser, newAddress("conversation-off"));
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(fr.home.title);
    await expect(page.getByRole("navigation", { name: fr.quickActions.label })).toBeVisible();
    await expect(topBar(page).getByRole("button", { name: fr.coachPanel.open })).toBeVisible();
    await expect(conversation(page)).toHaveCount(0);
    await expect(sidebar(page).getByRole("link", { name: texts.newConversation })).toHaveCount(0);
    expect((await page.goto("/conversations/00000000-0000-4000-8000-000000000000"))?.status()).toBe(404);
  });

  test("a super-admin switches it on in Paramètres' Environnement tab, and the Journal records it", async ({ browser }) => {
    const admin = await signedIn(browser, SUPER_ADMIN);
    await admin.goto("/admin/parametres?tab=environnement");
    const row = admin.locator(`tr[data-setting="${SETTING}"]`);
    await expect(row).toContainText(settings.labels[SETTING]);
    await expect(row.getByRole("cell").nth(0)).toHaveText("false");
    await row.getByRole("combobox", { name: tr(settings.newValue, { name: SETTING }) }).selectOption("true");
    await row.getByRole("button", { name: settings.save }).click();
    await expect(admin.getByRole("status").filter({ hasText: SETTING })).toHaveText(tr(settings.notices.saved, { name: SETTING }));
    await expect(row.getByRole("cell").nth(0)).toHaveText("true");

    await admin.goto("/admin/journal?section=platform_settings");
    const saved = admin.getByRole("row").filter({ hasText: SETTING }).filter({ hasText: SUPER_ADMIN }).filter({ hasText: fr.admin.journal.actions.updated });
    await expect(saved).toHaveCount(1);
    await expect(saved).toContainText(tr(fr.admin.journal.changed, { field: settings.journalFields.value, before: "false", after: "true" }));
  });

  test("sign in → the home page is a new conversation → send → the reply → « Effacer »", async ({ browser }) => {
    const email = newAddress("conversation-home");
    const page = await signedIn(browser, email);
    // A change takes effect within seconds, without a restart.
    await expect(async () => {
      await page.goto("/");
      await expect(conversation(page)).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 20_000 });

    // The home page: « Nouvelle conversation », its Introduction, the note, the Quick actions above the box.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(texts.newConversation);
    await expect(topBar(page).getByRole("button", { name: fr.coachPanel.open })).toHaveCount(0);
    await expect(topBar(page).getByRole("button", { name: texts.clear })).toBeVisible();
    const introduction = messages(page).first();
    await expect(introduction).toContainText(fr.coachPanel.aiDisclosure);
    await expect(introduction).toContainText(fr.app.tagline);
    await expect(introduction).toContainText(fr.home.comingSoon);
    const suggestions = conversation(page).getByRole("group", { name: texts.suggestions });
    await expect(suggestions.getByRole("link", { name: fr.quickActions.searchJobOffers })).toBeVisible();
    await expect(suggestions.getByRole("button", { name: fr.quickActions.addApplication })).toBeVisible();
    await expect(conversation(page).getByText(fr.coachPanel.badge, { exact: true })).toBeVisible();
    // The Sidebar: « Nouvelle conversation » and « Coach », and its links still there.
    await expect(sidebar(page).getByRole("link", { name: texts.newConversation })).toBeVisible();
    await expect(sidebar(page).getByRole("button", { name: texts.coach, exact: true })).toHaveAttribute("aria-expanded", "true");
    await expect(sidebar(page).getByRole("link", { name: fr.nav.applications })).toBeVisible();
    await expect(sidebar(page).getByRole("link", { name: fr.sidebar.agenda })).toBeVisible();

    // Its reading width, 46rem, centred in its space: equal margins.
    const main = await page.locator("main").boundingBox();
    const thread = await conversation(page).locator(".page-conversation-thread").boundingBox();
    const rem = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
    expect(thread!.width).toBeCloseTo(46 * rem, 0);
    expect(Math.abs(thread!.x - main!.x - (main!.x + main!.width - thread!.x - thread!.width))).toBeLessThanOrEqual(2);

    // Sending: « Arrêter » while the reply is on its way, then the reply with its Provenance line and « Cela répond à votre question ? ».
    await send(page, "Comment préparer mon entretien ? E2E_COACH_SLOW=2000");
    await expect(conversation(page).getByRole("button", { name: fr.coachPanel.stop, exact: true })).toBeVisible();
    await expect(suggestions).toHaveCount(0);
    await expect(messages(page)).toHaveCount(3);
    const reply = messages(page).last();
    await expect(reply.locator(".provenance-line")).toContainText("Mistral Large");
    await expect(reply.getByRole("group", { name: fr.coachPanel.team.answered })).toBeVisible();
    await expect(conversation(page).getByRole("button", { name: fr.coachPanel.send, exact: true })).toBeEnabled();
    // The page is now that Free conversation: its address, and its line under « Coach ».
    await expect(page).toHaveURL(/\/conversations\/[0-9a-f-]{36}$/);
    const title = "Comment préparer mon entretien ? E2E_COACH_SLOW=2000";
    await expect(sidebar(page).getByRole("link", { name: title })).toHaveAttribute("aria-current", "page");
    const axe = await new AxeBuilder({ page }).include(".page-conversation").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(axe.violations.map(({ id }) => id)).toEqual([]);

    // It reopens with its messages.
    await page.reload();
    await expect(messages(page)).toHaveCount(3);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);

    // « Effacer »: a confirming Dialog, the focus on « Annuler », which deletes nothing.
    await topBar(page).getByRole("button", { name: texts.clear }).click();
    const dialog = page.getByRole("alertdialog", { name: texts.clearTitle });
    await expect(dialog).toContainText(texts.clearText);
    await expect(dialog.getByRole("button", { name: fr.designSystem.cancel })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(dialog).toHaveCount(0);
    await expect(messages(page)).toHaveCount(3);

    // Confirmed, every message of the page's conversation goes; the page is a new conversation again.
    await topBar(page).getByRole("button", { name: texts.clear }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: texts.clear }).click();
    await expect(conversation(page).getByRole("status").filter({ hasText: texts.cleared })).toBeVisible();
    await expect(messages(page)).toHaveCount(1);
    await expect(conversation(page).getByRole("group", { name: texts.suggestions })).toBeVisible();
    await expect(page).toHaveURL(`${server.origin}/`);
    await expect(sidebar(page).getByRole("link", { name: title })).toHaveCount(0);
    expect(await freeConversationsOf(email)).toEqual([]);
  });

  test("the Sidebar renames and deletes a Free conversation, « Nouvelle conversation » starts afresh", async ({ browser }) => {
    const email = newAddress("conversation-sidebar");
    const page = await signedIn(browser, email);
    await page.goto("/");
    await send(page, "Premier sujet");
    await expect(messages(page)).toHaveCount(3);
    await expect(sidebar(page).getByRole("link", { name: "Premier sujet" })).toBeVisible();

    await sidebar(page).getByRole("link", { name: texts.newConversation }).click();
    await expect(messages(page)).toHaveCount(1);
    await expect(page).toHaveURL(`${server.origin}/`);
    await send(page, "Second sujet");
    await expect(messages(page)).toHaveCount(3);
    await expect.poll(() => freeConversationsOf(email)).toEqual(["Premier sujet", "Second sujet"]);

    // Renamed from its actions.
    await sidebar(page).getByRole("button", { name: tr(texts.actions, { title: "Premier sujet" }) }).click();
    await page.getByRole("menuitem", { name: fr.coachPanel.rename }).click();
    const name = sidebar(page).getByRole("textbox", { name: texts.nameLabel });
    await name.fill("Mon pitch");
    await name.press("Enter");
    await expect(sidebar(page).getByRole("link", { name: "Mon pitch" })).toBeVisible();
    await expect.poll(() => freeConversationsOf(email)).toEqual(["Mon pitch", "Second sujet"]);

    // Opened from the Sidebar, it is the page.
    await sidebar(page).getByRole("link", { name: "Mon pitch" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Mon pitch");
    await expect(messages(page).nth(1)).toContainText("Premier sujet");

    // Deleted after a confirming Dialog: the page it was shows a new conversation.
    await sidebar(page).getByRole("button", { name: tr(texts.actions, { title: "Mon pitch" }) }).click();
    await page.getByRole("menuitem", { name: fr.coachPanel.delete }).click();
    const dialog = page.getByRole("alertdialog", { name: tr(texts.deleteTitle, { title: "Mon pitch" }) });
    await expect(dialog.getByRole("button", { name: fr.designSystem.cancel })).toBeFocused();
    await dialog.getByRole("button", { name: fr.coachPanel.delete }).click();
    await expect(sidebar(page).getByRole("link", { name: "Mon pitch" })).toHaveCount(0);
    await expect(messages(page)).toHaveCount(1);
    await expect.poll(() => freeConversationsOf(email)).toEqual(["Second sujet"]);
  });

  // #602 (ADR-0070): the Work Pane beside the conversation, never over it, where the help and the Candidate's forms open.
  test("the help opens in the Work Pane: suggestions while typing, « Comment marche cette page ? », « Demander au coach »", async ({ browser }) => {
    const page = await signedIn(browser, newAddress("work-pane-help"));
    await page.goto("/");
    await expect(conversation(page)).toBeVisible();
    const pane = page.getByRole("complementary").filter({ has: page.locator(".work-pane-head") });
    const box = conversation(page).getByRole("textbox", { name: fr.coachPanel.messageLabel });

    // « Comment marche cette page ? », while the conversation is empty: the page's article, beside it.
    const howItWorks = conversation(page).getByRole("button", { name: texts.howThisPageWorks });
    await howItWorks.click();
    await expect(pane).toHaveCount(1);
    await expect(pane.getByRole("heading", { level: 2, name: "Accueil" })).toBeFocused();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // Beside the conversation, never over it: the thread ends before the pane starts.
    const thread = await conversation(page).locator(".page-conversation-thread").boundingBox();
    const beside = await pane.boundingBox();
    expect(thread!.x + thread!.width).toBeLessThanOrEqual(beside!.x);
    const axe = await new AxeBuilder({ page }).include(".work-pane").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(axe.violations.map(({ id }) => id)).toEqual([]);
    // Escape gives the focus back to what opened it.
    await page.keyboard.press("Escape");
    await expect(pane).toHaveCount(0);
    await expect(howItWorks).toBeFocused();

    // While typing, the help's articles, without AI, take the suggestions' place above the box.
    await box.fill("relance");
    const found = conversation(page).getByRole("list", { name: fr.coachPanel.help.suggestions });
    await expect(found).toBeVisible();
    await expect(conversation(page).getByRole("group", { name: texts.suggestions })).toHaveCount(0);
    const suggestion = found.getByRole("button", { name: /^Relance/ });
    await suggestion.click();
    await expect(pane.getByRole("heading", { level: 2, name: "Relance" })).toBeFocused();
    await expect(messages(page)).toHaveCount(1);
    await pane.getByRole("button", { name: texts.close }).click();
    await expect(pane).toHaveCount(0);
    await expect(suggestion).toBeFocused();

    // « Demander au coach »: the box starts a question about the article, which stays open beside it.
    await suggestion.click();
    await pane.getByRole("button", { name: texts.askCoach }).click();
    await expect(box).toBeFocused();
    await expect(box).toHaveValue(tr(fr.coachPanel.help.askAbout, { title: "Relance" }));
    await expect(pane).toHaveCount(1);
  });

  test("Signalements and Coach Memory open in the Work Pane, no Drawer; Mon compte has « Aide »", async ({ browser }) => {
    const page = await signedIn(browser, newAddress("work-pane-forms"));
    await page.goto("/");
    await expect(conversation(page)).toBeVisible();
    const pane = page.getByRole("complementary").filter({ has: page.locator(".work-pane-head") });

    // « Signaler un problème », under the box: its form in the Work Pane, sent from there.
    await conversation(page).getByRole("button", { name: fr.coachPanel.team.reportProblem }).click();
    await expect(pane.getByRole("heading", { level: 2, name: fr.signalement.title })).toBeFocused();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await pane.getByRole("textbox").fill("Le bouton Envoyer ne répond pas sur la page des offres.");
    await pane.getByRole("button", { name: fr.signalement.send }).click();
    await expect(pane.getByText(fr.signalement.thanks)).toBeVisible();

    // The icon beside « Mon compte » too.
    const icon = page.locator(".sidebar-docked").getByRole("button", { name: fr.signalement.open });
    await icon.click();
    await expect(pane.getByRole("heading", { level: 2, name: fr.signalement.title })).toBeFocused();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(pane).toHaveCount(0);
    await expect(icon).toBeFocused();

    // « Mémoire du coach » under « Coach »: the Coach Memory in the Work Pane.
    const memory = sidebar(page).getByRole("button", { name: fr.coachMemory.open });
    await memory.click();
    await expect(pane.getByRole("heading", { level: 2, name: fr.coachMemory.title })).toBeFocused();
    await expect(pane.getByText(fr.coachMemory.empty)).toBeVisible();
    await pane.getByRole("button", { name: texts.close }).click();
    await expect(memory).toBeFocused();

    // Mon compte, a page without a conversation: « Aide » in the Top Bar opens its article; « Demander au coach » starts
    // a Free conversation about it.
    await page.goto("/compte/relances");
    await expect(topBar(page).getByRole("button", { name: texts.clear })).toHaveCount(0);
    await topBar(page).getByRole("button", { name: texts.help, exact: true }).click();
    await expect(pane.getByRole("heading", { level: 2, name: "Mon compte" })).toBeFocused();
    await pane.getByRole("link", { name: texts.askCoach }).click();
    await expect(page).toHaveURL(`${server.origin}/`);
    const box = conversation(page).getByRole("textbox", { name: fr.coachPanel.messageLabel });
    await expect(box).toHaveValue(tr(fr.coachPanel.help.askAbout, { title: "Mon compte" }));
    await expect(box).toBeFocused();
    await expect(topBar(page).getByRole("button", { name: texts.help, exact: true })).toHaveCount(0);

    // On a phone the Work Pane takes the whole screen.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/compte");
    await topBar(page).getByRole("button", { name: texts.help, exact: true }).click();
    await expect(pane.getByRole("heading", { level: 2, name: "Mon compte" })).toBeFocused();
    expect(await pane.boundingBox()).toEqual({ x: 0, y: 0, width: 390, height: 844 });
  });

  test("in the dark theme, the conversation and its box are drawn on the dark tokens, in the Confort Density", async ({ browser }) => {
    const page = await signedIn(browser, newAddress("conversation-dark"), "dark");
    await page.goto("/");
    await expect(conversation(page)).toBeVisible();
    const colours = await page.evaluate(() => {
      const foot = document.querySelector(".page-conversation-foot")!;
      const box = document.querySelector(".page-conversation textarea")!;
      return { body: getComputedStyle(document.body).backgroundColor, foot: getComputedStyle(foot).backgroundColor, text: getComputedStyle(box).fontSize };
    });
    // The page's background, dark: the box's foot is drawn on it, not on a light one.
    const [r, g, b] = colours.body.match(/\d+/g)!.map(Number);
    expect(r! + g! + b!).toBeLessThan(3 * 80);
    expect(colours.foot).toBe(colours.body);
    // Confort: the 16px body-text floor.
    expect(parseFloat(colours.text)).toBeGreaterThanOrEqual(16);
    const axe = await new AxeBuilder({ page }).include(".page-conversation").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(axe.violations.map(({ id }) => id)).toEqual([]);
  });
});
