import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import pg from "pg";
import { signInWithMagicLink } from "./support/candidate";
import { comparesScreenshots, leaveOutRelease, SCREENSHOT_WIDTHS } from "./support/screenshots";
import { expectTextContrast, showInTheme, themedName, THEMES } from "./support/theme";

// Issue #465 (ADR-0053): the pilot of the Back Office in the Compact Density, Paramètres, the Dashboard and Activité,
// drawn in the Design System. Their screenshot baselines, light and dark (#473), at three widths, live in e2e/__screenshots__ and fail
// CI on a visual difference; axe runs on each. Only the page (`<main>`) is compared: the shell has its own baselines
// (shell-screenshots.spec.ts). What changes with the day is masked: the Dashboard's month and its day-by-day axes.
// How to update a baseline on purpose: docs/agents/screenshot-baselines.md.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const admin = fr.admin;
// Its own permanent super-admin (playwright.config.ts): two sign-ins of one address at once can pick up each other's link.
const SUPER_ADMIN = "pilot-pages-office@e2e.jobbbox.test";
const origin = process.env.E2E_WEB_ORIGIN!;

/** The model of the AI calls this spec records, so Appels IA lists only them, at fixed times, whatever else ran. */
const MODEL = "e2e-screenshots-465";
/** Long past: no month's Dashboard counts them. */
const CALLS = [
  { at: "2025-01-15T08:42:10Z", task: "coaching", outcome: "ok", reason: null },
  { at: "2025-01-15T08:40:03Z", task: "scoring", outcome: "ok", reason: null },
  { at: "2025-01-15T08:31:47Z", task: "offer_analysis", outcome: "failed", reason: "provider_unavailable" },
  { at: "2025-01-14T17:05:22Z", task: "cv_parsing", outcome: "ok", reason: null },
] as const;

/** Records CALLS once, with their AI Message Logs (no Candidate, no text worth reading). */
async function recordCalls() {
  const database = new pg.Pool({ connectionString: process.env.E2E_DATABASE_URL });
  try {
    const { rows } = await database.query<{ count: number }>(`SELECT count(*)::int AS count FROM ai_usage WHERE model = $1`, [MODEL]);
    if (rows[0]!.count > 0) return;
    for (const call of CALLS) {
      const usage = await database.query<{ id: string }>(
        `INSERT INTO ai_usage (at, task, provider, endpoint, model, input_tokens, output_tokens, cost_eur, ok, duration_ms, outcome, reason)
         VALUES ($1, $2, 'mistral', 'e2e', $3, 120, 40, 0, $4, 800, $5, $6) RETURNING id`,
        [call.at, call.task, MODEL, call.outcome === "ok", call.outcome, call.reason],
      );
      await database.query(`INSERT INTO ai_message_log (usage_id, at, messages, reply, sent) VALUES ($1, $2, '[]'::jsonb, '', true)`, [usage.rows[0]!.id, call.at]);
    }
  } finally {
    await database.end();
  }
}

const PAGES = [
  {
    name: "parametres",
    component: "main .ds-tabs__list",
    path: "/admin/parametres?tab=recherche-web",
    ready: (page: Page) => page.locator("[data-active-provider]"),
    mask: () => [] as string[],
  },
  {
    name: "parametres-sheet",
    component: '.ds-drawer[data-sheet="perplexity"]',
    path: "/admin/parametres?tab=recherche-web&fournisseur=perplexity",
    ready: (page: Page) => page.locator('[data-sheet="perplexity"]'),
    mask: () => [] as string[],
  },
  {
    name: "dashboard",
    component: "main .ds-stat",
    path: "/admin",
    ready: (page: Page) => page.getByRole("region", { name: new RegExp(`^${admin.dashboard.jobDiscovery.title}`) }),
    // The month and day, and the axes and notes that follow the days of the month.
    mask: () => [".dashboard-period", ".chart-note", ".chart-plot", ".chart-x"],
  },
  {
    name: "activite",
    component: "main .ds-table",
    path: `/admin/activite/appels-ia?model=${MODEL}`,
    ready: (page: Page) => page.getByRole("table", { name: admin.aiMessages.caption }),
    mask: () => [] as string[],
  },
] as const;

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

async function expectNoAxeViolations(page: Page, selector: string) {
  const results = await new AxeBuilder({ page }).include(selector).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map((node) => node.target.join(" ")) }))).toEqual([]);
}

test.describe("the Back Office's pilot pages in the Design System (#465)", () => {
  // One super-admin's session, their own, for every page: one sign-in, not four in a row.
  let session: BrowserContext;
  test.beforeAll(async ({ browser }) => {
    await recordCalls();
    session = await browser.newContext({ baseURL: origin, locale: "en-US", colorScheme: "light" });
    await signInWithMagicLink(await session.newPage(), SUPER_ADMIN);
  });
  test.afterAll(async () => {
    await session.close();
  });

  for (const shot of PAGES) {
    test(`${shot.name}: in the Compact Density, matches its baseline at every width, and axe passes`, async () => {
      const page = await session.newPage();
      for (const { name, width, height } of SCREENSHOT_WIDTHS) {
        await page.setViewportSize({ width, height });
        await page.goto(shot.path);
        await expect(shot.ready(page)).toBeVisible({ timeout: 20_000 });
        // Drawn with the Design System's components (ADR-0053), not the old markup restyled.
        await expect(page.locator(shot.component).first()).toBeAttached();
        await settled(page);
        // Nothing runs off the side: a wide table scrolls in its own frame.
        expect(await page.evaluate(() => document.documentElement.scrollWidth), `${name}: the page's width`).toBeLessThanOrEqual(width);
        const sheet = shot.name === "parametres-sheet";
        // Nor off the Drawer's side: its content wraps to the Drawer's width, a wide table scrolling in its own frame. The
        // page's width cannot show it, the Drawer being fixed to the window.
        if (sheet) {
          const body = await page.locator("[data-sheet] .ds-drawer__body").evaluate((element) => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }));
          expect(body.scrollWidth, `${name}: the sheet's content width`).toBeLessThanOrEqual(body.clientWidth);
        }
        for (const theme of THEMES) {
          await showInTheme(page, theme);
          await settled(page);
          await expectNoAxeViolations(page, sheet ? "[data-sheet]" : "#main");
          if (theme === "dark") await expectTextContrast(page, `${shot.name}-${name}`);
          if (comparesScreenshots()) {
            // A side panel is shot as the window shows it; a page whole, its column drawn at once with nothing to scroll into view.
            const target: Locator = sheet ? page.locator("[data-sheet]") : page.locator("#main");
            await leaveOutRelease(page);
            if (!sheet) await page.setViewportSize({ width, height: await page.evaluate(() => document.documentElement.scrollHeight) });
            await settled(page);
            await expect(target).toHaveScreenshot(`${themedName(`${shot.name}-${name}`, theme)}.png`, { mask: shot.mask().map((selector) => page.locator(selector)) });
          }
        }
        await showInTheme(page, "light");
      }
      await page.close();
    });
  }
});
