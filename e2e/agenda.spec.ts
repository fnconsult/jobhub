import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

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

/** The day `offset` days from now, in French time ("2026-10-30"). */
const parisDay = (offset: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(Date.now() + offset * 86_400_000));

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

    await item.getByRole("link").click();
    await expect(page).toHaveURL(new RegExp(`/candidatures/${applicationId}/entretiens$`));
    await page.getByRole("region", { name: fr.application.interviewsTitle }).getByRole("link", { name: fr.application.seeInAgenda }).click();
    await expect(page).toHaveURL(/\/agenda$/);

    await page.getByRole("link", { name: fr.agenda.showPast }).click();
    await expect(page).toHaveURL(/\/agenda\?periode=passes$/);
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
    await dialog(page).getByRole("button", { name: fr.agenda.addDialog.close }).press("Enter");
    await expect(dialog(page)).toHaveCount(0);
    await expect(addButton(page)).toBeFocused();
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
