import path from "node:path";
import { readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import pg from "pg";
import { newAddress } from "./support/mailbox";
import { signInByEmail, startOwnServer, type OwnServer } from "./support/own-server";

// Issue #1097 (ADR-0113): the Tailored CV reworked from an Application's conversation, change by change. A Layout-only
// Change on the saved Tailored CV (« mets cette compétence en premier ») → a card « Mise en forme seule, aucun mot
// ajouté » → « Relire les changements » opens its review in the Work Pane → the change accepted and saved: the Tailored
// CV's next version, the card as its Origin (« Origine ») → « Annuler » puts the version before back. This spec runs on a
// server of its own with COACH_ACTIONS_ENABLED on; the AI Coach is faked inside it (fake-mistral.mjs): a message holding
// `E2E_COACH_TOOL=<name>:<json>` has it call that Coach Action.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const texts = fr.coachProposals;
const tc = fr.tailoredCv;
/** Inside the suite's own range of derived ports (e2e/support/ports.ts), apart from the other specs' servers. */
const PORT_OFFSET = 1097;
const TITLE = "Responsable financier (H/F)";
const tr = (template: string, values: Record<string, string>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");
const at = (template: string) => new RegExp(`^${tr(template, { time: "\\d\\d:\\d\\d" })}$`);

const masterCv = {
  fullName: "Marie Dupont",
  headline: "Directrice financière",
  email: "marie.dupont@example.fr",
  phone: "",
  location: "Lyon",
  summary: "",
  experience: [{ title: "Directrice financière", employer: "Groupe Seb", location: "Lyon", period: "2005 – 2024", description: "Consolidation IFRS." }],
  education: [{ degree: "Master Finance", institution: "ESSEC", year: "1994" }],
  skills: ["Consolidation", "IFRS", "SAP"],
  languages: [{ name: "Anglais", level: "courant" }],
};

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

/** A new Candidate with a Profile, an Application and its saved Tailored CV: its page open on its conversation. */
async function withTailoredCv(browser: Browser): Promise<{ page: Page; applicationId: string; skills: string[] }> {
  const context = await browser.newContext({ baseURL: server.origin, locale: "fr-FR", viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  await signInByEmail(page, server, newAddress("coach-tailored-cv"));
  const headers = { origin: server.origin };
  const profile = await page.request.post("/api/profiles", { data: { masterCv, searchCriteria: { targetRole: "DAF", locations: ["Lyon"] } }, headers });
  expect(profile.status(), await profile.text()).toBe(201);
  const captured = await page.request.post("/api/job-offers", {
    data: {
      source: { url: `https://www.apec.fr/offres/${Date.now()}-${Math.random().toString(36).slice(2, 8)}` },
      title: TITLE,
      content: "Acme Industrie recrute son responsable financier. Vous pilotez la consolidation IFRS sous SAP et le reporting sous Power BI.",
      skills: ["IFRS", "SAP", "Power BI"],
      employer: "Acme Industrie",
      location: "Lyon",
    },
    headers,
  });
  expect(captured.status(), await captured.text()).toBe(200);
  const saved = await page.request.post("/api/applications", { data: { jobOfferId: (await captured.json()).id, profileId: (await profile.json()).id }, headers });
  expect(saved.ok(), await saved.text()).toBe(true);
  const applicationId = (await saved.json()).id as string;
  // Its Tailored CV, proposed and saved from the documents page, every change accepted.
  const proposed = await page.request.post(`/api/applications/${applicationId}/tailored-cv`, { data: {}, headers });
  expect(proposed.ok(), await proposed.text()).toBe(true);
  const { proposal } = (await proposed.json()) as { proposal: { revision: string; changes: { id: string }[] } };
  const kept = await page.request.post(`/api/applications/${applicationId}/tailored-cv/save`, { data: { revision: proposal.revision, accepted: proposal.changes.map((change) => change.id) }, headers });
  expect(kept.ok(), await kept.text()).toBe(true);
  const skills = ((await kept.json()) as { saved: { content: { skills: string[] } } }).saved.content.skills;
  await page.goto(`/candidatures/${applicationId}`);
  return { page, applicationId, skills };
}

const conversation = (page: Page) => page.getByRole("region", { name: fr.conversationFirst.label });
const cardOf = (page: Page, what: string) => conversation(page).getByRole("article", { name: new RegExp(what) }).last();

/** Asks the AI Coach from the Application's conversation, having it call `tool` with `args`. */
async function ask(page: Page, message: string, tool: string, args: object = {}) {
  await conversation(page).getByLabel(fr.coachPanel.messageLabel).fill(`${message}\nE2E_COACH_TOOL=${tool}:${JSON.stringify(args)}`);
  await conversation(page).getByRole("button", { name: fr.coachPanel.send, exact: true }).click();
}

const savedOf = (applicationId: string) =>
  query<{ saved: { content: { skills: string[] }; origin?: { origin: string } } }>("SELECT saved FROM tailored_cv WHERE application_id = $1", [applicationId]).then((rows) => rows[0]!.saved);
const versionsOf = (applicationId: string) =>
  query<{ version: number; source: string; restored_from: number | null }>(
    "SELECT version, source, restored_from FROM tailored_document_version WHERE application_id = $1 AND document = 'tailored_cv' ORDER BY version",
    [applicationId],
  );

test.describe.configure({ mode: "serial" });

test.describe("the Tailored CV reworked from the conversation, change by change (ADR-0113, #1097)", () => {
  test.beforeAll(async () => {
    test.setTimeout(180_000);
    server = await startOwnServer(PORT_OFFSET, "coach_tailored_cv_rework", {
      JOBHUB_TARGET: "e2e",
      JOBHUB_IGNORE_ROOT_ENV: "1",
      AUTH_SECRET: "e2e-coach-tailored-cv-rework-e2e-coach-tailored-cv",
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

  test("a Layout-only card on the saved Tailored CV → its review in the Work Pane → saved with its Origin → « Annuler »", async ({ browser }) => {
    const { page, applicationId, skills } = await withTailoredCv(browser);
    const last = skills.at(-1)!;
    expect(skills.length).toBeGreaterThan(1);
    expect(await versionsOf(applicationId)).toHaveLength(1);

    await ask(page, "Mettez cette compétence en premier dans mon CV adapté.", "propose_tailored_cv_changes", { changes: [{ kind: "highlight", section: "skills", item: last }] });
    const card = cardOf(page, tc.tailored);
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText(texts.layoutOnly);
    await expect(card).toContainText(tr(texts.tailoredCvChanges.saved, { version: "1" }));
    await expect(card.getByRole("link", { name: `${TITLE} · Acme Industrie` })).toHaveAttribute("href", `/candidatures/${applicationId}/documents?resultat=cv-adapte`);
    // No « Appliquer » in one click: the change is reviewed first; nothing changed yet.
    await expect(card.getByRole("button")).toHaveText([texts.review.open, texts.dismiss]);
    expect((await savedOf(applicationId)).content.skills).toEqual(skills);

    await card.getByRole("button", { name: texts.review.open, exact: true }).click();
    const pane = page.getByRole("complementary", { name: tr(texts.review.title, { what: tc.tailored }) });
    await expect(pane.getByRole("heading", { level: 2 })).toBeFocused();
    await expect(pane).toContainText(tr(texts.review.introTailoredCv, { name: `${TITLE} · Acme Industrie` }));
    await expect(pane.getByRole("listitem")).toHaveCount(1);
    // None accepted in advance.
    await expect(pane.getByRole("button", { name: tc.accept, exact: true })).toHaveAttribute("aria-pressed", "false");
    await pane.getByRole("button", { name: tc.accept, exact: true }).click();
    await pane.getByRole("button", { name: texts.review.save, exact: true }).click();
    await expect(pane).toBeHidden();
    await expect(card.getByRole("status")).toHaveText(at(texts.applied));

    // The Tailored CV's next version, the card kept as its Origin.
    const reworked = await savedOf(applicationId);
    expect(reworked.content.skills).toEqual([last, ...skills.slice(0, -1)]);
    expect(reworked.origin?.origin).toBe("coach_proposal");
    expect((await versionsOf(applicationId)).map((version) => [version.version, version.source])).toEqual([
      [1, "drafted"],
      [2, "coach"],
    ]);

    // Shown under « Origine » on the Tailored CV.
    await page.goto(`/candidatures/${applicationId}/documents?resultat=cv-adapte`);
    const saved = page.getByRole("group", { name: tc.savedTitle });
    const origin = saved.locator("details.origin-disclosure");
    await origin.getByText(fr.origin.label, { exact: true }).click();
    await expect(origin).toContainText(new RegExp(tr(fr.origin.coachProposal, { date: ".+" })));

    // « Annuler »: a Restore of the version before, as version 3; the history kept, the Origin gone.
    await page.goto(`/candidatures/${applicationId}`);
    const applied = cardOf(page, tc.tailored);
    await applied.getByRole("button", { name: texts.undo, exact: true }).click();
    await expect(applied.getByRole("status")).toHaveText(at(texts.undone));
    const undone = await savedOf(applicationId);
    expect(undone.content.skills).toEqual(skills);
    expect(undone.origin).toBeUndefined();
    expect((await versionsOf(applicationId)).map((version) => [version.version, version.restored_from])).toEqual([
      [1, null],
      [2, null],
      [3, 1],
    ]);
  });
});
