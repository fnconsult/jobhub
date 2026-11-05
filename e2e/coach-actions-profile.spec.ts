import path from "node:path";
import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import pg from "pg";
import { newAddress } from "./support/mailbox";
import { signInByEmail, startOwnServer, type OwnServer } from "./support/own-server";

// Issue #719 (ADR-0077): the Coach Actions of the « Profil » group, proposed in a Profile's conversation and applied by the
// Candidate. « ajoute Lyon à mes lieux » → a card → « Appliquer » → the Search Criteria with Lyon, « Origine » → « Annuler »
// → the criteria before. A Master CV change → « Relire les changements » in the Work Pane, change by change → one new
// Master CV Version with its Origin, revealed on the versions' page; « Annuler » is a Restore. Coach Actions are switched
// on for this spec's own server (COACH_ACTIONS_ENABLED); the AI Coach is faked inside it (fake-mistral.mjs): a message
// holding `E2E_COACH_TOOL=<name>:<json>` has it call that Coach Action.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const texts = fr.coachProposals;
/** Inside the suite's own range of derived ports (e2e/support/ports.ts), apart from the other specs' servers. */
const PORT_OFFSET = 719;
const tr = (template: string, values: Record<string, string>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");
const APPLIED = new RegExp(`^${tr(texts.applied, { time: "\\d\\d:\\d\\d" })}$`);
const UNDONE = new RegExp(`^${tr(texts.undone, { time: "\\d\\d:\\d\\d" })}$`);

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

async function query<T>(sql: string, values: unknown[]): Promise<T[]> {
  const db = new pg.Client({ connectionString: server.databaseUrl });
  await db.connect();
  try {
    return (await db.query(sql, values)).rows as T[];
  } finally {
    await db.end();
  }
}

const criteriaOf = async (id: string) =>
  (await query<{ locations: string[]; search_criteria_origin: { origin: string } | null }>("SELECT locations, search_criteria_origin FROM profile WHERE id = $1", [id]))[0]!;
const versionsOf = (id: string) =>
  query<{ version: number; restored_from: number | null; origin: { origin: string; cardId: string } | null; content: typeof masterCv }>(
    "SELECT version, restored_from, origin, content FROM master_cv_version WHERE profile_id = $1 ORDER BY version",
    [id],
  );

/** A new Candidate, signed in on a wide screen, with a Profile looking in Paris: its page and id. */
async function withProfile(browser: Browser): Promise<{ page: Page; id: string }> {
  const context = await browser.newContext({ baseURL: server.origin, locale: "fr-FR", viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  await signInByEmail(page, server, newAddress("coach-profile"));
  const created = await page.request.post("/api/profiles", { data: { masterCv, searchCriteria: { targetRole: "Directrice financière", locations: ["Paris"] } }, headers: { origin: server.origin } });
  expect(created.status(), await created.text()).toBe(201);
  return { page, id: (await created.json()).id as string };
}

const conversation = (page: Page) => page.getByRole("region", { name: fr.conversationFirst.label });
const ficheOf = (page: Page) => page.getByRole("complementary", { name: fr.fiche.label });
const cardOf = (page: Page, what: string) => conversation(page).getByRole("article", { name: new RegExp(what) });

/** Asks the AI Coach, on the page, for `message`, having it call `action` with `args`. */
async function ask(page: Page, message: string, action: string, args: object) {
  await conversation(page).getByLabel(fr.coachPanel.messageLabel).fill(`${message}\nE2E_COACH_TOOL=${action}:${JSON.stringify(args)}`);
  await conversation(page).getByRole("button", { name: fr.coachPanel.send, exact: true }).click();
}

test.describe.configure({ mode: "serial" });

test.describe("the Coach Actions « Profil » (#719)", () => {
  test.beforeAll(async () => {
    test.setTimeout(180_000);
    server = await startOwnServer(PORT_OFFSET, "coach_actions_profile", {
      JOBHUB_TARGET: "e2e",
      JOBHUB_IGNORE_ROOT_ENV: "1",
      AUTH_SECRET: "e2e-coach-actions-profile-e2e-coach-actions-profile",
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

  test("« ajoute Lyon à mes lieux » → a card → « Appliquer » → the criteria with Lyon, « Origine » → « Annuler » → the criteria before", async ({ browser }) => {
    const { page, id } = await withProfile(browser);
    await page.goto(`/profils/${id}`);
    await ask(page, "Ajoute Lyon à mes lieux", "propose_search_criteria", { profileId: id, addLocations: ["Lyon"] });

    const card = cardOf(page, fr.cvReview.searchCriteria);
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText(texts.by);
    await expect(card.getByRole("link", { name: "Directrice financière" })).toHaveAttribute("href", `/profils/${id}`);
    await expect(card.locator(".coach-proposal-card__before")).toHaveText(`${fr.cvReview.locations} : Paris`);
    await expect(card.locator(".coach-proposal-card__after")).toHaveText(new RegExp(`^${fr.cvReview.locations} : Paris, Lyon`));
    await expect(card.getByRole("button")).toHaveText([texts.apply, texts.edit, texts.dismiss]);
    // Proposed: nothing changed yet.
    expect(await criteriaOf(id)).toEqual({ locations: ["Paris"], search_criteria_origin: null });
    expect((await new AxeBuilder({ page }).include(".coach-proposal-card").analyze()).violations).toEqual([]);

    await card.getByRole("button", { name: texts.apply, exact: true }).click();
    await expect(card.getByRole("status")).toHaveText(APPLIED);
    await expect(ficheOf(page)).toContainText(/Paris ou Lyon/);
    const applied = await criteriaOf(id);
    expect(applied.locations).toEqual(["Paris", expect.stringMatching(/^Lyon/)]);
    expect(applied.search_criteria_origin).toMatchObject({ origin: "coach_proposal" });

    // The Origin, hidden until « Origine » is opened.
    const origin = ficheOf(page).locator("details.origin-disclosure");
    await expect(origin.getByText(/Sur proposition de votre coach IA/)).toBeHidden();
    await origin.getByText(fr.origin.label, { exact: true }).click();
    await expect(origin).toContainText(new RegExp(tr(fr.origin.coachProposal, { date: ".+" })));

    await card.getByRole("button", { name: texts.undo, exact: true }).click();
    await expect(card.getByRole("status")).toHaveText(UNDONE);
    expect(await criteriaOf(id)).toEqual({ locations: ["Paris"], search_criteria_origin: null });
    await expect(ficheOf(page)).not.toContainText(/Lyon/);
    await expect(ficheOf(page).locator("details.origin-disclosure")).toHaveCount(0);
  });

  test("a Master CV change reviewed change by change in the Work Pane → one new Master CV Version, its Origin revealed; « Annuler » is a Restore", async ({ browser }) => {
    const { page, id } = await withProfile(browser);
    await page.goto(`/profils/${id}`);
    await ask(page, "Reformule mon expérience chez Groupe Seb et mets SAP en avant", "propose_master_cv_changes", {
      profileId: id,
      changes: [
        { kind: "rephrase", section: "experience", item: "Groupe Seb", description: "Pilotage financier d'un groupe industriel." },
        { kind: "highlight", section: "skills", item: "SAP" },
      ],
    });

    const card = cardOf(page, fr.profilePage.sections["cv-de-reference"]);
    await expect(card).toBeVisible({ timeout: 30_000 });
    // No « Appliquer » in one click for a Master CV.
    await expect(card.getByRole("button")).toHaveText([texts.review.open, texts.dismiss]);
    await expect(card).toContainText(tr(texts.masterCv.changes_other, { count: "2" }));

    await card.getByRole("button", { name: texts.review.open, exact: true }).click();
    const pane = page.getByRole("complementary", { name: tr(texts.review.title, { what: fr.profilePage.sections["cv-de-reference"] }) });
    await expect(pane.getByRole("heading", { level: 2 })).toBeFocused();
    await expect(pane.getByRole("listitem")).toHaveCount(2);
    await expect(pane).toContainText("Pilotage financier d'un groupe industriel.");
    // The Candidate rejects putting SAP forward, keeps the rephrasing.
    await pane.getByRole("button", { name: fr.tailoredCv.reject, exact: true }).nth(1).click();
    expect((await new AxeBuilder({ page }).include(".coach-proposal-form").analyze()).violations).toEqual([]);
    await pane.getByRole("button", { name: texts.review.save, exact: true }).click();
    await expect(pane).toBeHidden();
    await expect(card.getByRole("status")).toHaveText(APPLIED);
    await expect(card).toContainText(tr(texts.review.saved_one, { count: "1" }));

    const versions = await versionsOf(id);
    expect(versions.map((version) => [version.version, version.origin?.origin ?? null])).toEqual([
      [1, null],
      [2, "coach_proposal"],
    ]);
    expect(versions[1]!.content.experience[0]!.description).toBe("Pilotage financier d'un groupe industriel.");
    expect(versions[1]!.content.skills).toEqual(masterCv.skills);

    // « Annuler »: a Restore of version 1, as version 3, the history kept.
    await card.getByRole("button", { name: texts.undo, exact: true }).click();
    await expect(card.getByRole("status")).toHaveText(UNDONE);
    expect((await versionsOf(id)).map((version) => [version.version, version.restored_from])).toEqual([
      [1, null],
      [2, null],
      [3, 1],
    ]);

    // On the versions' page, version 2's Origin, hidden until « Origine » is opened.
    await page.goto(`/profils/${id}/versions`);
    const second = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: tr(fr.versions.version, { version: "2" }) }) });
    const origin = second.locator("details.origin-disclosure");
    await expect(origin.getByText(/Sur proposition de votre coach IA/)).toBeHidden();
    await origin.getByText(fr.origin.label, { exact: true }).click();
    await expect(origin).toContainText(new RegExp(tr(fr.origin.coachProposal, { date: ".+" })));
    await expect(page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: tr(fr.versions.version, { version: "3" }) }) }).locator("details.origin-disclosure")).toHaveCount(0);
  });
});
