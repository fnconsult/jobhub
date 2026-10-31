import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import pg from "pg";
import { MARIE_DUPONT_CV, pdfCv } from "../apps/web/src/cv/test-support";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";
import { subscribe } from "./support/plan";
import { comparesScreenshots, SCREENSHOT_WIDTHS } from "./support/screenshots";
import { expectTextContrast, showInTheme, themedName, THEMES } from "./support/theme";

// The Candidate's pages in the Design System (ADR-0053), their screenshot baselines, light and dark (#473), at three widths, in
// e2e/__screenshots__, failing CI on a visual difference; axe runs on each. Only the page (`#main`) is compared, or one
// component alone: the shell has its own baselines (shell-screenshots.spec.ts). How to update a baseline on purpose:
// docs/agents/screenshot-baselines.md.
// - Issue #467, in the Confort Density: Recherches d'offres (Job Offer cards with the Match Score ring), Candidatures
//   (the list as a Table), an Application's page (its Sections in tabs) and the quick actions on the home page.
//   Everything shown is fixed (titles, dates, scores) but the day an Application was saved, which is masked.
// - Issue #468: the Profile (its head, its Sections as tabs, its Master CV in cards, the ATS Score card, the save bar),
//   the File upload's states (empty, a file chosen, a file refused, a file being read) and « Documents adaptés » (the
//   saved Tailored CV in the Viewer, beside its aside). Dates are masked.
const fr = JSON.parse(
  readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"),
);
const origin = process.env.E2E_WEB_ORIGIN!;
/** One run's Job Offers, kept apart from another run's in the same database. */
const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
/** A date written out (« 30 octobre 2026 »), with its day of the week or not. */
const MONTHS =
  /\d{1,2} (janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre) \d{4}/;

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

async function query<T = Record<string, unknown>>(
  sql: string,
  values: unknown[] = [],
): Promise<T[]> {
  const db = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL });
  await db.connect();
  try {
    return (await db.query(sql, values)).rows as T[];
  } finally {
    await db.end();
  }
}

/** Job Offers as a Job Search found them; `batch` keeps one set apart from another in the same run. */
async function insertJobOffers(
  offers: readonly (typeof OFFERS)[number][],
  batch = "",
): Promise<string[]> {
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

/**
 * The metrics a done Job Search's worker records (#109): a seeded row carries them too, since every finished or failed
 * run has them (job-search-metrics.spec.ts checks the whole database, these rows included). Two minutes, `matched` offers.
 */
function doneRunMetrics(matched: number): string {
  return JSON.stringify({
    funnel: {
      providerUrls: matched,
      fetched: matched,
      extracted: matched,
      alreadyStored: 0,
      afterDedup: matched,
      matched,
    },
    skipped: {},
    costEur: 0,
    durationMs: 120_000,
  });
}

type Seeded = { profileId: string; applicationId: string };

/**
 * A Candidate with one Profile, its Job Search done on a fixed day with the first three Job Offers, and three
 * Applications: the first offer at « Entretien » with an Interview, the second « Postulée », the fourth « À postuler »
 * (the third stays unsaved, its card offering « Enregistrer en candidature »).
 */
async function seed(page: Page, email: string): Promise<Seeded> {
  const [candidate] = await query<{ id: string }>(
    `SELECT id FROM candidate WHERE email = $1`,
    [email],
  );
  const created = await page.request.post("/api/profiles", {
    headers: { origin },
    data: {
      masterCv,
      searchCriteria: {
        targetRole: "Directrice administrative et financière",
        locations: ["Lyon"],
        minSalary: 90_000,
        contractTypes: ["cdi"],
      },
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const profileId: string = (await created.json()).id;
  const offerIds = await insertJobOffers(OFFERS);
  await query(
    `INSERT INTO job_search (candidate_id, profile_id, status, job_offer_ids, started_at, finished_at, metrics) VALUES ($1, $2, 'done', $3, $4, $5, $6)`,
    [
      candidate!.id,
      profileId,
      offerIds.slice(0, 3),
      "2026-10-27T08:30:00Z",
      "2026-10-27T08:32:00Z",
      doneRunMetrics(3),
    ],
  );
  const applicationIds: string[] = [];
  for (const jobOfferId of [offerIds[0], offerIds[1], offerIds[3]]) {
    const saved = await page.request.post("/api/applications", {
      headers: { origin },
      data: { jobOfferId, profileId },
    });
    expect(saved.ok(), await saved.text()).toBe(true);
    applicationIds.push((await saved.json()).id);
  }
  const status = async (id: string, value: string) =>
    expect(
      (
        await page.request.patch(`/api/applications/${id}`, {
          headers: { origin },
          data: { status: value },
        })
      ).ok(),
    ).toBe(true);
  await status(applicationIds[0]!, "interview");
  await status(applicationIds[1]!, "applied");
  const interview = await page.request.post(
    `/api/applications/${applicationIds[0]}/interviews`,
    {
      headers: { origin },
      data: {
        scheduledAt: "2027-03-12T14:30",
        durationMinutes: 60,
        format: "",
        place: "",
        note: "Avec la DRH et le directeur général.",
      },
    },
  );
  expect(interview.ok(), await interview.text()).toBe(true);
  return { profileId, applicationId: applicationIds[0]! };
}

/** The Master CV the Profile's screenshots (#468) show: every part of it filled. */
const profileMasterCv = {
  fullName: "Catherine Morel",
  headline: "Directrice administrative et financière",
  email: "catherine.morel@example.fr",
  phone: "06 11 22 33 44",
  location: "Lyon",
  summary:
    "Vingt ans de direction financière dans l'industrie : consolidation IFRS, trésorerie, refinancement.",
  experience: [
    {
      title: "Directrice administrative et financière",
      employer: "Groupe Sorelis",
      location: "Lyon",
      period: "2015 – aujourd'hui",
      description: "Refinancement de 45 M€ de dette.",
    },
    {
      title: "Responsable du contrôle de gestion",
      employer: "Valmont Distribution",
      location: "Villeurbanne",
      period: "2007 – 2015",
      description: "Clôtures mensuelles en cinq jours.",
    },
  ],
  education: [
    { degree: "Master Finance", institution: "IAE Lyon", year: "2004" },
  ],
  skills: ["Consolidation IFRS", "Trésorerie", "SAP"],
  languages: [{ name: "Anglais", level: "courant" }],
};

async function newProfile(page: Page): Promise<string> {
  const created = await page.request.post("/api/profiles", {
    headers: { origin },
    data: {
      masterCv: profileMasterCv,
      searchCriteria: {
        targetRole: "Directrice administrative et financière",
        locations: ["Lyon"],
        minSalary: 85000,
        contractTypes: ["cdi"],
      },
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  return (await created.json()).id;
}

/** An Application with its Tailored CV proposed and saved through the HTTP API, every change accepted. */
async function applicationWithTailoredCv(page: Page): Promise<string> {
  const profileId = await newProfile(page);
  const captured = await page.request.post("/api/job-offers", {
    headers: { origin },
    data: {
      source: { url: "https://www.apec.fr/offres/daf-screenshots-468" },
      title: "Directeur administratif et financier",
      content:
        "Groupe Ferlac recrute son DAF. Vous pilotez la consolidation IFRS et la trésorerie du groupe, sur SAP.",
      employer: "Groupe Ferlac",
      location: "Lyon",
      skills: ["IFRS", "SAP"],
    },
  });
  expect(captured.status(), await captured.text()).toBe(200);
  const saved = await page.request.post("/api/applications", {
    headers: { origin },
    data: { jobOfferId: (await captured.json()).id, profileId },
  });
  expect(saved.ok(), await saved.text()).toBe(true);
  const id = (await saved.json()).id as string;
  const proposed = await page.request.post(
    `/api/applications/${id}/tailored-cv`,
    { headers: { origin }, data: { language: "fr" } },
  );
  expect(proposed.status(), await proposed.text()).toBe(200);
  const { revision, changes } = (await proposed.json()).proposal as {
    revision: string;
    changes: { id: string }[];
  };
  const kept = await page.request.post(
    `/api/applications/${id}/tailored-cv/save`,
    {
      headers: { origin },
      data: { revision, accepted: changes.map((change) => change.id) },
    },
  );
  expect(kept.status(), await kept.text()).toBe(200);
  return id;
}

/** The page drawn and still: Inter loaded, every finite animation over. */
async function settled(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter(
          (animation) => animation.effect?.getTiming().iterations !== Infinity,
        )
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
}

/**
 * Today's date written out becomes one fixed date: masked, it still has the width of its text (« 31 octobre » is
 * narrower than « 30 octobre »), so the mask would move with the day. The baselines were drawn on 30 October 2026.
 */
async function fixDates(page: Page) {
  await page.evaluate((source) => {
    const pattern = new RegExp(
      `((lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche) )?${source}`,
      "g",
    );
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode())
      node.textContent = node.textContent!.replace(pattern, (_, weekday) =>
        weekday ? "vendredi 30 octobre 2026" : "30 octobre 2026",
      );
  }, MONTHS.source);
}

async function expectNoAxeViolations(page: Page, selector = "#main") {
  const results = await new AxeBuilder({ page })
    .include(selector)
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    results.violations.map(({ id, nodes }) => ({
      id,
      nodes: nodes.map((node) => node.target.join(" ")),
    })),
  ).toEqual([]);
}

/**
 * In each theme (#473): axe on `target`, nothing off the side, in dark every text at AA, then, where screenshots are
 * compared, `target` against its baseline. The page is left light.
 */
async function check(
  page: Page,
  target: Locator,
  selector: string,
  name: string,
  width: number,
  whole = true,
) {
  for (const theme of THEMES) {
    await showInTheme(page, theme);
    await settled(page);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
      `${name}: the page's width`,
    ).toBeLessThanOrEqual(width);
    await expectNoAxeViolations(page, selector);
    if (theme === "dark") await expectTextContrast(page, name);
    if (!comparesScreenshots()) continue;
    // A page whole, its column drawn at once with nothing to scroll into view.
    if (whole)
      await page.setViewportSize({
        width,
        height: await page.evaluate(() => document.documentElement.scrollHeight),
      });
    await fixDates(page);
    await settled(page);
    await expect(target).toHaveScreenshot(`${themedName(name, theme)}.png`, {
      mask: [
        page.getByText(MONTHS),
        page.locator(".provenance-line, .sidebar-count"),
      ],
    });
  }
  await showInTheme(page, "light");
}

test.describe("the Candidate's pages in the Design System (#467)", () => {
  let session: BrowserContext;
  let seeded: Seeded;
  test.beforeAll(async ({ browser }) => {
    session = await browser.newContext({
      baseURL: origin,
      locale: "fr-FR",
      colorScheme: "light",
    });
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
      ready: (page: Page) =>
        page.getByRole("list", {
          name: fr.jobSearchesPage.groupTitle.replace(
            "{{profile}}",
            "Directrice administrative et financière",
          ),
        }),
      // Drawn with the Design System's components: the Job Offer cards' Match Score ring.
      component: ".job-offer-result .ds-ring",
      mask: () => [] as string[],
    },
    {
      name: "candidatures",
      path: () => "/candidatures",
      ready: (page: Page) =>
        page.getByRole("table", { name: fr.applications.title }),
      component: "main .ds-table",
      mask: () => [] as string[],
    },
    {
      name: "application",
      path: () => `/candidatures/${seeded.applicationId}/entretiens`,
      ready: (page: Page) =>
        page.getByRole("region", { name: fr.application.interviewsTitle }),
      component: '.sections[data-look="tabs"]',
      // The day it was saved: today.
      mask: () => [".application-head__props .prop:nth-child(4) dd"],
    },
    {
      name: "home",
      path: () => "/",
      ready: (page: Page) =>
        page.getByRole("navigation", { name: fr.quickActions.label }),
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
        for (const theme of THEMES) {
          await showInTheme(page, theme);
          await settled(page);
          // Nothing runs off the side: a wide table scrolls in its own frame.
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth),
            `${name}: the page's width`,
          ).toBeLessThanOrEqual(width);
          await expectNoAxeViolations(page);
          if (theme === "dark") await expectTextContrast(page, `${shot.name}-${name}`);
          if (comparesScreenshots()) {
            // The page whole, its column drawn at once with nothing to scroll into view.
            await page.setViewportSize({
              width,
              height: await page.evaluate(
                () => document.documentElement.scrollHeight,
              ),
            });
            await settled(page);
            await expect(page.locator("#main")).toHaveScreenshot(
              `${themedName(`${shot.name}-${name}`, theme)}.png`,
              { mask: shot.mask().map((selector) => page.locator(selector)) },
            );
          }
        }
        await showInTheme(page, "light");
      }
      await page.close();
    });
  }

  test("the home page's quick actions lead to Recherches d'offres and the Agenda, and open the Coach Panel", async () => {
    const page = await session.newPage();
    await page.goto("/");
    const actions = page.getByRole("navigation", {
      name: fr.quickActions.label,
    });
    await expect(
      actions.getByRole("link", { name: fr.quickActions.searchJobOffers }),
    ).toHaveAttribute("href", "/recherches");
    await expect(
      actions.getByRole("link", { name: fr.quickActions.scheduleInterview }),
    ).toHaveAttribute("href", "/agenda");
    await actions
      .getByRole("button", { name: fr.quickActions.askCoach })
      .click();
    await expect(page.getByLabel(fr.coachPanel.messageLabel)).toBeVisible();
    await page.close();
  });

  // ADR-0009 on a phone, in the all-Profiles view: only a swimlane scrolls sideways, never the page. The long « Chercher
  // pour mes 2 profils (2 recherches) » wraps, a card's visually hidden label stays inside its swimlane, and the Profile
  // select reaches the 44px target floor. Without the worker: on the Standard Plan, for two Profiles, each Profile's Job
  // Search is seeded done.
  test("Recherches d'offres for every Profile, in swimlanes, does not scroll the page sideways at 375px, and its targets are 44px high", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      baseURL: origin,
      locale: "fr-FR",
      colorScheme: "light",
    });
    const page = await context.newPage();
    const email = newAddress("candidate-pages-all-profiles");
    await signInWithMagicLink(page, email);
    await subscribe(page, email, "standard");
    const [candidate] = await query<{ id: string }>(
      `SELECT id FROM candidate WHERE email = $1`,
      [email],
    );
    const roles = [
      "Directrice administrative et financière",
      "Responsable consolidation groupe",
    ];
    for (const [index, targetRole] of roles.entries()) {
      const created = await page.request.post("/api/profiles", {
        headers: { origin },
        data: {
          masterCv,
          searchCriteria: {
            targetRole,
            locations: ["Lyon"],
            minSalary: 90_000,
            contractTypes: ["cdi"],
          },
        },
      });
      expect(created.status(), await created.text()).toBe(201);
      const offerIds = await insertJobOffers(
        OFFERS.slice(0, 3),
        `all-${index}-`,
      );
      await query(
        `INSERT INTO job_search (candidate_id, profile_id, status, job_offer_ids, started_at, finished_at, metrics) VALUES ($1, $2, 'done', $3, $4, $5, $6)`,
        [
          candidate!.id,
          (await created.json()).id,
          offerIds,
          "2026-10-27T08:30:00Z",
          "2026-10-27T08:32:00Z",
          doneRunMetrics(offerIds.length),
        ],
      );
    }

    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/recherches?profil=tous&vue=couloirs");
    const lane = page.getByRole("region", {
      name: fr.jobSearchesPage.laneLabel.replace("{{profile}}", roles[0]),
    });
    await expect(lane.locator(".job-offer-result")).toHaveCount(3);
    await expect(
      page.getByRole("button", {
        name: fr.jobSearchesPage.startAll_other.replaceAll("{{count}}", "2"),
      }),
    ).toBeVisible();
    await settled(page);
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
      "sideways scroll at 375px",
    ).toBe(0);
    expect(
      await lane.evaluate(
        (element) => element.scrollWidth > element.clientWidth,
      ),
      "the swimlane scrolls sideways",
    ).toBe(true);
    for (const target of await page
      .getByRole("main")
      .locator("a, button, summary, select")
      .all()) {
      if (!(await target.isVisible())) continue;
      expect
        .soft(
          (await target.boundingBox())!.height,
          `height of "${await target.innerText()}"`,
        )
        .toBeGreaterThanOrEqual(44);
    }
    await context.close();
  });

  test("an Application's Sections are tabs from 64rem, the one shown marked, and stay in the page beside a docked Coach Panel", async () => {
    const page = await session.newPage();
    await page.setViewportSize({ width: 1170, height: 800 });
    await page.goto(`/candidatures/${seeded.applicationId}/entretiens`);
    const tabs = page
      .getByRole("main")
      .getByRole("navigation", { name: fr.application.sections.sectionsLabel });
    await expect(
      tabs.getByRole("link", { name: fr.application.sections.entretiens }),
    ).toHaveAttribute("aria-current", "page");
    const boxes = await tabs
      .getByRole("link")
      .evaluateAll((links) =>
        links.map((link) => link.getBoundingClientRect().top),
      );
    // One line of tabs.
    expect(new Set(boxes.map(Math.round)).size).toBe(1);
    // The Coach Panel docked beside the page: the tabs stay, the sidebar keeps the main menu.
    await page.getByRole("button", { name: fr.coachPanel.open }).click();
    await expect(tabs).toBeVisible();
    await expect(
      page.locator(".sidebar-docked").getByRole("navigation", {
        name: fr.application.sections.sectionsLabel,
      }),
    ).toHaveCount(0);
    await page.close();
  });
});

test.use({ colorScheme: "light" });

test.describe("Candidate pages in the Design System (#468)", () => {
  test("the Profile: its head, its Sections as tabs, its Master CV in cards, the ATS Score card and the save bar", async ({
    page,
  }) => {
    await signInWithMagicLink(page, newAddress("shots-profile"));
    const id = await newProfile(page);
    for (const { name, width, height } of SCREENSHOT_WIDTHS) {
      await page.setViewportSize({ width, height });
      await page.goto(`/profils/${id}/cv-de-reference`);
      const cv = page.getByRole("region", { name: fr.profile.masterCv });
      await expect(cv.getByLabel(fr.cvReview.summary)).toBeVisible();
      await check(
        page,
        page.locator("#main"),
        "#main",
        `profile-${name}`,
        width,
      );

      // An edit waits in the save bar, stuck to the bottom.
      await page.setViewportSize({ width, height });
      await cv
        .getByLabel(fr.cvReview.headline)
        .fill("Directrice financière groupe");
      const bar = page.getByRole("region", {
        name: fr.profilePage.savebarLabel,
      });
      await expect(bar).toBeVisible();
      await check(page, bar, "#main", `profile-savebar-${name}`, width, false);
    }
  });

  test("the File upload's states: empty, a file chosen, a file refused, a file being read", async ({
    page,
  }) => {
    await signInWithMagicLink(page, newAddress("shots-upload"));
    const upload = page.locator(".ds-upload");
    const input = page.getByLabel(fr.cvUpload.fileLabel);
    for (const { name, width, height } of SCREENSHOT_WIDTHS) {
      await page.setViewportSize({ width, height });
      await page.goto("/profils/nouveau");
      await page.waitForLoadState("networkidle");
      await check(
        page,
        page.locator("#main"),
        "#main",
        `upload-empty-${name}`,
        width,
      );

      await page.setViewportSize({ width, height });
      await input.setInputFiles({
        name: "CV-Marie-Dupont.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.alloc(10 * 1024 * 1024 + 1, 0x20),
      });
      await expect(upload.locator(".ds-note")).toHaveText(
        fr.cvUpload.errors.too_large,
      );
      await check(
        page,
        upload,
        "#main",
        `upload-refused-${name}`,
        width,
        false,
      );

      await input.setInputFiles({
        name: "CV-Marie-Dupont.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from(
          pdfCv([...MARIE_DUPONT_CV, "Divers", "E2E_CV_SLOW"]),
        ),
      });
      await expect(upload.locator(".ds-upload__file")).toContainText(
        "CV-Marie-Dupont.pdf",
      );
      await check(page, upload, "#main", `upload-chosen-${name}`, width, false);

      await page.getByRole("button", { name: fr.cvUpload.submit }).click();
      await expect(upload.locator(".ds-upload__step")).toBeVisible();
      await check(
        page,
        upload,
        "#main",
        `upload-reading-${name}`,
        width,
        false,
      );
      await upload
        .getByRole("button", { name: fr.aiActivity.live.stop.cv_reading })
        .click();
      await expect(upload.locator(".ds-upload__step")).toHaveCount(0);
    }
  });

  test("« Documents adaptés »: the saved Tailored CV in the Viewer, beside its aside", async ({
    page,
  }) => {
    await signInWithMagicLink(page, newAddress("shots-documents"));
    const id = await applicationWithTailoredCv(page);
    for (const { name, width, height } of SCREENSHOT_WIDTHS) {
      await page.setViewportSize({ width, height });
      await page.goto(`/candidatures/${id}/documents`);
      const viewer = page.getByRole("toolbar", {
        name: fr.designSystem.viewer.toolbar,
      });
      await expect(viewer).toContainText(/Page 1 sur \d/);
      await expect(
        page.getByRole("img", { name: /^Page 1 sur \d$/ }),
      ).toBeVisible();
      await check(
        page,
        page.locator("#main"),
        "#main",
        `documents-${name}`,
        width,
      );
    }
  });
});
