import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { fakeCustomerId } from "../apps/web/src/billing/fake-stripe";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";
import { parisDay } from "./support/paris-days";
import { subscribe } from "./support/plan";

// Issue #801 (ADR-0091): « Votre consommation » on Mon abonnement. A Standard Candidate's billing period comes from
// Stripe (the fake Stripe's subscription, its period set over HTTP); a Free Candidate's is the calendar month. Their
// daily counts are seeded straight into the e2e database (`consumption_day`, #799's table): what each feature counts
// is #799's own spec (consumption.spec.ts), this one is what the page shows of them.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const c = fr.billing.consumption;
const databaseUrl = process.env.E2E_DATABASE_URL!;
const stripeUrl = process.env.E2E_STRIPE_URL!;

async function query<T extends pg.QueryResultRow>(sql: string, values: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return (await client.query<T>(sql, values)).rows;
  } finally {
    await client.end();
  }
}

async function seed(email: string, rows: [day: string, tool: string, count: number][]) {
  const [{ id }] = await query<{ id: string }>("SELECT id FROM candidate WHERE email = $1", [email]);
  for (const [day, tool, count] of rows) {
    await query("INSERT INTO consumption_day (candidate_id, day, tool, count) VALUES ($1, $2, $3, $4) ON CONFLICT (candidate_id, day, tool) DO UPDATE SET count = excluded.count", [id, day, tool, count]);
  }
}

const dated = (day: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("fr", { ...options, timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).include("#consommation").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map((node) => node.target.join(" ")) }))).toEqual([]);
}

/** A Candidate on Standard whose billing period started 18 days ago and lasts 31 days, with 8 AI actions in it and 2 before. */
async function standardCandidate(page: Page, label: string) {
  const email = newAddress(label);
  await signInWithMagicLink(page, email);
  await subscribe(page, email, "standard");
  const [first, renewal] = [parisDay(-18), parisDay(13)];
  const response = await fetch(`${stripeUrl}/__subscriptions/sub_fake_${fakeCustomerId(email)}/period`, {
    method: "POST",
    body: new URLSearchParams({ start: String(Date.parse(`${first}T09:00:00Z`) / 1000), end: String(Date.parse(`${renewal}T09:00:00Z`) / 1000) }),
  });
  expect(response.ok).toBe(true);
  await seed(email, [
    [parisDay(0), "coach", 5],
    [parisDay(-1), "matchScore", 3],
    [parisDay(-40), "jobSearch", 2],
  ]);
  const last = parisDay(12);
  const options: Intl.DateTimeFormatOptions = first.slice(0, 4) === last.slice(0, 4) ? { day: "numeric", month: "long" } : { day: "numeric", month: "long", year: "numeric" };
  return { email, period: c.periodBilled.replace("{{start}}", dated(first, options)).replace("{{end}}", dated(last, options)), renewal };
}

const section = (page: Page) => page.getByRole("region", { name: c.title });
const cell = (page: Page, day: string) => page.locator(`#consommation [data-day="${day}"]`);

test.describe("« Votre consommation » on Mon abonnement (#801)", () => {
  test("a Standard Candidate sees their billing period, its AI actions and their count per Tool; axe passes", async ({ page }) => {
    const { period, renewal } = await standardCandidate(page, "consommation-standard");
    await page.goto("/abonnement");

    const card = section(page);
    await expect(card).toBeVisible();
    await expect(card.getByText(period)).toBeVisible();
    await expect(card.locator(".consumption-total")).toHaveText("8 actions IA");
    await expect(card.getByText(c.dayOf.replace("{{day}}", "19").replace("{{days}}", "31"))).toBeVisible();
    await expect(card.getByText(c.renewal.replace("{{date}}", dated(renewal, { day: "numeric", month: "short" })))).toBeVisible();
    const tools = card.getByRole("list", { name: c.byTool });
    await expect(tools.getByRole("listitem").filter({ hasText: "Coach IA" }).first()).toContainText("5 réponses");
    await expect(tools.getByRole("listitem").filter({ hasText: "Match Score" }).first()).toContainText("3 scores");
    // Its weekly Plan Quota beside it: Standard has 7 Job Searches a week.
    await expect(tools.getByRole("listitem").filter({ hasText: "Recherches d'offres" }).first()).toContainText("0 sur 7 cette semaine");
    // Between the summary and the Plans.
    const order = await page.locator(".subscription > *").evaluateAll((children) => children.map((child) => child.className));
    expect(order.indexOf("ds-card consumption")).toBe(order.indexOf("subscription-summary") + 1);
    await expectNoAxeViolations(page);
  });

  test("a Free Candidate sees the calendar month, not billed, and its count", async ({ page }) => {
    const email = newAddress("consommation-free");
    await signInWithMagicLink(page, email);
    await seed(email, [[parisDay(0), "coach", 4]]);
    await page.goto("/abonnement");

    const card = section(page);
    const month = dated(parisDay(0), { month: "long" });
    await expect(card.getByText(c.periodFree.replace("{{month}}", /^[aeiouyàâéèêh]/i.test(month) ? `d'${month}` : `de ${month}`))).toBeVisible();
    await expect(card.locator(".consumption-total")).toHaveText("4 actions IA");
    await expect(card.getByText(c.monthEnd)).toBeVisible();
    await expect(card.getByRole("list", { name: c.byToolMonth }).getByRole("listitem").filter({ hasText: "Coach IA" }).first()).toContainText("4 réponses");
    await expectNoAxeViolations(page);
  });

  test("the switch, the days and the table work with the keyboard; the choice is remembered", async ({ page }) => {
    await standardCandidate(page, "consommation-clavier");
    await page.goto("/abonnement");
    const card = section(page);

    const grid = card.getByRole("radio", { name: c.grid });
    await expect(grid).toHaveAttribute("aria-checked", "true");
    await grid.focus();
    // From the switch, Tab reaches the grid's one stop: today.
    await page.keyboard.press("Tab");
    await expect(cell(page, parisDay(0))).toBeFocused();
    await expect(page.getByRole("tooltip")).toContainText("Coach IA : 5");
    await page.keyboard.press("ArrowLeft");
    await expect(cell(page, parisDay(-1))).toBeFocused();
    await expect(page.getByRole("tooltip")).toContainText("Match Score : 3");
    await expect(page.getByRole("tooltip")).toContainText(c.inPeriod);

    // « Voir en tableau »: the same figures as a table.
    await page.keyboard.press("Tab");
    await expect(card.getByRole("button", { name: c.showTable })).toBeFocused();
    await page.keyboard.press("Enter");
    const table = card.getByRole("table", { name: c.tableYear });
    await expect(table.getByRole("row")).toHaveCount(4);
    await expect(table.getByRole("row").last()).toContainText("5");

    // The switch: the arrow keys choose « Barres », remembered on the next visit.
    await grid.focus();
    await page.keyboard.press("ArrowRight");
    await expect(card.getByRole("radio", { name: c.bars })).toHaveAttribute("aria-checked", "true");
    await expect(card.getByRole("heading", { name: c.dailyPeriod })).toBeVisible();
    await expect(card.locator("[data-bar]")).toHaveCount(31);
    await expectNoAxeViolations(page);
    await page.reload();
    await expect(section(page).getByRole("radio", { name: c.bars })).toHaveAttribute("aria-checked", "true");
    await section(page).getByRole("radio", { name: c.grid }).click();
  });

  test("/abonnement#consommation, the Activité's link, scrolls to the Card and gives it the focus", async ({ page }) => {
    await standardCandidate(page, "consommation-ancre");
    await page.goto("/abonnement#consommation");
    const card = page.locator("#consommation");
    await expect(card).toBeFocused();
    await expect(card).toBeInViewport();
    await expect(page.locator("#consommation-title")).toHaveText(c.title);
    expect(await card.getAttribute("aria-labelledby")).toBe("consommation-title");
  });

  test("at 200 % text size (a 640px-wide window) and at phone width, the page never scrolls sideways; the grid scrolls in its own frame, on the latest weeks", async ({ page }) => {
    await standardCandidate(page, "consommation-largeur");
    for (const [width, textSize] of [
      [640, "xlarge"],
      [390, "standard"],
    ] as const) {
      await page.setViewportSize({ width, height: 800 });
      await page.evaluate((size) => localStorage.setItem("jobbbox.textSize", size), textSize);
      await page.goto("/abonnement");
      await expect(section(page)).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${width} px, ${textSize} text`).toBe(true);
      const frame = page.locator(".consumption-grid-scroll");
      const scrolled = await frame.evaluate((element) => ({ scrolls: element.scrollWidth > element.clientWidth, atEnd: element.scrollLeft + element.clientWidth >= element.scrollWidth - 1 }));
      expect(scrolled, `${width} px`).toEqual({ scrolls: true, atEnd: true });
      // Today's day is within the frame, not scrolled out of it.
      const [box, today] = [await frame.boundingBox(), await cell(page, parisDay(0)).boundingBox()];
      expect(today!.x >= box!.x && today!.x + today!.width <= box!.x + box!.width, `${width} px: today in view`).toBe(true);
    }
    await page.evaluate(() => localStorage.setItem("jobbbox.textSize", "standard"));
  });
});
