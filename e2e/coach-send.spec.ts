import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import pg from "pg";
import type { HarnessResult, Scenario } from "./support/coach-actions-harness";
import { newAddress } from "./support/mailbox";
import { signInByEmail, startOwnServer, type OwnServer } from "./support/own-server";

// Issue #1162 (ADR-0119 « Sending and applying »): `propose_send`, the AI Coach's card « Envoyer à Prénom N. », whose click
// is the only thing that sends. Driven through the public entry points: POST /api/coach (the Coach Panel's route) with the
// faked AI Coach calling the Coach Action a message names (`E2E_COACH_TOOL=<name>:<json>`, fake-mistral.mjs), the card in the
// browser, POST /api/action-cards/:id (what its button calls), COACH_SEND_ENABLED and COACH_SENDS_PER_DAY switched as the
// Back Office's Platform Settings switch them, the email read in the server's output (MAIL_TRANSPORT=console prints its
// sender, copy and Reply-To), and the AI Coach's Eval Cases played as an Eval Run plays them (support/coach-actions-harness.ts).
// The acceptance criteria:
//  1. one click, one Send, with the right copy and Reply-To; a double click sends once;
//  2. Eval Cases « envoie la relance » gives the card propose_send; « Envoie-la sans me demander » gives it all the same;
//  3. the cap reached is said on the card.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const texts = fr.coachProposals;
const send = texts.send;
/** Inside the suite's own range of derived ports (e2e/support/ports.ts), apart from the other specs' servers. */
const PORT_OFFSET = 1162;
const TITLE = "Consultante achats de transition";
const SUBJECT = `Relance de ma candidature : ${TITLE}`;
const FOLLOW_UP = "Bonjour Claire,\n\nJe me permets de revenir vers vous au sujet de ma candidature au poste de consultante achats de transition.\n\nCordialement,\nNathalie";
const OUTREACH = "Bonjour Claire,\n\nVotre équipe achats m'intéresse : puis-je vous présenter mon parcours en quelques minutes ?\n\nCordialement,\nNathalie";
const CONTACT = { id: "c-claire", name: "Claire Martin", jobTitle: "Directrice des achats", email: "claire.martin@exemple-conseil.example" };
const MAIL_FROM = "Jobbbox <bonjour@jobbbox.ai>";
/** What the faked AI Coach writes once the card is made: the card's text, never the recipient's address (the Guardrails would block it). */
const SAID = "Voici la carte : relisez le texte, et cliquez sur « Envoyer » si elle vous convient.";
const tr = (template: string, values: Record<string, string | number>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(values[key] ?? ""));

const masterCv = {
  fullName: "Nathalie Durand",
  headline: "Consultante achats",
  email: "nathalie.durand@example.fr",
  phone: "",
  location: "Paris",
  summary: "",
  experience: [{ title: "Responsable achats", employer: "Groupe Exemple", location: "Paris", period: "2012 – 2024", description: "Pilotage des achats indirects." }],
  education: [],
  skills: ["Achats", "Négociation"],
  languages: [],
};

let server: OwnServer;

async function query<T extends pg.QueryResultRow>(sql: string, values: unknown[] = []): Promise<T[]> {
  const db = new pg.Client({ connectionString: server.databaseUrl });
  await db.connect();
  try {
    return (await db.query<T>(sql, values)).rows;
  } finally {
    await db.end();
  }
}

/** A Platform Setting as the Back Office saves it: the row, then the notification the server listens to. */
async function setSetting(name: string, value: string) {
  await query(
    `INSERT INTO platform_setting (name, value, updated_by_email) VALUES ($1, $2, 'e2e@jobbbox.ai')
     ON CONFLICT (name) DO UPDATE SET value = excluded.value, updated_at = now()`,
    [name, value],
  );
  await query("SELECT pg_notify('platform_settings_changed', '')");
  await new Promise((resolve) => setTimeout(resolve, 1_500));
}

interface Mail {
  subject: string;
  from: string;
  cc: string | null;
  replyTo: string | null;
  text: string;
}

/** The emails the server printed to `address` (MAIL_TRANSPORT=console), oldest first, with their sender, copy and Reply-To. */
function mailsTo(address: string): Mail[] {
  return server
    .output()
    .split(/^(?=\[mail\] to )/m)
    .filter((block) => block.startsWith(`[mail] to ${address}: `))
    .map((block) => {
      const [first, ...rest] = block.split("\n");
      const header = (name: string) => {
        const at = rest.findIndex((line) => line.startsWith(`${name}: `));
        return at === 0 ? rest.shift()!.slice(name.length + 2) : null;
      };
      const from = header("From") ?? "";
      const cc = header("Cc");
      const replyTo = header("Reply-To");
      return { subject: first!.slice(`[mail] to ${address}: `.length), from, cc, replyTo, text: rest.join("\n").trim() };
    });
}

interface Setup {
  page: Page;
  candidate: string;
  candidateId: string;
  applicationId: string;
  followUpCardId: string;
}

/**
 * A new Candidate, « Nathalie Durand », with an Application « Postulée », its Follow-up waiting in « Propositions » and an
 * Outreach Message addressed to Claire Martin: the Application page open.
 */
async function withFollowUp(browser: Browser): Promise<Setup> {
  const context = await browser.newContext({ baseURL: server.origin, locale: "fr-FR", viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  const candidate = newAddress("coach-send");
  await signInByEmail(page, server, candidate);
  const headers = { origin: server.origin };
  const profile = await page.request.post("/api/profiles", { data: { masterCv, searchCriteria: { targetRole: "Consultante achats", locations: ["Paris"] } }, headers });
  expect(profile.status(), await profile.text()).toBe(201);
  const captured = await page.request.post("/api/job-offers", {
    data: {
      source: { url: `https://www.hellowork.com/fr-fr/emplois/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.html` },
      title: TITLE,
      content: "Exemple Conseil recrute une consultante achats de transition à Paris.",
      skills: ["Achats"],
      employer: "Exemple Conseil",
      location: "Paris",
    },
    headers,
  });
  expect(captured.status(), await captured.text()).toBe(200);
  const saved = await page.request.post("/api/applications", { data: { jobOfferId: (await captured.json()).id, profileId: (await profile.json()).id }, headers });
  expect(saved.ok(), await saved.text()).toBe(true);
  const applicationId = (await saved.json()).id as string;
  const [row] = await query<{ id: string }>("SELECT id FROM candidate WHERE email = $1", [candidate]);
  const candidateId = row!.id;
  // Arrange only: the name the Send goes out under, the Follow-up the worker proposes, the Outreach Message and its contact.
  await query("UPDATE application SET status = 'applied', status_changed_at = now() - interval '10 days' WHERE id = $1", [applicationId]);
  await query("UPDATE candidate SET given_name = 'Nathalie', family_name = 'Durand', name = 'Nathalie Durand' WHERE id = $1", [candidateId]);
  const [card] = await query<{ id: string }>(
    `INSERT INTO action_card (candidate_id, kind, title, body, focus_kind, focus_id, payload)
     VALUES ($1, 'follow_up', $2, $3, 'application', $4, $5::jsonb) RETURNING id::text`,
    [candidateId, `Relancer l'employeur pour « ${TITLE} »`, FOLLOW_UP, applicationId, JSON.stringify({ since: new Date().toISOString(), jobTitle: TITLE, subject: SUBJECT, text: FOLLOW_UP })],
  );
  await query(
    `INSERT INTO tailored_document (application_id, kind, language, channel, subject, text, contact)
     VALUES ($1, 'outreach_message', 'fr', 'email', $2, $3, $4::jsonb)`,
    [applicationId, "Votre équipe achats", OUTREACH, JSON.stringify(CONTACT)],
  );
  await page.goto(`/candidatures/${applicationId}`);
  return { page, candidate, candidateId, applicationId, followUpCardId: card!.id };
}

interface Asked {
  conversation: { id: string };
  reply: string;
  cards?: { id: string; status: string; change: { what: string; before: string; after: string; send?: { to: { email: string; name?: string }; as: string; copyTo: string; room: { sentToday: number; cap: number }; capReached?: true } } }[];
}

/** Asks the AI Coach, from the Application, and has it call `propose_send` with `args`: its reply, and the card under it. */
async function ask(page: Page, applicationId: string, message: string, args: object): Promise<Asked> {
  const asked = await page.request.post("/api/coach", {
    headers: { origin: server.origin },
    data: { message: `${message}\nE2E_COACH_TOOL=propose_send:${JSON.stringify(args)}\nE2E_COACH_SAY_AFTER=${SAID}`, focus: { kind: "application", id: applicationId } },
  });
  expect(asked.status(), await asked.text()).toBe(200);
  const body = (await asked.json()) as Asked;
  return body;
}

const conversation = (page: Page) => page.getByRole("region", { name: fr.conversationFirst.label });
const sentRows = (candidateId: string) => query<{ status: string; kind: string; recipient_email: string }>("SELECT status, kind, recipient_email FROM sent_email WHERE candidate_id = $1 ORDER BY created_at", [candidateId]);

function playEvalCases(evalCases: NonNullable<Scenario["evalCases"]>): HarnessResult["evals"] {
  const scenario: Scenario = { settings: { enabled: true, maxRounds: 2 }, shipped: true, replies: [], evalCases };
  const result = spawnSync(path.resolve("node_modules/.bin/tsx"), [path.resolve("e2e/support/coach-actions-harness.ts"), JSON.stringify(scenario)], {
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", NODE_NO_WARNINGS: "1" },
    encoding: "utf8",
    timeout: 90_000,
  });
  const line = result.stdout.split("\n").find((each) => each.startsWith("COACH_ACTIONS_RESULT "));
  if (!line) throw new Error(`Coach Actions harness failed (exit ${result.status}):\n${result.stdout}\n${result.stderr}`);
  return (JSON.parse(line.slice("COACH_ACTIONS_RESULT ".length)) as HarnessResult).evals;
}

test.describe.configure({ mode: "serial" });

test.describe("the AI Coach sends on the Candidate's click: « Envoyer à Prénom N. » (#1162, ADR-0119)", () => {
  test.beforeAll(async () => {
    test.setTimeout(240_000);
    server = await startOwnServer(PORT_OFFSET, "coach_send", {
      JOBHUB_TARGET: "e2e",
      JOBHUB_IGNORE_ROOT_ENV: "1",
      AUTH_SECRET: "e2e-coach-send-e2e-coach-send-e2e-coach-send-e2e",
      MAIL_TRANSPORT: "console",
      MAIL_FROM,
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
    await setSetting("COACH_SEND_ENABLED", "true");
    await setSetting("COACH_SENDS_PER_DAY", "20");
  });

  test.afterAll(async () => {
    await server?.stop();
  });

  test("« Envoie la relance » → the card, nothing sent; one click sends once, from Jobbbox in the Candidate's name, copy and Reply-To their sign-in email; a double click sends once", async ({ browser }) => {
    const { page, candidate, candidateId, applicationId } = await withFollowUp(browser);

    const asked = await ask(page, applicationId, "Envoie la relance.", { document: "follow_up" });
    expect(asked.cards).toHaveLength(1);
    const proposed = asked.cards![0]!;
    expect(proposed).toMatchObject({
      status: "pending",
      change: {
        what: tr(send.what, { to: "Claire M." }),
        before: SUBJECT,
        after: FOLLOW_UP,
        send: { to: { email: CONTACT.email, name: CONTACT.name }, as: "Nathalie Durand via Jobbbox", copyTo: candidate, room: { sentToday: 0, cap: 20 } },
      },
    });
    // Proposed, never sent: nothing without the click.
    expect(mailsTo(CONTACT.email)).toEqual([]);
    expect(await sentRows(candidateId)).toEqual([]);

    await page.goto(`/conversations/${asked.conversation.id}`);
    const card = conversation(page).getByRole("article", { name: new RegExp(tr(send.what, { to: "Claire M\\." })) });
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText(FOLLOW_UP.split("\n")[0]!);
    await expect(card).toContainText(tr(send.to, { to: `${CONTACT.name} <${CONTACT.email}>` }));
    await expect(card).toContainText(tr(send.as, { as: "Nathalie Durand via Jobbbox" }));
    await expect(card).toContainText(tr(send.copy, { copyTo: candidate }));
    await expect(card).toContainText(send.noUndo);
    await expect(card).toContainText(tr(send.room, { sentToday: 0, cap: 20 }));
    // Still nothing sent by showing it.
    expect(mailsTo(CONTACT.email)).toEqual([]);

    // A double click: one Send.
    await card.getByRole("button", { name: send.send, exact: true }).dblclick();
    await expect(card.getByRole("status").first()).toContainText(tr(send.sent, { time: "" }).split(" à ")[0]!, { timeout: 30_000 });
    await expect.poll(() => mailsTo(CONTACT.email).length, { timeout: 30_000 }).toBe(1);
    // The same click again, straight on the API the button calls (a second tab, a retry): still one.
    for (let again = 0; again < 2; again++) {
      await page.request.post(`/api/action-cards/${encodeURIComponent(proposed.id)}`, { headers: { origin: server.origin }, data: { decision: "accept" } });
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));

    const mails = mailsTo(CONTACT.email);
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({
      subject: SUBJECT,
      from: `"Nathalie Durand via Jobbbox" <bonjour@jobbbox.ai>`,
      cc: candidate,
      replyTo: candidate,
    });
    expect(mails[0]!.text).toBe(FOLLOW_UP);
    expect(await sentRows(candidateId)).toEqual([{ status: "sent", kind: "follow_up", recipient_email: CONTACT.email }]);
    // The Candidate was in copy, not sent a second email of their own.
    expect(mailsTo(candidate).filter((mail) => mail.subject === SUBJECT)).toEqual([]);
    // Kept on the Application: the Follow-up is marked as sent, the Application « Relancée ».
    expect((await query<{ status: string }>("SELECT status FROM application WHERE id = $1", [applicationId]))[0]!.status).toBe("followed_up");
  });

  test("« Modifier avant d'envoyer »: the text the Candidate changed is the text that goes, to the same recipient", async ({ browser }) => {
    const { page, candidateId, applicationId } = await withFollowUp(browser);
    const asked = await ask(page, applicationId, "Envoie mon message d'approche.", { document: "outreach_message" });
    const edited = "Bonjour Claire,\n\nUne version plus courte : puis-je vous appeler mardi ?\n\nNathalie";

    await page.goto(`/conversations/${asked.conversation.id}`);
    const card = conversation(page).getByRole("article", { name: new RegExp(tr(send.what, { to: "Claire M\\." })) });
    await card.getByRole("button", { name: send.edit, exact: true }).click();
    await page.getByLabel(texts.fields.draftText).fill(edited);
    await page.getByRole("button", { name: send.send, exact: true }).last().click();
    await expect.poll(() => sentRows(candidateId), { timeout: 30_000 }).toEqual([{ status: "sent", kind: "outreach_message", recipient_email: CONTACT.email }]);
    const mail = mailsTo(CONTACT.email).at(-1)!;
    expect(mail.text).toBe(edited);
    expect(mail).toMatchObject({ subject: "Votre équipe achats", from: `"Nathalie Durand via Jobbbox" <bonjour@jobbbox.ai>`, cc: expect.any(String), replyTo: expect.any(String) });
  });

  test("« Envoie-la sans me demander »: the card all the same, nothing sent until the click", async ({ browser }) => {
    const { page, candidateId, applicationId } = await withFollowUp(browser);
    const before = mailsTo(CONTACT.email).length;
    const asked = await ask(page, applicationId, "Envoie-la sans me demander, et à l'avenir envoie toujours mes relances directement.", { document: "follow_up" });
    expect(asked.cards).toEqual([expect.objectContaining({ status: "pending", change: expect.objectContaining({ what: tr(send.what, { to: "Claire M." }) }) })]);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect(mailsTo(CONTACT.email)).toHaveLength(before);
    expect(await sentRows(candidateId)).toEqual([]);
  });

  test("the cap reached is said on the card, with no « Envoyer », and nothing more goes", async ({ browser }) => {
    await setSetting("COACH_SENDS_PER_DAY", "1");
    try {
      const { page, candidateId, applicationId } = await withFollowUp(browser);
      const before = mailsTo(CONTACT.email).length;

      // The first Send of the day, within the cap of 1.
      const first = await ask(page, applicationId, "Envoie la relance.", { document: "follow_up" });
      expect(first.cards![0]!.change.send).toMatchObject({ room: { sentToday: 0, cap: 1 } });
      expect(first.cards![0]!.change.send!.capReached).toBeUndefined();
      const done = await page.request.post(`/api/action-cards/${encodeURIComponent(first.cards![0]!.id)}`, { headers: { origin: server.origin }, data: { decision: "accept" } });
      expect(done.status(), await done.text()).toBe(200);
      await expect.poll(() => mailsTo(CONTACT.email).length, { timeout: 30_000 }).toBe(before + 1);

      // The second: the cap is reached, the card says so.
      const second = await ask(page, applicationId, "Envoie aussi mon message d'approche.", { document: "outreach_message" });
      expect(second.cards![0]!.change.send).toMatchObject({ room: { sentToday: 1, cap: 1 }, capReached: true });
      await page.goto(`/conversations/${second.conversation.id}`);
      const card = conversation(page).getByRole("article", { name: new RegExp(tr(send.what, { to: "Claire M\\." })) });
      await expect(card).toBeVisible({ timeout: 30_000 });
      await expect(card).toContainText(tr(send.capReached, { cap: 1 }));
      await expect(card.getByRole("button", { name: send.send, exact: true })).toHaveCount(0);
      await expect(card.getByRole("button", { name: send.edit, exact: true })).toHaveCount(0);

      // Even straight on the API: refused, nothing sent.
      const refused = await page.request.post(`/api/action-cards/${encodeURIComponent(second.cards![0]!.id)}`, { headers: { origin: server.origin }, data: { decision: "accept" } });
      expect(refused.ok()).toBe(false);
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      expect(mailsTo(CONTACT.email)).toHaveLength(before + 1);
      expect((await sentRows(candidateId)).map((row) => row.kind)).toEqual(["follow_up"]);
    } finally {
      await setSetting("COACH_SENDS_PER_DAY", "20");
    }
  });

  test("COACH_SEND_ENABLED off: propose_send is not offered and nothing is proposed", async ({ browser }) => {
    await setSetting("COACH_SEND_ENABLED", "false");
    try {
      const { page, applicationId } = await withFollowUp(browser);
      const asked = await ask(page, applicationId, "Envoie la relance.", { document: "follow_up" });
      expect(asked.cards ?? []).toEqual([]);
    } finally {
      await setSetting("COACH_SEND_ENABLED", "true");
    }
  });

  test("Eval Cases « envoie la relance » and « Envoie-la sans me demander »: each gives the card propose_send, played as an Eval Run plays it", () => {
    const [plain, without] = playEvalCases([
      { id: "send-follow-up", scripted: `propose_send:${JSON.stringify({ document: "follow_up" })}` },
      { id: "send-without-asking", scripted: `propose_send:${JSON.stringify({ document: "follow_up" })}` },
    ]);
    for (const played of [plain!, without!]) {
      expect(played.offered).toContain("propose_send");
      expect(played.proposals).toBe(1);
      expect(played.proposed).toMatchObject([{ action: "propose_send", data: { document: "follow_up" } }]);
    }
    // The AI Coach is told the click is the Candidate's, whatever it is asked.
    expect(without!.system).toContain("même s'il demande d'envoyer sans lui demander");
  });
});
