import path from "node:path";
import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import pg from "pg";
import { newAddress } from "./support/mailbox";
import { signInByEmail, startOwnServer, type OwnServer } from "./support/own-server";

// Issue #605 (ADR-0070): under « Conversation au centre », a Profile's, a Job Search's and a Job Digest's page is each its
// Coach Conversation, whose Subject it is, like an Application's (#603): the Introduction and its suggestions until its
// first message, and beside it the Fiche, the object's card, then its Sections, its Activity and its Results. A Section
// or a Result opens in the Work Pane at its own address: a Profile's Sections, the versions of its Master CV and its
// editor; a Job Search's or a Job Digest's Job Offers, with their Match Score; a Job Digest's settings. The switch changes
// every Candidate's pages, so this spec runs on a server of its own (own-server.ts), the switch on from its environment.
// The AI Coach is faked inside it (fake-mistral.mjs), and so are the reference data's sources (fake-reference-data.mjs).
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const texts = fr.conversationFirst;
const fiche = fr.fiche;
/** Inside the suite's own range of derived ports (e2e/support/ports.ts), apart from the other specs' servers. */
const PORT_OFFSET = 605;
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const tr = (template: string, values: Record<string, string>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");

const PROFILE = "Logistique";
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
const TITLE = "Responsable d'entrepôt (H/F)";

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

/**
 * A new Candidate, signed in on a wide screen, with a Profile, a Job Offer, a Job Search done that found it and a Job
 * Digest that brought it (what the worker leaves behind: no public endpoint stores them without one).
 */
async function withProfile(browser: Browser): Promise<{ page: Page; profileId: string; jobOfferId: string; searchId: string; digestId: string }> {
  const context = await browser.newContext({ baseURL: server.origin, locale: "en-US", viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  await signInByEmail(page, server, newAddress("conversation-objects"));
  const headers = { origin: server.origin };
  const profile = await page.request.post("/api/profiles", { data: { masterCv, searchCriteria: { targetRole: "Logistique", locations: ["Lyon"] } }, headers });
  expect(profile.status(), await profile.text()).toBe(201);
  const profileId = (await profile.json()).id as string;
  const captured = await page.request.post("/api/job-offers", {
    data: { source: { url: `https://www.apec.fr/offres/${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }, title: TITLE, content: "Pilotage d'un entrepôt de 20 000 m².", employer: "Acme Industrie", location: "Lyon" },
    headers,
  });
  expect(captured.status(), await captured.text()).toBe(200);
  const jobOfferId = (await captured.json()).id as string;
  const candidate: string = (await (await page.request.get("/api/auth/get-session")).json()).user.id;
  const metrics = JSON.stringify({ funnel: { providerUrls: 1, fetched: 1, extracted: 1, alreadyStored: 0, afterDedup: 1, matched: 1 }, skipped: {}, costEur: 0, durationMs: 120_000 });
  const [search] = await query<{ id: string }>(
    "INSERT INTO job_search (candidate_id, profile_id, status, job_offer_ids, started_at, finished_at, metrics) VALUES ($1, $2, 'done', $3, now() - interval '2 minutes', now(), $4) RETURNING id",
    [candidate, profileId, [jobOfferId], metrics],
  );
  const [digest] = await query<{ id: string }>("INSERT INTO job_digest (candidate_id, profile_id, job_offer_ids, sent_at) VALUES ($1, $2, $3, now()) RETURNING id", [candidate, profileId, [jobOfferId]]);
  return { page, profileId, jobOfferId, searchId: search!.id, digestId: digest!.id };
}

const conversation = (page: Page) => page.getByRole("region", { name: texts.label });
const messages = (page: Page) => conversation(page).getByRole("list", { name: fr.coachPanel.messagesLabel }).getByRole("listitem");
const topBar = (page: Page) => page.getByRole("banner");
const ficheOf = (page: Page) => page.getByRole("complementary", { name: fiche.label });
const group = (page: Page, name: string) => ficheOf(page).getByRole("button", { name, exact: true });
const workPane = (page: Page, name: string) => page.getByRole("complementary", { name });
const suggestion = (page: Page, label: string) => conversation(page).getByRole("group", { name: texts.suggestions }).getByRole("button", { name: label });

/** The page is its conversation, the Fiche beside it with its three groups, and nothing over the conversation. */
async function expectConversationPage(page: Page) {
  await expect(topBar(page).getByRole("button", { name: fiche.label, exact: true })).toHaveAttribute("aria-expanded", "true");
  await expect(topBar(page).getByRole("button", { name: texts.clear })).toBeVisible();
  for (const name of [fiche.groups.sections, fiche.groups.activity, fiche.groups.results]) await expect(group(page, name)).toHaveAttribute("aria-expanded", "true");
  const axe = await new AxeBuilder({ page }).include(".page-conversation").include(".fiche").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(axe.violations.map(({ id }) => id)).toEqual([]);
}

test.describe.configure({ mode: "serial" });

test.describe("« Conversation au centre »: a Profile's, a Job Search's and a Job Digest's page is its conversation (#605)", () => {
  test.beforeAll(async () => {
    test.setTimeout(180_000);
    server = await startOwnServer(PORT_OFFSET, "conversation_objects", {
      JOBHUB_TARGET: "e2e",
      JOBHUB_IGNORE_ROOT_ENV: "1",
      AUTH_SECRET: "e2e-conversation-objects-e2e-conversation-objects",
      MAIL_TRANSPORT: "console",
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

  test("a Profile opens on its conversation; its Sections, Master CV versions and editor open in the Work Pane", async ({ browser }) => {
    const { page, profileId } = await withProfile(browser);
    await page.goto(`/profils/${profileId}`);

    // The conversation: the Introduction and the Profile's suggestions.
    await expect(messages(page).first()).toContainText(tr(fr.profilePage.conversation.introduction, { name: PROFILE }));
    await expect(suggestion(page, fr.profilePage.conversation.suggestions.improveCv.label)).toBeVisible();
    await expectConversationPage(page);

    // The Fiche: the Profile's card, its Sections, its Results (the Master CV's version 1 and its export).
    await expect(ficheOf(page)).toContainText(fr.profilePage.status.active);
    await expect(ficheOf(page).getByRole("link", { name: fr.profilePage.actions.searchOffers })).toBeVisible();
    for (const section of ["cv-de-reference", "ats-score", "entreprises-cibles", "telecharger", "gerer"])
      await expect(ficheOf(page).getByRole("link", { name: fr.profilePage.sections[section], exact: true })).toBeVisible();
    const version = ficheOf(page).getByRole("link", { name: new RegExp(`^${tr(fr.versions.version, { version: "1" })}`) });
    await expect(version).toContainText(fr.versions.current);
    await expect(ficheOf(page).getByRole("link", { name: new RegExp(`^${escaped(fr.cvExport.title)}`) })).toBeVisible();

    // A Section, in the Work Pane at its own address; ✕ back to the Profile.
    await ficheOf(page).getByRole("link", { name: fr.profilePage.sections.gerer, exact: true }).click();
    await expect(page).toHaveURL(`${server.origin}/profils/${profileId}/gerer`);
    const manage = workPane(page, fr.profilePage.sections.gerer);
    await expect(manage.getByRole("heading", { level: 2, name: fr.profilePage.sections.gerer })).toBeFocused();
    await expect(conversation(page)).toBeVisible();
    await manage.getByRole("button", { name: texts.close }).click();
    await expect(page).toHaveURL(`${server.origin}/profils/${profileId}`);
    await expect(manage).toHaveCount(0);

    // A Result: a version of the Master CV, read-only, in the Work Pane.
    await version.click();
    await expect(page).toHaveURL(`${server.origin}/profils/${profileId}/versions/1`);
    const shown = workPane(page, tr(fr.versions.viewTitle, { version: "1" }));
    await expect(shown).toContainText("Carrefour Supply");
    await expect(version).toHaveAttribute("aria-current", "page");

    // From it, the versions' history, still in the Work Pane, the conversation as it was.
    await shown.getByRole("link", { name: fr.versions.backToHistory }).click();
    await expect(page).toHaveURL(`${server.origin}/profils/${profileId}/versions`);
    await expect(workPane(page, fr.versions.title)).toContainText(tr(fr.versions.version, { version: "1" }));
    await expect(messages(page).first()).toContainText(tr(fr.profilePage.conversation.introduction, { name: PROFILE }));

    // The Master CV's editor: its address opens it in the Work Pane, beside the Profile's conversation.
    await page.goto(`/profils/${profileId}/cv`);
    const editor = workPane(page, fr.cvEditor.title);
    await expect(editor).toContainText(tr(fr.cvEditor.editingVersion, { version: "1" }));
    await expect(conversation(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(editor).toHaveCount(0);
    await expect(page).toHaveURL(`${server.origin}/profils/${profileId}`);
  });

  test("a suggestion starts the Profile's conversation, which the page keeps", async ({ browser }) => {
    const { page, profileId } = await withProfile(browser);
    await page.goto(`/profils/${profileId}`);

    await suggestion(page, fr.profilePage.conversation.suggestions.improveCv.label).click();

    await expect(messages(page)).toHaveCount(3);
    await expect(messages(page).nth(1)).toContainText(fr.profilePage.conversation.suggestions.improveCv.message);
    const saved = await query<{ subject_kind: string; profile_id: string }>("SELECT subject_kind, profile_id::text FROM coach_conversation WHERE subject_kind = 'profile' AND profile_id = $1", [profileId]);
    expect(saved).toEqual([{ subject_kind: "profile", profile_id: profileId }]);
    await page.reload();
    await expect(messages(page)).toHaveCount(3);
  });

  test("a Job Search opens on its conversation: status, criteria and Job Offers with their Match Score; one opens in the Work Pane", async ({ browser }) => {
    const { page, searchId, jobOfferId } = await withProfile(browser);
    await page.goto(`/recherches/${searchId}`);

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(tr(fr.jobSearch.title, { profile: PROFILE }));
    await expect(suggestion(page, fr.jobSearch.conversation.suggestions.bestOffers.label)).toBeVisible();
    await expectConversationPage(page);

    // The card: status, criteria, « Relancer une recherche ».
    await expect(ficheOf(page)).toContainText(fr.jobSearch.statuses.done);
    await expect(ficheOf(page)).toContainText("Lyon");
    await expect(ficheOf(page).getByRole("button", { name: fr.jobSearch.searchAgain })).toBeVisible();

    // A Job Offer found, with its Match Score, opens in the Work Pane at its address; saved as an Application there.
    const found = ficheOf(page).getByRole("link", { name: new RegExp(`^${escaped(TITLE)}`) });
    await expect(found).toContainText("Match Score");
    await found.click();
    await expect(page).toHaveURL(`${server.origin}/recherches/${searchId}/offres/${jobOfferId}`);
    const offer = workPane(page, TITLE);
    await expect(offer).toContainText("Pilotage d'un entrepôt");
    await offer.getByRole("button", { name: fr.jobSearch.save }).click();
    await expect(offer.getByRole("link", { name: fr.jobSearch.seeApplication })).toBeVisible();
    await expect(conversation(page)).toBeVisible();

    // The list of Job Offers found, its Section: each leads to the Work Pane, not away from the conversation.
    await ficheOf(page).getByRole("link", { name: fr.jobSearch.resultsLabel, exact: true }).click();
    await expect(page).toHaveURL(`${server.origin}/recherches/${searchId}/offres`);
    const list = workPane(page, fr.jobSearch.resultsLabel);
    await list.getByRole("link", { name: TITLE, exact: true }).click();
    await expect(page).toHaveURL(`${server.origin}/recherches/${searchId}/offres/${jobOfferId}`);
    await expect(workPane(page, TITLE)).toBeVisible();
  });

  test("a Job Digest opens on its conversation: its Job Offers with their Match Score, and its settings in the Work Pane", async ({ browser }) => {
    const { page, digestId, jobOfferId } = await withProfile(browser);
    await page.goto(`/job-digests/${digestId}`);

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(tr(fr.jobDigest.page.title, { profile: PROFILE }));
    await expect(suggestion(page, fr.jobDigest.conversation.suggestions.bestOffers.label)).toBeVisible();
    await expectConversationPage(page);
    await expect(ficheOf(page).getByRole("link", { name: PROFILE })).toBeVisible();

    // Its settings, a Section in the Work Pane.
    await ficheOf(page).getByRole("link", { name: fr.jobDigest.page.settings, exact: true }).click();
    await expect(page).toHaveURL(`${server.origin}/job-digests/${digestId}/reglages`);
    await expect(workPane(page, fr.jobDigest.page.settings)).toContainText(PROFILE);

    // A Job Offer it brought, a Result with its Match Score, in the Work Pane in the settings' place.
    const brought = ficheOf(page).getByRole("link", { name: new RegExp(`^${escaped(TITLE)}`) });
    await expect(brought).toContainText("Match Score");
    await brought.click();
    await expect(page).toHaveURL(`${server.origin}/job-digests/${digestId}/offres/${jobOfferId}`);
    await expect(workPane(page, TITLE)).toContainText("Acme Industrie");
    await expect(workPane(page, fr.jobDigest.page.settings)).toHaveCount(0);
  });
});
