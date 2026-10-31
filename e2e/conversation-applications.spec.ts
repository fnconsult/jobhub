import path from "node:path";
import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import pg from "pg";
import { newAddress } from "./support/mailbox";
import { signInByEmail, startOwnServer, type OwnServer } from "./support/own-server";

// Issue #604 (ADR-0070): under « Conversation au centre », Mes candidatures is the menu's conversation, one per Candidate:
// its list of Applications (status, Match Score, à traiter) is a card in the thread, each line to its Application, and its
// suggestions sit above the box. In the Sidebar, Mes candidatures unfolds into its most recent Applications, the one open
// highlighted, then « Tout voir (N) »; its fold is remembered in this browser. The switch changes every Candidate's pages,
// so this spec runs on a server of its own (own-server.ts), switched on by its environment; the AI Coach is faked inside
// it (fake-mistral.mjs), and so are the reference data's sources its context reads.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const texts = fr.conversationFirst;
const menuTexts = fr.applicationsMenu;
/** Inside the suite's own range of derived ports (e2e/support/ports.ts), apart from the other specs' servers. */
const PORT_OFFSET = 604;
const tr = (template: string, values: Record<string, string | number>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(values[key] ?? ""));

let server: OwnServer;

const masterCv = {
  fullName: "Marie Dupont",
  headline: "Directrice financière",
  email: "marie.dupont@example.fr",
  phone: "",
  location: "Lyon",
  summary: "",
  experience: [{ title: "Directrice financière", employer: "Groupe Seb", location: "Lyon", period: "2005 – 2024", description: "Consolidation IFRS." }],
  education: [],
  skills: ["IFRS", "SAP"],
  languages: [],
};

async function signedIn(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext({ baseURL: server.origin, locale: "fr-FR" });
  const page = await context.newPage();
  await signInByEmail(page, server, email);
  return page;
}

/** Saves `count` Job Offers as Applications of one Profile, the first saved first: their ids, the latest saved last. */
async function saveApplications(page: Page, titles: readonly string[]): Promise<string[]> {
  const headers = { origin: server.origin };
  const profile = await page.request.post("/api/profiles", { data: { masterCv, searchCriteria: { targetRole: "DAF", locations: ["Lyon"], contractTypes: ["cdi"] } }, headers });
  expect(profile.status(), await profile.text()).toBe(201);
  const ids: string[] = [];
  for (const title of titles) {
    const offer = await page.request.post("/api/job-offers", {
      data: { title, content: `${title} (réf. ${Math.random().toString(36).slice(2)}) : 15 ans d'expérience.`, employer: "Acme Industrie", location: "Lyon", contractType: "cdi", skills: ["IFRS", "SAP"] },
      headers,
    });
    expect(offer.status(), await offer.text()).toBe(200);
    const application = await page.request.post("/api/applications", { data: { jobOfferId: (await offer.json()).id, profileId: (await profile.json()).id }, headers });
    expect(application.ok(), await application.text()).toBe(true);
    ids.push((await application.json()).id);
  }
  return ids;
}

const conversation = (page: Page) => page.getByRole("region", { name: texts.label });
const messages = (page: Page) => conversation(page).getByRole("list", { name: fr.coachPanel.messagesLabel }).getByRole("listitem");
const sidebar = (page: Page) => page.locator(".sidebar-docked").getByRole("navigation", { name: fr.sidebar.label });
const sublist = (page: Page) => sidebar(page).getByRole("list", { name: fr.nav.applications });

async function menuConversationsOf(email: string): Promise<{ subject: string; messages: number }[]> {
  const db = new pg.Client({ connectionString: server.databaseUrl });
  await db.connect();
  try {
    const { rows } = await db.query<{ subject: string; messages: number }>(
      `SELECT c.subject_kind || ':' || c.subject_menu AS subject, (SELECT count(*)::int FROM coach_message m WHERE m.conversation_id = c.id) AS messages
         FROM coach_conversation c JOIN candidate ON candidate.id = c.candidate_id
        WHERE candidate.email = $1 AND c.subject_kind = 'menu'`,
      [email],
    );
    return rows;
  } finally {
    await db.end();
  }
}

test.describe.configure({ mode: "serial" });

test.describe("« Conversation au centre »: Mes candidatures and the Sidebar's sub-lists (#604)", () => {
  test.beforeAll(async () => {
    test.setTimeout(180_000);
    server = await startOwnServer(PORT_OFFSET, "conversation_applications", {
      JOBHUB_TARGET: "e2e",
      JOBHUB_IGNORE_ROOT_ENV: "1",
      AUTH_SECRET: "e2e-applications-secret-e2e-applications-secret",
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

  test("Mes candidatures is its conversation: the list a card in the thread, each line to its Application, a message to the menu's conversation", async ({ browser }) => {
    const email = newAddress("conversation-applications");
    const page = await signedIn(browser, email);
    const [first] = await saveApplications(page, ["DAF H/F", "Contrôleur de gestion"]);

    await page.goto("/candidatures");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(fr.applications.title);
    await expect(messages(page).first()).toContainText(fr.coachPanel.aiDisclosure);
    await expect(messages(page).first()).toContainText(menuTexts.introduction);
    const card = conversation(page).getByRole("region", { name: tr(menuTexts.count_other, { count: 2 }) });
    await expect(card).toBeVisible();
    const rows = card.getByRole("row");
    // The header row, then the latest saved first.
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(1)).toContainText("Contrôleur de gestion · Acme Industrie");
    await expect(rows.nth(2)).toContainText(fr.applicationStatuses.to_apply);
    await expect(rows.nth(2).getByRole("cell").nth(1)).toHaveText(/^\d{1,3}$/);
    const suggestions = conversation(page).getByRole("group", { name: texts.suggestions });
    await expect(suggestions.getByRole("button", { name: fr.quickActions.addApplication })).toBeVisible();
    await expect(suggestions.getByRole("link", { name: fr.quickActions.searchJobOffers })).toBeVisible();
    const axe = await new AxeBuilder({ page }).include(".page-conversation").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(axe.violations.map(({ id }) => id)).toEqual([]);

    // A message goes to the menu's conversation; the page keeps its address and the card stays in the thread.
    await conversation(page).getByRole("textbox", { name: fr.coachPanel.messageLabel }).fill("Laquelle traiter en premier ?");
    await conversation(page).getByRole("button", { name: fr.coachPanel.send, exact: true }).click();
    await expect(messages(page)).toHaveCount(4);
    await expect(page).toHaveURL(`${server.origin}/candidatures`);
    await expect(card).toBeVisible();
    await expect.poll(() => menuConversationsOf(email)).toEqual([{ subject: "menu:applications", messages: 2 }]);
    await expect(sidebar(page).getByRole("link", { name: "Laquelle traiter en premier ?" })).toHaveCount(0);

    // It reopens with its messages.
    await page.reload();
    await expect(messages(page)).toHaveCount(4);

    // Each line opens its Application.
    await card.getByRole("link", { name: "DAF H/F · Acme Industrie" }).click();
    await expect(page).toHaveURL(`${server.origin}/candidatures/${first}`);
  });

  test("the Sidebar unfolds Mes candidatures into its 5 most recent Applications, the open one highlighted, then « Tout voir (N) », its fold remembered", async ({ browser }) => {
    const page = await signedIn(browser, newAddress("conversation-sidebar-lists"));
    const titles = ["Poste 1", "Poste 2", "Poste 3", "Poste 4", "Poste 5", "Poste 6", "Poste 7"];
    const ids = await saveApplications(page, titles);

    await page.goto("/candidatures");
    const links = sublist(page).getByRole("link");
    await expect(links).toHaveText(["Acme Industrie · Poste 7", "Acme Industrie · Poste 6", "Acme Industrie · Poste 5", "Acme Industrie · Poste 4", "Acme Industrie · Poste 3", tr(texts.seeAll, { count: 7 })]);
    await expect(sidebar(page).getByRole("link", { name: fr.nav.applications, exact: true })).toHaveAttribute("aria-current", "page");

    await sublist(page).getByRole("link", { name: "Acme Industrie · Poste 6" }).click();
    await expect(page).toHaveURL(`${server.origin}/candidatures/${ids[5]}`);
    await expect(sublist(page).getByRole("link", { name: "Acme Industrie · Poste 6" })).toHaveAttribute("aria-current", "page");
    await expect(sidebar(page).getByRole("link", { name: fr.nav.applications, exact: true })).not.toHaveAttribute("aria-current", "page");

    // Folded, it stays folded in this browser.
    const fold = sidebar(page).getByRole("button", { name: tr(texts.unfold, { menu: fr.nav.applications }) });
    await fold.click();
    await expect(fold).toHaveAttribute("aria-expanded", "false");
    await expect(sublist(page)).toHaveCount(0);
    await page.goto("/candidatures");
    await expect(sidebar(page).getByRole("button", { name: tr(texts.unfold, { menu: fr.nav.applications }) })).toHaveAttribute("aria-expanded", "false");
    await expect(sublist(page)).toHaveCount(0);
  });
});
