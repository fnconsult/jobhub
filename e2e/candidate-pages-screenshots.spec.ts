import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import pg from "pg";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";
import { subscribe } from "./support/plan";
import { comparesScreenshots, SCREENSHOT_WIDTHS } from "./support/screenshots";

// Issue #467 (ADR-0053): the Candidate's pages in the Design System's Confort Density: Recherches d'offres (Job Offer
// cards with the Match Score ring), Candidatures (the list as a Table), an Application's page (its Sections in tabs) and
// the quick actions on the home page. Their screenshot baselines, light, at three widths, live in e2e/__screenshots__
// and fail CI on a visual difference; axe runs on each. Only the page (`<main>`) is compared: the shell has its own
// baselines (shell-screenshots.spec.ts). Everything shown is fixed (titles, dates, scores) but the day an Application was
// saved, which is masked. How to update a baseline on purpose: docs/agents/screenshot-baselines.md.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;
/** One run's Job Offers, kept apart from another run's in the same database. */
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
  skills: ["IFRS", "Consolidation", "SAP", "Contrôle de gestion"],
  languages: [],
};

/** The Job Offers found, each with what its card shows; posted on fixed days. */
const OFFERS = [
  {
    title: "Directrice administrative et financière (H/F)",
    employer: "Groupe Ferlac",
    location: "Lyon",
    contract: "cdi",
    remote: "hybrid",
    salary: [95_000, 120_000],
    skills: ["IFRS", "Consolidation", "SAP"],
    years: 12,
    postedAt: "2026-10-23T09:00:00Z",
    site: "apec.fr",
  },
  {
    title: "Responsable consolidation groupe",
    employer: "Seb Industrie",
    location: "Écully",
    contract: "cdi",
    remote: "on_site",
    salary: [80_000, 95_000],
    skills: ["Consolidation", "IFRS", "Power BI"],
    years: 8,
    postedAt: "2026-10-22T09:00:00Z",
    site: "welcometothejungle.com",
  },
  {
    title: "Contrôleuse de gestion senior",
    employer: "Boiron",
    location: "Messimy",
    contract: "cdd",
    remote: null,
    salary: [null, null],
    skills: ["Contrôle de gestion", "SAP", "Tableau"],
    years: 5,
    postedAt: null,
    site: "indeed.fr",
  },
  // Not found by the Job Search: saved from elsewhere, so the Job Search's third Job Offer stays unsaved.
  {
    title: "Directrice financière de transition",
    employer: "Descours & Cabaud",
    location: "Lyon",
    contract: "freelance",
    remote: "hybrid",
    salary: [null, null],
    skills: ["IFRS", "Trésorerie"],
    years: 15,
    postedAt: "2026-10-20T09:00:00Z",
    site: "michaelpage.fr",
  },
] as const;

async function query<T = Record<string, unknown>>(sql: string, values: unknown[] = []): Promise<T[]> {
  const db = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL });
  await db.connect();
  try {
    return (await db.query(sql, values)).rows as T[];
  } finally {
    await db.end();
  }
}

/** Job Offers as a Job Search found them; `batch` keeps one set apart from another in the same run. */
async function insertJobOffers(offers: readonly (typeof OFFERS)[number][], batch = ""): Promise<string[]> {
  const offerIds: string[] = [];
  for (const [index, offer] of offers.entries()) {
    const [row] = await query<{ id: string }>(
      `INSERT INTO job_offer (url_key, content_fingerprint, source_url, source_name, title, content, employer, location, contract_type, remote_work,
         salary_min, salary_max, skills, required_experience_years, posted_at, summary, summary_read_at, sector, sector_read_at, text_read_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, now(), 'Industrie', now(), now()) RETURNING id`,
      [
        `${offer.site}/offres/${tag}-${batch}${index}`,
        `candidate-pages-${tag}-${batch}${index}`,
        `https://www.${offer.site}/offres/${tag}-${batch}${index}`,
        offer.site,
        offer.title,
        `${offer.employer} recrute. Vos missions : piloter la clôture, encadrer l'équipe.`,
        offer.employer,
        offer.location,
        offer.contract,
        offer.remote,
        offer.salary[0],
        offer.salary[1],
        offer.skills,
        offer.years,
        offer.postedAt,
        `${offer.title} chez ${offer.employer}, à ${offer.location}.`,
      ],
    );
    offerIds.push(row!.id);
  }
  return offerIds;
}

type Seeded = { profileId: string; applicationId: string };

/**
 * A Candidate with one Profile, its Job Search done on a fixed day with the first three Job Offers, and three
 * Applications: the first offer at « Entretien » with an Interview, the second « Postulée », the fourth « À postuler »
 * (the third stays unsaved, its card offering « Enregistrer en candidature »).
 */
async function seed(page: Page, email: string): Promise<Seeded> {
  const [candidate] = await query<{ id: string }>(`SELECT id FROM candidate WHERE email = $1`, [email]);
  const created = await page.request.post("/api/profiles", {
    headers: { origin },
    data: { masterCv, searchCriteria: { targetRole: "Directrice administrative et financière", locations: ["Lyon"], minSalary: 90_000, contractTypes: ["cdi"] } },
  });
  expect(created.status(), await created.text()).toBe(201);
  const profileId: string = (await created.json()).id;
  const offerIds = await insertJobOffers(OFFERS);
  await query(
    `INSERT INTO job_search (candidate_id, profile_id, status, job_offer_ids, started_at, finished_at) VALUES ($1, $2, 'done', $3, $4, $5)`,
    [candidate!.id, profileId, offerIds.slice(0, 3), "2026-10-27T08:30:00Z", "2026-10-27T08:32:00Z"],
  );
  const applicationIds: string[] = [];
  for (const jobOfferId of [offerIds[0], offerIds[1], offerIds[3]]) {
    const saved = await page.request.post("/api/applications", { headers: { origin }, data: { jobOfferId, profileId } });
    expect(saved.ok(), await saved.text()).toBe(true);
    applicationIds.push((await saved.json()).id);
  }
  const status = async (id: string, value: string) =>
    expect((await page.request.patch(`/api/applications/${id}`, { headers: { origin }, data: { status: value } })).ok()).toBe(true);
  await status(applicationIds[0]!, "interview");
  await status(applicationIds[1]!, "applied");
  const interview = await page.request.post(`/api/applications/${applicationIds[0]}/interviews`, {
    headers: { origin },
    data: { scheduledAt: "2027-03-12T14:30", durationMinutes: 60, format: "", place: "", note: "Avec la DRH et le directeur général." },
  });
  expect(interview.ok(), await interview.text()).toBe(true);
  return { profileId, applicationId: applicationIds[0]! };
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

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).include("#main").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map((node) => node.target.join(" ")) }))).toEqual([]);
}

test.describe("the Candidate's pages in the Design System (#467)", () => {
  let session: BrowserContext;
  let seeded: Seeded;
  test.beforeAll(async ({ browser }) => {
    session = await browser.newContext({ baseURL: origin, locale: "fr-FR", colorScheme: "light" });
    const page = await session.newPage();
    const email = newAddress("candidate-pages-shots");
    await signInWithMagicLink(page, email);
    seeded = await seed(page, email);
    await page.close();
  });
  test.afterAll(async () => {
    await session.close();
  });

  const PAGES = [
    {
      name: "recherches",
      path: () => `/recherches?profil=${seeded.profileId}`,
      ready: (page: Page) => page.getByRole("list", { name: fr.jobSearchesPage.groupTitle.replace("{{profile}}", "Directrice administrative et financière") }),
      // Drawn with the Design System's components: the Job Offer cards' Match Score ring.
      component: ".job-offer-result .ds-ring",
      mask: () => [] as string[],
    },
    {
      name: "candidatures",
      path: () => "/candidatures",
      ready: (page: Page) => page.getByRole("table", { name: fr.applications.title }),
      component: "main .ds-table",
      mask: () => [] as string[],
    },
    {
      name: "application",
      path: () => `/candidatures/${seeded.applicationId}/entretiens`,
      ready: (page: Page) => page.getByRole("region", { name: fr.application.interviewsTitle }),
      component: '.sections[data-look="tabs"]',
      // The day it was saved: today.
      mask: () => [".application-head__props .prop:nth-child(4) dd"],
    },
    {
      name: "home",
      path: () => "/",
      ready: (page: Page) => page.getByRole("navigation", { name: fr.quickActions.label }),
      component: ".quick-actions .ds-button--primary",
      mask: () => [] as string[],
    },
  ] as const;

  for (const shot of PAGES) {
    test(`${shot.name}: in the Confort Density, matches its baseline at every width, and axe passes`, async () => {
      const page = await session.newPage();
      for (const { name, width, height } of SCREENSHOT_WIDTHS) {
        await page.setViewportSize({ width, height });
        await page.goto(shot.path());
        await expect(shot.ready(page)).toBeVisible({ timeout: 20_000 });
        await expect(page.locator(shot.component).first()).toBeAttached();
        await settled(page);
        // Nothing runs off the side: a wide table scrolls in its own frame.
        expect(await page.evaluate(() => document.documentElement.scrollWidth), `${name}: the page's width`).toBeLessThanOrEqual(width);
        await expectNoAxeViolations(page);
        if (comparesScreenshots()) {
          // The page whole, its column drawn at once with nothing to scroll into view.
          await page.setViewportSize({ width, height: await page.evaluate(() => document.documentElement.scrollHeight) });
          await settled(page);
          await expect(page.locator("#main")).toHaveScreenshot(`${shot.name}-${name}.png`, { mask: shot.mask().map((selector) => page.locator(selector)) });
        }
      }
      await page.close();
    });
  }

  test("the home page's quick actions lead to Recherches d'offres and the Agenda, and open the Coach Panel", async () => {
    const page = await session.newPage();
    await page.goto("/");
    const actions = page.getByRole("navigation", { name: fr.quickActions.label });
    await expect(actions.getByRole("link", { name: fr.quickActions.searchJobOffers })).toHaveAttribute("href", "/recherches");
    await expect(actions.getByRole("link", { name: fr.quickActions.scheduleInterview })).toHaveAttribute("href", "/agenda");
    await actions.getByRole("button", { name: fr.quickActions.askCoach }).click();
    await expect(page.getByLabel(fr.coachPanel.messageLabel)).toBeVisible();
    await page.close();
  });

  // ADR-0009 on a phone, in the all-Profiles view: only a swimlane scrolls sideways, never the page. The long « Chercher
  // pour mes 2 profils (2 recherches) » wraps, a card's visually hidden label stays inside its swimlane, and the Profile
  // select reaches the 44px target floor. Without the worker: on the Standard Plan, for two Profiles, each Profile's Job
  // Search is seeded done.
  test("Recherches d'offres for every Profile, in swimlanes, does not scroll the page sideways at 375px, and its targets are 44px high", async ({ browser }) => {
    const context = await browser.newContext({ baseURL: origin, locale: "fr-FR", colorScheme: "light" });
    const page = await context.newPage();
    const email = newAddress("candidate-pages-all-profiles");
    await signInWithMagicLink(page, email);
    await subscribe(page, email, "standard");
    const [candidate] = await query<{ id: string }>(`SELECT id FROM candidate WHERE email = $1`, [email]);
    const roles = ["Directrice administrative et financière", "Responsable consolidation groupe"];
    for (const [index, targetRole] of roles.entries()) {
      const created = await page.request.post("/api/profiles", {
        headers: { origin },
        data: { masterCv, searchCriteria: { targetRole, locations: ["Lyon"], minSalary: 90_000, contractTypes: ["cdi"] } },
      });
      expect(created.status(), await created.text()).toBe(201);
      const offerIds = await insertJobOffers(OFFERS.slice(0, 3), `all-${index}-`);
      await query(
        `INSERT INTO job_search (candidate_id, profile_id, status, job_offer_ids, started_at, finished_at) VALUES ($1, $2, 'done', $3, $4, $5)`,
        [candidate!.id, (await created.json()).id, offerIds, "2026-10-27T08:30:00Z", "2026-10-27T08:32:00Z"],
      );
    }

    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/recherches?profil=tous&vue=couloirs");
    const lane = page.getByRole("region", { name: fr.jobSearchesPage.laneLabel.replace("{{profile}}", roles[0]) });
    await expect(lane.locator(".job-offer-result")).toHaveCount(3);
    await expect(page.getByRole("button", { name: fr.jobSearchesPage.startAll_other.replaceAll("{{count}}", "2") })).toBeVisible();
    await settled(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), "sideways scroll at 375px").toBe(0);
    expect(await lane.evaluate((element) => element.scrollWidth > element.clientWidth), "the swimlane scrolls sideways").toBe(true);
    for (const target of await page.getByRole("main").locator("a, button, summary, select").all()) {
      if (!(await target.isVisible())) continue;
      expect.soft((await target.boundingBox())!.height, `height of "${await target.innerText()}"`).toBeGreaterThanOrEqual(44);
    }
    await context.close();
  });

  test("an Application's Sections are tabs from 64rem, the one shown marked, and stay in the page beside a docked Coach Panel", async () => {
    const page = await session.newPage();
    await page.setViewportSize({ width: 1170, height: 800 });
    await page.goto(`/candidatures/${seeded.applicationId}/entretiens`);
    const tabs = page.getByRole("main").getByRole("navigation", { name: fr.application.sections.sectionsLabel });
    await expect(tabs.getByRole("link", { name: fr.application.sections.entretiens })).toHaveAttribute("aria-current", "page");
    const boxes = await tabs.getByRole("link").evaluateAll((links) => links.map((link) => link.getBoundingClientRect().top));
    // One line of tabs.
    expect(new Set(boxes.map(Math.round)).size).toBe(1);
    // The Coach Panel docked beside the page: the tabs stay, the sidebar keeps the main menu.
    await page.getByRole("button", { name: fr.coachPanel.open }).click();
    await expect(tabs).toBeVisible();
    await expect(page.locator(".sidebar-docked").getByRole("navigation", { name: fr.application.sections.sectionsLabel })).toHaveCount(0);
    await page.close();
  });
});
