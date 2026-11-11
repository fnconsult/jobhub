import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test as base, type Browser, type Page } from "@playwright/test";
import config from "../playwright.config";
import { Pool } from "pg";
import { approvedLegacyCoach, paidHistoricalSession } from "./support/legacy-coach";
import { startOwnServer, signInByEmail, type OwnServer } from "./support/own-server";
import { newAddress } from "./support/mailbox";
import { parisDay } from "./support/paris-days";
import { queuedPushEvents, registerDevice, sendPush, switchPush } from "./support/push";

// Issue #699: each event of the Jobbbox app's Push notifications (ADR-0076) is queued once for the right person, under
// its switch in Rappels. What was queued shows in the person's Data export (`pushNotifications.sent`: the event and
// when, never the text), whichever worker takes it; the text and the deep link of each event are what the worker hands
// the provider (e2e/support/push-send.ts). The Job Search's and the Job Digest's events are in job-search.spec.ts and
// job-digest.spec.ts, where their worker runs.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const space = fr.coachSpace;
const hc = fr.humanCoaches;
let origin = process.env.E2E_WEB_ORIGIN!;
let own: OwnServer;
const previousEnvironment = { origin: process.env.E2E_WEB_ORIGIN, database: process.env.E2E_DATABASE_URL };
const test = base.extend({ page: async ({ browser }, use) => {
  const context = await browser.newContext({ baseURL: origin });
  await use(await context.newPage());
  await context.close();
} });
test.beforeAll(async () => {
  const env = (config.webServer as { env: NodeJS.ProcessEnv }).env;
  own = await startOwnServer(699, "legacy_push_events", {
    ...env,
    NODE_OPTIONS: `${env.NODE_OPTIONS} --import=${path.resolve("e2e/support/fake-coach-contract.mjs")}`,
  });
  origin = own.origin;
  process.env.E2E_WEB_ORIGIN = origin;
  process.env.E2E_DATABASE_URL = own.databaseUrl;
});
test.afterAll(async () => {
  try { await own?.stop(); }
  finally {
    if (previousEnvironment.origin === undefined) delete process.env.E2E_WEB_ORIGIN;
    else process.env.E2E_WEB_ORIGIN = previousEnvironment.origin;
    if (previousEnvironment.database === undefined) delete process.env.E2E_DATABASE_URL;
    else process.env.E2E_DATABASE_URL = previousEnvironment.database;
  }
});
async function signInWithMagicLink(page: Page, email: string) {
  await signInByEmail(page, own, email);
  const database = new Pool({ connectionString: own.databaseUrl });
  try {
    const coach = (await database.query("SELECT id FROM human_coach WHERE email=$1 AND retired_at IS NULL", [email])).rows[0];
    if (coach) {
      const response = await page.request.post("/api/coach-space/contract", {
        headers: { origin }, data: { kind: "coach", id: coach.id, version: "2026-01-01", sha256: "e".repeat(64), accepted: true },
      });
      expect(response.status()).toBe(204);
    }
  } finally { await database.end(); }
}
const ADMINISTRATOR = "push-events-office@e2e.jobbbox.test";
const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const tr = (template: string, values: Record<string, string>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");

const masterCv = {
  fullName: "Marie Dupont",
  headline: "Directrice financière",
  email: "marie.dupont@example.fr",
  phone: "",
  location: "Lyon",
  summary: "",
  experience: [{ title: "Directrice financière", employer: "Groupe Seb", location: "Lyon", period: "2005 – 2024", description: "Pilotage financier." }],
  education: [],
  skills: ["Consolidation", "IFRS"],
  languages: [],
};

async function personPage(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext({ baseURL: origin, locale: "en-US" });
  const page = await context.newPage();
  await signInWithMagicLink(page, email);
  return page;
}

/** The Administrator adds a Human Coach; returns their name and id (from the retire form). */
async function addCoach(browser: Browser, email: string) {
  const admin = await personPage(browser, ADMINISTRATOR);
  const name = `Sophie Martin ${unique()}`;
  await admin.goto("/admin/coachs");
  await admin.getByLabel(fr.admin.humanCoaches.name).fill(name);
  await admin.getByLabel(fr.admin.humanCoaches.email).fill(email);
  await admin.getByLabel(fr.admin.humanCoaches.bookingUrl).fill(`https://cal.com/sophie-${unique()}/seance`);
  await admin.getByRole("button", { name: fr.admin.humanCoaches.add }).click();
  await expect(admin.getByRole("status")).toHaveText(tr(fr.admin.humanCoaches.added, { name }));
  const form = admin.locator("form").filter({ has: admin.getByRole("button", { name: tr(fr.admin.humanCoaches.retire, { name }) }) });
  const id = await form.locator('input[name="coachId"]').inputValue();
  await approvedLegacyCoach(id);
  await admin.context().close();
  return { name, id };
}

/** The Candidate on `page` pays a Coaching Session of the coach, Stripe's signed webhook delivered `deliveries` times; returns the session's id. */
async function paidSession(page: Page, coachId: string, deliveries = 1): Promise<string> {
  const historical = await paidHistoricalSession(page, coachId);
  for (let delivery = 1; delivery < deliveries; delivery++) {
    const response = await page.request.post("/api/billing/webhook", { data: historical.signed.payload, headers: { "stripe-signature": historical.signed.signature, "content-type": "application/json" } });
    expect(response.status()).toBe(200);
  }
  const sessions = (await (await page.request.get("/api/coaching")).json()).sessions;
  return sessions.find((session: {coach: {id: string}}) => session.coach.id === coachId).id;
}

/** A Profile and an Application with a Cover Letter drafted by the AI Coach, for the Candidate on `page`. */
async function applicationWithCoverLetter(page: Page): Promise<string> {
  const profile = await page.request.post("/api/profiles", { data: { masterCv, searchCriteria: { targetRole: "DAF", locations: ["Lyon"], contractTypes: ["cdi"] } }, headers: { origin } });
  expect(profile.status(), await profile.text()).toBe(201);
  const offer = await page.request.post("/api/job-offers", {
    data: { source: { url: `https://www.apec.fr/offres/${unique()}` }, title: "DAF (H/F)", content: "Acme Industrie recrute son DAF. Vous pilotez la clôture des comptes.", employer: "Acme Industrie" },
    headers: { origin },
  });
  expect(offer.status(), await offer.text()).toBe(200);
  const saved = await page.request.post("/api/applications", { data: { jobOfferId: (await offer.json()).id, profileId: (await profile.json()).id }, headers: { origin } });
  expect(saved.ok(), await saved.text()).toBe(true);
  const id = (await saved.json()).id as string;
  const drafted = await page.request.post(`/api/applications/${id}/tailored-documents`, { data: { document: "cover_letter" }, headers: { origin } });
  expect(drafted.ok(), await drafted.text()).toBe(true);
  return id;
}

/** The Human Coach leaves a Coach Review on the Candidate's Cover Letter, from the Coach space. */
async function leaveReview(coachPage: Page, candidateEmail: string) {
  const database = new Pool({ connectionString: own.databaseUrl });
  let subject: {candidateId: string; applicationId: string};
  try {
    subject = (await database.query('SELECT c.id AS "candidateId",a.id AS "applicationId" FROM candidate c JOIN application a ON a.candidate_id=c.id WHERE c.email=$1', [candidateEmail])).rows[0];
  } finally { await database.end(); }
  await coachPage.goto(`/espace-coach/${subject!.candidateId}/candidatures/${subject!.applicationId}`);
  await coachPage.getByLabel(space.reviewDocument).selectOption({ label: fr.coachReviews.documents.cover_letter });
  await coachPage.getByLabel(space.reviewText).fill("Ouvrez sur votre dernier poste de DAF.");
  await coachPage.getByRole("button", { name: space.reviewSubmit }).click();
  await expect(coachPage.getByRole("status")).toHaveText(space.reviewSaved);
}

const inDays = (days: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(Date.now() + days * 86_400_000));

/** The instant of `time` ("18:05") French time on `day`, found without knowing the offset. */
function parisInstant(day: string, time: string): Date {
  const wanted = `${day}T${time}`;
  for (let guess = Date.parse(`${wanted}:00Z`) - 2 * 3_600_000; guess <= Date.parse(`${wanted}:00Z`); guess += 60_000) {
    const parts = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" }).format(guess).replace(" ", "T");
    if (parts === wanted) return new Date(guess);
  }
  throw new Error(`no such French time: ${wanted}`);
}

/** Runs the worker's job once, its clock set to `at`. */
function runWorkerJob(job: string, at: Date) {
  const run = spawnSync(path.resolve("node_modules/.bin/tsx"), ["e2e/support/worker-job.ts", job, String((at.getTime() - Date.now()) / 3_600_000)], {
    env: { ...process.env, DATABASE_URL: process.env.E2E_DATABASE_URL, APP_URL: origin, MAIL_TRANSPORT: "console", AI_FAKE: "" },
    encoding: "utf8",
  });
  expect(run.status, run.stderr).toBe(0);
}

/** An Application with an Interview at `scheduledAt` (French time, "2026-10-30T09:00"), for the Candidate on `page`. */
async function interviewAt(page: Page, scheduledAt: string, profileId?: string): Promise<string> {
  if (!profileId) {
    const profile = await page.request.post("/api/profiles", { headers: { origin }, data: { masterCv, searchCriteria: { targetRole: "DAF", locations: ["Lyon"], contractTypes: ["cdi"] } } });
    expect(profile.status(), await profile.text()).toBe(201);
    profileId = (await profile.json()).id as string;
  }
  const offer = await page.request.post("/api/job-offers", {
    headers: { origin },
    data: { source: { url: `https://www.apec.fr/offres/push-${unique()}` }, title: `DAF H/F ${unique()}`, content: "Acme Industrie recrute son DAF.", employer: "Acme Industrie", location: "Lyon", contractType: "cdi" },
  });
  expect(offer.status(), await offer.text()).toBe(200);
  const saved = await page.request.post("/api/applications", { headers: { origin }, data: { jobOfferId: (await offer.json()).id, profileId } });
  expect(saved.ok(), await saved.text()).toBe(true);
  const applicationId = (await saved.json()).id as string;
  expect((await page.request.patch(`/api/applications/${applicationId}`, { headers: { origin }, data: { status: "interview" } })).ok()).toBe(true);
  const added = await page.request.post(`/api/applications/${applicationId}/interviews`, { headers: { origin }, data: { scheduledAt, place: "12 rue de la République, Lyon" } });
  expect(added.ok(), await added.text()).toBe(true);
  return profileId;
}

test.describe("Push notifications' events", () => {
  test.describe.configure({ timeout: 180_000 });

  test("a notification opens its object by the id it carries, and says nothing of it: each event's path and fixed text", async ({ page }) => {
    const email = newAddress("push-links");
    await signInWithMagicLink(page, email);
    expect((await registerDevice(page, { platform: "android", token: `tok-${unique()}`, language: "fr" })).status()).toBe(204);
    const opens: Record<string, string> = {
      job_search_results: "/recherches/js_1",
      job_digest: "/job-digests/jd_1",
      appointment_reminder: "/agenda?vue=liste",
      coach_review: "/candidatures/app_1",
      coaching_session_changed: "/agenda?vue=liste",
      follow_up_due: "/candidatures/app_1",
      coach_access_granted: "/espace-coach/candidates/cand_1",
      coaching_session_paid: "/espace-coach",
      coaching_session_changed_by_candidate: "/espace-coach",
    };
    for (const [event, opened] of Object.entries(opens)) {
      const [message] = sendPush(email, event).messages;
      expect(message, event).toMatchObject({ path: opened, title: fr.pushNotifications.messages[event].title, body: fr.pushNotifications.messages[event].body });
    }
  });

  test("a Coach Review left, and the date of a Coaching Session entered or cancelled by the coach, each tell the Candidate once", async ({ page, browser }) => {
    const coachEmail = newAddress("push-coach");
    const coach = await addCoach(browser, coachEmail);
    const email = newAddress("push-candidate");
    await signInWithMagicLink(page, email);
    const applicationId = await applicationWithCoverLetter(page);
    const sessionId = await paidSession(page, coach.id);
    const coachPage = await personPage(browser, coachEmail);
    expect(await queuedPushEvents(page)).toEqual([]);

    await page.goto("/coachs");
    await page.getByRole("button", { name: tr(hc.grant, { name: coach.name }) }).click();
    await expect(page.getByText(tr(hc.accessGranted, { name: coach.name }))).toBeVisible();
    await leaveReview(coachPage, email);
    expect(await queuedPushEvents(page)).toEqual(["coach_review"]);

    const date = (time: string) => ({ data: { scheduledAt: `${inDays(5)}T${time}` }, headers: { origin } });
    expect((await coachPage.request.patch(`/api/coach-space/sessions/${sessionId}`, date("10:00"))).status()).toBeLessThan(300);
    expect(await queuedPushEvents(page)).toEqual(["coach_review", "coaching_session_changed"]);
    // The same date sent again changes nothing: nothing more is queued.
    await coachPage.request.patch(`/api/coach-space/sessions/${sessionId}`, date("10:00"));
    expect(await queuedPushEvents(page)).toHaveLength(2);

    expect((await coachPage.request.post(`/api/coach-space/sessions/${sessionId}/cancel`, { headers: { origin } })).status()).toBe(200);
    expect(await queuedPushEvents(page)).toEqual(["coach_review", "coaching_session_changed", "coaching_session_changed"]);
    expect(applicationId).toBeTruthy();
    await coachPage.context().close();
  });

  test("Coach Access granted, a Coaching Session paid, its date entered and cancelled by the Candidate, each tell the Human Coach once", async ({ page, browser }) => {
    const coachEmail = newAddress("push-coach");
    const coach = await addCoach(browser, coachEmail);
    const coachPage = await personPage(browser, coachEmail);
    await signInWithMagicLink(page, newAddress("push-candidate"));

    // Granted: the coach hears of it.
    await page.goto("/coachs");
    await page.getByRole("button", { name: tr(hc.grant, { name: coach.name }) }).click();
    await expect(page.getByText(tr(hc.accessGranted, { name: coach.name }))).toBeVisible();
    expect(await queuedPushEvents(coachPage)).toEqual(["coach_access_granted"]);

    // Paid, Stripe's webhook delivered twice: once.
    const sessionId = await paidSession(page, coach.id, 2);
    expect(await queuedPushEvents(coachPage)).toEqual(["coach_access_granted", "coaching_session_paid"]);

    const entered = await page.request.patch(`/api/coaching/sessions/${sessionId}`, { data: { scheduledAt: `${inDays(6)}T10:00` }, headers: { origin } });
    expect(entered.ok(), await entered.text()).toBe(true);
    expect(await queuedPushEvents(coachPage)).toEqual(["coach_access_granted", "coaching_session_paid", "coaching_session_changed_by_candidate"]);
    const cancelled = await page.request.post(`/api/coaching/sessions/${sessionId}/cancel`, { headers: { origin } });
    expect(cancelled.ok(), await cancelled.text()).toBe(true);
    expect(await queuedPushEvents(coachPage)).toEqual(["coach_access_granted", "coaching_session_paid", "coaching_session_changed_by_candidate", "coaching_session_changed_by_candidate"]);
    // The Candidate has none of the coach's events.
    expect(await queuedPushEvents(page)).toEqual([]);
    await coachPage.context().close();
  });

  test("an event switched off in Rappels queues nothing, and queues again once switched back on", async ({ page, browser }) => {
    const coachEmail = newAddress("push-coach-off");
    const coach = await addCoach(browser, coachEmail);
    const coachPage = await personPage(browser, coachEmail);
    await signInWithMagicLink(page, newAddress("push-candidate-off"));
    for (const event of ["coach_access_granted", "coaching_session_paid", "coaching_session_changed_by_candidate"]) await switchPush(coachPage, event, false);

    await page.goto("/coachs");
    await page.getByRole("button", { name: tr(hc.grant, { name: coach.name }) }).click();
    await expect(page.getByText(tr(hc.accessGranted, { name: coach.name }))).toBeVisible();
    const sessionId = await paidSession(page, coach.id);
    expect((await page.request.patch(`/api/coaching/sessions/${sessionId}`, { data: { scheduledAt: `${inDays(6)}T10:00` }, headers: { origin } })).ok()).toBe(true);
    expect(await queuedPushEvents(coachPage)).toEqual([]);

    await switchPush(coachPage, "coaching_session_changed_by_candidate", true);
    expect((await page.request.post(`/api/coaching/sessions/${sessionId}/cancel`, { headers: { origin } })).ok()).toBe(true);
    expect(await queuedPushEvents(coachPage)).toEqual(["coaching_session_changed_by_candidate"]);
    await coachPage.context().close();
  });

  test("the Appointment Reminder's Push notification goes the evening before at 18:00 French time, once, under its own switch beside the email's", async ({ page }) => {
    const email = newAddress("push-reminder");
    await signInWithMagicLink(page, email);
    const profileId = await interviewAt(page, `${parisDay(2)}T09:00`);

    runWorkerJob("appointment-reminders.send", parisInstant(parisDay(1), "17:55"));
    expect(await queuedPushEvents(page)).toEqual([]);

    runWorkerJob("appointment-reminders.send", parisInstant(parisDay(1), "18:00"));
    runWorkerJob("appointment-reminders.send", parisInstant(parisDay(1), "18:30"));
    expect(await queuedPushEvents(page)).toEqual(["appointment_reminder"]);

    // The email's switch off does not stop the push, nor the push's the email: two Interviews, two evenings.
    await page.request.put("/api/account/appointment-reminders", { headers: { origin }, data: { enabled: false } });
    await interviewAt(page, `${parisDay(4)}T09:00`, profileId);
    runWorkerJob("appointment-reminders.send", parisInstant(parisDay(3), "18:00"));
    expect(await queuedPushEvents(page)).toEqual(["appointment_reminder", "appointment_reminder"]);
  });

  test("the Appointment Reminder's Push notification is not queued once its switch is off, nor for an Interview entered after 18:00 for tomorrow", async ({ page }) => {
    const email = newAddress("push-reminder-off");
    await signInWithMagicLink(page, email);
    await interviewAt(page, `${parisDay(2)}T09:00`);
    await switchPush(page, "appointment_reminder", false);
    runWorkerJob("appointment-reminders.send", parisInstant(parisDay(1), "18:00"));
    expect(await queuedPushEvents(page)).toEqual([]);

    const late = newAddress("push-reminder-late");
    const other = page.context();
    await other.clearCookies();
    await signInWithMagicLink(page, late);
    await interviewAt(page, `${parisDay(0)}T23:30`);
    runWorkerJob("appointment-reminders.send", parisInstant(parisDay(-1), "19:00"));
    expect(await queuedPushEvents(page)).toEqual([]);
  });

  test("a Follow-up due is queued once per wait, and not once its switch is off", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("push-follow-up"));
    const applicationId = await interviewApplication(page);
    const due = new Date(Date.now() + 14 * 86_400_000);
    runWorkerJob("follow-ups.propose", due);
    runWorkerJob("follow-ups.propose", new Date(due.getTime() + 86_400_000));
    expect(await queuedPushEvents(page)).toEqual(["follow_up_due"]);
    expect(applicationId).toBeTruthy();

    await switchPush(page, "follow_up_due", false);
    await page.context().clearCookies();
    await signInWithMagicLink(page, newAddress("push-follow-up-off"));
    await switchPush(page, "follow_up_due", false);
    await interviewApplication(page);
    runWorkerJob("follow-ups.propose", due);
    expect(await queuedPushEvents(page)).toEqual([]);
  });
});

/** An Application the Candidate on `page` applied to ("Postulée"): its Follow-up is due after a wait. */
async function interviewApplication(page: Page): Promise<string> {
  const profile = await page.request.post("/api/profiles", { headers: { origin }, data: { masterCv, searchCriteria: { targetRole: "DAF", locations: ["Lyon"], contractTypes: ["cdi"] } } });
  expect(profile.status(), await profile.text()).toBe(201);
  const tag = unique();
  const offer = await page.request.post("/api/job-offers", {
    headers: { origin },
    data: { source: { url: `https://www.apec.fr/offres/relance-${tag}` }, title: `DAF (H/F) – réf. ${tag}`, content: `Acme Industrie recrute son DAF (réf. ${tag}).\n\nCandidatures à recrutement@acme-industrie.fr.`, employer: "Acme Industrie", location: "Lyon", contractType: "cdi" },
  });
  expect(offer.status(), await offer.text()).toBe(200);
  const saved = await page.request.post("/api/applications", { headers: { origin }, data: { jobOfferId: (await offer.json()).id, profileId: (await profile.json()).id } });
  expect(saved.ok(), await saved.text()).toBe(true);
  const id = (await saved.json()).id as string;
  const status = await page.request.patch(`/api/applications/${id}`, { headers: { origin }, data: { status: "applied" } });
  expect(status.ok(), await status.text()).toBe(true);
  return id;
}
