import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import pg from "pg";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";
import { activityButtonOf, activityOf, openActivity } from "./support/conversation";
import { EXIT_LINK_REL } from "./support/exit-page";

// Issue #332: AI Activity, read from each element's stored Provenance: the page's content and the AI Coach replies about
// its object, which « Activité » in the Candidate's Top Bar shows (#603, #607, #608), as its history's entries since #808. The AI is
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
const history = fr.aiActivity.history;
const tr = (template: string, values: Record<string, string>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");
/** The history's rows (#808): one button each, unfolding its detail. */
const rowsOf = (pane: Locator) => pane.locator(".activity-entry-row");
const detailOf = async (page: Page, row: Locator) => page.locator(`[id="${await row.getAttribute("aria-controls")}"]`);

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

// Since #603, #607 and #608 the page's AI Activity is in an object's Fiche, in its Activity group, and the other pages'
// Activité column beside the page; since #809 AI Activity's button, « Activité » in the Top Bar, opens it, and its own
// « Cette page » pane is gone.
test.describe("AI Activity (#332)", () => {
  test("`/offres/[id]` and a Coach reply about it show in « Activité »'s history, each with its models, Tools and cost, never in euros (#808)", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("ai-activity-offer"));
    const offerId = await storedJobOffer("DAF Lyon");
    await page.goto(`/offres/${offerId}`);

    // Closed at rest: « Activité » in the Top Bar opens the column, beside the page.
    const button = activityButtonOf(page);
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(paneOf(page)).toHaveCount(0);
    await expectNoAxeViolations(page, "header.topbar");
    const pane = await openActivity(page);
    // The former blocks are gone: one history, its rows folded.
    for (const gone of ["Modèles", "Sources", "Outils", "Par élément"]) await expect(pane.getByRole("button", { name: gone, exact: true })).toHaveCount(0);
    const offer = rowsOf(pane).filter({ hasText: "DAF Lyon" });
    await expect(rowsOf(pane)).toHaveCount(1);
    await expect(offer).toContainText(`${fr.aiActivity.kinds.job_offer} · DAF Lyon`);
    await expect(offer).toContainText(/[\d,]+k jetons/);
    await expect(offer).toHaveAttribute("aria-expanded", "false");
    await offer.click();
    const detail = await detailOf(page, offer);
    await expect(detail).toContainText("Perplexity");
    await expect(detail).toContainText("Claude Haiku 4.5");
    await expect(detail).toContainText("AWS Bedrock · UE (Stockholm)");
    await expect(detail).toContainText("Sites d'emploi");
    await expect(detail.getByRole("link", { name: history.cost.consumption })).toHaveAttribute("href", "/abonnement#consommation");
    await expectNothingInternal(pane);
    await expectNoAxeViolations(page, ".activity-column");

    // A Coach reply about the offer is an entry of the page, once, as the server read it.
    await askTheCoachAbout(page, offerId, "Que pensez-vous de cette offre ?");
    await page.reload();
    await openActivity(page);
    await expect(rowsOf(pane)).toHaveCount(2);
    const reply = rowsOf(pane).filter({ hasText: fr.aiActivity.kinds.coach_reply });
    await expect(reply).toContainText(/\d+ appels? · [\d,]+k? jetons envoyés/);
    await reply.click();
    await expect(await detailOf(page, reply)).toContainText("Mistral Large");
    await expect(await detailOf(page, reply)).toContainText(tr(history.you, { question: "Que pensez-vous de cette offre ?" }));
    await expectNothingInternal(pane);

    // « Activité » closes it again.
    await button.click();
    await expect(paneOf(page)).toHaveCount(0);
    await expect(button).toHaveAttribute("aria-expanded", "false");
  });

  test("a reply saved before #791 says « dernier appel seulement » (#808)", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("ai-activity-before-791"));
    const offerId = await storedJobOffer("DAF Lyon");
    await askTheCoachAbout(page, offerId, "Que pensez-vous de cette offre ?");
    // As saved before #791: no AI call kept with it, its Provenance its last call only.
    await query("UPDATE coach_message SET ai_call_ids = NULL, ai_turn_ids = NULL WHERE author = 'coach' AND focus_id = $1", [offerId]);

    await page.goto(`/offres/${offerId}`);
    const pane = await openActivity(page);
    const reply = rowsOf(pane).filter({ hasText: fr.aiActivity.kinds.coach_reply });
    await expect(reply).toContainText(history.cost.partial);
    await expect(reply).not.toContainText(/appels? ·/);
    await reply.click();
    await expect(await detailOf(page, reply)).toContainText(new RegExp(`[\\d,]+k? jetons · ${history.cost.partial}`));
  });

  test("works from the keyboard: a row unfolds its detail, « Sources et outils de cette page » and a site's pages", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("ai-activity-keyboard"));
    await page.goto(`/offres/${await storedJobOffer("DAF Lyon")}`);
    const button = activityButtonOf(page);

    await button.focus();
    await page.keyboard.press("Enter");
    const pane = paneOf(page);
    await expect(button).toHaveAttribute("aria-expanded", "true");

    // A row is a button that unfolds its detail.
    const row = rowsOf(pane).first();
    await expect(row).toHaveAttribute("aria-expanded", "false");
    await row.focus();
    await page.keyboard.press("Enter");
    await expect(row).toHaveAttribute("aria-expanded", "true");
    await expect(await detailOf(page, row)).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(row).toHaveAttribute("aria-expanded", "false");
    await expect(await detailOf(page, row)).toBeHidden();

    // « Sources et outils de cette page », folded at the foot: each site once, its pages in a new tab without a referrer.
    const sources = pane.getByRole("button", { name: history.sources });
    await expect(sources).toHaveAttribute("aria-expanded", "false");
    await sources.focus();
    await page.keyboard.press("Enter");
    await expect(sources).toHaveAttribute("aria-expanded", "true");
    const site = pane.getByRole("button", { name: /welcometothejungle\.com/ });
    await expect(site).toHaveCount(1);
    await expect(site).toHaveAttribute("aria-expanded", "false");
    await site.focus();
    await page.keyboard.press("Enter");
    await expect(site).toHaveAttribute("aria-expanded", "true");
    const link = pane.getByRole("link", { name: /welcometothejungle\.com\/fr\/companies\/seb\/jobs\/daf-lyon/ });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", EXIT_LINK_REL);
    await expect(pane).toContainText("Sites d'emploi");
    await expectNoAxeViolations(page, ".activity-column");

    // « Activité » closes the column, from the keyboard too.
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(pane).toHaveCount(0);
    await expect(button).toBeFocused();
    await expect(button).toHaveAttribute("aria-expanded", "false");
  });

  test("AI Activity's button opens Activity and closes it, Escape closes it with the focus back on the button, its name « Activité IA » and its words (#809)", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("ai-activity-button"));
    await page.goto(`/offres/${await storedJobOffer("DAF Lyon")}`);
    const button = activityButtonOf(page);
    // The page's summary, left of its frame: Perplexity and Claude Haiku 4.5, 7,8k tokens.
    const words = tr(fr.aiActivity.models_other, { count: "2" }) + " · " + tr(fr.aiActivity.tokens, { tokens: "7,8k" });

    // Closed: « Activité » on its frame, its words beside it, and in its name.
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(button).toHaveText(fr.fiche.activity);
    await expect(button).toHaveAttribute("title", fr.aiActivity.label);
    await expect(page.getByRole("banner").getByText(words, { exact: true })).toBeVisible();
    await expect(button).toHaveAccessibleName(`${fr.aiActivity.label} ${words}`);
    await expect(page.getByRole("banner").getByRole("button", { name: fr.fiche.activity, exact: true })).toHaveCount(0);

    // It opens Activity, the Activité column beside the page; shown, Activity says it all: its name is « Activité IA ».
    await button.click();
    await expect(paneOf(page)).toBeVisible();
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await expect(button).toHaveAccessibleName(fr.aiActivity.label);
    await expect(rowsOf(paneOf(page))).toHaveCount(1);

    // Then closes it.
    await button.click();
    await expect(paneOf(page)).toHaveCount(0);
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(button).toHaveAccessibleName(`${fr.aiActivity.label} ${words}`);

    // Escape closes it, the focus back on the button.
    await button.click();
    await expect(paneOf(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(paneOf(page)).toHaveCount(0);
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(button).toBeFocused();

    // Its words are no control of their own: clicking them opens Activity, the focus on the button.
    await page.getByRole("banner").getByText(words, { exact: true }).click();
    await expect(paneOf(page)).toBeVisible();
    await expect(button).toBeFocused();
    await expectNoAxeViolations(page, "header.topbar");
  });

  test("on a phone, AI Activity's button opens Activity full screen with « Fermer », and Escape gives the focus back to the button (#809, ADR-0070)", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 740 });
    await signInWithMagicLink(page, newAddress("ai-activity-button-phone"));
    await page.goto(`/offres/${await storedJobOffer("DAF Lyon")}`);
    const button = activityButtonOf(page);

    await button.click();
    const pane = paneOf(page);
    await expect(pane.getByRole("heading", { level: 2, name: fr.fiche.activity })).toBeFocused();
    const sheet = (await pane.boundingBox())!;
    expect([sheet.x, sheet.width]).toEqual([0, 375]);
    await expect(pane.getByRole("button", { name: fr.conversationFirst.close })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(pane).toHaveCount(0);
    await expect(button).toBeFocused();
    await expect(button).toHaveAttribute("aria-expanded", "false");
  });

  test("a page with no AI content: « Activité » says so", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("ai-activity-none"));
    await page.goto("/candidatures");
    await expect(activityButtonOf(page)).toHaveAttribute("aria-expanded", "false");
    const pane = await openActivity(page);
    await expect(pane).toContainText(history.empty);
    // « En savoir plus » leads to « IA dans Jobbbox », the privacy policy's section (#338).
    await expect(pane.getByRole("link", { name: fr.aiActivity.learnMoreLabel })).toHaveAttribute("href", "/legal/confidentialite#ia");
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
    // Its last entry is reached by scrolling the column.
    const last = pane.locator(".activity-entry").last();
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
    await expect(page.getByRole("banner").getByRole("button", { name: fr.fiche.activity })).toHaveCount(0);
    await expect(page.locator(".ai-activity-control, .activity-column")).toHaveCount(0);
  });
});

// #936: « Activité »'s glyph in the Top Bar is the very glyph « En ce moment » draws for the action under way (glyphNow),
// live, morphing from one step into the next, on a wider screen as in the compact Top Bar of a phone (#897). A Job Search
// searching is stored for the Candidate, its Run progress written here moment by moment, which the page's poll reads
// (ADR-0034): each moment of a run is shown for sure, between two steps above all, when the poll finds them all ended.
test.describe("« Activité »'s live glyph follows the step under way (#936, #333, ADR-0034)", () => {
  const at = "2026-11-09T09:00:00.000Z";
  const started = (id: number, activity: string) => ({ type: "step_started", id, step: { kind: "tool", activity, tool: "job-site", at } });
  const ended = (id: number, activity: string) => ({ type: "step_ended", id, step: { kind: "tool", activity, tool: "job-site", ms: 900, at, outcome: "ok", count: 2 } });
  /** A Job Search's run, moment by moment: its Run progress, and the glyph it must draw. */
  const RUN = [
    { moment: "a web search under way", progress: [started(1, "web_search")], glyph: "web_search" },
    { moment: "between two steps: the web search's globe, not the brain of before the first step", progress: [ended(1, "web_search")], glyph: "web_search" },
    { moment: "a page read", progress: [ended(1, "web_search"), started(2, "read")], glyph: "read" },
    { moment: "another page read, the same Activity", progress: [ended(1, "web_search"), ended(2, "read"), started(3, "read")], glyph: "read" },
  ];

  /** A Job Search searching for a new Profile of the Candidate signed in as `email`, with its Run progress; its id. */
  async function searching(email: string, progress: unknown[]): Promise<string> {
    const [candidate] = await query<{ id: string }>("SELECT id FROM candidate WHERE lower(email) = lower($1)", [email]);
    const [profile] = await query<{ id: string }>("INSERT INTO profile (candidate_id, name, target_role, locations) VALUES ($1, 'HEAD OF BU', 'Head of BU', ARRAY['Lyon']) RETURNING id", [candidate!.id]);
    const [search] = await query<{ id: string }>("INSERT INTO job_search (candidate_id, profile_id, status, started_at, progress) VALUES ($1, $2, 'searching', now(), $3) RETURNING id", [
      candidate!.id,
      profile!.id,
      JSON.stringify(progress),
    ]);
    return search!.id;
  }
  const progressed = (jobSearchId: string, progress: unknown[]) => query("UPDATE job_search SET progress = $2 WHERE id = $1", [jobSearchId, JSON.stringify(progress)]);

  /** « Activité »'s live glyph in the Top Bar: the button's, or on a phone the compact Top Bar's. */
  const buttonGlyphOf = (page: Page, compact: boolean) =>
    page.locator(compact ? "header .topbar-compact-actions:not(.topbar-first-paint) .activity-glyph" : "header .topbar-activity .activity-glyph");
  /** The glyph of « En ce moment »'s action under way. */
  const nowGlyphOf = (page: Page) => paneOf(page).locator('.en-ce-moment-action[data-status="running"] > .activity-glyph');

  async function expectTheButtonFollowsTheRun(page: Page, email: string, compact: boolean) {
    await signInWithMagicLink(page, email);
    const jobSearchId = await searching(email, []);
    await page.goto("/candidatures");

    const glyph = buttonGlyphOf(page, compact);
    // Before its first step: the brain.
    await expect(glyph).toHaveAttribute("data-activity", "think", { timeout: 10_000 });
    await expect(glyph).toHaveAttribute("data-live", "true");
    await openActivity(page);
    // One glyph from start to end: each step morphs out of the one before, it is not drawn anew.
    await glyph.evaluate((svg) => ((window as unknown as { glyph936: Element }).glyph936 = svg));

    for (const { moment, progress, glyph: activity } of RUN) {
      await progressed(jobSearchId, progress);
      // The poll brought this moment: « En ce moment » has its glyph and its steps finished.
      const finished = progress.filter((event) => event.type === "step_ended").length;
      await expect(nowGlyphOf(page), moment).toHaveAttribute("data-activity", activity, { timeout: 10_000 });
      await expect(paneOf(page).locator(".en-ce-moment-action .ai-activity-meta"), moment).toHaveText(new RegExp(`^${finished} `), { timeout: 10_000 });
      // The button, at that very moment: the same glyph, live.
      expect(await glyph.getAttribute("data-activity"), moment).toBe(activity);
      expect(await glyph.getAttribute("data-live"), moment).toBe("true");
      // It moves: its strokes are drawn from JavaScript, each with its opacity (ActivityGlyph).
      await expect(glyph.locator("path[opacity]").first(), moment).toBeAttached();
      expect(await glyph.evaluate((svg) => svg === (window as unknown as { glyph936: Element }).glyph936), moment).toBe(true);
    }

    // Nothing runs any more: the tasks icon, still.
    await query("DELETE FROM job_search WHERE id = $1", [jobSearchId]);
    await expect(glyph).toHaveCount(0, { timeout: 10_000 });
  }

  test("at 1280px, the button's glyph is « En ce moment »'s, between two steps too, live and morphing", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await expectTheButtonFollowsTheRun(page, newAddress("ai-activity-glyph-wide"), false);
  });

  test("at 390px, the compact Top Bar's « Activité » is « En ce moment »'s glyph, between two steps too, live and morphing (#897)", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await expectTheButtonFollowsTheRun(page, newAddress("ai-activity-glyph-phone"), true);
  });

  test("under reduced motion, the button's glyph is the step's, still", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const email = newAddress("ai-activity-glyph-still");
    await signInWithMagicLink(page, email);
    await searching(email, [ended(1, "web_search")]);
    await page.goto("/candidatures");
    const glyph = buttonGlyphOf(page, false);
    await expect(glyph).toHaveAttribute("data-activity", "web_search", { timeout: 10_000 });
    await page.waitForTimeout(500);
    expect(await glyph.evaluate((svg) => svg.querySelectorAll("path[opacity], path:not([d])").length)).toBe(0);
  });
});
