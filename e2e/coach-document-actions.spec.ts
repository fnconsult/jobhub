import path from "node:path";
import { readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import pg from "pg";
import { workPaneOf } from "./support/conversation";
import { newAddress } from "./support/mailbox";
import { signInByEmail, startOwnServer, type OwnServer } from "./support/own-server";

// Issue #721 (ADR-0077): the « Documents » Coach Actions, end to end. In an Application's conversation, « adapte mon CV »:
// the shipped `propose_tailored_cv` makes a card under the reply; « Préparer » runs the Tailored CV proposal through its
// own route, and its Tailored CV Review opens in the Work Pane, beside the conversation, change by change. « Écris-moi une
// lettre »: a card, no letter drafted until « Rédiger »; a draft that exists is said to be replaced, edits included, and
// confirmed first. This spec runs on a server of its own with COACH_ACTIONS_ENABLED on; the AI Coach is faked inside it
// (fake-mistral.mjs): a message holding `E2E_COACH_TOOL=<name>:<json>` has it call that Coach Action.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const texts = fr.coachProposals;
const tc = fr.tailoredCv;
/** Inside the suite's own range of derived ports (e2e/support/ports.ts), apart from the other specs' servers. */
const PORT_OFFSET = 721;
const TITLE = "Directeur administratif et financier (H/F)";
const tr = (template: string, values: Record<string, string>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");
const at = (template: string) => new RegExp(`^${tr(template, { time: "\\d\\d:\\d\\d" })}$`);

const masterCv = {
  fullName: "Marie Dupont",
  headline: "Directrice financière",
  email: "marie.dupont@example.fr",
  phone: "",
  location: "Lyon",
  summary: "",
  experience: [
    { title: "Directrice financière", employer: "Groupe Seb", location: "Lyon", period: "2005 – 2024", description: "Consolidation IFRS." },
    { title: "Contrôleuse de gestion", employer: "Danone", location: "Paris", period: "1995 – 2005", description: "Reporting mensuel." },
  ],
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

/** A new Candidate, signed in on a wide screen, with a Profile and an Application: its page open on its conversation. */
async function withApplication(browser: Browser): Promise<{ page: Page; applicationId: string }> {
  const context = await browser.newContext({ baseURL: server.origin, locale: "fr-FR", viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  await signInByEmail(page, server, newAddress("coach-documents"));
  const headers = { origin: server.origin };
  const profile = await page.request.post("/api/profiles", { data: { masterCv, searchCriteria: { targetRole: "DAF", locations: ["Lyon"] } }, headers });
  expect(profile.status(), await profile.text()).toBe(201);
  const captured = await page.request.post("/api/job-offers", {
    data: {
      source: { url: `https://www.apec.fr/offres/${Date.now()}-${Math.random().toString(36).slice(2, 8)}` },
      title: TITLE,
      content: "Acme Industrie recrute son DAF. Vous pilotez la consolidation IFRS sous SAP et le reporting sous Power BI.",
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
  await page.goto(`/candidatures/${applicationId}`);
  return { page, applicationId };
}

const conversation = (page: Page) => page.getByRole("region", { name: fr.conversationFirst.label });
const cardOf = (page: Page, what: string) => conversation(page).getByRole("article", { name: new RegExp(what) }).last();

/** Asks the AI Coach from the Application's conversation, having it call `tool` with `args`. */
async function ask(page: Page, message: string, tool: string, args: object = {}) {
  await conversation(page).getByLabel(fr.coachPanel.messageLabel).fill(`${message}\nE2E_COACH_TOOL=${tool}:${JSON.stringify(args)}`);
  await conversation(page).getByRole("button", { name: fr.coachPanel.send, exact: true }).click();
}

const draftsOf = (applicationId: string) =>
  query<{ kind: string; drafted_at: Date; text: string }>("SELECT kind, drafted_at, text FROM tailored_document WHERE application_id = $1 ORDER BY kind", [applicationId]);

test.describe.configure({ mode: "serial" });

test.describe("the « Documents » Coach Actions: « Préparer », « Rédiger », the Work Pane (#721)", () => {
  test.beforeAll(async () => {
    test.setTimeout(180_000);
    server = await startOwnServer(PORT_OFFSET, "coach_document_actions", {
      JOBHUB_TARGET: "e2e",
      JOBHUB_IGNORE_ROOT_ENV: "1",
      AUTH_SECRET: "e2e-coach-document-actions-e2e-coach-document-actions",
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

  test("« adapte mon CV » → a card → « Préparer » → the Tailored CV Review opened in the Work Pane, beside the conversation", async ({ browser }) => {
    const { page, applicationId } = await withApplication(browser);

    await ask(page, "Adaptez mon CV à cette offre.", "propose_tailored_cv");
    const card = cardOf(page, tc.tailored);
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText(texts.by);
    await expect(card).toContainText(texts.values.noTailoredCv);
    await expect(card.getByRole("link", { name: `${TITLE} · Acme Industrie` })).toHaveAttribute("href", `/candidatures/${applicationId}/documents?resultat=cv-adapte`);
    await expect(card.getByRole("button")).toHaveText([texts.prepare, texts.dismiss]);
    // Proposed, nothing prepared yet.
    const proposals = () => query<{ proposal: unknown }>("SELECT proposal FROM tailored_cv WHERE application_id = $1 AND proposal IS NOT NULL", [applicationId]);
    expect(await proposals()).toEqual([]);

    await card.getByRole("button", { name: texts.prepare, exact: true }).click();
    await expect(card.getByRole("status").first()).toHaveText(at(texts.launched));

    // The Tailored CV Review, in the Work Pane at the Result's address, the conversation still beside it.
    await expect(page).toHaveURL(new RegExp(`/candidatures/${applicationId}/documents\\?resultat=cv-adapte$`), { timeout: 30_000 });
    const pane = workPaneOf(page, tc.tailored);
    const review = pane.getByRole("group", { name: tc.proposalTitle });
    await expect(review).toBeVisible({ timeout: 30_000 });
    await expect(review.getByText(tc.changesIntro)).toBeVisible();
    await expect(review.getByRole("button", { name: tc.accept }).first()).toBeVisible();
    await expect(conversation(page)).toBeVisible();
    expect(await proposals()).toHaveLength(1);
    // No « Annuler »: a launched action ends with Stop.
    await expect(card.getByRole("button", { name: texts.undo })).toHaveCount(0);
  });

  test("« écris-moi une lettre » → a card, no letter drafted; a draft that exists is replaced only once confirmed", async ({ browser }) => {
    const { page, applicationId } = await withApplication(browser);

    await ask(page, "Écris-moi une lettre de motivation.", "propose_cover_letter");
    const first = cardOf(page, fr.tailoredDocuments.coverLetter.title);
    await expect(first).toBeVisible({ timeout: 30_000 });
    await expect(first).toContainText(texts.values.noDraft);
    await expect(first.getByRole("button")).toHaveText([texts.draft, texts.dismiss]);
    // A card, not a letter: nothing is drafted until « Rédiger ».
    expect(await draftsOf(applicationId)).toEqual([]);
    await first.getByRole("button", { name: texts.dismiss, exact: true }).click();

    // A letter drafted, then edited, from the documents page.
    const headers = { origin: server.origin };
    const drafted = await page.request.post(`/api/applications/${applicationId}/tailored-documents`, { data: { document: "cover_letter" }, headers });
    expect(drafted.ok(), await drafted.text()).toBe(true);
    const edited = await page.request.patch(`/api/applications/${applicationId}/tailored-documents`, { data: { document: "cover_letter", text: "Ma lettre, retouchée à la main." }, headers });
    expect(edited.ok(), await edited.text()).toBe(true);
    const [before] = await draftsOf(applicationId);

    await page.reload();
    await ask(page, "Réécris ma lettre de motivation.", "propose_cover_letter");
    const card = cardOf(page, fr.tailoredDocuments.coverLetter.title);
    await expect(card).toContainText(texts.values.replacesDraft, { timeout: 30_000 });

    await card.getByRole("button", { name: texts.draft, exact: true }).click();
    await expect(card.getByRole("group", { name: texts.confirmReplace })).toBeVisible();
    await expect(card.getByRole("button", { name: texts.confirmYes })).toBeFocused();
    await card.getByRole("button", { name: texts.confirmNo, exact: true }).click();
    expect(await draftsOf(applicationId)).toEqual([before]);

    await card.getByRole("button", { name: texts.draft, exact: true }).click();
    await card.getByRole("button", { name: texts.confirmYes, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/candidatures/${applicationId}/documents\\?resultat=lettre$`), { timeout: 30_000 });
    await expect(workPaneOf(page, fr.tailoredDocuments.coverLetter.title)).toBeVisible();
    await expect.poll(async () => (await draftsOf(applicationId))[0]?.text).not.toBe("Ma lettre, retouchée à la main.");
  });
});

test.describe("documentation of #721", () => {
  const read = (file: string) => readFileSync(file, "utf8");
  for (const [lang, labels] of [
    ["fr", ["« Préparer »", "« Rédiger »", "« Remplacer et rédiger »", "« Garder mon brouillon »"]],
    ["en", ["« Prepare »", "« Draft »", "« Replace and draft »", "« Keep my draft »"]],
  ] as const) {
    test(`Help Article ${lang}/page-application says what the coach can prepare, and how`, () => {
      const article = read(`packages/help/articles/${lang}/page-application.md`);
      for (const label of labels) expect(article).toContain(label);
    });
  }
  test("the Release Note fragment: new, tagged documents", () => {
    const fragment = read("packages/help/releases/unreleased/767.md");
    expect(fragment).toMatch(/^kind: new$/m);
    expect(fragment).toMatch(/^tags: \[.*documents.*\]$/m);
    expect(fragment).toMatch(/^## en$/m);
  });
});
