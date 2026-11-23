import { spawnSync } from "node:child_process";
import path from "node:path";
import { readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import pg from "pg";
import { inboundRequest, recruiterEmail } from "../apps/web/src/email-intake/fixtures/inbound-emails";
import { newAddress } from "./support/mailbox";
import { signInByEmail, startOwnServer, type OwnServer } from "./support/own-server";

// #1099 (ADR-0115, proposed): an Application's Exchanges. An email from the employer's domain reaching the Candidate's
// Forwarding address is tied to their Application by rules, checked by the « Contenu piégé dans un email » Guardrail in
// the worker (`exchanges.check`, run once by e2e/support/worker-exchange-check.ts), and shown in the Application's
// « Échanges » Section, not « Correspondance ». Asked to answer it, the AI Coach reads it (`read_exchange`) and proposes
// the whole reply on a card (`propose_exchange_reply`): « Copier » puts it on the clipboard, « Ouvrir dans ma messagerie »
// is a mailto: link; Jobbbox sends nothing and the Application Status does not move. Behind APPLICATION_EXCHANGES_ENABLED,
// off by default: this spec runs on a server of its own with it on (and COACH_ACTIONS_ENABLED); the AI Coach is faked
// inside it (fake-mistral.mjs): a message holding `E2E_COACH_TOOL=<name>:<json>` has it call that Coach Action, one a round.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
/** Inside the suite's own range of derived ports (e2e/support/ports.ts), apart from the other specs' servers. */
const PORT_OFFSET = 1099;
const SECRET = "e2e-application-exchanges-inbound-secret-0123456789";
const MTA_IP = "203.0.113.7";
const MASTER_KEYS = "1:ZTJlLW9ubHktbWFzdGVyLWtleS1lMmUtb25seS0wMDA=";
const REPLY = "Bonjour Jane,\n\nMardi à 14 h me convient très bien pour ce premier entretien.\n\nBien cordialement,\nMarie";

const masterCv = {
  fullName: "Marie Dupont",
  headline: "Data scientist",
  email: "marie.dupont@example.fr",
  phone: "",
  location: "Paris",
  summary: "",
  experience: [{ title: "Data scientist", employer: "Groupe Seb", location: "Paris", period: "2018 – 2024", description: "Modèles de prévision." }],
  education: [],
  skills: ["Python", "SQL"],
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

/** A new Candidate with Email intake on and an Application at Benchling: its id, their Forwarding address and the page. */
async function withApplication(browser: Browser): Promise<{ page: Page; applicationId: string; address: string }> {
  const context = await browser.newContext({ baseURL: server.origin, locale: "fr-FR", viewport: { width: 1600, height: 1000 }, permissions: ["clipboard-read", "clipboard-write"] });
  const page = await context.newPage();
  await signInByEmail(page, server, newAddress("exchanges"));
  const headers = { origin: server.origin };
  const profile = await page.request.post("/api/profiles", { data: { masterCv, searchCriteria: { targetRole: "Data scientist", locations: ["Paris"] } }, headers });
  expect(profile.status(), await profile.text()).toBe(201);
  const captured = await page.request.post("/api/job-offers", {
    data: {
      source: { url: `https://www.welcometothejungle.com/fr/companies/benchling/jobs/${Date.now()}-${Math.random().toString(36).slice(2, 8)}` },
      title: "Data scientist",
      content: "Benchling recrute une data scientist à Paris.",
      skills: ["Python"],
      employer: "Benchling",
      location: "Paris",
    },
    headers,
  });
  expect(captured.status(), await captured.text()).toBe(200);
  const saved = await page.request.post("/api/applications", { data: { jobOfferId: (await captured.json()).id, profileId: (await profile.json()).id }, headers });
  expect(saved.ok(), await saved.text()).toBe(true);
  const on = await page.request.put("/api/account/email-intake", { headers });
  expect(on.status()).toBe(200);
  return { page, applicationId: (await saved.json()).id as string, address: (await on.json()).address as string };
}

/** The worker's `exchanges.check` job on each Exchange waiting for its Guardrail. */
function workerChecks(ids: string[]) {
  const worker = spawnSync(path.resolve("node_modules/.bin/tsx"), ["e2e/support/worker-exchange-check.ts", ...ids], {
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      NODE_ENV: "development",
      DATABASE_URL: server.databaseUrl,
      JOBHUB_TARGET: "e2e",
      AI_EMAIL_GUARDRAIL_PROVIDER: "mistral",
      AI_GUARDRAIL_PROVIDER: "mistral",
      MISTRAL_API_KEY: "e2e-mistral-key",
      NODE_OPTIONS: `--import=${path.resolve("e2e/support/fake-mistral.mjs")}`,
    },
    encoding: "utf8",
    timeout: 90_000,
  });
  expect(worker.status, `${worker.stdout}\n${worker.stderr}`).toBe(0);
  return worker.stdout;
}

const conversation = (page: Page) => page.getByRole("region", { name: fr.conversationFirst.label });

/** Asks the AI Coach from the Application's conversation, having it call each of `tools` in turn. */
async function ask(page: Page, message: string, tools: { name: string; args: object }[]) {
  const markers = tools.map(({ name, args }) => `E2E_COACH_TOOL=${name}:${JSON.stringify(args)}`).join("\n");
  await conversation(page).getByLabel(fr.coachPanel.messageLabel).fill(`${message}\n${markers}`);
  await conversation(page).getByRole("button", { name: fr.coachPanel.send, exact: true }).click();
}

test.describe.configure({ mode: "serial" });

test.describe("An Application's Exchanges: tied by rules, shown in « Échanges », answered as a draft the Candidate sends (#1099)", () => {
  test.beforeAll(async () => {
    test.setTimeout(180_000);
    server = await startOwnServer(PORT_OFFSET, "application_exchanges", {
      JOBHUB_TARGET: "e2e",
      JOBHUB_IGNORE_ROOT_ENV: "1",
      AUTH_SECRET: "e2e-application-exchanges-e2e-application-exchanges",
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
      SECRETS_MASTER_KEYS: MASTER_KEYS,
      EMAIL_INTAKE_INBOUND_SECRET: SECRET,
      EMAIL_INTAKE_MTA_IP_RANGES: "203.0.113.0/24",
      COACH_ACTIONS_ENABLED: "true",
      // On for this spec only: off by default, until the Legal Review of ADR-0115.
      APPLICATION_EXCHANGES_ENABLED: "true",
      NODE_OPTIONS: ["fake-google.mjs", "fake-mistral.mjs", "fake-reference-data.mjs"].map((fake) => `--import=${path.resolve("e2e/support", fake)}`).join(" "),
    });
  });

  test.afterAll(async () => {
    await server?.stop();
  });

  test("an email from the employer's domain is tied, shown in « Échanges », a reply proposed then copied; nothing sent, the status unchanged", async ({ browser }) => {
    const { page, applicationId, address } = await withApplication(browser);

    // The MTA posts a recruiter's answer from benchling.com to the Candidate's Forwarding address.
    const email = recruiterEmail(address, { messageId: `<invite-${Date.now()}@benchling.com>` });
    const { headers, body } = inboundRequest(email, SECRET);
    const delivered = await page.request.post("/api/email-intake/inbound", { headers: { ...headers, "x-forwarded-for": MTA_IP }, data: body });
    expect(delivered.status(), await delivered.text()).toBe(200);
    // Tied by rules to the Application, it waits for the email Guardrail; no Received offer email is read for offers.
    const waiting = await query<{ id: string; application_id: string }>(`SELECT id::text, application_id::text FROM exchange WHERE state = 'awaiting_check'`, []);
    expect(waiting).toEqual([{ id: expect.any(String), application_id: applicationId }]);
    expect(await query(`SELECT 1 FROM received_offer_email WHERE message_id = $1`, [email.messageId])).toEqual([]);
    expect(workerChecks(waiting.map((each) => each.id))).toContain("checked: kept");

    // The « Échanges » Section, apart from « Correspondance ».
    await page.goto(`/candidatures/${applicationId}/echanges`);
    const section = page.getByRole("region", { name: fr.exchanges.title });
    await expect(section).toBeVisible({ timeout: 30_000 });
    await expect(section.getByRole("heading", { name: "Votre candidature : Data scientist" })).toBeVisible();
    await expect(section).toContainText("jane.recruiter@benchling.com");
    await expect(section).toContainText("Seriez-vous disponible mardi à 14 h pour un premier entretien ?");
    await expect(page.getByRole("link", { name: fr.application.sections.echanges })).toHaveAttribute("href", `/candidatures/${applicationId}/echanges`);
    await expect(page.getByRole("link", { name: fr.application.sections.correspondance })).toHaveAttribute("href", `/candidatures/${applicationId}/correspondance`);

    // Asked to answer it, the AI Coach reads it and proposes the whole reply on a card.
    await ask(page, "Aide-moi à répondre à Jane : mardi 14 h me va.", [
      { name: "read_exchange", args: {} },
      { name: "propose_exchange_reply", args: { text: REPLY } },
    ]);
    const card = conversation(page).getByRole("article", { name: /Réponse à « Votre candidature : Data scientist »/ }).last();
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card.locator(".coach-proposal-card__text")).toHaveText(REPLY);
    await expect(card).toContainText("À : jane.recruiter@benchling.com · Objet : Re: Votre candidature : Data scientist");
    await expect(card).toContainText(fr.coachProposals.handOver.nothingSent);
    await expect(card.getByRole("button", { name: fr.coachProposals.apply, exact: true })).toHaveCount(0);
    const mailto = await card.getByRole("link", { name: fr.coachProposals.handOver.open }).getAttribute("href");
    expect(mailto).toMatch(/^mailto:jane\.recruiter%40benchling\.com\?subject=Re%3A%20Votre%20candidature/);
    expect(decodeURIComponent(new URL(mailto!).searchParams.get("body") ?? "")).toBe(REPLY);

    await card.getByRole("button", { name: fr.coachProposals.handOver.copy, exact: true }).click();
    await expect(card.getByRole("status").first()).toContainText(fr.coachProposals.handOver.copied, { timeout: 30_000 });
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(REPLY);

    // Jobbbox sent nothing, and the Exchange moved no Application Status.
    const application = await page.request.get(`/api/applications/${applicationId}`);
    expect((await application.json()).status).toBe("to_apply");
  });
});
