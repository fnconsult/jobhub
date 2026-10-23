import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import pg from "pg";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #332: AI Activity, the Candidate's top-bar button left of « Mon coach », and the « Cette page » pane it opens,
// read from each element's stored Provenance: the page's content and the AI Coach replies about its object. The AI is
// faked inside the server (fake-mistral.mjs): every Coach reply runs on Mistral Large (api.mistral.ai, in the EU).
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const SUPER_ADMIN = "ai-activity-office@e2e.jobbbox.test";

/** A Job Offer found by a web search (Perplexity), its page read, then read by Claude Haiku on Bedrock in Stockholm. */
const PROVENANCE = {
  v: 1,
  steps: [
    { kind: "ai", activity: "web_search", task: "web_search", provider: "perplexity", endpoint: "api.perplexity.ai", model: "sonar", tokens: { input: 300, output: 800 }, ms: 4100, at: "2026-10-23T08:00:00.000Z", outcome: "ok", count: 1 },
    { kind: "tool", activity: "read", tool: "job-site", ms: 900, at: "2026-10-23T08:00:05.000Z", outcome: "ok", count: 1 },
    { kind: "ai", activity: "read", task: "offer_analysis", provider: "anthropic", endpoint: "bedrock eu-north-1", model: "anthropic.claude-haiku-4-5", tokens: { input: 6000, output: 700 }, ms: 3900, at: "2026-10-23T08:00:06.000Z", outcome: "ok", count: 1 },
  ],
  sites: [{ kind: "web", domain: "welcometothejungle.com", links: ["https://www.welcometothejungle.com/fr/companies/seb/jobs/daf-lyon"] }],
  startedAt: "2026-10-23T08:00:00.000Z",
  wallMs: 9100,
};

async function query<T = Record<string, unknown>>(sql: string, values: unknown[] = []): Promise<T[]> {
  const db = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL });
  await db.connect();
  try {
    return (await db.query(sql, values)).rows as T[];
  } finally {
    await db.end();
  }
}

/** A Job Offer stored with its Provenance, as Job discovery keeps it; its id. */
async function storedJobOffer(title: string): Promise<string> {
  const [row] = await query<{ id: string }>(
    `INSERT INTO job_offer (content_fingerprint, title, content, employer, provenance) VALUES ($1, $2, 'Vous pilotez la finance du groupe.', 'Groupe Seb', $3) RETURNING id`,
    [`ai-activity-${Math.random()}`, title, JSON.stringify(PROVENANCE)],
  );
  return row!.id;
}

const aiActivityButton = (page: Page) => page.getByRole("banner").getByRole("button", { name: new RegExp(`^${fr.aiActivity.label}`) });
const paneOf = (page: Page) => page.getByRole("complementary", { name: fr.aiActivity.label });
const coachPanelOf = (page: Page) => page.getByRole("complementary", { name: fr.coachPanel.title });

async function askTheCoach(page: Page, message: string) {
  await page.getByRole("button", { name: fr.coachPanel.open, exact: true }).click();
  const panel = coachPanelOf(page);
  const replies = panel.getByRole("list", { name: fr.coachPanel.messagesLabel }).getByRole("listitem");
  const before = await replies.count();
  await panel.getByLabel(fr.coachPanel.messageLabel).fill(message);
  await panel.getByRole("button", { name: fr.coachPanel.send }).click();
  await expect(replies).toHaveCount(before + 2, { timeout: 30_000 });
}

async function expectNoAxeViolations(page: Page, selector: string) {
  const results = await new AxeBuilder({ page }).include(selector).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map((node) => node.target.join(" ")) }))).toEqual([]);
}

/** Nothing the Candidate must never see: cost, prompt, AI task, Playbook Agent, Back Office setting, internal id or technical error. */
async function expectNothingInternal(region: Locator) {
  const shown = await region.innerText();
  expect(shown).not.toMatch(/€|\beur\b|co[uû]t|prompt|playbook|coaching|offer_analysis|web_search|guardrail|[0-9a-f]{8}-[0-9a-f]{4}-|error|erreur/i);
}

test.describe("AI Activity (#332)", () => {
  test("`/offres/[id]` and a Coach reply about it show in the pane, with each model's sums, the Tools and the wall-clock total", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("ai-activity-offer"));
    const offerId = await storedJobOffer("DAF Lyon");
    await page.goto(`/offres/${offerId}`);

    // At rest: the tasks icon and the page's summary, left of « Mon coach », as high.
    const button = aiActivityButton(page);
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(button).toContainText("2 modèles · 7,8k tokens · 9,1 s");
    const coachButton = page.getByRole("button", { name: fr.coachPanel.open, exact: true });
    const [mine, coach] = [(await button.boundingBox())!, (await coachButton.boundingBox())!];
    expect(mine.x + mine.width).toBeLessThanOrEqual(coach.x);
    expect(mine.height).toBeCloseTo(coach.height, 0);
    const words = button.locator(".ai-activity-summary");
    expect(await words.evaluate((element) => getComputedStyle(element).color)).toBe("rgb(107, 106, 103)");
    expect(await words.evaluate((element) => parseFloat(getComputedStyle(element).fontSize) / parseFloat(getComputedStyle(document.documentElement).fontSize))).toBeGreaterThanOrEqual(0.8125);

    // A Coach reply about the offer counts with the page at once.
    await askTheCoach(page, "Que pensez-vous de cette offre ?");
    await coachPanelOf(page).getByRole("button", { name: fr.coachPanel.close }).click();
    await expect(button).toContainText(/3 modèles · \d+(,\d)?k tokens · \d+(,\d)? s/);

    await button.click();
    const pane = paneOf(page);
    await expect(pane.getByRole("heading", { name: fr.aiActivity.title })).toBeVisible();
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await expect(button).toHaveText(fr.aiActivity.label);
    const models = pane.locator(".ai-activity-section").first();
    await expect(models).toContainText("Perplexity");
    await expect(models).toContainText("Claude Haiku 4.5");
    await expect(models).toContainText("AWS Bedrock · UE (Stockholm)");
    await expect(models).toContainText("Mistral Large");
    await expect(models).toContainText(fr.aiActivity.measure);
    await expect(pane.locator(".ai-activity-total")).toContainText(/Total\s*\d+(,\d)?k tokens · \d+(,\d)? s/);
    await expect(pane).toContainText("Sites d'emploi");
    await expect(pane).toContainText("DAF Lyon");
    await expect(pane).toContainText(fr.aiActivity.kinds.coach_reply);
    await expectNothingInternal(pane);
    await expectNoAxeViolations(page, "aside.ai-activity-pane");

    // Loaded again, the reply comes from the server, counted once.
    await page.reload();
    await expect(button).toContainText("3 modèles · ");
    await button.click();
    await expect(paneOf(page).locator(".ai-activity-element")).toHaveCount(2);
  });

  test("works from the keyboard: the button, the sections, the Sources disclosures and Escape", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("ai-activity-keyboard"));
    await page.goto(`/offres/${await storedJobOffer("DAF Lyon")}`);
    const button = aiActivityButton(page);

    await button.focus();
    await page.keyboard.press("Enter");
    const pane = paneOf(page);
    await expect(pane.getByRole("heading", { name: fr.aiActivity.title })).toBeFocused();

    // Each section folds under its title, a disclosure button.
    const models = pane.getByRole("button", { name: fr.aiActivity.sections.models });
    await expect(models).toHaveAttribute("aria-expanded", "true");
    await models.focus();
    await page.keyboard.press("Enter");
    await expect(models).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(`[id="${await models.getAttribute("aria-controls")}"]`)).toBeHidden();
    await page.keyboard.press("Enter");
    await expect(models).toHaveAttribute("aria-expanded", "true");

    // A Provenance site opens its pages inline, each in a new tab without a referrer.
    const site = pane.getByRole("button", { name: /welcometothejungle\.com/ });
    await expect(site).toHaveAttribute("aria-expanded", "false");
    await site.focus();
    await page.keyboard.press("Enter");
    await expect(site).toHaveAttribute("aria-expanded", "true");
    const link = pane.getByRole("link", { name: /welcometothejungle\.com\/fr\/companies\/seb\/jobs\/daf-lyon/ });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    await expectNoAxeViolations(page, "aside.ai-activity-pane");

    // Escape closes the pane and gives the focus back to the button.
    await page.keyboard.press("Escape");
    await expect(pane).toHaveCount(0);
    await expect(button).toBeFocused();
    await expect(button).toHaveAttribute("aria-expanded", "false");
  });

  test("a page with no AI content: no words on the button, and the pane says so", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("ai-activity-none"));
    await page.goto("/candidatures");
    const button = aiActivityButton(page);
    await expect(button.locator(".ai-activity-summary")).toHaveCount(0);

    await button.click();
    await expect(paneOf(page)).toContainText(fr.aiActivity.noAi);
    await expectNoAxeViolations(page, "aside.ai-activity-pane");
  });

  test("under 1300px with the Coach Panel docked, the pane is a drawer over the page; Escape closes it, focus back on the button", async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    await signInWithMagicLink(page, newAddress("ai-activity-drawer"));
    await page.goto(`/offres/${await storedJobOffer("DAF Lyon")}`);
    await page.getByRole("button", { name: fr.coachPanel.open, exact: true }).click();
    await expect(coachPanelOf(page)).toBeVisible();
    const button = aiActivityButton(page);
    await button.click();

    const pane = paneOf(page);
    expect(await pane.evaluate((element) => getComputedStyle(element).position)).toBe("fixed");
    const [drawer, coach, topbar] = [(await pane.boundingBox())!, (await coachPanelOf(page).boundingBox())!, (await page.getByRole("banner").boundingBox())!];
    // Over the page, under the Top Bar, beside the Coach Panel, within the window.
    expect(drawer.x + drawer.width).toBeLessThanOrEqual(coach.x);
    expect(drawer.y).toBeGreaterThanOrEqual(topbar.y + topbar.height);
    expect(drawer.y + drawer.height).toBeLessThanOrEqual(800);
    await page.keyboard.press("Escape");
    await expect(pane).toHaveCount(0);
    await expect(button).toBeFocused();
  });

  test("on a phone: a short visible label, and a sheet with its visible title and a labelled Close", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 740 });
    await signInWithMagicLink(page, newAddress("ai-activity-phone"));
    await page.goto(`/offres/${await storedJobOffer("DAF Lyon")}`);
    const button = aiActivityButton(page);
    await expect(button.getByText(fr.aiActivity.label, { exact: true })).toBeVisible();
    await expect(button.locator(".ai-activity-summary")).toBeHidden();

    await button.click();
    const pane = paneOf(page);
    await expect(pane.getByRole("heading", { name: fr.aiActivity.title })).toBeVisible();
    const sheet = (await pane.boundingBox())!;
    expect(sheet.x).toBe(0);
    expect(sheet.width).toBe(375);
    expect(sheet.y + sheet.height).toBeCloseTo(740, 0);
    await expectNoAxeViolations(page, "aside.ai-activity-pane");
    await pane.getByRole("button", { name: fr.aiActivity.close }).click();
    await expect(pane).toHaveCount(0);
    await expect(button).toBeFocused();
  });

  test("at 200 % text size (a 640px-wide window), the pane's words stay whole, with no scrolling sideways", async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 450 });
    await signInWithMagicLink(page, newAddress("ai-activity-zoom"));
    await page.evaluate(() => localStorage.setItem("jobbbox.textSize", "xlarge"));
    await page.goto(`/offres/${await storedJobOffer("Directeur administratif et financier du groupe H/F")}`);
    await aiActivityButton(page).click();

    const pane = paneOf(page);
    await expect(pane.getByRole("heading", { name: fr.aiActivity.title })).toBeVisible();
    const body = pane.locator(".ai-activity-body");
    expect(await body.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    // Its last element is reached by scrolling the pane.
    const last = pane.locator(".ai-activity-element").last();
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
    await expect(pane.getByRole("button", { name: fr.aiActivity.close })).toBeInViewport();
  });

  test("no token count appears in the Usage Meter or on /abonnement", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("ai-activity-quotas"));
    await page.goto(`/offres/${await storedJobOffer("DAF Lyon")}`);
    await askTheCoach(page, "Que pensez-vous de cette offre ?");

    await page.goto("/abonnement");
    await expect(page.getByRole("main")).not.toContainText(/tokens?|jetons?/i);
    await page.getByRole("button", { name: new RegExp(fr.usageMeter.title) }).click();
    await expect(page.locator(".sidebar-docked")).not.toContainText(/tokens?|jetons?/i);
  });

  test("is not in the Back Office", async ({ page }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    await page.goto("/admin/journal");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: new RegExp(fr.aiActivity.label) })).toHaveCount(0);
    await expect(page.locator(".ai-activity-pane")).toHaveCount(0);
  });
});
