import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signInWithMagicLink } from "./support/candidate";
import { emailsIn, newAddress } from "./support/mailbox";

// Issue #253: the Appointment Reminder, emailed the day before each Agenda Item, is on by
// default; the Candidate switches it off (and on again) in Mon compte's Rappels Section.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const en = JSON.parse(readFileSync("packages/shared/src/i18n/locales/en.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;

const masterCv = { fullName: "Marie Dupont", headline: "Directrice financière", email: "marie.dupont@example.fr", phone: "", location: "Lyon", summary: "", experience: [], education: [], skills: ["IFRS"], languages: [] };

/** The day `offset` days from now, in French time ("2026-10-30"). */
const parisDay = (offset: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(Date.now() + offset * 86_400_000));

/** The instant of `time` ("18:05") French time on `day` ("2026-10-30"), found without knowing the offset. */
function parisInstant(day: string, time: string): Date {
  const wanted = `${day}T${time}`;
  for (let guess = Date.parse(`${wanted}:00Z`) - 2 * 3_600_000; guess <= Date.parse(`${wanted}:00Z`); guess += 60_000) {
    const parts = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" }).format(guess).replace(" ", "T");
    if (parts === wanted) return new Date(guess);
  }
  throw new Error(`no such French time: ${wanted}`);
}

/** Runs the worker's "appointment-reminders.send" job once, its clock set to `at`. Returns its output (with the emails it printed). */
function sendRemindersAt(at: Date): string {
  const run = spawnSync(path.resolve("node_modules/.bin/tsx"), ["e2e/support/worker-job.ts", "appointment-reminders.send", String((at.getTime() - Date.now()) / 3_600_000)], {
    env: { ...process.env, DATABASE_URL: process.env.E2E_DATABASE_URL, APP_URL: origin, MAIL_TRANSPORT: "console", AI_FAKE: "" },
    encoding: "utf8",
  });
  expect(run.status, run.stderr).toBe(0);
  return run.stdout + run.stderr;
}

/** An Application at "Entretien" for the signed-in Candidate, with an Interview at `scheduledAt` (French time, "2026-10-30T09:00"). Returns their ids. */
async function interviewAt(page: Page, scheduledAt: string, place = "12 rue de la République, Lyon") {
  const profile = await page.request.post("/api/profiles", { headers: { origin }, data: { masterCv, searchCriteria: { targetRole: "DAF", locations: ["Lyon"], contractTypes: ["cdi"] } } });
  expect(profile.status(), await profile.text()).toBe(201);
  const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const offer = await page.request.post("/api/job-offers", {
    headers: { origin },
    data: { source: { url: `https://www.apec.fr/offres/rappel-${tag}` }, title: `DAF H/F ${tag}`, content: `Acme Industrie recrute son DAF (${tag}).`, employer: "Acme Industrie", location: "Lyon", contractType: "cdi" },
  });
  expect(offer.status(), await offer.text()).toBe(200);
  const saved = await page.request.post("/api/applications", { headers: { origin }, data: { jobOfferId: (await offer.json()).id, profileId: (await profile.json()).id } });
  expect(saved.ok(), await saved.text()).toBe(true);
  const applicationId = (await saved.json()).id as string;
  const status = await page.request.patch(`/api/applications/${applicationId}`, { headers: { origin }, data: { status: "interview" } });
  expect(status.ok(), await status.text()).toBe(true);
  const added = await page.request.post(`/api/applications/${applicationId}/interviews`, { headers: { origin }, data: { scheduledAt, place } });
  expect(added.ok(), await added.text()).toBe(true);
  return { applicationId, title: `DAF H/F ${tag}`, place };
}

test.describe("Appointment Reminders", () => {
  test("the Candidate finds Appointment Reminders on in Mon compte's Rappels Section, and switches them off and on again", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("appointment-reminders"));
    await page.goto("/compte");
    await page.getByRole("link", { name: fr.account.sections.reminders }).click();
    await expect(page).toHaveURL(/\/compte\/rappels$/);

    const reminders = page.getByRole("region", { name: fr.appointmentReminder.settings.title });
    const checkbox = reminders.getByRole("checkbox", { name: fr.appointmentReminder.settings.label });
    await expect(checkbox).toBeChecked();

    await checkbox.uncheck();
    await expect(reminders.getByRole("status")).toHaveText(fr.appointmentReminder.settings.off);
    await page.reload();
    await expect(checkbox).not.toBeChecked();

    await checkbox.check();
    await expect(reminders.getByRole("status")).toHaveText(fr.appointmentReminder.settings.on);
    await page.reload();
    await expect(checkbox).toBeChecked();
  });

  test("emails an Interview tomorrow at 09:00 once at 18:00 the day before, in French, and nothing again when the job runs again", async ({ page }) => {
    const email = newAddress("reminder-sent");
    await signInWithMagicLink(page, email);
    const { title, place } = await interviewAt(page, `${parisDay(2)}T09:00`);

    // Before 18:00 the day before: nothing yet.
    expect(emailsIn(sendRemindersAt(parisInstant(parisDay(1), "17:55")), email)).toHaveLength(0);

    // At 18:00 the day before, and on a rerun a few minutes later: one email.
    let output = sendRemindersAt(parisInstant(parisDay(1), "18:00"));
    output += sendRemindersAt(parisInstant(parisDay(1), "18:30"));
    const sent = emailsIn(output, email);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toMatch(/^Rappel : votre rendez-vous de demain, /);
    expect(sent[0]!.text).toContain("09:00");
    expect(sent[0]!.text).toContain(title);
    expect(sent[0]!.text).toContain(place);
    expect(sent[0]!.text).toContain(`${origin}/agenda`);
  });

  test("sends nothing for a Cancelled Interview", async ({ page }) => {
    const email = newAddress("reminder-cancelled");
    await signInWithMagicLink(page, email);
    const { applicationId } = await interviewAt(page, `${parisDay(2)}T09:00`);
    const application = await (await page.request.get(`/api/applications/${applicationId}`)).json();
    const interviewId = (application.interviews as { id: string }[]).at(-1)!.id;
    const cancelled = await page.request.post(`/api/applications/${applicationId}/interviews/${interviewId}/cancel`, { headers: { origin } });
    expect(cancelled.ok(), await cancelled.text()).toBe(true);

    expect(emailsIn(sendRemindersAt(parisInstant(parisDay(1), "18:00")), email)).toHaveLength(0);
  });

  test("sends nothing for an Interview entered after 18:00 for tomorrow, even when the job runs later that evening", async ({ page }) => {
    const email = newAddress("reminder-late");
    await signInWithMagicLink(page, email);
    // Entered now, which is after yesterday's 18:00 reminder, for today (tomorrow, as of that reminder).
    await interviewAt(page, `${parisDay(0)}T23:30`);

    expect(emailsIn(sendRemindersAt(parisInstant(parisDay(-1), "19:00")), email)).toHaveLength(0);
  });

  test("sends nothing once the Candidate switched Appointment Reminders off, and sends again when they switch them back on", async ({ page }) => {
    const email = newAddress("reminder-off");
    await signInWithMagicLink(page, email);
    await interviewAt(page, `${parisDay(2)}T09:00`);
    await page.goto("/compte/rappels");
    const reminders = page.getByRole("region", { name: fr.appointmentReminder.settings.title });
    await reminders.getByRole("checkbox", { name: fr.appointmentReminder.settings.label }).uncheck();
    await expect(reminders.getByRole("status")).toHaveText(fr.appointmentReminder.settings.off);

    expect(emailsIn(sendRemindersAt(parisInstant(parisDay(1), "18:00")), email)).toHaveLength(0);

    await reminders.getByRole("checkbox", { name: fr.appointmentReminder.settings.label }).check();
    await expect(reminders.getByRole("status")).toHaveText(fr.appointmentReminder.settings.on);
    expect(emailsIn(sendRemindersAt(parisInstant(parisDay(1), "18:30")), email)).toHaveLength(1);
  });

  test("writes the email in English when the Interface Language is English", async ({ page }) => {
    const email = newAddress("reminder-en");
    await signInWithMagicLink(page, email);
    const switched = await page.request.post("/api/auth/update-user", { data: { interfaceLanguage: "en" }, headers: { origin } });
    expect(switched.ok(), await switched.text()).toBe(true);
    await interviewAt(page, `${parisDay(2)}T09:00`);

    const sent = emailsIn(sendRemindersAt(parisInstant(parisDay(1), "18:00")), email);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toMatch(/^Reminder: your appointment tomorrow, /);
    expect(sent[0]!.subject).toBe(en.appointmentReminder.email.subject_one.replace("{{date}}", sent[0]!.subject.split("tomorrow, ")[1]!));
    expect(sent[0]!.text).not.toContain("Bonjour");
  });

  test("only a signed-in Candidate can switch Appointment Reminders, with a yes or no", async ({ request }) => {
    expect((await request.put("/api/account/appointment-reminders", { headers: { origin }, data: { enabled: false } })).status()).toBe(401);
  });
});
