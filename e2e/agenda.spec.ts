import { mkdirSync, readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";
import { parisDay } from "./support/paris-days";

// Issue #246: the Agenda (« Entretiens et rendez-vous »), from the Sidebar right
// after Mes candidatures, lists the Candidate's Interviews: upcoming ones by day in
// French time, past ones on request, newest first and dimmed. Each leads to its
// Application's Interviews Section, which links back to the Agenda.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;

const masterCv = {
  fullName: "Marie Dupont",
  headline: "Directrice financière",
  email: "",
  phone: "",
  location: "Lyon",
  summary: "",
  experience: [],
  education: [],
  skills: ["IFRS"],
  languages: [],
};

/** The Monday on or before `day` ("2026-10-30"). */
const mondayOf = (day: string) => {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
};
/** `day` plus `count` days. */
const plusDays = (day: string, count: number) => new Date(Date.parse(`${day}T00:00:00Z`) + count * 86_400_000).toISOString().slice(0, 10);

/** An Application at "Entretien" on a Job Offer `title` at Acme Industrie, with Interviews at `times` (French time, "2026-10-30T23:30"). */
async function applicationWithInterviews(page: Page, title: string, times: string[]): Promise<string> {
  const applicationId = await applicationAt(page, await createProfile(page), title, "interview");
  for (const scheduledAt of times) {
    const added = await page.request.post(`/api/applications/${applicationId}/interviews`, { headers: { origin }, data: { scheduledAt } });
    expect(added.ok(), await added.text()).toBe(true);
  }
  return applicationId;
}

/** The Candidate's Profile (the Free Plan holds one), for their Applications. */
async function createProfile(page: Page): Promise<string> {
  const profile = await page.request.post("/api/profiles", {
    headers: { origin },
    data: { masterCv, searchCriteria: { targetRole: "DAF", locations: ["Lyon"], contractTypes: ["cdi"] } },
  });
  expect(profile.status(), await profile.text()).toBe(201);
  return (await profile.json()).id;
}

/** An Application with Profile `profileId` at `status` on a Job Offer `title` at Acme Industrie. */
async function applicationAt(page: Page, profileId: string, title: string, status: string): Promise<string> {
  const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const offer = await page.request.post("/api/job-offers", {
    headers: { origin },
    data: { source: { url: `https://www.apec.fr/offres/agenda-${tag}` }, title, content: `Acme Industrie recrute (réf. ${tag}).`, employer: "Acme Industrie", location: "Lyon" },
  });
  expect(offer.status(), await offer.text()).toBe(200);
  const saved = await page.request.post("/api/applications", { headers: { origin }, data: { jobOfferId: (await offer.json()).id, profileId } });
  expect(saved.ok(), await saved.text()).toBe(true);
  const applicationId: string = (await saved.json()).id;
  if (status !== "to_apply") {
    const changed = await page.request.patch(`/api/applications/${applicationId}`, { headers: { origin }, data: { status } });
    expect(changed.ok(), await changed.text()).toBe(true);
  }
  return applicationId;
}

const viewSwitch = (page: Page) => page.getByRole("navigation", { name: fr.agenda.viewsLabel });
const weekNav = (page: Page) => page.getByRole("navigation", { name: fr.agenda.weekNavLabel });
const monthNav = (page: Page) => page.getByRole("navigation", { name: fr.agenda.monthNavLabel });
/** The month grid's day buttons. */
const dayButtons = (page: Page) => page.getByRole("table").getByRole("button");
/** The day chosen in the month grid, its items listed below it. */
const chosenDay = (page: Page) => page.locator("section.agenda-day");
const sidebarNav = (page: Page) => page.getByRole("navigation", { name: fr.sidebar.label });
const agendaLink = (page: Page) => sidebarNav(page).getByRole("link", { name: fr.sidebar.agenda, exact: true });

test.describe("the Agenda", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("is in the Sidebar after Mes candidatures, and says when there is nothing", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("agenda-empty"));
    const links = sidebarNav(page).getByRole("link");
    await expect(links.nth(0)).toHaveText(fr.nav.applications);
    await expect(links.nth(1)).toHaveText(fr.sidebar.agenda);

    await agendaLink(page).click();
    await expect(page).toHaveURL(/\/agenda$/);
    await expect(page.getByRole("heading", { level: 1, name: fr.agenda.title })).toBeVisible();
    await expect(agendaLink(page)).toHaveAttribute("aria-current", "page");
    await expect(page.getByText(fr.agenda.none)).toBeVisible();
  });

  test("lists upcoming Interviews by day in French time, past ones on request, and links both ways with the Interviews Section", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("agenda-interviews"));
    const lateDay = parisDay(10);
    const pastDay = parisDay(-10);
    const applicationId = await applicationWithInterviews(page, "DAF H/F", [`${lateDay}T23:30`, `${pastDay}T10:00`]);
    // An Archived Application keeps its Interviews on the Agenda.
    await page.request.patch(`/api/applications/${applicationId}`, { headers: { origin }, data: { status: "rejected" } });

    await page.goto("/agenda");
    const days = page.getByRole("region", { name: fr.agenda.upcomingTitle }).getByRole("region");
    await expect(days).toHaveCount(1);
    // 23:30 in Paris is the next day in UTC: it stays on its own day.
    await expect(days.first().getByRole("heading").locator("time")).toHaveAttribute("datetime", lateDay);
    const item = days.first().getByRole("listitem");
    await expect(item).toContainText("23:30");
    await expect(item).toContainText("DAF H/F");
    await expect(item).toContainText("Acme Industrie");

    // Its first link leads to the Interviews Section; the other is its Calendar file (#252).
    await item.getByRole("link").first().click();
    await expect(page).toHaveURL(new RegExp(`/candidatures/${applicationId}/entretiens$`));
    await page.getByRole("region", { name: fr.application.interviewsTitle }).getByRole("link", { name: fr.application.seeInAgenda }).click();
    await expect(page).toHaveURL(/\/agenda$/);

    await page.getByRole("link", { name: fr.agenda.showPast }).click();
    await expect(page).toHaveURL(/\/agenda\?vue=liste&periode=passes$/);
    const past = page.getByRole("region", { name: fr.agenda.pastTitle }).getByRole("region");
    await expect(past).toHaveCount(1);
    await expect(past.first().getByRole("heading").locator("time")).toHaveAttribute("datetime", pastDay);
    await expect(past.first().getByRole("listitem")).toContainText("10:00");
    await expect(agendaLink(page)).toHaveAttribute("aria-current", "page");
  });

  test("is what the Coach Panel has in view (#254)", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("agenda-coach"));
    await page.goto("/agenda");
    await page.getByRole("button", { name: fr.coachPanel.open, exact: true }).click();
    const coachPanel = page.getByRole("complementary", { name: fr.coachPanel.title });
    await expect(coachPanel).toContainText(`Vous consultez : ${fr.coachPanel.inViewAgenda}`);
  });

  test("shows only the signed-in Candidate's Interviews", async ({ page, browser }) => {
    await signInWithMagicLink(page, newAddress("agenda-owner"));
    await applicationWithInterviews(page, "Contrôleur de gestion", [`${parisDay(5)}T09:00`]);

    const other = await browser.newPage();
    await signInWithMagicLink(other, newAddress("agenda-other"));
    await other.goto("/agenda");
    await expect(other.getByText(fr.agenda.none)).toBeVisible();
    await expect(other.getByText("Contrôleur de gestion")).toHaveCount(0);
    await other.close();
  });
});

// Issue #247: Interviews carry a duration, a format and a place or link, and are added
// from the Agenda too, moving the Application to "Entretien" when the Candidate confirms.
test.describe("adding an Interview from the Agenda", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  const addButton = (page: Page) => page.getByRole("button", { name: fr.agenda.add, exact: true });
  const dialog = (page: Page) => page.getByRole("dialog", { name: fr.agenda.addDialog.title });

  test("moves an Application at « Postulée » to « Entretien » and adds the Interview, its link clickable", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("agenda-add-move"));
    const day = parisDay(3);
    const profileId = await createProfile(page);
    const applicationId = await applicationAt(page, profileId, "DAF H/F", "applied");
    await applicationAt(page, profileId, "Ancienne offre", "rejected"); // not ongoing: not offered

    await page.goto("/agenda");
    await addButton(page).click();
    const form = dialog(page);
    const picker = form.getByLabel(fr.agenda.addDialog.application);
    await expect(picker).toBeFocused();
    await expect(picker.locator("option")).toHaveText([fr.agenda.addDialog.chooseApplication, `DAF H/F · Acme Industrie · ${fr.applicationStatuses.applied}`]);
    await picker.selectOption({ label: `DAF H/F · Acme Industrie · ${fr.applicationStatuses.applied}` });
    const move = form.getByRole("checkbox", { name: fr.agenda.addDialog.moveToInterview });
    await expect(move).toBeChecked();
    await form.getByLabel(fr.application.interviewDate).fill(`${day}T14:30`);
    await form.getByLabel(fr.application.interviewDuration).fill("45");
    await form.getByLabel(fr.application.interviewFormat).selectOption({ label: fr.interviewFormats.video });
    await form.getByLabel(fr.application.interviewPlace).fill("Teams : https://meet.example.com/abc");
    await form.getByRole("button", { name: fr.agenda.addDialog.submit }).click();

    await expect(dialog(page)).toHaveCount(0);
    await expect(addButton(page)).toBeFocused();
    const item = page.getByRole("region", { name: fr.agenda.upcomingTitle }).getByRole("listitem");
    await expect(item).toHaveCount(1);
    await expect(item).toContainText("14:30 – 15:15");
    await expect(item).toContainText(fr.interviewFormats.video);
    await expect(item.getByRole("link", { name: "https://meet.example.com/abc" })).toHaveAttribute("href", "https://meet.example.com/abc");

    // Both saved in that one request: the Application is now at « Entretien », with the Interview.
    await page.goto(`/candidatures/${applicationId}/entretiens`);
    await expect(page.getByLabel(fr.application.statusLabel).first()).toHaveValue("interview");
    const interviews = page.getByRole("region", { name: fr.application.interviewsTitle });
    await expect(interviews.getByRole("listitem")).toContainText("14:30 – 15:15");
    await expect(interviews.getByRole("link", { name: "https://meet.example.com/abc" })).toBeVisible();
  });

  test("saves nothing when the box is unchecked, and says why", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("agenda-add-unchecked"));
    const applicationId = await applicationAt(page, await createProfile(page), "Contrôleur de gestion", "applied");

    await page.goto("/agenda");
    await addButton(page).click();
    const form = dialog(page);
    await form.getByLabel(fr.agenda.addDialog.application).selectOption({ label: `Contrôleur de gestion · Acme Industrie · ${fr.applicationStatuses.applied}` });
    await form.getByRole("checkbox", { name: fr.agenda.addDialog.moveToInterview }).uncheck();
    await form.getByLabel(fr.application.interviewDate).fill(`${parisDay(2)}T10:00`);
    await form.getByRole("button", { name: fr.agenda.addDialog.submit }).click();

    await expect(form.getByRole("alert")).toHaveText(fr.agenda.addDialog.notMoved);
    await page.keyboard.press("Escape");
    await page.goto(`/candidatures/${applicationId}/entretiens`);
    await expect(page.getByLabel(fr.application.statusLabel).first()).toHaveValue("applied");
    await expect(page.getByRole("region", { name: fr.application.interviewsTitle })).toContainText(fr.application.interviewsNone);
    // The server still refuses an Interview on an Application not at « Entretien ».
    const refused = await page.request.post(`/api/applications/${applicationId}/interviews`, { headers: { origin }, data: { scheduledAt: `${parisDay(2)}T10:00` } });
    expect(refused.status()).toBe(409);
    expect(await refused.json()).toEqual({ error: "not_in_interview" });
  });

  test("is operated with the keyboard and gives the focus back on closing", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("agenda-add-keyboard"));
    await applicationAt(page, await createProfile(page), "DAF H/F", "interview");

    await page.goto("/agenda");
    await addButton(page).focus();
    await page.keyboard.press("Enter");
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page).getByLabel(fr.agenda.addDialog.application)).toBeFocused();
    // At « Entretien » already: no box to check.
    await dialog(page).getByLabel(fr.agenda.addDialog.application).selectOption({ label: `DAF H/F · Acme Industrie · ${fr.applicationStatuses.interview}` });
    await expect(dialog(page).getByRole("checkbox")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
    await expect(addButton(page)).toBeFocused();

    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(dialog(page).getByLabel(fr.agenda.addDialog.application)).toBeFocused();
    await dialog(page).getByRole("button", { name: fr.designSystem.close }).press("Enter");
    await expect(dialog(page)).toHaveCount(0);
    await expect(addButton(page)).toBeFocused();
  });
});

// Issue #250: « Annuler » keeps a Cancelled Interview, struck through, with its date of cancellation,
// on the Agenda and in its Application's Interviews Section; « Supprimer » leaves no trace.
test.describe("cancelling an Interview (#250)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  const tr = (template: string, values: Record<string, string>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");

  test("asks first, then keeps the Interview struck through with « Annulé le … », on the Agenda too; the export holds the cancellation", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("agenda-cancel"));
    const applicationId = await applicationWithInterviews(page, "DAF H/F", [`${parisDay(4)}T14:30`]);

    await page.goto(`/candidatures/${applicationId}/entretiens`);
    const interviews = page.getByRole("region", { name: fr.application.interviewsTitle });
    const cancel = interviews.getByRole("button", { name: /^Annuler l'entretien du/ });
    await cancel.click();
    await expect(interviews.getByRole("group", { name: fr.agendaChanges.cancelInterviewConfirm })).toBeVisible();
    await expect(interviews.getByRole("button", { name: fr.agendaChanges.confirm })).toBeFocused();
    await interviews.getByRole("button", { name: fr.agendaChanges.keep }).click();
    await expect(cancel).toBeFocused();
    await expect(interviews.getByText(/^Annulé le/)).toHaveCount(0);

    await cancel.click();
    await interviews.getByRole("button", { name: fr.agendaChanges.confirm }).click();
    const cancelledOn = tr(fr.agendaChanges.cancelledOn, { date: new Intl.DateTimeFormat("fr", { dateStyle: "long", timeZone: "Europe/Paris" }).format(new Date()) });
    await expect(interviews.getByRole("listitem")).toContainText(cancelledOn);
    await expect(interviews.getByRole("listitem")).toContainText("14:30");
    await expect(interviews.getByRole("button", { name: /^Annuler l'entretien du/ })).toHaveCount(0);
    await expect(interviews.getByText(fr.agendaChanges.removeHint)).toBeVisible();

    await page.goto("/agenda");
    const item = page.getByRole("region", { name: fr.agenda.upcomingTitle }).getByRole("listitem");
    await expect(item).toHaveCount(1);
    await expect(item).toContainText(fr.agendaChanges.cancelledInterview);
    await expect(item).toContainText(cancelledOn);
    await expect(item.locator(".agenda-item-time")).toHaveCSS("text-decoration-line", "line-through");

    const exported = await (await page.request.get("/api/account/export")).json();
    const application = exported.applications.find((a: { id: string }) => a.id === applicationId);
    expect(application.interviews).toEqual([expect.objectContaining({ cancelledAt: expect.any(String), reschedules: [] })]);
  });

  test("only the Candidate's own Interview can be cancelled", async ({ page, browser }) => {
    await signInWithMagicLink(page, newAddress("agenda-cancel-owner"));
    const applicationId = await applicationWithInterviews(page, "DAF H/F", [`${parisDay(4)}T14:30`]);
    await page.goto(`/candidatures/${applicationId}/entretiens`);
    const interviewId = (await (await page.request.get("/api/account/export")).json()).applications[0].interviews[0].id as string;

    const other = await browser.newPage();
    await signInWithMagicLink(other, newAddress("agenda-cancel-other"));
    const refused = await other.request.post(`/api/applications/${applicationId}/interviews/${interviewId}/cancel`, { headers: { origin } });
    expect(refused.status()).toBe(404);
    await other.close();
    await page.reload();
    await expect(page.getByRole("region", { name: fr.application.interviewsTitle }).getByText(/^Annulé le/)).toHaveCount(0);
  });
});

// Issue #250: a date change is a Reschedule only when made more than an hour after the date was set.
// The server runs on the real clock, so the test ages the date by moving `date_set_at` back in the e2e database.
async function ageDate(interviewId: string, minutesAgo: number) {
  const db = new pg.Pool({ connectionString: process.env.E2E_DATABASE_URL });
  try {
    await db.query("UPDATE interview SET date_set_at = now() - ($2 || ' minutes')::interval WHERE id = $1", [interviewId, String(minutesAgo)]);
  } finally {
    await db.end();
  }
}

test.describe("rescheduling an Interview (#250)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("a change 30 minutes after entering the date leaves no trace; one 2 hours later is a Reschedule, listed in order by whom", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("agenda-reschedule"));
    const first = `${parisDay(4)}T14:30`;
    const applicationId = await applicationWithInterviews(page, "DAF H/F", [first]);
    const exportOf = async () => (await (await page.request.get("/api/account/export")).json()).applications.find((a: { id: string }) => a.id === applicationId).interviews[0];
    const interviewId: string = (await exportOf()).id;
    const move = async (scheduledAt: string) => {
      const response = await page.request.patch(`/api/applications/${applicationId}/interviews/${interviewId}`, { headers: { origin }, data: { scheduledAt } });
      expect(response.ok(), await response.text()).toBe(true);
    };

    // 30 minutes after it was entered: a correction.
    await ageDate(interviewId, 30);
    await move(`${parisDay(4)}T15:00`);
    expect((await exportOf()).reschedules).toEqual([]);
    await page.goto(`/candidatures/${applicationId}/entretiens`);
    const interviews = page.getByRole("region", { name: fr.application.interviewsTitle });
    await expect(interviews.getByText(/^Reporté/)).toHaveCount(0);
    await expect(interviews.getByText(fr.agendaChanges.history)).toHaveCount(0);

    // 2 hours after: a Reschedule; then another, later still.
    await ageDate(interviewId, 120);
    await move(`${parisDay(5)}T10:00`);
    await ageDate(interviewId, 180);
    await move(`${parisDay(6)}T11:15`);

    const reschedules = (await exportOf()).reschedules as { previousAt: string; newAt: string; by: string; at: string }[];
    expect(reschedules).toHaveLength(2);
    expect(reschedules.map((r) => r.by)).toEqual(["candidate", "candidate"]);
    expect(new Date(reschedules[1]!.previousAt).getTime()).toBe(new Date(reschedules[0]!.newAt).getTime());
    expect(new Date(reschedules[0]!.at).getTime()).toBeLessThanOrEqual(new Date(reschedules[1]!.at).getTime());

    for (const url of [`/candidatures/${applicationId}/entretiens`, "/agenda"]) {
      await page.goto(url);
      const scope = url === "/agenda" ? page.getByRole("region", { name: fr.agenda.upcomingTitle }) : page.getByRole("region", { name: fr.application.interviewsTitle });
      await expect(scope.getByText(/^Reporté · initialement prévu le/)).toContainText("15:00");
      await scope.getByText(fr.agendaChanges.history).click();
      const history = scope.locator(".reschedule-history li");
      await expect(history).toHaveCount(2);
      await expect(history.nth(0)).toContainText("15:00");
      await expect(history.nth(0)).toContainText("10:00");
      await expect(history.nth(1)).toContainText("10:00");
      await expect(history.nth(1)).toContainText("11:15");
      await expect(history.nth(0)).toContainText("par vous");
      await expect(history.nth(1)).toContainText("par vous");
    }
  });
});

test.describe("the Data export (#247)", () => {
  test("carries each Interview's duration, format and place", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("agenda-export"));
    const applicationId = await applicationAt(page, await createProfile(page), "DAF H/F", "interview");
    const added = await page.request.post(`/api/applications/${applicationId}/interviews`, {
      headers: { origin },
      data: { scheduledAt: "2026-11-12T14:30", durationMinutes: 45, format: "video", place: "https://meet.example.com/abc" },
    });
    expect(added.ok(), await added.text()).toBe(true);

    const exported = await (await page.request.get("/api/account/export")).json();
    const application = exported.applications.find((a: { id: string }) => a.id === applicationId);
    expect(application.interviews).toEqual([
      expect.objectContaining({ durationMinutes: 45, format: "video", place: "https://meet.example.com/abc" }),
    ]);
  });
});

// Issue #251: week and month views, each view and period with its own address (ADR-0028).
test.describe("the Agenda's week and month views", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("each view and period has its own address, which back and reload keep; the last view picked comes back from the Sidebar", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("agenda-views"));
    const today = parisDay(0);
    await page.goto("/agenda");
    await expect(viewSwitch(page).getByRole("link", { name: fr.agenda.listView })).toHaveAttribute("aria-current", "page");

    await viewSwitch(page).getByRole("link", { name: fr.agenda.weekView }).click();
    await expect(page).toHaveURL(new RegExp(`/agenda\\?vue=semaine&date=${today}$`));
    await expect(viewSwitch(page).getByRole("link", { name: fr.agenda.weekView })).toHaveAttribute("aria-current", "page");
    const days = page.locator(".agenda-week > li");
    await expect(days).toHaveCount(7);
    await expect(days.first().locator("time")).toHaveAttribute("datetime", mondayOf(today));

    await weekNav(page).getByRole("link", { name: fr.agenda.next }).click();
    const nextMonday = plusDays(mondayOf(today), 7);
    await expect(page).toHaveURL(new RegExp(`vue=semaine&date=${nextMonday}$`));
    await expect(days.first().locator("time")).toHaveAttribute("datetime", nextMonday);
    await page.reload();
    await expect(days.first().locator("time")).toHaveAttribute("datetime", nextMonday);
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`vue=semaine&date=${today}$`));
    await expect(days.first().locator("time")).toHaveAttribute("datetime", mondayOf(today));
    await weekNav(page).getByRole("link", { name: fr.agenda.previous }).click();
    await expect(days.first().locator("time")).toHaveAttribute("datetime", plusDays(mondayOf(today), -7));
    await weekNav(page).getByRole("link", { name: fr.agenda.today }).click();
    await expect(days.first().locator("time")).toHaveAttribute("datetime", mondayOf(today));

    await viewSwitch(page).getByRole("link", { name: fr.agenda.monthView }).click();
    await expect(page).toHaveURL(new RegExp(`vue=mois&date=${today}$`));
    await monthNav(page).getByRole("link", { name: fr.agenda.next }).click();
    await expect(page).toHaveURL(/vue=mois&date=\d{4}-\d{2}-01$/);
    await page.reload();
    await expect(page.getByRole("table")).toBeVisible();

    // The Sidebar's link names no view: this browser brings back the month, last picked.
    await agendaLink(page).click();
    await expect(page).toHaveURL(/\/agenda\?vue=mois$/);
    await expect(viewSwitch(page).getByRole("link", { name: fr.agenda.monthView })).toHaveAttribute("aria-current", "page");
    await viewSwitch(page).getByRole("link", { name: fr.agenda.listView }).click();
    await expect(page).toHaveURL(/\/agenda\?vue=liste$/);
    await agendaLink(page).click();
    await expect(page).toHaveURL(/\/agenda$/);
    await expect(page.getByRole("heading", { name: fr.agenda.upcomingTitle })).toBeVisible();
  });

  test("the week runs Monday to Sunday, each day listing its items with their time, past ones dimmed", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("agenda-week"));
    const day = parisDay(14);
    const monday = mondayOf(day);
    const sunday = plusDays(monday, 6);
    await applicationWithInterviews(page, "DAF H/F", [`${sunday}T23:30`, `${monday}T09:15`, `${parisDay(-1)}T10:00`]);

    await page.goto(`/agenda?vue=semaine&date=${day}`);
    const days = page.locator(".agenda-week > li");
    await expect(days).toHaveCount(7);
    await expect(days.nth(0).locator("h3 time")).toHaveAttribute("datetime", monday);
    await expect(days.nth(6).locator("h3 time")).toHaveAttribute("datetime", sunday);
    // 23:30 on Sunday in Paris is Monday in UTC: it stays on Sunday.
    await expect(days.nth(6).getByRole("listitem")).toContainText("23:30");
    await expect(days.nth(0).getByRole("listitem")).toContainText("09:15");
    await expect(days.nth(3)).toContainText(fr.agenda.nothing);

    await page.goto(`/agenda?vue=semaine&date=${parisDay(-1)}`);
    await expect(page.locator(".agenda-item-past")).toHaveCount(1);
    await expect(page.locator(".agenda-item-past")).toContainText("10:00");
  });

  test("the month grid is used by keyboard, Tab through its day buttons, each announcing its number of items", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("agenda-month"));
    const day = parisDay(20);
    const first = `${day.slice(0, 7)}-01`;
    const busy = `${day.slice(0, 7)}-15`;
    await applicationWithInterviews(page, "DAF H/F", [`${busy}T09:00`, `${busy}T16:30`]);

    await page.goto(`/agenda?vue=mois&date=${first}`);
    const buttons = dayButtons(page);
    // One button per day of the month, the 1st first.
    const lastDay = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)), 0)).getUTCDate();
    await expect(buttons).toHaveCount(lastDay);
    await expect(buttons.nth(0)).toHaveAttribute("aria-pressed", "true");
    await expect(buttons.nth(14)).toHaveAccessibleName(/: 2 rendez-vous$/);
    await expect(buttons.nth(13)).toHaveAccessibleName(/: aucun rendez-vous$/);
    await expect(page.getByText(fr.agenda.nothingThatDay)).toBeVisible();

    await buttons.nth(0).focus();
    for (let index = 1; index <= 14; index += 1) {
      await page.keyboard.press("Tab");
      await expect(buttons.nth(index)).toBeFocused();
    }
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`vue=mois&date=${busy}$`));
    await expect(buttons.nth(14)).toHaveAttribute("aria-pressed", "true");
    await expect(buttons.nth(14)).toBeFocused();
    const chosen = chosenDay(page).getByRole("listitem");
    await expect(chosen).toHaveCount(2);
    await expect(chosen.first()).toContainText("09:00");
    await expect(chosen.last()).toContainText("16:30");
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`vue=mois&date=${first}$`));
  });
});

test.describe("the Agenda's week and month views at 375 px", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("stack the week's days and keep the month grid compact, without horizontal scroll", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("agenda-views-phone"));
    const day = parisDay(10);
    await applicationWithInterviews(page, "Directeur administratif et financier H/F", [`${day}T09:00`, `${day}T11:00`, `${day}T14:00`, `${day}T17:30`]);

    for (const view of ["semaine", "mois"]) {
      await page.goto(`/agenda?vue=${view}&date=${day}`);
      await expect(viewSwitch(page)).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    }
    // The month's day buttons stay at least 44 px high, the list of the day chosen below the grid.
    const box = await dayButtons(page).first().boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await expect(chosenDay(page).getByRole("listitem")).toHaveCount(4);
  });
});

/**
 * What of the week view does not fit: words cut across two lines, or lying outside their day's
 * column or their item's card (hidden under the next column, or scrolling the page sideways).
 */
const weekMisfits = (page: Page) =>
  page.evaluate(() => {
    const misfits: string[] = [];
    const outside = (inner: DOMRect, outer: DOMRect) => inner.left < outer.left - 0.5 || inner.right > outer.right + 0.5;
    for (const box of document.querySelectorAll<HTMLElement>(".agenda-week-day, .agenda-week .agenda-item")) {
      const bounds = box.getBoundingClientRect();
      const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
        for (const word of node.data.matchAll(/\S+/g)) {
          const range = document.createRange();
          range.setStart(node, word.index);
          range.setEnd(node, word.index + word[0].length);
          const lines = [...range.getClientRects()].filter((rect) => rect.width > 0);
          if (lines.length > 1) misfits.push(`« ${word[0]} » is cut across ${lines.length} lines`);
          if (lines.some((rect) => outside(rect, bounds))) misfits.push(`« ${word[0]} » overflows its ${box.className}`);
        }
      }
    }
    if (document.documentElement.scrollWidth > window.innerWidth) misfits.push(`the page scrolls sideways (${document.documentElement.scrollWidth} px)`);
    return misfits;
  });

/** The tops of the week's seven days: all equal when they are columns, all different when stacked. */
const weekDayTops = (page: Page) => page.locator(".agenda-week > li").evaluateAll((days) => days.map((day) => Math.round(day.getBoundingClientRect().top)));

// QA on #251: the seven columns came at a 64rem viewport, with the Sidebar taking 17rem of it, so
// at 1024 px each was 88 px wide: times hidden under the next column, words cut, the page sideways.
test.describe("the Agenda's week view beside the Sidebar", () => {
  test("shows each item whole, its times and words inside its card and day, at every width and text size", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("agenda-week-desktop"));
    // Next week's Tuesday, so the day after is in the same week whatever today is (two days on, a Friday gave a Sunday).
    const day = plusDays(mondayOf(parisDay(7)), 1);
    await applicationWithInterviews(page, "Directeur administratif et financier H/F", [`${day}T09:30`, `${day}T14:00`, `${plusDays(day, 1)}T23:30`]);

    for (const textSize of ["standard", "xlarge"]) {
      for (const width of [1024, 1280, 1440, 1920]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`/agenda?vue=semaine&date=${day}`);
        await page.evaluate((size) => localStorage.setItem("jobbbox.textSize", size), textSize);
        await page.reload();
        await expect(page.locator("html")).toHaveAttribute("data-text-size", textSize);
        await expect(page.locator(".agenda-week .agenda-item")).toHaveCount(3);
        expect(await weekMisfits(page), `${width} px, ${textSize} text`).toEqual([]);
        // Seven columns when they have room for their items, else the days stacked: never in between.
        const tops = new Set(await weekDayTops(page));
        expect(tops.size === 1 || tops.size === 7, `${width} px, ${textSize} text: ${[...tops].join(", ")}`).toBe(true);
      }
    }
    // A 1440 px desktop at the standard text size has room for the seven columns.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => localStorage.setItem("jobbbox.textSize", "standard"));
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-text-size", "standard");
    expect(new Set(await weekDayTops(page)).size).toBe(1);
  });
});

test("screenshots of the week and month views at 3 widths", async ({ page }, testInfo) => {
  await signInWithMagicLink(page, newAddress("agenda-screens"));
  const day = parisDay(2);
  await applicationWithInterviews(page, "Directeur administratif et financier H/F", [`${parisDay(-1)}T10:00`, `${day}T09:30`, `${day}T14:00`, `${parisDay(4)}T23:30`]);
  const dir = process.env.AGENDA_SCREENSHOTS_DIR;
  if (dir) mkdirSync(dir, { recursive: true });
  for (const view of ["semaine", "mois"]) {
    for (const [width, height] of [
      [375, 812],
      [900, 1000],
      [1440, 900],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.goto(`/agenda?vue=${view}&date=${day}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      const path = dir ? `${dir}/${width}-${view}.png` : testInfo.outputPath(`${width}-${view}.png`);
      await page.screenshot({ path, fullPage: true });
      await testInfo.attach(`${width}px ${view}`, { path, contentType: "image/png" });
    }
  }
});

test.describe("the Agenda on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("sits in the Sidebar's drawer", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("agenda-phone"));
    await page.goto("/agenda");
    await page.getByRole("button", { name: fr.sidebar.menu, exact: true }).click();
    const drawer = page.getByRole("dialog", { name: fr.sidebar.menu });
    const link = drawer.getByRole("navigation", { name: fr.sidebar.label }).getByRole("link", { name: fr.sidebar.agenda, exact: true });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("aria-current", "page");
  });
});

// Issue #252: « Ajouter à mon calendrier » downloads an upcoming Agenda Item as a Calendar file (ADR-0029).
test.describe("the Calendar file (#252)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  /** The Calendar file's content lines, unfolded (RFC 5545 s3.1). */
  const unfolded = (file: string) => file.replace(/\r\n[ \t]/g, "").split("\r\n");
  const calendarLinks = (page: Page) => page.getByRole("link", { name: new RegExp(`^${fr.agenda.calendarFile.add}`) });

  test("an upcoming Interview offers « Ajouter à mon calendrier », with the hint, and downloads it in French time", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("agenda-ics"));
    const day = parisDay(6);
    const applicationId = await applicationAt(page, await createProfile(page), "DAF H/F", "interview");
    const added = await page.request.post(`/api/applications/${applicationId}/interviews`, {
      headers: { origin },
      data: { scheduledAt: `${day}T14:30`, durationMinutes: 45, format: "video", place: "https://meet.example.com/abc", note: "avec la DRH, 2e étage" },
    });
    expect(added.ok(), await added.text()).toBe(true);
    // A past Interview has no link.
    await page.request.post(`/api/applications/${applicationId}/interviews`, { headers: { origin }, data: { scheduledAt: `${parisDay(-3)}T10:00` } });

    await page.goto("/agenda");
    const link = calendarLinks(page);
    await expect(link).toHaveCount(1);
    await expect(link).toHaveText(fr.agenda.calendarFile.add);
    await expect(link).toHaveAccessibleName(new RegExp(`^${fr.agenda.calendarFile.add} : DAF H/F, `));
    await expect(link).toHaveAccessibleDescription(fr.agenda.calendarFile.hint);
    await expect(page.getByText(fr.agenda.calendarFile.hint)).toBeVisible();

    const download = page.waitForEvent("download");
    await link.click();
    expect((await download).suggestedFilename()).toBe(`entretien-${day}.ics`);

    const response = await page.request.get((await link.getAttribute("href"))!);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("text/calendar; charset=utf-8");
    const file = await response.text();
    for (const line of file.split("\r\n")) expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
    const lines = unfolded(file);
    const compact = day.replace(/-/g, "");
    expect(lines).toEqual(
      expect.arrayContaining([
        "BEGIN:VCALENDAR",
        "TZID:Europe/Paris",
        `DTSTART;TZID=Europe/Paris:${compact}T143000`,
        `DTEND;TZID=Europe/Paris:${compact}T151500`,
        "SUMMARY:Entretien — DAF H/F\\, Acme Industrie",
        "LOCATION:https://meet.example.com/abc",
        "URL:https://meet.example.com/abc",
        `DESCRIPTION:avec la DRH\\, 2e étage\\n\\nDans votre agenda Jobbbox : ${origin}/agenda`,
      ]),
    );
    expect(lines.find((line) => line.startsWith("UID:"))).toMatch(/^UID:interview-[0-9a-f-]{36}@jobbbox\.fr$/);
  });

  test("another Candidate's Agenda Item returns 404", async ({ page, browser }) => {
    await signInWithMagicLink(page, newAddress("agenda-ics-owner"));
    await applicationWithInterviews(page, "DAF H/F", [`${parisDay(4)}T14:30`]);
    await page.goto("/agenda");
    const href = (await calendarLinks(page).getAttribute("href"))!;
    expect((await page.request.get(href)).status()).toBe(200);

    const other = await browser.newPage();
    await signInWithMagicLink(other, newAddress("agenda-ics-other"));
    expect((await other.request.get(href)).status()).toBe(404);
    await other.close();
  });

  test("a Cancelled Interview has no link and its file returns 404", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("agenda-ics-cancel"));
    const applicationId = await applicationWithInterviews(page, "DAF H/F", [`${parisDay(4)}T14:30`]);
    await page.goto("/agenda");
    const href = (await calendarLinks(page).getAttribute("href"))!;
    const interviewId = (await (await page.request.get("/api/account/export")).json()).applications[0].interviews[0].id as string;

    const cancelled = await page.request.post(`/api/applications/${applicationId}/interviews/${interviewId}/cancel`, { headers: { origin } });
    expect(cancelled.ok(), await cancelled.text()).toBe(true);
    await page.reload();
    await expect(page.getByRole("region", { name: fr.agenda.upcomingTitle }).getByRole("listitem")).toContainText(fr.agendaChanges.cancelledInterview);
    await expect(calendarLinks(page)).toHaveCount(0);
    expect((await page.request.get(href)).status()).toBe(404);
  });
});
