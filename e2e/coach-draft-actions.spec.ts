import path from "node:path";
import { readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import pg from "pg";
import { newAddress } from "./support/mailbox";
import { signInByEmail, startOwnServer, type OwnServer } from "./support/own-server";

// ADR-0109: the AI Coach reworks an Application's drafts from the conversation. On the Beta, « Retravaille la
// proposition de relance de façon plus concise » ended twice on « Je n'ai pas réussi à vous répondre cette fois » and
// « Poser la question à l'équipe »: the AI Coach could neither read the Follow-up waiting in « Propositions » nor propose
// a new text for it, and wrote nothing. Now it reads the draft (`read_draft`), proposes its new text (`propose_draft_text`)
// as a card under its reply; « Appliquer » changes the Follow-up in « Propositions », « Annuler » puts it back. And a turn
// that ends with no text gets a Last turn, which answers the request; if that one writes nothing either, the Last net
// answers with « Poser la question à l'équipe » (#1156, ADR-0119), never a generic text. This spec runs on a
// server of its own with COACH_ACTIONS_ENABLED on; the AI Coach is faked inside it (fake-mistral.mjs): a message holding
// `E2E_COACH_TOOL=<name>:<json>` has it call that Coach Action, one a round.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const texts = fr.coachProposals;
/** Inside the suite's own range of derived ports (e2e/support/ports.ts), apart from the other specs' servers. */
const PORT_OFFSET = 1109;
const TITLE = "Head Of Business Unit Compte Stratégique - Paris H/F";
const LONG =
  "Bonjour,\n\nJe me permets de revenir vers vous au sujet de ma candidature au poste de Head Of Business Unit, que je vous ai adressée récemment.\n\nCe rôle de pilotage correspond à mon projet professionnel.\n\nJe serais heureux d'échanger avec vous pour préciser en quoi mon parcours répond aux attentes de ce poste.\n\nCordialement,";
const SHORT = "Bonjour,\n\nJe reviens vers vous au sujet de ma candidature au poste de Head Of Business Unit. Où en est le recrutement ?\n\nCordialement,";
const ASKED = "Retravaille la proposition de relance de façon plus concise";

const masterCv = {
  fullName: "Marie Dupont",
  headline: "Head of Business Unit",
  email: "marie.dupont@example.fr",
  phone: "",
  location: "Paris",
  summary: "",
  experience: [
    {
      title: "Directrice de BU",
      employer: "Groupe Seb",
      location: "Paris",
      period: "2010 – 2024",
      description: "Pilotage d'une BU de 40 personnes.",
    },
  ],
  education: [],
  skills: ["Management", "Grands comptes"],
  languages: [],
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

/** A new Candidate with an Application « Postulée » and its Follow-up waiting in « Propositions »: its page open on its conversation. */
async function withFollowUp(browser: Browser): Promise<{ page: Page; applicationId: string; cardId: string }> {
  const context = await browser.newContext({
    baseURL: server.origin,
    locale: "fr-FR",
    viewport: { width: 1600, height: 1000 },
  });
  const page = await context.newPage();
  await signInByEmail(page, server, newAddress("coach-drafts"));
  const headers = { origin: server.origin };
  const profile = await page.request.post("/api/profiles", {
    data: {
      masterCv,
      searchCriteria: { targetRole: "Head of BU", locations: ["Paris"] },
    },
    headers,
  });
  expect(profile.status(), await profile.text()).toBe(201);
  const captured = await page.request.post("/api/job-offers", {
    data: {
      source: {
        url: `https://www.hellowork.com/fr-fr/emplois/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.html`,
      },
      title: TITLE,
      content: "Fynd Recrutement recrute pour son client un Head of Business Unit compte stratégique à Paris.",
      skills: ["Management", "Grands comptes"],
      employer: "Fynd Recrutement",
      location: "Paris",
    },
    headers,
  });
  expect(captured.status(), await captured.text()).toBe(200);
  const saved = await page.request.post("/api/applications", {
    data: {
      jobOfferId: (await captured.json()).id,
      profileId: (await profile.json()).id,
    },
    headers,
  });
  expect(saved.ok(), await saved.text()).toBe(true);
  const applicationId = (await saved.json()).id as string;
  // Arrange only: the Follow-up the worker proposes once the Application stayed « Postulée » 7 working days.
  const [card] = await query<{ id: string }>(
    `INSERT INTO action_card (candidate_id, kind, title, body, focus_kind, focus_id, payload)
     SELECT candidate_id, 'follow_up', $2, $3, 'application', $1::text, $4::jsonb FROM application WHERE id::text = $1::text RETURNING id::text`,
    [
      applicationId,
      `Relancer l'employeur pour « ${TITLE} »`,
      LONG,
      JSON.stringify({
        since: new Date().toISOString(),
        jobTitle: TITLE,
        subject: `Relance de ma candidature : ${TITLE}`,
        text: LONG,
      }),
    ],
  );
  await page.goto(`/candidatures/${applicationId}`);
  return { page, applicationId, cardId: card!.id };
}

const conversation = (page: Page) => page.getByRole("region", { name: fr.conversationFirst.label });

/** Asks the AI Coach from the Application's conversation, having it call each of `tools` in turn. */
async function ask(page: Page, message: string, tools: { name: string; args: object }[], more = "") {
  const markers = tools.map(({ name, args }) => `E2E_COACH_TOOL=${name}:${JSON.stringify(args)}`).join("\n");
  await conversation(page)
    .getByLabel(fr.coachPanel.messageLabel)
    .fill(`${message}\n${more ? `${more}\n` : ""}${markers}`);
  await conversation(page).getByRole("button", { name: fr.coachPanel.send, exact: true }).click();
}

const followUpBody = async (cardId: string) => (await query<{ body: string }>("SELECT body FROM action_card WHERE id::text = $1", [cardId]))[0]!.body;

test.describe.configure({ mode: "serial" });

test.describe("the AI Coach reworks an Application's drafts: « Propositions », « Documents » (ADR-0109)", () => {
  test.beforeAll(async () => {
    test.setTimeout(180_000);
    server = await startOwnServer(PORT_OFFSET, "coach_draft_actions", {
      JOBHUB_TARGET: "e2e",
      JOBHUB_IGNORE_ROOT_ENV: "1",
      AUTH_SECRET: "e2e-coach-draft-actions-e2e-coach-draft-actions-0",
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

  test("« plus concise » → a card with the new Follow-up → « Appliquer » changes it in « Propositions » → « Annuler » puts it back", async ({ browser }) => {
    const { page, applicationId, cardId } = await withFollowUp(browser);

    await ask(page, ASKED, [
      { name: "read_draft", args: { document: "follow_up" } },
      {
        name: "propose_draft_text",
        args: { document: "follow_up", text: SHORT },
      },
    ]);
    const card = conversation(page)
      .getByRole("article", { name: new RegExp(texts.fields.draft.follow_up) })
      .last();
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText(texts.by);
    await expect(card.locator(".coach-proposal-card__text").first()).toHaveText(SHORT);
    await expect(card.getByText(texts.currentText)).toBeVisible();
    await expect(card.getByRole("link", { name: `${TITLE} · Fynd Recrutement` })).toHaveAttribute("href", `/candidatures/${applicationId}/propositions`);
    // Proposed, nothing changed yet.
    expect(await followUpBody(cardId)).toBe(LONG);

    await card.getByRole("button", { name: texts.apply, exact: true }).click();
    await expect(card.getByRole("status").first()).toContainText(texts.applied.replace(" à {{time}}", ""), { timeout: 30_000 });
    expect(await followUpBody(cardId)).toBe(SHORT);

    // The Section shows the Follow-up as it now is.
    await page.goto(`/candidatures/${applicationId}/propositions`);
    await expect(page.getByText("Où en est le recrutement ?").first()).toBeVisible({ timeout: 30_000 });

    await page.goto(`/candidatures/${applicationId}`);
    const applied = conversation(page)
      .getByRole("article", { name: new RegExp(texts.fields.draft.follow_up) })
      .last();
    await applied.getByRole("button", { name: texts.undo, exact: true }).click();
    await expect.poll(() => followUpBody(cardId), { timeout: 30_000 }).toBe(LONG);
  });

  test("the Beta's turn: drafts read, then no text written → its Last turn answers the request, no generic text (#1156)", async ({ browser }) => {
    const { page } = await withFollowUp(browser);

    await ask(page, ASKED, [{ name: "read_draft", args: { document: "follow_up" } }], "E2E_COACH_SILENT");
    const reply = conversation(page).locator(".chat-candidate + .chat-coach").last();
    // What the fake's Last turn answers (fake-mistral.mjs, LAST_TURN_REPLY).
    await expect(reply).toContainText("Dites-moi ce que vous voulez garder, et je vous la proposerai.", { timeout: 30_000 });
    await expect(reply).not.toContainText(fr.coachPanel.emptyReply.lastNet);
    await expect(conversation(page).getByRole("button", { name: fr.coachPanel.team.ask })).toHaveCount(0);
  });

  test("no text twice: the Last net, with « Poser la question à l'équipe » at once (#1156, ADR-0119)", async ({ browser }) => {
    const { page } = await withFollowUp(browser);

    await ask(page, ASKED, [{ name: "read_draft", args: { document: "follow_up" } }], "E2E_COACH_SILENT_TWICE");
    const reply = conversation(page).locator(".chat-candidate + .chat-coach").last();
    await expect(reply).toContainText(fr.coachPanel.emptyReply.lastNet, { timeout: 30_000 });
    await expect(conversation(page).getByText(fr.coachPanel.team.couldNotAnswer).first()).toBeVisible();
    await expect(conversation(page).getByRole("button", { name: fr.coachPanel.team.ask })).toBeVisible();
  });
});
