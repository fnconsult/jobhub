import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signInWithMagicLink } from "./support/candidate";
import { emailsIn, linkIn, newAddress } from "./support/mailbox";

// Issue #21: when an Application stays "Postulée" unanswered, the AI Coach
// proposes a Follow-up email draft on it (7 working days after "Postulée", then
// 10 more after each Follow-up sent; after two, it suggests "Abandonnée"), and
// tells the Candidate by email and with a notice on their Applications. Drafts
// only (ADR-0005): nothing is ever sent to the employer; the Candidate sends the
// draft themselves and marks it as sent, which moves the Application to
// "Relancée". The Candidate adjusts the delays on their account page.
//
// Driven through the built web app in a browser, with the worker's scheduled
// job "follow-ups.propose" run as its schedule would (e2e/support/worker-job.ts),
// its clock set to a later French working day. Its emails (MAIL_TRANSPORT=console)
// are read from its output.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;
const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const employerContact = "recrutement@acme-relances.example";

test.use({ baseURL: origin });

// French public holidays (metropolitan France), written out from the official calendar.
const holidays = new Set([
  "2026-01-01", "2026-04-06", "2026-05-01", "2026-05-08", "2026-05-14", "2026-05-25", "2026-07-14", "2026-08-15", "2026-11-01", "2026-11-11", "2026-12-25",
  "2027-01-01", "2027-03-29", "2027-05-01", "2027-05-06", "2027-05-08", "2027-05-17", "2027-07-14", "2027-08-15", "2027-11-01", "2027-11-11", "2027-12-25",
  "2028-01-01", "2028-04-17", "2028-05-01", "2028-05-08", "2028-05-25", "2028-06-05", "2028-07-14", "2028-08-15", "2028-11-01", "2028-11-11", "2028-12-25",
]);

const parisDate = (instant: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);

/** Late morning, French time, `count` working days after the French-time day of `from`. */
function workingDaysAfter(from: Date, count: number): Date {
  const day = new Date(`${parisDate(from)}T10:00:00Z`);
  for (let added = 0; added < count; ) {
    day.setUTCDate(day.getUTCDate() + 1);
    const weekday = day.getUTCDay();
    if (weekday !== 0 && weekday !== 6 && !holidays.has(day.toISOString().slice(0, 10))) added++;
  }
  return day;
}

/** Runs the worker's "follow-ups.propose" job once, as its schedule would at `at`. Returns its output. */
function proposeFollowUpsAt(at: Date): string {
  const run = spawnSync(path.resolve("node_modules/.bin/tsx"), ["e2e/support/worker-job.ts", "follow-ups.propose", String((at.getTime() - Date.now()) / 3_600_000)], {
    env: { ...process.env, DATABASE_URL: process.env.E2E_DATABASE_URL, APP_URL: origin, MAIL_TRANSPORT: "console", AI_FAKE: "" },
    encoding: "utf8",
  });
  expect(run.status, run.stderr).toBe(0);
  return run.stdout + run.stderr;
}

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

/** Signs a new Candidate in with one Application ("À postuler") to a French Job Offer. Returns its id, title and the Candidate's email. */
async function candidateWithApplication(page: Page, label: string) {
  const email = newAddress(label);
  await signInWithMagicLink(page, email);
  const profile = await page.request.post("/api/profiles", {
    data: { masterCv, searchCriteria: { targetRole: "DAF", location: "Lyon", contractType: "cdi" } },
    headers: { origin },
  });
  expect(profile.status(), await profile.text()).toBe(201);
  const tag = unique();
  const title = `Directeur administratif et financier (H/F) – réf. ${tag}`;
  const offer = await page.request.post("/api/job-offers", {
    data: {
      source: { url: `https://www.apec.fr/offres/relance-${tag}` },
      title,
      content: `Acme Industrie recrute son DAF (réf. ${tag}).\n\nVos missions :\n- Piloter la clôture des comptes\n- Encadrer une équipe de 12 personnes\n\nCandidatures à ${employerContact}.`,
      employer: "Acme Industrie",
      location: "Lyon",
      contractType: "cdi",
    },
    headers: { origin },
  });
  expect(offer.status(), await offer.text()).toBe(200);
  const saved = await page.request.post("/api/applications", { data: { jobOfferId: (await offer.json()).id, profileId: (await profile.json()).id }, headers: { origin } });
  expect(saved.ok(), await saved.text()).toBe(true);
  return { email, title, id: (await saved.json()).id as string };
}

/** Sets the Application's status by hand on its page. */
async function setStatus(page: Page, applicationId: string, status: string) {
  await page.goto(`/candidatures/${applicationId}`);
  await page.getByLabel(fr.application.statusLabel).selectOption({ label: fr.applicationStatuses[status] });
  await expect(page.getByRole("status")).toHaveText(fr.application.statusSaved);
}

const followUpCard = (page: Page, title: string) =>
  page.getByRole("article").filter({ has: page.getByRole("heading", { name: `Relancer l'employeur pour « ${title} »` }) });
const abandonCard = (page: Page, title: string) =>
  page.getByRole("article").filter({ has: page.getByRole("heading", { name: `Classer « ${title} » comme abandonnée ?` }) });
const notices = (page: Page) => page.getByRole("region", { name: fr.followUps.noticesTitle });

test.describe("Follow-ups", () => {
  test.describe.configure({ timeout: 180_000 });

  test("by default, proposes a Follow-up draft 7 working days after Postulée, then 10 after each one sent, then suggests Abandonnée — by email and in the app, drafts only", async ({ page }) => {
    const { email, title, id } = await candidateWithApplication(page, "follow-up-defaults");
    await setStatus(page, id, "applied");
    const appliedAt = new Date();

    // 6 working days on, nothing yet.
    let output = proposeFollowUpsAt(workingDaysAfter(appliedAt, 6));
    expect(emailsIn(output, email)).toHaveLength(0);
    await page.goto(`/candidatures/${id}`);
    await expect(followUpCard(page, title)).toHaveCount(0);

    // 7 working days on: a Follow-up draft on the Application, and an email to the Candidate. Proposed once.
    output = proposeFollowUpsAt(workingDaysAfter(appliedAt, 7));
    output += proposeFollowUpsAt(workingDaysAfter(appliedAt, 8));
    const notified = emailsIn(output, email);
    expect(notified).toHaveLength(1);
    expect(notified[0]!.subject).toBe(`Une relance vous attend : ${title}`);
    expect(linkIn(notified[0]!)).toBe(`${origin}/candidatures/${id}`);
    // Drafts only (ADR-0005): nothing goes to the employer.
    expect(emailsIn(output, employerContact)).toHaveLength(0);

    // The in-app notice on the Candidate's Applications leads to it.
    await page.goto("/candidatures");
    await notices(page).getByRole("link", { name: `Relance prête : ${title}` }).click();
    await expect(page).toHaveURL(`${origin}/candidatures/${id}`);
    const card = followUpCard(page, title);
    await expect(card).toHaveCount(1);
    await expect(card).toContainText(fr.followUps.cardLabel);
    await expect(card).toContainText(`Objet : Relance de ma candidature : ${title}`);
    await expect(card).toContainText("Je me permets de revenir vers vous au sujet de ma candidature");
    await expect(card).toContainText(fr.followUps.sentHint);
    await expect(page.getByLabel(fr.application.statusLabel)).toHaveValue("applied");

    // The Candidate sent it themselves, and marks it as sent: the Application is "Relancée".
    await card.getByRole("button", { name: fr.followUps.markSent }).click();
    await expect(page.getByText(fr.actionCards.accepted)).toBeVisible();
    await expect(page.getByLabel(fr.application.statusLabel)).toHaveValue("followed_up");
    await page.reload();
    await expect(page.getByLabel(fr.application.statusLabel)).toHaveValue("followed_up");
    await expect(followUpCard(page, title)).toHaveCount(0);
    await page.goto("/candidatures");
    await expect(notices(page)).toHaveCount(0);
    const firstSentAt = new Date();

    // 10 more working days for the second Follow-up.
    output = proposeFollowUpsAt(workingDaysAfter(firstSentAt, 9));
    expect(emailsIn(output, email)).toHaveLength(0);
    output = proposeFollowUpsAt(workingDaysAfter(firstSentAt, 10));
    expect(emailsIn(output, email).map((sent) => sent.subject)).toEqual([`Une relance vous attend : ${title}`]);
    await page.goto(`/candidatures/${id}`);
    await expect(followUpCard(page, title)).toContainText("Je me permets de revenir de nouveau vers vous");
    await followUpCard(page, title).getByRole("button", { name: fr.followUps.markSent }).click();
    await expect(page.getByText(fr.actionCards.accepted)).toBeVisible();
    await expect(page.getByLabel(fr.application.statusLabel)).toHaveValue("followed_up");
    const secondSentAt = new Date();

    // After two Follow-ups unanswered as long, the AI Coach suggests "Abandonnée" instead of a third.
    output = proposeFollowUpsAt(workingDaysAfter(secondSentAt, 10));
    const suggested = emailsIn(output, email);
    expect(suggested.map((sent) => sent.subject)).toEqual([`Toujours sans réponse : ${title}`]);
    expect(linkIn(suggested[0]!)).toBe(`${origin}/candidatures/${id}`);
    expect(emailsIn(output, employerContact)).toHaveLength(0);

    await page.goto("/candidatures");
    await notices(page).getByRole("link", { name: `Toujours sans réponse : ${title}` }).click();
    await expect(page).toHaveURL(`${origin}/candidatures/${id}`);
    await expect(followUpCard(page, title)).toHaveCount(0);
    const suggestion = abandonCard(page, title);
    await expect(suggestion).toContainText("Vos 2 relances sont restées sans réponse.");
    // The status only changes when the Candidate accepts.
    await expect(page.getByLabel(fr.application.statusLabel)).toHaveValue("followed_up");
    await suggestion.getByRole("button", { name: fr.followUps.abandonAccept }).click();
    await expect(page.getByLabel(fr.application.statusLabel)).toHaveValue("abandoned");
    await page.reload();
    await expect(page.getByLabel(fr.application.statusLabel)).toHaveValue("abandoned");
  });

  test("the Candidate adjusts their Follow-up Delays on their account page, and the AI Coach keeps to them", async ({ page }) => {
    const { email, title, id } = await candidateWithApplication(page, "follow-up-delays");

    await page.goto("/compte");
    const delays = page.getByRole("region", { name: fr.followUps.delaysTitle });
    await expect(delays.getByLabel(fr.followUps.afterApplied)).toHaveValue("7");
    await expect(delays.getByLabel(fr.followUps.afterFollowUp)).toHaveValue("10");

    // Out of range: refused, with the reason.
    await delays.getByLabel(fr.followUps.afterApplied).fill("0");
    await delays.getByRole("button", { name: fr.followUps.saveDelays }).click();
    await expect(delays.getByRole("alert")).toHaveText("Indiquez un nombre entier de jours ouvrés, de 1 à 60.");

    await delays.getByLabel(fr.followUps.afterApplied).fill("2");
    await delays.getByLabel(fr.followUps.afterFollowUp).fill("3");
    await delays.getByRole("button", { name: fr.followUps.saveDelays }).click();
    await expect(delays.getByRole("status")).toHaveText(fr.followUps.delaysSaved);
    await page.reload();
    await expect(delays.getByLabel(fr.followUps.afterApplied)).toHaveValue("2");
    await expect(delays.getByLabel(fr.followUps.afterFollowUp)).toHaveValue("3");

    await setStatus(page, id, "applied");
    const appliedAt = new Date();
    expect(emailsIn(proposeFollowUpsAt(workingDaysAfter(appliedAt, 1)), email)).toHaveLength(0);
    expect(emailsIn(proposeFollowUpsAt(workingDaysAfter(appliedAt, 2)), email)).toHaveLength(1);
    await page.goto(`/candidatures/${id}`);
    await followUpCard(page, title).getByRole("button", { name: fr.followUps.markSent }).click();
    await expect(page.getByLabel(fr.application.statusLabel)).toHaveValue("followed_up");
    const sentAt = new Date();

    expect(emailsIn(proposeFollowUpsAt(workingDaysAfter(sentAt, 2)), email)).toHaveLength(0);
    expect(emailsIn(proposeFollowUpsAt(workingDaysAfter(sentAt, 3)), email).map((sent) => sent.subject)).toEqual([`Une relance vous attend : ${title}`]);
    await page.reload();
    await expect(followUpCard(page, title)).toHaveCount(1);
  });
});
