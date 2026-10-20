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
  const profile = await page.request.post("/api/profiles", {
    headers: { origin },
    data: { masterCv, searchCriteria: { targetRole: "DAF", locations: ["Lyon"], contractTypes: ["cdi"] } },
  });
  expect(profile.status(), await profile.text()).toBe(201);
  const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const offer = await page.request.post("/api/job-offers", {
    headers: { origin },
    data: { source: { url: `https://www.apec.fr/offres/agenda-${tag}` }, title, content: `Acme Industrie recrute (réf. ${tag}).`, employer: "Acme Industrie", location: "Lyon" },
  });
  expect(offer.status(), await offer.text()).toBe(200);
  const saved = await page.request.post("/api/applications", { headers: { origin }, data: { jobOfferId: (await offer.json()).id, profileId: (await profile.json()).id } });
  expect(saved.ok(), await saved.text()).toBe(true);
  const applicationId: string = (await saved.json()).id;
  const changed = await page.request.patch(`/api/applications/${applicationId}`, { headers: { origin }, data: { status: "interview" } });
  expect(changed.ok(), await changed.text()).toBe(true);
  for (const scheduledAt of times) {
    const added = await page.request.post(`/api/applications/${applicationId}/interviews`, { headers: { origin }, data: { scheduledAt } });
    expect(added.ok(), await added.text()).toBe(true);
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
