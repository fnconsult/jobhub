import path from "node:path";
import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import pg from "pg";
import { newAddress } from "./support/mailbox";
import { signInByEmail, startOwnServer, type OwnServer } from "./support/own-server";

// Issue #603 (ADR-0070): under « Conversation au centre », an Application's page is its Coach Conversation, whose Subject
// it is: the Introduction and the Application's suggestions until its first message. Beside it the Fiche, which « Fiche »
// and « Activité » in the Top Bar alone open and close: the Application's card, then its Sections, its Activity and its
// Results, each group folding. A Section or a Result opens in the Work Pane at its own address. The switch changes every
// Candidate's pages, so this spec runs on a server of its own (own-server.ts), the switch on from its environment. The AI
// Coach is faked inside it (fake-mistral.mjs), and so are the reference data's sources (fake-reference-data.mjs).
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const texts = fr.conversationFirst;
const fiche = fr.fiche;
const application = fr.application;
/** Inside the suite's own range of derived ports (e2e/support/ports.ts), apart from the other specs' servers. */
const PORT_OFFSET = 603;
const tr = (template: string, values: Record<string, string>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");

const masterCv = {
  fullName: "Marie Dupont",
  headline: "Responsable logistique",
  email: "marie.dupont@example.fr",
  phone: "",
  location: "Lyon",
  summary: "",
  experience: [{ title: "Responsable logistique", employer: "Carrefour Supply", location: "Lyon", period: "2010 – 2024", description: "Pilotage des entrepôts." }],
  education: [],
  skills: ["Supply chain", "WMS", "Lean"],
  languages: [],
};
const TITLE = "Responsable logistique (H/F)";
const LETTER = "Madame, Monsieur, je souhaite mettre mon expérience de la logistique au service d'Acme Industrie.";

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

/** A new Candidate, signed in on a wide screen (or `viewport`), with an Application whose Cover Letter is drafted: its id. */
async function withApplication(browser: Browser, viewport = { width: 1600, height: 1000 }): Promise<{ page: Page; id: string }> {
  const context = await browser.newContext({ baseURL: server.origin, locale: "en-US", viewport });
  const page = await context.newPage();
  await signInByEmail(page, server, newAddress("application-conversation"));
  const headers = { origin: server.origin };
  const profile = await page.request.post("/api/profiles", { data: { masterCv, searchCriteria: { targetRole: "Logistique", locations: ["Lyon"] } }, headers });
  expect(profile.status(), await profile.text()).toBe(201);
  const captured = await page.request.post("/api/job-offers", {
    data: { source: { url: `https://www.apec.fr/offres/${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }, title: TITLE, content: "Pilotage de deux entrepôts.", employer: "Acme Industrie", location: "Lyon" },
    headers,
  });
  expect(captured.status(), await captured.text()).toBe(200);
  const saved = await page.request.post("/api/applications", { data: { jobOfferId: (await captured.json()).id, profileId: (await profile.json()).id }, headers });
  expect(saved.ok(), await saved.text()).toBe(true);
  const id = (await saved.json()).id as string;
  await query("INSERT INTO tailored_document (application_id, kind, language, text) VALUES ($1, 'cover_letter', 'fr', $2)", [id, LETTER]);
  return { page, id };
}

const conversation = (page: Page) => page.getByRole("region", { name: texts.label });
const messages = (page: Page) => conversation(page).getByRole("list", { name: fr.coachPanel.messagesLabel }).getByRole("listitem");
const topBar = (page: Page) => page.getByRole("banner");
const ficheOf = (page: Page) => page.getByRole("complementary", { name: fiche.label });
const group = (page: Page, name: string) => ficheOf(page).getByRole("button", { name, exact: true });
const workPane = (page: Page, name: string) => page.getByRole("complementary", { name });

test.describe.configure({ mode: "serial" });

test.describe("« Conversation au centre »: an Application's page is its conversation (#603)", () => {
  test.beforeAll(async () => {
    test.setTimeout(180_000);
    server = await startOwnServer(PORT_OFFSET, "application_conversation", {
      JOBHUB_TARGET: "e2e",
      JOBHUB_IGNORE_ROOT_ENV: "1",
      AUTH_SECRET: "e2e-application-conversation-e2e-application-conversation",
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

  test("an Application opens on its conversation, the Fiche beside it, columns pushing it aside", async ({ browser }) => {
    const { page, id } = await withApplication(browser);
    await page.goto(`/candidatures/${id}`);

    // The conversation: the Introduction and the Application's suggestions, its title in the Top Bar.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(TITLE);
    await expect(messages(page).first()).toContainText(tr(application.conversation.introduction, { title: TITLE }));
    const suggestions = conversation(page).getByRole("group", { name: texts.suggestions });
    await expect(suggestions.getByRole("button", { name: application.conversation.suggestions.prepareInterview.label })).toBeVisible();
    await expect(suggestions.getByRole("button", { name: application.conversation.suggestions.followUp.label })).toBeVisible();

    // The Top Bar: « Fiche » and « Activité », « Effacer »; no AI Activity button, no « Aide ».
    await expect(topBar(page).getByRole("button", { name: fiche.label, exact: true })).toHaveAttribute("aria-expanded", "true");
    await expect(topBar(page).getByRole("button", { name: fiche.activity, exact: true })).toBeVisible();
    await expect(topBar(page).getByRole("button", { name: texts.clear })).toBeVisible();
    await expect(topBar(page).getByRole("button", { name: new RegExp(`^${fr.aiActivity.label}`) })).toHaveCount(0);
    await expect(topBar(page).getByRole("button", { name: texts.help, exact: true })).toHaveCount(0);

    // The Fiche: the card, then Sections, Activité and Résultats; no heading nor ✕ of its own.
    await expect(ficheOf(page)).toContainText("Acme Industrie");
    await expect(group(page, fiche.groups.sections)).toHaveAttribute("aria-expanded", "true");
    await expect(group(page, fiche.groups.activity)).toHaveAttribute("aria-expanded", "true");
    await expect(group(page, fiche.groups.results)).toHaveAttribute("aria-expanded", "true");
    await expect(ficheOf(page).getByRole("button", { name: texts.close })).toHaveCount(0);
    await expect(ficheOf(page).getByRole("link", { name: application.sections.entretiens })).toBeVisible();
    await expect(ficheOf(page).getByRole("link", { name: new RegExp(fr.tailoredDocuments.coverLetter.title) })).toBeVisible();

    // Columns push the conversation aside: never over it, a 1rem gutter, the conversation centred with equal margins.
    const rem = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
    const main = (await page.locator("main").boundingBox())!;
    const card = (await ficheOf(page).boundingBox())!;
    const thread = (await conversation(page).locator(".page-conversation-thread").boundingBox())!;
    expect(card.x).toBeGreaterThanOrEqual(main.x + main.width - 1);
    expect(card.x - (thread.x + thread.width)).toBeGreaterThanOrEqual(rem - 1);
    expect(Math.abs(thread.x - main.x - (main.x + main.width - thread.x - thread.width))).toBeLessThanOrEqual(2);
    expect(thread.width).toBeLessThanOrEqual(46 * rem + 1);
    const axe = await new AxeBuilder({ page }).include(".page-conversation").include(".fiche").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(axe.violations.map(({ id }) => id)).toEqual([]);

    // « Fiche » closes it, the conversation taking the room; « Activité » opens it on its Activity group.
    await topBar(page).getByRole("button", { name: fiche.label, exact: true }).click();
    await expect(ficheOf(page)).toHaveCount(0);
    await topBar(page).getByRole("button", { name: fiche.activity, exact: true }).click();
    await expect(ficheOf(page)).toBeVisible();
    await expect(group(page, fiche.groups.activity)).toHaveAttribute("aria-expanded", "true");
    await expect(topBar(page).getByRole("button", { name: fiche.activity, exact: true })).toHaveAttribute("aria-expanded", "true");
  });

  test("a group folds; a Section and a Result open in the Work Pane at their own address", async ({ browser }) => {
    const { page, id } = await withApplication(browser);
    await page.goto(`/candidatures/${id}`);

    // Folding a group.
    await group(page, fiche.groups.sections).click();
    await expect(group(page, fiche.groups.sections)).toHaveAttribute("aria-expanded", "false");
    await expect(ficheOf(page).getByRole("link", { name: application.sections.entretiens })).toHaveCount(0);
    await group(page, fiche.groups.sections).click();

    // A Section: in the Work Pane, beside the conversation, at its address; its actions there; ✕ back to the Application.
    await ficheOf(page).getByRole("link", { name: application.sections.entretiens }).click();
    await expect(page).toHaveURL(`${server.origin}/candidatures/${id}/entretiens`);
    const interviews = workPane(page, application.sections.entretiens);
    await expect(interviews.getByRole("heading", { level: 2, name: application.sections.entretiens })).toBeFocused();
    await expect(interviews.getByRole("link", { name: application.seeInAgenda })).toBeVisible();
    await expect(ficheOf(page).getByRole("link", { name: application.sections.entretiens })).toHaveAttribute("aria-current", "page");
    await expect(conversation(page)).toBeVisible();
    await interviews.getByRole("button", { name: texts.close }).click();
    await expect(page).toHaveURL(`${server.origin}/candidatures/${id}`);
    await expect(interviews).toHaveCount(0);

    // A Section's address stays valid: it opens the Section in the Work Pane.
    await page.goto(`/candidatures/${id}/offre`);
    await expect(workPane(page, application.sections.offre)).toContainText("Pilotage de deux entrepôts.");
    await expect(conversation(page)).toBeVisible();

    // A Result: the Cover Letter alone, editable and downloadable, in the Work Pane at its address.
    await ficheOf(page).getByRole("link", { name: new RegExp(fr.tailoredDocuments.coverLetter.title) }).click();
    await expect(page).toHaveURL(`${server.origin}/candidatures/${id}/documents?resultat=lettre`);
    const letter = workPane(page, fr.tailoredDocuments.coverLetter.title);
    await expect(letter.getByRole("textbox").first()).toHaveValue(LETTER);
    await expect(letter.getByRole("link", { name: fr.tailoredDocuments.aside.downloadPdf })).toBeVisible();
    await expect(letter.getByRole("tablist")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(letter).toHaveCount(0);
    await expect(page).toHaveURL(`${server.origin}/candidatures/${id}`);
  });

  test("on a laptop's screen a Section takes the Fiche's place, the conversation still readable; Back closes it", async ({ browser }) => {
    const { page, id } = await withApplication(browser, { width: 1280, height: 800 });
    await page.goto(`/candidatures/${id}`);
    const entretiens = ficheOf(page).getByRole("link", { name: application.sections.entretiens });

    // The Sidebar, the Fiche and the Work Pane would leave the conversation 14rem: the Work Pane takes the Fiche's place.
    await entretiens.click();
    const interviews = workPane(page, application.sections.entretiens);
    await expect(interviews.getByRole("heading", { level: 2, name: application.sections.entretiens })).toBeFocused();
    await expect(ficheOf(page)).toBeHidden();
    const rem = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
    const main = (await page.locator("main").boundingBox())!;
    const thread = (await conversation(page).locator(".page-conversation-thread").boundingBox())!;
    const card = (await interviews.boundingBox())!;
    expect(thread.width).toBeGreaterThanOrEqual(28 * rem);
    expect(card.x - (thread.x + thread.width)).toBeGreaterThanOrEqual(rem - 1);
    expect(Math.abs(thread.x - main.x - (main.x + main.width - thread.x - thread.width))).toBeLessThanOrEqual(2);
    await expect(conversation(page).getByRole("button", { name: application.conversation.suggestions.prepareInterview.label })).toBeInViewport();

    // Closed, the Fiche is back, the focus on the link that opened the Section.
    await interviews.getByRole("button", { name: texts.close }).click();
    await expect(page).toHaveURL(`${server.origin}/candidatures/${id}`);
    await expect(ficheOf(page)).toBeVisible();
    await expect(entretiens).toBeFocused();

    // Left by the browser's Back, the Section's address closes the Work Pane with it: nothing open and empty.
    await entretiens.click();
    await expect(interviews).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(`${server.origin}/candidatures/${id}`);
    await expect(page.locator(".work-pane")).toHaveCount(0);
    await expect(ficheOf(page)).toBeVisible();
    await expect(entretiens).not.toHaveAttribute("aria-current", "page");

    // While the Fiche has given way, « Fiche » and « Activité » say it is not shown, and bring it back in the pane's place.
    const ficheButton = topBar(page).getByRole("button", { name: fiche.label, exact: true });
    const activityButton = topBar(page).getByRole("button", { name: fiche.activity, exact: true });
    await entretiens.click();
    await expect(interviews).toBeVisible();
    await expect(ficheButton).toHaveAttribute("aria-expanded", "false");
    await expect(activityButton).toHaveAttribute("aria-expanded", "false");
    await ficheButton.click();
    await expect(page).toHaveURL(`${server.origin}/candidatures/${id}`);
    await expect(page.locator(".work-pane")).toHaveCount(0);
    await expect(ficheOf(page)).toBeVisible();
    await expect(ficheButton).toHaveAttribute("aria-expanded", "true");
    await expect(ficheButton).toBeFocused();
    await group(page, fiche.groups.activity).click();
    await entretiens.click();
    await expect(interviews).toBeVisible();
    await activityButton.click();
    await expect(page.locator(".work-pane")).toHaveCount(0);
    await expect(ficheOf(page)).toBeVisible();
    await expect(group(page, fiche.groups.activity)).toHaveAttribute("aria-expanded", "true");
    await expect(activityButton).toHaveAttribute("aria-expanded", "true");
  });

  test("a suggestion starts the Application's conversation, which the page keeps at its address", async ({ browser }) => {
    const { page, id } = await withApplication(browser);
    await page.goto(`/candidatures/${id}`);

    await conversation(page).getByRole("button", { name: application.conversation.suggestions.prepareInterview.label }).click();

    await expect(messages(page)).toHaveCount(3);
    await expect(messages(page).nth(1)).toContainText(application.conversation.suggestions.prepareInterview.message);
    await expect(page).toHaveURL(`${server.origin}/candidatures/${id}`);
    const saved = await query<{ subject_kind: string; application_id: string }>("SELECT subject_kind, application_id::text FROM coach_conversation WHERE application_id = $1", [id]);
    expect(saved).toEqual([{ subject_kind: "application", application_id: id }]);

    // It comes back with the page.
    await page.reload();
    await expect(messages(page)).toHaveCount(3);
    await expect(conversation(page).getByRole("group", { name: texts.suggestions })).toHaveCount(0);
  });
});
