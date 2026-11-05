import path from "node:path";
import { readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import pg from "pg";
import { newAddress } from "./support/mailbox";
import { signInByEmail, startOwnServer, type OwnServer } from "./support/own-server";
import { parisDay } from "./support/paris-days";

// Issue #718 (ADR-0077): the Agenda's Coach Actions. From the Agenda, « ajoute mon entretien Airbus jeudi 14 h »: the AI
// Coach proposes the Interview (propose_interview), its card under the reply lists it at its absolute date with the move
// of the Application to « Entretien »; « Appliquer » adds it through the Applications module, and it shows in the week.
// The AI Coach is faked inside the server (fake-mistral.mjs): resolving « jeudi » is the model's, so the message holding
// `E2E_COACH_TOOL=<name>:<json>` gives the absolute date it would send. COACH_ACTIONS_ENABLED is on for this server only.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const texts = fr.coachProposals;
/** Inside the suite's own range of derived ports (e2e/support/ports.ts), apart from the other specs' servers. */
const PORT_OFFSET = 718;
const TITLE = "Contrôleuse de gestion industrielle";
const tr = (template: string, values: Record<string, string>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");

const masterCv = {
  fullName: "Sophie Martin",
  headline: "Contrôleuse de gestion",
  email: "sophie.martin@example.fr",
  phone: "",
  location: "Toulouse",
  summary: "",
  experience: [{ title: "Contrôleuse de gestion", employer: "Exemple Aéro", location: "Toulouse", period: "2008 – 2025", description: "Budget et clôtures." }],
  education: [],
  skills: ["Contrôle de gestion", "SAP"],
  languages: [],
};

let server: OwnServer;

/** The next Thursday after today, in French time ("2026-11-12"): what « jeudi » means said on any day of the week. */
function nextThursday(): string {
  for (let offset = 1; offset <= 7; offset += 1) {
    const day = parisDay(offset);
    if (new Date(`${day}T12:00:00Z`).getUTCDay() === 4) return day;
  }
  throw new Error("no Thursday in a week");
}

async function applicationRow(id: string): Promise<{ status: string; status_origin: unknown }> {
  const db = new pg.Client({ connectionString: server.databaseUrl });
  await db.connect();
  try {
    return (await db.query("SELECT status, status_origin FROM application WHERE id = $1", [id])).rows[0];
  } finally {
    await db.end();
  }
}

async function interviewsOf(id: string): Promise<{ scheduled_at: Date; format: string | null; origin: { origin: string } | null }[]> {
  const db = new pg.Client({ connectionString: server.databaseUrl });
  await db.connect();
  try {
    return (await db.query("SELECT scheduled_at, format, origin FROM interview WHERE application_id = $1", [id])).rows;
  } finally {
    await db.end();
  }
}

/** A new Candidate, signed in on a wide screen, with an Application at Airbus « Postulée »: its page and id. */
async function withAirbusApplication(browser: Browser): Promise<{ page: Page; id: string }> {
  const context = await browser.newContext({ baseURL: server.origin, locale: "fr-FR", viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  await signInByEmail(page, server, newAddress("coach-agenda"));
  const headers = { origin: server.origin };
  const profile = await page.request.post("/api/profiles", { data: { masterCv, searchCriteria: { targetRole: "Contrôle de gestion", locations: ["Toulouse"] } }, headers });
  expect(profile.status(), await profile.text()).toBe(201);
  const captured = await page.request.post("/api/job-offers", {
    data: { source: { url: `https://www.apec.fr/offres/${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }, title: TITLE, content: "Budget et clôtures d'un site de production.", employer: "Airbus", location: "Toulouse" },
    headers,
  });
  expect(captured.status(), await captured.text()).toBe(200);
  const saved = await page.request.post("/api/applications", { data: { jobOfferId: (await captured.json()).id, profileId: (await profile.json()).id }, headers });
  expect(saved.ok(), await saved.text()).toBe(true);
  const id = (await saved.json()).id as string;
  const applied = await page.request.patch(`/api/applications/${id}`, { data: { status: "applied" }, headers });
  expect(applied.ok(), await applied.text()).toBe(true);
  return { page, id };
}

const conversation = (page: Page) => page.getByRole("region", { name: fr.conversationFirst.label });
const workPane = (page: Page) => page.getByRole("complementary").filter({ has: page.getByRole("button", { name: fr.conversationFirst.close, exact: true }) });
const cardOf = (page: Page) => conversation(page).getByRole("article", { name: new RegExp(texts.fields.newInterview) });

test.describe.configure({ mode: "serial" });

test.describe("the Agenda's Coach Actions: an Interview proposed, applied, in the week (#718)", () => {
  test.beforeAll(async () => {
    test.setTimeout(180_000);
    server = await startOwnServer(PORT_OFFSET, "coach_agenda_actions", {
      JOBHUB_TARGET: "e2e",
      JOBHUB_IGNORE_ROOT_ENV: "1",
      AUTH_SECRET: "e2e-coach-agenda-actions-e2e-coach-agenda-actions-e2e",
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

  test("from the Agenda, « ajoute mon entretien Airbus jeudi 14 h » → its card → « Appliquer » → in the week", async ({ browser }) => {
    const { page, id } = await withAirbusApplication(browser);
    const thursday = nextThursday();
    await page.goto(`/agenda?vue=semaine&date=${thursday}`);
    const week = workPane(page);
    const thursdayInWeek = week.locator(".agenda-week > li").filter({ has: page.locator(`h3 time[datetime="${thursday}"]`) });
    await expect(thursdayInWeek).toContainText(fr.agenda.nothing);

    const args = { applicationId: id, scheduledAt: `${thursday}T14:00` };
    await conversation(page).getByLabel(fr.coachPanel.messageLabel).fill(`ajoute mon entretien Airbus jeudi 14 h\nE2E_COACH_TOOL=propose_interview:${JSON.stringify(args)}`);
    await conversation(page).getByRole("button", { name: fr.coachPanel.send, exact: true }).click();

    // One card, both changes listed: the Interview at its absolute date, and the Application moved to « Entretien ».
    const card = cardOf(page);
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText(texts.by);
    await expect(card.getByRole("link", { name: `${TITLE} · Airbus` })).toHaveAttribute("href", `/candidatures/${id}/entretiens`);
    const when = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", dateStyle: "full", timeStyle: "short" }).format(new Date(`${thursday}T12:00:00Z`)).replace(/\d\d:\d\d$/, "14:00");
    const changes = card.getByRole("listitem");
    await expect(changes).toHaveCount(2);
    await expect(changes.nth(0)).toContainText(when);
    await expect(changes.nth(1)).toContainText(`${fr.applicationStatuses.applied}`);
    await expect(changes.nth(1)).toContainText(`${fr.applicationStatuses.interview}`);
    await expect(card.getByRole("button")).toHaveText([texts.apply, texts.edit, texts.dismiss]);
    // Proposed, nothing written yet.
    expect(await interviewsOf(id)).toEqual([]);
    expect((await applicationRow(id)).status).toBe("applied");

    await card.getByRole("button", { name: texts.apply, exact: true }).click();
    await expect(card.getByRole("status")).toHaveText(new RegExp(`^${tr(texts.applied, { time: "\\d\\d:\\d\\d" })}$`));

    // In the week, on Thursday at 14:00; the Application at « Entretien », both keeping their Origin.
    await expect(thursdayInWeek.getByRole("listitem")).toContainText("14:00");
    await expect(thursdayInWeek.getByRole("listitem")).toContainText(TITLE);
    expect(await interviewsOf(id)).toMatchObject([{ origin: { origin: "coach_proposal" } }]);
    expect(await applicationRow(id)).toMatchObject({ status: "interview", status_origin: { origin: "coach_proposal" } });

    // « Annuler »: the state before, the week empty again.
    await card.getByRole("button", { name: texts.undo, exact: true }).click();
    await expect(card.getByRole("status")).toHaveText(new RegExp(`^${tr(texts.undone, { time: "\\d\\d:\\d\\d" })}$`));
    await expect(thursdayInWeek).toContainText(fr.agenda.nothing);
    expect(await interviewsOf(id)).toEqual([]);
    expect(await applicationRow(id)).toMatchObject({ status: "applied", status_origin: null });
  });
});
