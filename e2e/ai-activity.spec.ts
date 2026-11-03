import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import pg from "pg";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";
import { activityButtonOf, activityOf, openActivity } from "./support/conversation";
import { EXIT_LINK_REL } from "./support/exit-page";

// Issue #332: AI Activity, read from each element's stored Provenance: the page's content and the AI Coach replies about
// its object, which « Activité » in the Candidate's Top Bar shows (#603, #607, #608). The AI is
// faked inside the server (fake-mistral.mjs): every Coach reply runs on Mistral Large (api.eu.mistral.ai, in the EU).
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

/** AI Activity on a page with no conversation, the Job Offer's (#607, #608): « Activité » opens its column beside the page. */
const paneOf = (page: Page) => activityOf(page);

/** An AI Coach reply about the Job Offer `jobOfferId`, its Focus (#600): what the Coach Panel once sent from its page. */
async function askTheCoachAbout(page: Page, jobOfferId: string, message: string) {
  const sent = await page.request.post("/api/coach", { headers: { origin: process.env.E2E_WEB_ORIGIN! }, data: { message, focus: { kind: "job_offer", id: jobOfferId } } });
  expect(sent.status(), await sent.text()).toBe(200);
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

// Since #603, #607 and #608 the Top Bar's « Activité IA » button and its « Cette page » pane gave way to « Activité »: an
// object's Fiche shows the page's AI Activity in its Activity group, the other pages' Activité column beside the page.
test.describe("AI Activity (#332)", () => {
  test("`/offres/[id]` and a Coach reply about it show in « Activité », with each model's sums, the Tools and the wall-clock total", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("ai-activity-offer"));
    const offerId = await storedJobOffer("DAF Lyon");
    await page.goto(`/offres/${offerId}`);

    // Closed at rest: « Activité » in the Top Bar opens the column, beside the page.
    const button = activityButtonOf(page);
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(paneOf(page)).toHaveCount(0);
    await expectNoAxeViolations(page, "header.topbar");
    const pane = await openActivity(page);
    const models = pane.locator(".ai-activity-section").first();
    await expect(models).toContainText("Perplexity");
    await expect(models).toContainText("Claude Haiku 4.5");
    await expect(models).toContainText("AWS Bedrock · UE (Stockholm)");
    await expect(models).toContainText(fr.aiActivity.measure);
    await expect(pane.locator(".ai-activity-total")).toContainText(/Total\s*\d+(,\d)?k tokens · \d+(,\d)? s/);
    await expect(pane).toContainText("Sites d'emploi");
    await expect(pane).toContainText("DAF Lyon");
    await expect(pane.locator(".ai-activity-element")).toHaveCount(1);
    await expectNothingInternal(pane);
    await expectNoAxeViolations(page, ".activity-column");

    // A Coach reply about the offer counts with the page, once, as the server read it.
    await askTheCoachAbout(page, offerId, "Que pensez-vous de cette offre ?");
    await page.reload();
    await openActivity(page);
    await expect(models).toContainText("Mistral Large");
    await expect(pane).toContainText(fr.aiActivity.kinds.coach_reply);
    await expect(pane.locator(".ai-activity-element")).toHaveCount(2);
    await expectNothingInternal(pane);

    // « Activité » closes it again.
    await button.click();
    await expect(paneOf(page)).toHaveCount(0);
    await expect(button).toHaveAttribute("aria-expanded", "false");
  });

  test("works from the keyboard: the button, the sections and the Sources disclosures", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("ai-activity-keyboard"));
    await page.goto(`/offres/${await storedJobOffer("DAF Lyon")}`);
    const button = activityButtonOf(page);

    await button.focus();
    await page.keyboard.press("Enter");
    const pane = paneOf(page);
    await expect(button).toHaveAttribute("aria-expanded", "true");

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
    await expect(link).toHaveAttribute("rel", EXIT_LINK_REL);
    await expectNoAxeViolations(page, ".activity-column");

    // « Activité » closes the column, from the keyboard too.
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(pane).toHaveCount(0);
    await expect(button).toBeFocused();
    await expect(button).toHaveAttribute("aria-expanded", "false");
  });

  test("a page with no AI content: « Activité » says so", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("ai-activity-none"));
    await page.goto("/candidatures");
    await expect(activityButtonOf(page)).toHaveAttribute("aria-expanded", "false");
    const pane = await openActivity(page);
    await expect(pane).toContainText(fr.aiActivity.noAi);
    await expectNoAxeViolations(page, ".activity-column");
  });

  test("on a laptop's screen (1200px) the column opens beside the page, never over it", async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    await signInWithMagicLink(page, newAddress("ai-activity-beside"));
    await page.goto(`/offres/${await storedJobOffer("DAF Lyon")}`);
    const pane = await openActivity(page);
    const [column, main, topbar] = [(await pane.boundingBox())!, (await page.locator("main").boundingBox())!, (await page.getByRole("banner").boundingBox())!];
    expect(column.x).toBeGreaterThanOrEqual(main.x + main.width - 1);
    expect(column.y).toBeGreaterThanOrEqual(topbar.y + topbar.height - 1);
    expect(column.x + column.width).toBeLessThanOrEqual(1200);
    // Beside it, no heading nor ✕ of its own: « Activité » closes it.
    await expect(pane.getByRole("button", { name: fr.conversationFirst.close })).toHaveCount(0);
  });

  test("on a phone: the column over the whole screen, with its visible title and a labelled Close", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 740 });
    await signInWithMagicLink(page, newAddress("ai-activity-phone"));
    await page.goto(`/offres/${await storedJobOffer("DAF Lyon")}`);
    const button = activityButtonOf(page);

    await button.click();
    const pane = paneOf(page);
    await expect(pane.getByRole("heading", { level: 2, name: fr.fiche.activity })).toBeFocused();
    const sheet = (await pane.boundingBox())!;
    expect(sheet.x).toBe(0);
    expect(sheet.width).toBe(375);
    expect(sheet.y + sheet.height).toBeCloseTo(740, 0);
    await expect(pane).toContainText("DAF Lyon");
    await expectNoAxeViolations(page, ".activity-column");
    await pane.getByRole("button", { name: fr.conversationFirst.close }).click();
    await expect(pane).toHaveCount(0);
    await expect(button).toBeFocused();
  });

  test("at 200 % text size (a 640px-wide window), the column's words stay whole, with no scrolling sideways", async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 450 });
    await signInWithMagicLink(page, newAddress("ai-activity-zoom"));
    await page.evaluate(() => localStorage.setItem("jobbbox.textSize", "xlarge"));
    await page.goto(`/offres/${await storedJobOffer("Directeur administratif et financier du groupe H/F")}`);
    await activityButtonOf(page).click();

    const pane = paneOf(page);
    await expect(pane.getByRole("heading", { level: 2, name: fr.fiche.activity })).toBeVisible();
    expect(await pane.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    // Its last element is reached by scrolling the column.
    const last = pane.locator(".ai-activity-element").last();
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
    await expect(pane.getByRole("button", { name: fr.conversationFirst.close })).toBeInViewport();
  });

  test("no token count appears in the Usage Meter or on /abonnement", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("ai-activity-quotas"));
    await askTheCoachAbout(page, await storedJobOffer("DAF Lyon"), "Que pensez-vous de cette offre ?");

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
    await expect(page.getByRole("banner").getByRole("button", { name: fr.fiche.activity, exact: true })).toHaveCount(0);
    await expect(page.locator(".ai-activity-pane, .activity-column")).toHaveCount(0);
  });
});
