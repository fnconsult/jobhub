import { spawnSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signInWithMagicLink } from "./support/candidate";
import { emailsIn, newAddress } from "./support/mailbox";
import { parisDay } from "./support/paris-days";
import { showSystemPrompt, systemPromptShown } from "./support/system-prompt";

// Issue #921 (Identité 2): only the Preferred Name goes to the AI, and the emails greet by it. Driven through the public
// entry points: the Coach's endpoint (POST /api/coach) and the Cover Letter's (POST /api/applications/:id/tailored-documents),
// the account's identity endpoint (PUT /api/account/identity), the Candidate's data export and the worker's reminder job.
// The AI is faked inside the server (support/fake-mistral.mjs), which prints the system prompt it was sent on request.
const origin = process.env.E2E_WEB_ORIGIN!;
const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const masterCv = {
  fullName: "Marie Dupont",
  headline: "Directrice financière",
  email: "marie.dupont@example.fr",
  phone: "",
  location: "Lyon",
  summary: "",
  experience: [{ title: "Directrice financière", employer: "Groupe Seb", location: "Lyon", period: "2005 – 2024", description: "Pilotage financier." }],
  education: [],
  skills: ["Consolidation", "IFRS", "SAP"],
  languages: [],
};

async function setIdentity(page: Page, identity: { givenName: string; familyName: string; preferredName: string | null }) {
  const saved = await page.request.put("/api/account/identity", { headers: { origin }, data: { ...identity, preferredName: identity.preferredName ?? "" } });
  expect(saved.ok(), await saved.text()).toBe(true);
}

async function createProfile(page: Page): Promise<string> {
  const created = await page.request.post("/api/profiles", { headers: { origin }, data: { masterCv, searchCriteria: { targetRole: "DAF", locations: ["Lyon"], contractTypes: ["cdi"] } } });
  expect(created.status(), await created.text()).toBe(201);
  return (await created.json()).id;
}

async function createApplication(page: Page, profileId: string, content: string): Promise<string> {
  const captured = await page.request.post("/api/job-offers", {
    headers: { origin },
    data: { source: { url: `https://www.apec.fr/offres/${unique()}` }, title: "Directeur administratif et financier (H/F)", content, employer: "Acme Industrie", location: "Lyon" },
  });
  expect(captured.status(), await captured.text()).toBe(200);
  const saved = await page.request.post("/api/applications", { headers: { origin }, data: { jobOfferId: (await captured.json()).id, profileId } });
  expect(saved.ok(), await saved.text()).toBe(true);
  return (await saved.json()).id;
}

/** What the AI Coach is told, and answers, to a message that gives the Candidate's name and email. */
async function askCoach(page: Page): Promise<{ system: string; reply: string }> {
  const show = showSystemPrompt();
  const response = await page.request.post("/api/coach", { headers: { origin }, data: { message: `Bonjour, je suis Marie Dupont (marie.dupont@example.fr). ${show}` } });
  expect(response.status(), await response.text()).toBe(200);
  return { system: await systemPromptShown(show), reply: (await response.json()).reply as string };
}

/** Everything the AI Message Log kept of the Candidate's calls (what each one was sent), from their data export. */
async function loggedCalls(page: Page): Promise<string> {
  const exported = await page.request.get("/api/account/export");
  expect(exported.ok(), await exported.text()).toBe(true);
  return JSON.stringify((await exported.json()).aiMessageLog);
}

test.describe("AI calls and Preferred Name", () => {
  test("with Preferred Name « Mimi » and first name « Marie », the AI Coach is told « Mimi » and never « Marie » nor « Dupont »", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("pn-coach"));
    await createProfile(page);
    await setIdentity(page, { givenName: "Marie", familyName: "Dupont", preferredName: "Mimi" });

    const { system } = await askCoach(page);

    expect(system).toContain("Mimi");
    expect(system).not.toMatch(/Marie|Dupont|marie\.dupont/i);
    // What the AI Message Log kept of the call, as it was sent (Mimi in, no first name, no last name, no email).
    const logged = await loggedCalls(page);
    expect(logged).toContain("Mimi");
    expect(logged).not.toMatch(/Marie|Dupont|marie\.dupont/i);
  });

  test("without a Preferred Name, the AI Coach is told no name was given, is not given the CV's first name, and its reply names no one", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("pn-none"));
    await createProfile(page);
    await setIdentity(page, { givenName: "Marie", familyName: "Dupont", preferredName: null });

    const { system, reply } = await askCoach(page);

    expect(system).toContain("Le candidat n'a pas donné le nom à employer. Ne l'appelle par aucun nom.");
    expect(system).not.toMatch(/Marie|Dupont/);
    expect(reply).not.toMatch(/Marie|Dupont|Mimi/);
  });

  test("a Cover Letter drafted with only the Preferred Name sent still names the Candidate by their first and last name", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("pn-letter"));
    const profileId = await createProfile(page);
    await setIdentity(page, { givenName: "Marie", familyName: "Dupont", preferredName: "Mimi" });
    const applicationId = await createApplication(page, profileId, "Acme Industrie recrute son DAF. Vous pilotez la clôture des comptes. E2E_SIGNED_LETTER");

    const drafted = await page.request.post(`/api/applications/${applicationId}/tailored-documents`, { headers: { origin }, data: { document: "cover_letter", language: "fr" } });
    expect(drafted.status(), await drafted.text()).toBe(200);

    const letter: string = (await drafted.json()).coverLetter.text;
    expect(letter).toContain("Directrice financière, Marie Dupont met quinze ans de consolidation à votre service.");
    expect(letter).not.toMatch(/\[NOM\]|Mimi/);
    // Kept on the Application as put back, and the call as logged held no first or last name.
    const stored = await (await page.request.get(`/api/applications/${applicationId}/tailored-documents`)).json();
    expect(stored.coverLetter.text).toBe(letter);
    expect(await loggedCalls(page)).not.toMatch(/Marie|Dupont|marie\.dupont/i);
  });
});

/** Runs the worker's reminder job once, its clock set to `at` (as in e2e/appointment-reminders.spec.ts). */
function sendRemindersIn(hours: number): string {
  const run = spawnSync(path.resolve("node_modules/.bin/tsx"), ["e2e/support/worker-job.ts", "appointment-reminders.send", String(hours)], {
    env: { ...process.env, DATABASE_URL: process.env.E2E_DATABASE_URL, APP_URL: origin, MAIL_TRANSPORT: "console", AI_FAKE: "" },
    encoding: "utf8",
  });
  expect(run.status, run.stderr).toBe(0);
  return run.stdout + run.stderr;
}

/** The instant of `time` ("18:05") French time on `day`, found without knowing the offset. */
function parisInstant(day: string, time: string): Date {
  const wanted = `${day}T${time}`;
  for (let guess = Date.parse(`${wanted}:00Z`) - 2 * 3_600_000; guess <= Date.parse(`${wanted}:00Z`); guess += 60_000) {
    const parts = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" }).format(guess).replace(" ", "T");
    if (parts === wanted) return new Date(guess);
  }
  throw new Error(`no such French time: ${wanted}`);
}

async function interviewTomorrow(page: Page) {
  const profileId = await createProfile(page);
  const applicationId = await createApplication(page, profileId, `Acme Industrie recrute son DAF (${unique()}).`);
  const status = await page.request.patch(`/api/applications/${applicationId}`, { headers: { origin }, data: { status: "interview" } });
  expect(status.ok(), await status.text()).toBe(true);
  const added = await page.request.post(`/api/applications/${applicationId}/interviews`, { headers: { origin }, data: { scheduledAt: `${parisDay(2)}T09:00`, place: "12 rue de la République, Lyon" } });
  expect(added.ok(), await added.text()).toBe(true);
}

test.describe("Emails and Preferred Name", () => {
  test("an Appointment Reminder greets « Bonjour Mimi, » by the Preferred Name, never by the first or last name", async ({ page }) => {
    const email = newAddress("pn-email-named");
    await signInWithMagicLink(page, email);
    await setIdentity(page, { givenName: "Marie", familyName: "Dupont", preferredName: "Mimi" });
    await interviewTomorrow(page);

    const sent = emailsIn(sendRemindersIn((parisInstant(parisDay(1), "18:00").getTime() - Date.now()) / 3_600_000), email);

    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toMatch(/^Bonjour Mimi,/m);
    expect(sent[0]!.text).not.toMatch(/Marie|Dupont/);
  });

  test("an Appointment Reminder greets « Bonjour, » with no name when there is no Preferred Name", async ({ page }) => {
    const email = newAddress("pn-email-unnamed");
    await signInWithMagicLink(page, email);
    await setIdentity(page, { givenName: "Marie", familyName: "Dupont", preferredName: null });
    await interviewTomorrow(page);

    const sent = emailsIn(sendRemindersIn((parisInstant(parisDay(1), "18:00").getTime() - Date.now()) / 3_600_000), email);

    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toMatch(/^Bonjour,$/m);
    expect(sent[0]!.text).not.toMatch(/Marie|Dupont|Mimi/);
  });
});
