import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #368: in AI Activity's « Par élément », a stored element whose action was stopped or failed says so in words and
// sits on light red, after a reload as the next day: here a Job Search the Candidate stopped, which kept the Job Offers it
// had found (#331). Its row is stored as the worker leaves it; driven through the built web app.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;

const masterCv = {
  fullName: "Marie Dupont",
  headline: "Directrice financière",
  email: "marie.dupont@example.fr",
  phone: "",
  location: "Lyon",
  summary: "J'ai piloté la trésorerie d'un groupe coté.",
  experience: [{ title: "Directrice financière", employer: "Groupe Seb", location: "Lyon", period: "2015 – 2024", description: "Budget et consolidation." }],
  education: [],
  skills: ["IFRS", "Consolidation"],
  languages: [],
};

/** A Job Search the Candidate stopped today, during a page read, after a web search and one page read: 4 minutes long. */
function stoppedRun(startedAt: Date) {
  const at = (seconds: number) => new Date(startedAt.getTime() + seconds * 1000).toISOString();
  return {
    v: 1,
    steps: [
      { kind: "ai", activity: "web_search", task: "web_search", provider: "perplexity", endpoint: "api.perplexity.ai", model: "sonar", tokens: { input: 300, output: 800 }, ms: 4100, at: at(0), outcome: "ok", count: 1 },
      { kind: "tool", activity: "read", tool: "job-site", ms: 900, at: at(5), outcome: "ok", count: 1 },
      { kind: "tool", activity: "read", tool: "job-site", ms: 400, at: at(239), outcome: "stopped", count: 1 },
    ],
    sites: [{ kind: "web", domain: "welcometothejungle.com", links: ["https://www.welcometothejungle.com/fr/companies/seb/jobs/daf-lyon"] }],
    startedAt: at(0),
    wallMs: 4 * 60 * 1000,
  };
}

async function query<T = Record<string, unknown>>(sql: string, values: unknown[] = []): Promise<T[]> {
  const db = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL });
  await db.connect();
  try {
    return (await db.query(sql, values)).rows as T[];
  } finally {
    await db.end();
  }
}

const aiActivityButton = (page: Page) => page.getByRole("banner").getByRole("button", { name: new RegExp(`^${fr.aiActivity.label}`) });
const paneOf = (page: Page) => page.getByRole("complementary", { name: fr.aiActivity.label });

test.describe("AI Activity: stopped or failed elements in « Par élément » (#368)", () => {
  test("a stopped Job Search with kept Job Offers shows its element stopped, in words and light red, after a reload", async ({ page }) => {
    const email = newAddress("ai-activity-ended");
    await signInWithMagicLink(page, email);
    const [candidate] = await query<{ id: string }>(`SELECT id FROM candidate WHERE email = $1`, [email]);
    const created = await page.request.post("/api/profiles", { headers: { origin }, data: { masterCv, searchCriteria: { targetRole: "Directrice financière", locations: ["Lyon"] } } });
    expect(created.status()).toBe(201);
    const profileId: string = (await created.json()).id;
    const [offer] = await query<{ id: string }>(
      `INSERT INTO job_offer (content_fingerprint, title, content, employer) VALUES ($1, 'DAF Lyon', 'Vous pilotez la finance du groupe.', 'Groupe Seb') RETURNING id`,
      [`ai-activity-ended-${Math.random()}`],
    );
    const startedAt = new Date(Date.now() - 5 * 60 * 1000);
    const [search] = await query<{ id: string }>(
      `INSERT INTO job_search (candidate_id, profile_id, status, job_offer_ids, started_at, finished_at, provenance)
       VALUES ($1, $2, 'stopped', $3, $4, $5, $6) RETURNING id`,
      [candidate!.id, profileId, [offer!.id], startedAt, new Date(startedAt.getTime() + 4 * 60 * 1000), JSON.stringify(stoppedRun(startedAt))],
    );
    const endedAt = await page.evaluate(
      (ms) => new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms)),
      startedAt.getTime() + 4 * 60 * 1000,
    );

    await page.goto(`/recherches/${search!.id}`);
    await page.reload();
    await aiActivityButton(page).click();
    const pane = paneOf(page);
    await expect(pane.getByRole("heading", { name: fr.aiActivity.title })).toBeVisible();

    // Its element says it stopped, and when, on light red like a stopped live action.
    const stopped = pane.locator(".ai-activity-element").filter({ hasText: fr.aiActivity.kinds.job_search });
    await expect(stopped).toContainText(fr.aiActivity.ended.stopped.replace("{{time}}", endedAt));
    await expect(stopped).toHaveAttribute("data-end", "stopped");
    const surface = await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.style.background = "var(--color-danger-surface)";
      document.body.append(probe);
      const color = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return color;
    });
    expect(await stopped.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(surface);

    // The Job Offer it kept is done; the Total still counts what the stopped search spent.
    const kept = pane.locator(".ai-activity-element").filter({ hasText: "DAF Lyon" });
    await expect(kept).not.toHaveAttribute("data-end", /.*/);
    await expect(pane.locator(".ai-activity-total")).toContainText("1,1k tokens");
    await expect(aiActivityButton(page)).toHaveAttribute("aria-expanded", "true");

    const results = await new AxeBuilder({ page }).include("aside.ai-activity-pane").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map((node) => node.target.join(" ")) }))).toEqual([]);
  });

  test("a failed Job Search shows its element failed, with its Failure Reason, though it kept no Provenance", async ({ page }) => {
    const email = newAddress("ai-activity-failed");
    await signInWithMagicLink(page, email);
    const [candidate] = await query<{ id: string }>(`SELECT id FROM candidate WHERE email = $1`, [email]);
    const created = await page.request.post("/api/profiles", { headers: { origin }, data: { masterCv, searchCriteria: { targetRole: "Directrice financière", locations: ["Lyon"] } } });
    const profileId: string = (await created.json()).id;
    const [search] = await query<{ id: string }>(
      `INSERT INTO job_search (candidate_id, profile_id, status, failure, started_at, finished_at) VALUES ($1, $2, 'failed', 'discovery_failed', now() - interval '5 minutes', now()) RETURNING id`,
      [candidate!.id, profileId],
    );

    await page.goto(`/recherches/${search!.id}`);
    await aiActivityButton(page).click();
    const failed = paneOf(page).locator(".ai-activity-element").filter({ hasText: fr.aiActivity.kinds.job_search });
    await expect(failed).toHaveAttribute("data-end", "failed");
    await expect(failed).toContainText(fr.aiActivity.ended.failedUndated);
    await expect(failed).toContainText(fr.jobSearch.failureReasons.discovery_failed);
  });
});
