import path from "node:path";
import { readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import pg from "pg";
import { newAddress } from "./support/mailbox";
import { signInByEmail, startOwnServer, type OwnServer } from "./support/own-server";

// ADR-0077: the AI Coach never writes the Candidate's data; every change is an Action Card the Candidate applies. With
// COACH_ACTIONS_ENABLED on (this spec's own server; the AI Coach faked inside it, fake-mistral.mjs: a message holding
// `E2E_COACH_TOOL=<name>:<json>` has it call that Coach Action):
//  - the product owner's report on the Beta: on a Profile's « CV de référence », « rajoute ces competences et outils » and
//    a pasted block: after the reply, no new Master CV Version and the current one byte for byte as it was;
//  - a Master CV change: nothing is written until the Candidate accepts a change themselves (none accepted in advance);
//    a skill « rephrased » into a list of skills is refused, no card;
//  - under « Propositions du coach : Formulaire », the form opens by itself and the Search Criteria stay as they were until
//    « Appliquer ».
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const texts = fr.coachProposals;
/** Inside the suite's own range of derived ports (e2e/support/ports.ts), apart from the other specs' servers. */
const PORT_OFFSET = 777;

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

const PASTED = `rajoute ces competences et outils
STRUCTURER & PILOTER LES OPÉRATIONS IT
Management jusqu'à 47 personnes • gouvernance • delivery • équipes
Tech/Support/Chefs de projet • multi-sites • prestataires • CODIR.
PERFORMANCE OPÉRATIONNELLE & ÉCONOMIQUE
P&L • CAPEX/OPEX • QoS/SLA • KPI • optimisation des ressources •
amélioration continue • -20 % / -140 K€/mois chez ACTEOS.
TRANSFORMATION SI, DATA & AUTOMATISATION
ERP • CRM • HubSpot • SAP BusinessByDesign • Power BI • N8N •
Make • Zapier • API • workflows • usages IA appliqués aux processus.
TECHNOLOGIE, BUSINESS & CLIENT
SaaS B2B • Customer Success • Produit/R&D/Sales • roadmap • NRR/
churn/adoption • 1 M€ ARR • C-level • FR/EN/AR.`;

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

/** Every Master CV Version of the Profile, each with a fingerprint of its content and Origin as stored. */
const versionsOf = (id: string) =>
  query<{ version: number; fingerprint: string; origin: { origin: string } | null; content: typeof masterCv }>(
    "SELECT version, md5(content::text || coalesce(origin::text, '')) AS fingerprint, origin, content FROM master_cv_version WHERE profile_id = $1 ORDER BY version",
    [id],
  );
const locationsOf = async (id: string) => (await query<{ locations: string[] }>("SELECT locations FROM profile WHERE id = $1", [id]))[0]!.locations;

/** A new Candidate, signed in on a wide screen, with a Profile: its page and id. */
async function withProfile(browser: Browser): Promise<{ page: Page; id: string }> {
  const context = await browser.newContext({ baseURL: server.origin, locale: "fr-FR", viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  await signInByEmail(page, server, newAddress("coach-never-writes"));
  const created = await page.request.post("/api/profiles", { data: { masterCv, searchCriteria: { targetRole: "Directrice financière", locations: ["Paris"] } }, headers: { origin: server.origin } });
  expect(created.status(), await created.text()).toBe(201);
  return { page, id: (await created.json()).id as string };
}

const conversation = (page: Page) => page.getByRole("region", { name: fr.conversationFirst.label });
const lastReply = (page: Page) => conversation(page).locator(".chat-coach").last();

/** Sends `message` to the AI Coach as the Candidate does, with Enter; with `tool`, has it call that Coach Action. */
async function send(page: Page, message: string, tool?: { action: string; args: object }) {
  const box = conversation(page).getByLabel(fr.coachPanel.messageLabel);
  await box.fill(tool ? `${message}\nE2E_COACH_TOOL=${tool.action}:${JSON.stringify(tool.args)}` : message);
  await box.press("Enter");
}

test.describe.configure({ mode: "serial" });

test.describe("the AI Coach never writes without the Candidate's « Appliquer » (ADR-0077)", () => {
  test.beforeAll(async () => {
    test.setTimeout(180_000);
    server = await startOwnServer(PORT_OFFSET, "coach_never_writes", {
      JOBHUB_TARGET: "e2e",
      JOBHUB_IGNORE_ROOT_ENV: "1",
      AUTH_SECRET: "e2e-coach-never-writes-e2e-coach-never-writes",
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

  test("« rajoute ces competences et outils » and a pasted block on the « CV de référence »: the Master CV Version is untouched", async ({ browser }) => {
    const { page, id } = await withProfile(browser);
    await page.goto(`/profils/${id}/cv-de-reference`);
    await expect(page.getByLabel(fr.cvReview.summary)).toHaveValue(masterCv.summary);
    const before = await versionsOf(id);

    await send(page, PASTED);
    await expect(conversation(page).locator(".chat-candidate + .chat-coach")).toBeVisible({ timeout: 30_000 });
    // The reply has arrived, and anything it could have set off has had time to land.
    await page.waitForTimeout(2_000);
    await expect(conversation(page).locator(".coach-proposal-card")).toHaveCount(0);
    expect(await versionsOf(id)).toEqual(before);

    // Reloaded: the page shows the Master CV as saved, nothing left in its fields.
    await page.reload();
    await expect(page.getByLabel(fr.cvReview.summary)).toHaveValue(masterCv.summary);
    await expect(page.getByLabel(fr.profilePage.skills)).toHaveValue(masterCv.skills.join("\n"));
    expect(await versionsOf(id)).toEqual(before);
  });

  test("the Beta's reply (#784): its Master CV proposal refused and no text written, the Candidate still reads why and where to add skills", async ({ browser }) => {
    const { page, id } = await withProfile(browser);
    await page.goto(`/profils/${id}/cv-de-reference`);
    const before = await versionsOf(id);
    // The pasted block holds figures the Master CV does not: the proposal is refused; the model then writes nothing.
    await send(page, `${PASTED}\nE2E_COACH_SILENT`, {
      action: "propose_master_cv_changes",
      args: { profileId: id, changes: [{ kind: "rephrase", section: "summary", text: PASTED.split("\n").slice(1).join("\n") }] },
    });
    const reply = conversation(page).locator(".chat-candidate + .chat-coach");
    await expect(reply).toBeVisible({ timeout: 30_000 });
    await expect(reply).toContainText(fr.coachPanel.emptyReply.masterCvNotProposed);
    await expect(conversation(page).locator(".coach-proposal-card")).toHaveCount(0);
    expect(await versionsOf(id)).toEqual(before);
  });

  test("a skill « rephrased » into a list of skills is refused: no card, nothing written", async ({ browser }) => {
    const { page, id } = await withProfile(browser);
    await page.goto(`/profils/${id}/cv-de-reference`);
    const before = await versionsOf(id);
    await send(page, "Ajoute HubSpot et Power BI à mes compétences", {
      action: "propose_master_cv_changes",
      args: { profileId: id, changes: [{ kind: "rephrase", section: "skills", item: "SAP", text: "SAP, HubSpot, Power BI" }] },
    });
    await expect(lastReply(page)).toContainText("n'est pas une reformulation d'une compétence", { timeout: 30_000 });
    await expect(conversation(page).locator(".coach-proposal-card")).toHaveCount(0);
    expect(await versionsOf(id)).toEqual(before);
  });

  test("a Master CV change: nothing written until the Candidate accepts a change themselves, none accepted in advance", async ({ browser }) => {
    const { page, id } = await withProfile(browser);
    await page.goto(`/profils/${id}`);
    const before = await versionsOf(id);
    await send(page, "Reformule le résumé de mon CV", {
      action: "propose_master_cv_changes",
      args: { profileId: id, changes: [{ kind: "rephrase", section: "summary", text: "Vingt-cinq ans de pilotage financier dans l'industrie." }] },
    });
    const card = conversation(page).getByRole("article", { name: new RegExp(fr.profilePage.sections["cv-de-reference"]) });
    await expect(card).toBeVisible({ timeout: 30_000 });
    expect(await versionsOf(id)).toEqual(before);

    await card.getByRole("button", { name: texts.review.open, exact: true }).click();
    const pane = page.getByRole("complementary", { name: texts.review.title.replace("{{what}}", fr.profilePage.sections["cv-de-reference"]) });
    await expect(pane.getByRole("button", { name: fr.tailoredCv.accept, exact: true })).toHaveAttribute("aria-pressed", "false");
    await expect(pane).toContainText(texts.review.pending);
    // « Enregistrer » before any change is accepted: refused, nothing written.
    await pane.getByRole("button", { name: texts.review.save, exact: true }).click();
    await expect(pane.getByRole("alert")).toHaveText(texts.problems.noneAccepted);
    expect(await versionsOf(id)).toEqual(before);

    // Accepted by the Candidate, then saved: one new version, its Origin the card.
    await pane.getByRole("button", { name: fr.tailoredCv.accept, exact: true }).click();
    await pane.getByRole("button", { name: texts.review.save, exact: true }).click();
    await expect(pane).toBeHidden();
    const after = await versionsOf(id);
    expect(after.map((version) => [version.version, version.origin?.origin ?? null])).toEqual([
      [1, null],
      [2, "coach_proposal"],
    ]);
    expect(after[0]).toEqual(before[0]);
    expect(after[1]!.content.summary).toBe("Vingt-cinq ans de pilotage financier dans l'industrie.");
  });

  test("« Propositions du coach : Formulaire »: the form opens by itself, the Search Criteria unchanged until « Appliquer »", async ({ browser }) => {
    const { page, id } = await withProfile(browser);
    const chosen = await page.request.put("/api/account/coach-proposals-display", { data: { display: "form" }, headers: { origin: server.origin } });
    expect(chosen.status()).toBe(200);
    await page.goto(`/profils/${id}`);
    await send(page, "Ajoute Lyon à mes lieux", { action: "propose_search_criteria", args: { profileId: id, addLocations: ["Lyon"] } });

    const form = page.getByRole("complementary", { name: texts.editTitle.replace("{{what}}", fr.cvReview.searchCriteria) });
    await expect(form).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(2_000);
    expect(await locationsOf(id)).toEqual(["Paris"]);

    await form.getByRole("button", { name: texts.apply, exact: true }).click();
    await expect(form).toBeHidden();
    await expect.poll(() => locationsOf(id)).toEqual(["Paris", expect.stringMatching(/^Lyon/)]);
  });
});
