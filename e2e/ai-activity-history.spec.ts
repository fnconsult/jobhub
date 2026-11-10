import path from "node:path";
import { readFileSync } from "node:fs";
import AxeBuilder from "./support/axe";
import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { newAddress } from "./support/mailbox";
import { signInByEmail, startOwnServer, type OwnServer } from "./support/own-server";

// Issue #808 (ADR-0086): under « En ce moment », Activity's history of the page's Activité entries, by day, newest first,
// each linked to its object and to the conversation. On a Profile's « CV de référence », a reply proposing a Master CV
// change, its card applied, then an ATS Score: the history shows ATS Score → Version 2 → Réponse du coach, each « suite
// de » the one before, each linking to its object; « Voir dans la conversation » marks the reply in the thread, and
// « Dans l'activité » under the card opens its entry. Coach Actions are switched on for this spec's own server
// (COACH_ACTIONS_ENABLED); the AI Coach is faked inside it (fake-mistral.mjs): a message holding
// `E2E_COACH_TOOL=<name>:<json>` has it call that Coach Action.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const texts = fr.coachProposals;
const history = fr.aiActivity.history;
/** Inside the suite's own range of derived ports (e2e/support/ports.ts), apart from the other specs' servers. */
const PORT_OFFSET = 808;
const tr = (template: string, values: Record<string, string>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");

const masterCv = {
  fullName: "Christine Martin",
  headline: "Directrice financière",
  email: "christine.martin@example.fr",
  phone: "",
  location: "Paris",
  summary: "25 ans dans l'industrie.",
  experience: [{ title: "Directrice financière", employer: "Groupe Seb", location: "Paris", period: "2012 – 2026", description: "Pilotage financier." }],
  education: [],
  skills: ["IFRS", "SAP", "Consolidation"],
  languages: [],
};

let server: OwnServer;

/** A new Candidate, signed in on a wide screen, with a Profile: its page and id. */
async function withProfile(browser: Browser, viewport = { width: 1600, height: 1000 }): Promise<{ page: Page; id: string }> {
  const context = await browser.newContext({ baseURL: server.origin, locale: "fr-FR", viewport });
  const page = await context.newPage();
  await signInByEmail(page, server, newAddress("activity-history"));
  const created = await page.request.post("/api/profiles", { data: { masterCv, searchCriteria: { targetRole: "Directrice financière", locations: ["Paris"] } }, headers: { origin: server.origin } });
  expect(created.status(), await created.text()).toBe(201);
  return { page, id: (await created.json()).id as string };
}

const conversation = (page: Page) => page.getByRole("region", { name: fr.conversationFirst.label });
const thread = (page: Page) => conversation(page).getByRole("list", { name: fr.coachPanel.messagesLabel });
const fiche = (page: Page) => page.getByRole("complementary", { name: fr.fiche.label, exact: true });
const today = (page: Page) => fiche(page).getByRole("region", { name: history.title }).getByRole("region", { name: history.today });
const rows = (page: Page) => today(page).locator(".activity-entry-row");
const detailOf = async (page: Page, row: Locator) => page.locator(`[id="${await row.getAttribute("aria-controls")}"]`);

/** Asks the AI Coach, on the page, for `message`, having it call `action` with `args`. */
async function ask(page: Page, message: string, action: string, args: object) {
  await conversation(page).getByLabel(fr.coachPanel.messageLabel).fill(`${message}\nE2E_COACH_TOOL=${action}:${JSON.stringify(args)}`);
  await conversation(page).getByRole("button", { name: fr.coachPanel.send, exact: true }).click();
}

/** The Master CV change proposed and applied from its card: Version 2, made from the reply's proposal. */
async function applyMasterCvChange(page: Page, id: string) {
  await ask(page, "Reformule mon expérience chez Groupe Seb", "propose_master_cv_changes", {
    profileId: id,
    changes: [{ kind: "rephrase", section: "experience", item: "Groupe Seb", description: "Pilotage financier d'un groupe industriel." }],
  });
  const card = conversation(page).getByRole("article", { name: new RegExp(fr.profilePage.sections["cv-de-reference"]) });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.getByRole("button", { name: texts.review.open, exact: true }).click();
  const pane = page.getByRole("complementary", { name: tr(texts.review.title, { what: fr.profilePage.sections["cv-de-reference"] }) });
  await pane.getByRole("button", { name: fr.tailoredCv.accept, exact: true }).first().click();
  await pane.getByRole("button", { name: texts.review.save, exact: true }).click();
  await expect(pane).toBeHidden();
  await expect(card.getByRole("status")).toContainText(/\d\d:\d\d/);
}

test.describe.configure({ mode: "serial" });

test.describe("Activity's history (#808)", () => {
  test.beforeAll(async () => {
    test.setTimeout(180_000);
    server = await startOwnServer(PORT_OFFSET, "activity_history", {
      JOBHUB_TARGET: "e2e",
      JOBHUB_IGNORE_ROOT_ENV: "1",
      AUTH_SECRET: "e2e-activity-history-e2e-activity-history",
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
      COACH_ACTIONS_ENABLED: "true",
      NODE_OPTIONS: ["fake-google.mjs", "fake-mistral.mjs", "fake-reference-data.mjs"].map((fake) => `--import=${path.resolve("e2e/support", fake)}`).join(" "),
    });
  });

  test.afterAll(async () => {
    await server?.stop();
  });

  test("on « CV de référence »: Réponse du coach → Version 2 → ATS Score, each « suite de » the one before, linked to its object, and the reply marked in the conversation", async ({ browser }) => {
    test.setTimeout(120_000);
    const { page, id } = await withProfile(browser);
    await page.goto(`/profils/${id}/cv-de-reference`);
    await applyMasterCvChange(page, id);
    // Jobbbox's rules score Version 2.
    const scored = await page.request.post(`/api/profiles/${id}/ats-score`, { headers: { origin: server.origin } });
    expect(scored.ok(), await scored.text()).toBe(true);

    await page.reload();
    await expect(fiche(page)).toBeVisible();
    // Newest first: the ATS Score, Version 2, the reply whose card made it, then « Création du profil » with Version 1 (#810) (the
    // ATS Fixes the score proposed are entries of their own, beside it).
    const version = tr(history.titles.master_cv_version, { version: "2" });
    const titles = await today(page).locator(".activity-entry-title").allTextContents();
    const at = (title: string) => titles.indexOf(title);
    expect(at(fr.aiActivity.kinds.ats_score), titles.join(" | ")).toBeGreaterThanOrEqual(0);
    expect(at(fr.aiActivity.kinds.ats_score)).toBeLessThan(at(version));
    expect(at(version)).toBeLessThan(at(fr.aiActivity.kinds.coach_reply));
    expect(at(fr.aiActivity.kinds.coach_reply)).toBeLessThan(at(fr.aiActivity.kinds.profile_creation));
    const row = (title: string) => today(page).locator(".activity-entry-row").filter({ has: page.locator(".activity-entry-title").getByText(title, { exact: true }) });
    await expect(row(fr.aiActivity.kinds.ats_score)).toContainText(history.cost.quota.atsScores);
    await expect(row(version)).toContainText(history.cost.noAi);
    // Its tokens: all its calls', read back after the reload (never « dernier appel seulement », for a reply saved before #791).
    await expect(row(fr.aiActivity.kinds.coach_reply)).toContainText(/\d+ appels? · [\d,]+k? jetons envoyés/);
    await expect(row(fr.aiActivity.kinds.coach_reply)).not.toContainText(history.cost.partial);
    for (const each of await rows(page).all()) await expect(each).toHaveAttribute("aria-expanded", "false");
    await expect(fiche(page)).not.toContainText(/€|euros?\b/);

    // The ATS Score « suite de » Version 2, which « suite de » the reply.
    await row(fr.aiActivity.kinds.ats_score).click();
    await expect(row(fr.aiActivity.kinds.ats_score)).toHaveAttribute("aria-expanded", "true");
    const score = await detailOf(page, row(fr.aiActivity.kinds.ats_score));
    await expect(score).toContainText(`${history.after} ${version}`);
    await expect(score.getByRole("link", { name: history.open.ats_score })).toHaveAttribute("href", `/profils/${id}/ats-score`);
    await score.getByRole("button", { name: new RegExp(version) }).click();
    await expect(row(version)).toHaveAttribute("aria-expanded", "true");
    const second = await detailOf(page, row(version));
    await expect(second).toContainText(`${history.after} ${fr.aiActivity.kinds.coach_reply}`);
    await expect(second).toContainText(history.origin.coach_proposal);

    // The reply: its question, what it proposed and what that led to.
    await row(fr.aiActivity.kinds.coach_reply).click();
    const reply = await detailOf(page, row(fr.aiActivity.kinds.coach_reply));
    await expect(reply).toContainText(tr(history.you, { question: "Reformule mon expérience chez Groupe Seb" }));
    await expect(reply).toContainText(history.state.applied);
    await expect(reply).toContainText(`${history.led} ${version}`);
    await expect(reply.getByRole("link", { name: history.cost.consumption })).toHaveAttribute("href", "/abonnement#consommation");
    expect((await new AxeBuilder({ page }).include(".fiche").analyze()).violations.map(({ id: rule }) => rule)).toEqual([]);

    // « Voir dans la conversation »: the reply, marked in the thread.
    await reply.getByRole("button", { name: history.inConversation }).click();
    const message = thread(page).locator("li[data-message-id]").last();
    await expect(message).toHaveAttribute("data-highlighted", "true");
    await expect(message).toBeInViewport();

    // Each link leads to its object: Version 2's page.
    await second.getByRole("link", { name: history.open.master_cv_version }).click();
    await expect(page).toHaveURL(new RegExp(`/profils/${id}/versions/2$`));
    await page.goto(`/profils/${id}/cv-de-reference`);

    // « Dans l'activité » under the applied card opens Activity on Version 2, unfolded.
    await thread(page).getByRole("button", { name: history.inActivity }).last().click();
    await expect(row(version)).toHaveAttribute("aria-expanded", "true");
    await expect(row(version)).toBeFocused();
  });

  test("on a phone, « Voir dans la conversation » closes Activity over the conversation and marks the reply", async ({ browser }) => {
    test.setTimeout(120_000);
    const { page, id } = await withProfile(browser, { width: 390, height: 800 });
    await page.goto(`/profils/${id}`);
    await ask(page, "Que penses-tu de mon profil ?", "propose_master_cv_changes", {
      profileId: id,
      changes: [{ kind: "highlight", section: "skills", item: "SAP" }],
    });
    await expect(thread(page).locator("li[data-message-id]")).toHaveCount(1, { timeout: 30_000 });
    await thread(page).getByRole("button", { name: history.inActivity }).first().click();
    const column = page.getByRole("complementary", { name: fr.fiche.label, exact: true });
    const row = column.locator(".activity-entry-row").filter({ hasText: fr.aiActivity.kinds.coach_reply });
    await expect(row).toHaveAttribute("aria-expanded", "true");
    await (await detailOf(page, row)).getByRole("button", { name: history.inConversation }).click();
    await expect(column).toHaveCount(0);
    await expect(thread(page).locator("li[data-message-id]")).toHaveAttribute("data-highlighted", "true");
  });
});
