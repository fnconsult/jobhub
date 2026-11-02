import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import pg from "pg";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";
import { comparesScreenshots, leaveOutRelease, SCREENSHOT_WIDTHS } from "./support/screenshots";
import { expectTextContrast, showInTheme, themedName, THEMES } from "./support/theme";

// Issue #469 (ADR-0053): the Agenda's three views, Mon compte and Mon abonnement in the Design System's Confort Density.
// Their screenshot baselines, light and dark (#473), at three widths, live in e2e/__screenshots__ and fail CI on a visual difference;
// axe runs on each. Only the page (`<main>`) is compared: the shell has its own baselines (shell-screenshots.spec.ts).
// The Agenda shows a week of March 2030, far from today, so nothing in it is past or today whatever day the suite runs;
// only the day an Interview was cancelled is masked. How to update a baseline on purpose: docs/agents/screenshot-baselines.md.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;
/** One run's Job Offers and Human Coach, kept apart from another run's in the same database. */
const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const masterCv = {
  fullName: "Catherine Morel",
  headline: "Directrice administrative et financière",
  email: "",
  phone: "",
  location: "Lyon",
  summary: "Directrice financière, quinze ans en groupes industriels.",
  experience: [],
  education: [],
  skills: ["IFRS", "Consolidation", "SAP"],
  languages: [],
};

/** The week shown: Monday 11 to Sunday 17 March 2030. */
const WEEK_DAY = "2030-03-12";
/** The day chosen in the month: the Coaching Session's. */
const MONTH_DAY = "2030-03-14";

async function query<T = Record<string, unknown>>(sql: string, values: unknown[] = []): Promise<T[]> {
  const db = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL });
  await db.connect();
  try {
    return (await db.query(sql, values)).rows as T[];
  } finally {
    await db.end();
  }
}

/** A Job Offer `title` at `employer`, saved as an Application at « Entretien » for `profileId`. */
async function applicationAtInterview(page: Page, profileId: string, title: string, employer: string): Promise<{ applicationId: string; jobOfferId: string }> {
  const offer = await page.request.post("/api/job-offers", {
    headers: { origin },
    data: { source: { url: `https://www.apec.fr/offres/agenda-account-${tag}-${employer.length}` }, title, content: `${employer} recrute (réf. ${tag}).`, employer, location: "Lyon" },
  });
  expect(offer.status(), await offer.text()).toBe(200);
  const jobOfferId: string = (await offer.json()).id;
  const saved = await page.request.post("/api/applications", { headers: { origin }, data: { jobOfferId, profileId } });
  expect(saved.ok(), await saved.text()).toBe(true);
  const applicationId: string = (await saved.json()).id;
  expect((await page.request.patch(`/api/applications/${applicationId}`, { headers: { origin }, data: { status: "interview" } })).ok()).toBe(true);
  return { applicationId, jobOfferId };
}

async function addInterview(page: Page, applicationId: string, data: Record<string, unknown>): Promise<void> {
  const added = await page.request.post(`/api/applications/${applicationId}/interviews`, { headers: { origin }, data });
  expect(added.ok(), await added.text()).toBe(true);
}

/**
 * A Candidate on Free with one Profile, two Applications at « Entretien » and their Interviews in the week of 11 March
 * 2030 (one Cancelled, the week after), a Coaching Session with Camille Martin Rescheduled to the 14th and another paid
 * but « À planifier », and the week's one Match Score used: its bar full and red on Mon abonnement.
 */
async function seed(page: Page, email: string): Promise<void> {
  const [candidate] = await query<{ id: string }>(`SELECT id FROM candidate WHERE email = $1`, [email]);
  const created = await page.request.post("/api/profiles", {
    headers: { origin },
    data: { masterCv, searchCriteria: { targetRole: "Directrice administrative et financière", locations: ["Lyon"], contractTypes: ["cdi"] } },
  });
  expect(created.status(), await created.text()).toBe(201);
  const profileId: string = (await created.json()).id;

  const ferlac = await applicationAtInterview(page, profileId, "Directrice administrative et financière (H/F)", "Groupe Ferlac");
  const seb = await applicationAtInterview(page, profileId, "Responsable consolidation groupe", "Seb Industrie");
  await addInterview(page, ferlac.applicationId, { scheduledAt: `${WEEK_DAY}T09:30`, durationMinutes: 60, format: "video", place: "https://meet.example.com/ferlac" });
  await addInterview(page, seb.applicationId, { scheduledAt: `${WEEK_DAY}T16:00`, durationMinutes: 45, format: "on_site", place: "Écully" });
  await addInterview(page, seb.applicationId, { scheduledAt: "2030-03-18T14:30" });
  const exported = (await (await page.request.get("/api/account/export")).json()) as { applications: { id: string; interviews: { id: string; scheduledAt: string }[] }[] };
  const cancelled = exported.applications.find((application) => application.id === seb.applicationId)!.interviews.find((interview) => interview.scheduledAt.startsWith("2030-03-18"))!;
  expect((await page.request.post(`/api/applications/${seb.applicationId}/interviews/${cancelled.id}/cancel`, { headers: { origin } })).ok()).toBe(true);

  // Retired from the start: the Agenda still shows a Retired Human Coach's Coaching Sessions, and the Back Office's
  // « Coachs », shot alongside (back-office-sections-screenshots.spec.ts), lists only the active ones.
  const [coach] = await query<{ id: string }>(`INSERT INTO human_coach (name, email, booking_url, retired_at) VALUES ('Camille Martin', $1, 'https://cal.com/camille-martin', now()) RETURNING id`, [
    `camille.martin+${tag}@e2e.jobbbox.test`,
  ]);
  const [dated] = await query<{ id: string }>(
    `INSERT INTO coaching_session (stripe_checkout_session_id, candidate_id, coach_id, amount, currency, paid_at, scheduled_at, duration_minutes, changed_by)
     VALUES ($1, $2, $3, 9000, 'eur', '2026-10-01T09:00:00Z', '2030-03-13T10:00:00Z', 60, 'candidate') RETURNING id`,
    [`cs_e2e_${tag}_dated`, candidate!.id, coach!.id],
  );
  // Rescheduled by the Candidate: « Reporté · initialement prévu le 13 mars 2030 à 11:00 ».
  const moved = await page.request.patch(`/api/coaching/sessions/${dated!.id}`, { headers: { origin }, data: { scheduledAt: `${MONTH_DAY}T11:00`, durationMinutes: 60, videoLink: "", note: "" } });
  expect(moved.ok(), await moved.text()).toBe(true);
  await query(`INSERT INTO coaching_session (stripe_checkout_session_id, candidate_id, coach_id, amount, currency, paid_at) VALUES ($1, $2, $3, 9000, 'eur', '2026-10-02T09:00:00Z')`, [
    `cs_e2e_${tag}_unscheduled`,
    candidate!.id,
    coach!.id,
  ]);

  // The Free Plan's Match Score of the week, used.
  const scored = await page.request.post("/api/match-score", { headers: { origin }, data: { jobOfferId: ferlac.jobOfferId, cv: masterCv } });
  expect(scored.status(), await scored.text()).toBe(200);
}

/** The page drawn and still: Inter loaded, every finite animation over. */
async function settled(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
}

async function expectNoAxeViolations(page: Page, target: string) {
  const results = await new AxeBuilder({ page }).include(target).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map((node) => node.target.join(" ")) }))).toEqual([]);
}

/**
 * Each screen, and what is shot of it (`target`): the page (`#main`); for the Agenda's week and month, the Work Pane they
 * open in beside the Agenda's conversation (#606, #608), the list being a card of the conversation.
 */
const PAGES = [
  {
    name: "agenda-liste",
    path: "/agenda",
    ready: (page: Page) => page.getByRole("region", { name: fr.agenda.upcomingTitle }),
    component: "#main .ds-card",
    target: "#main",
  },
  {
    name: "agenda-semaine",
    path: `/agenda?vue=semaine&date=${WEEK_DAY}`,
    ready: (page: Page) => page.getByRole("navigation", { name: fr.agenda.weekNavLabel }),
    component: "aside.work-pane .ds-button",
    target: "aside.work-pane",
  },
  {
    name: "agenda-mois",
    path: `/agenda?vue=mois&date=${MONTH_DAY}`,
    ready: (page: Page) => page.getByRole("navigation", { name: fr.agenda.monthNavLabel }),
    component: "aside.work-pane .ds-button",
    target: "aside.work-pane",
  },
  {
    name: "compte",
    path: "/compte",
    ready: (page: Page) => page.getByRole("navigation", { name: fr.account.sections.sectionsLabel }).first(),
    component: "main .sections",
    target: "#main",
  },
  {
    name: "abonnement",
    path: "/abonnement",
    ready: (page: Page) => page.getByRole("region", { name: fr.billing.page.comparisonTitle }),
    component: "main .ds-card",
    target: "#main",
  },
] as const;

/** What changes with the day the suite runs: when the Interview was cancelled. */
const MASK = [".cancelled-on"];

test.describe("the Agenda, Mon compte and Mon abonnement in the Design System (#469)", () => {
  let session: BrowserContext;
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    session = await browser.newContext({ baseURL: origin, locale: "fr-FR", colorScheme: "light" });
    const page = await session.newPage();
    const email = newAddress("agenda-account-shots");
    await signInWithMagicLink(page, email);
    await seed(page, email);
    await page.close();
  });
  test.afterAll(async () => {
    await session.close();
  });

  for (const shot of PAGES) {
    test(`${shot.name}: in the Confort Density, matches its baseline at every width, and axe passes`, async () => {
      const page = await session.newPage();
      for (const { name, width, height } of SCREENSHOT_WIDTHS) {
        await page.setViewportSize({ width, height });
        await page.goto(shot.path);
        await expect(shot.ready(page)).toBeVisible({ timeout: 20_000 });
        // Drawn with the Design System's components (ADR-0053), not the old markup restyled.
        await expect(page.locator(shot.component).first()).toBeAttached();
        await settled(page);
        // Nothing runs off the side.
        expect(await page.evaluate(() => document.documentElement.scrollWidth), `${name}: the page's width`).toBeLessThanOrEqual(width);
        // Its buttons and segmented options reach the 44px target floor (ADR-0009).
        for (const target of await page.locator(shot.target).locator(".ds-button, .ds-segmented__option").all()) {
          if (!(await target.isVisible())) continue;
          expect.soft((await target.boundingBox())!.height, `${name}: the height of « ${await target.innerText()} »`).toBeGreaterThanOrEqual(44);
        }
        for (const theme of THEMES) {
          await showInTheme(page, theme);
          await settled(page);
          await expectNoAxeViolations(page, shot.target);
          if (theme === "dark") await expectTextContrast(page, `${shot.name}-${name}`);
          if (comparesScreenshots()) {
            // The page whole, its column drawn at once with nothing to scroll into view.
            await leaveOutRelease(page);
            await page.setViewportSize({ width, height: await page.evaluate(() => document.documentElement.scrollHeight) });
            await settled(page);
            await expect(page.locator(shot.target)).toHaveScreenshot(`${themedName(`${shot.name}-${name}`, theme)}.png`, { mask: MASK.map((selector) => page.locator(selector)) });
          }
        }
        await showInTheme(page, "light");
      }
      await page.close();
    });
  }

  test("the Agenda's views are a segmented control of links, and the legend closes each view", async () => {
    const page = await session.newPage();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/agenda?vue=semaine&date=${WEEK_DAY}`);
    const views = page.getByRole("navigation", { name: fr.agenda.viewsLabel });
    await expect(views.getByRole("link")).toHaveText([fr.agenda.listView, fr.agenda.weekView, fr.agenda.monthView]);
    // The card holds the list; the week opens beside the conversation, in the Work Pane (#606, #608).
    await expect(views.getByRole("link", { name: fr.agenda.listView })).toHaveAttribute("aria-current", "page");
    await expect(page.locator("aside.work-pane .agenda-week")).toBeVisible();
    // An Interview's block and a Coaching Session's, told apart by their colour and their words.
    await expect(page.locator('.agenda-week .agenda-item[data-kind="interview"]')).toHaveCount(2);
    await expect(page.locator('.agenda-week .agenda-item[data-kind="coachingSession"]')).toHaveCount(1);
    for (const view of ["liste", "semaine", "mois"]) {
      await page.goto(`/agenda?vue=${view}&date=${WEEK_DAY}`);
      await expect(page.getByRole("list", { name: fr.agenda.legendLabel })).toContainText(fr.agenda.pastDimmed);
    }
    // « Reporté » as a warn Pill; the Cancelled Interview struck through in the list.
    await page.goto("/agenda?vue=liste");
    await expect(page.locator('.agenda-item .ds-pill[data-tone="warn"]')).toContainText("Reporté");
    await expect(page.locator(".agenda-item-cancelled .agenda-item-title")).toHaveCSS("text-decoration-line", "line-through");
    await expect(page.getByRole("region", { name: fr.agenda.toSchedule })).toContainText("Camille Martin");
    await page.close();
  });

  test("Mon abonnement shows the week's used-up quota in red and the Plans as cards, the Candidate's and the recommended one marked", async () => {
    const page = await session.newPage();
    await page.goto("/abonnement");
    const matchScores = page.getByRole("progressbar", { name: "Match Scores" });
    await expect(matchScores).toHaveAttribute("aria-valuenow", "100");
    const plans = page.getByRole("region", { name: fr.billing.page.comparisonTitle });
    await expect(plans.getByRole("article", { name: "Gratuite" })).toContainText(fr.billing.page.current);
    await expect(plans.getByRole("article", { name: "Standard" })).toContainText(fr.billing.page.recommended);
    // A promotion code, typed here, is checked as a shared link's is.
    await page.getByLabel(fr.billing.page.codeLabel).fill("INCONNU");
    await page.getByRole("button", { name: fr.billing.page.applyCode }).click();
    await expect(page).toHaveURL(/\/abonnement\?code=INCONNU$/);
    await expect(page.getByRole("alert").filter({ hasText: fr.billing.page.codeInvalid })).toBeVisible();
    await page.close();
  });
});
