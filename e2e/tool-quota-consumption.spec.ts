import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import pg from "pg";
import { signInWithMagicLink } from "./support/candidate";

// Issue #1114: Consommation IA and Outils count the Failure Reason `quota_exhausted` (« Quota épuisé chez le fournisseur »)
// as any other, apart from `rate_limited`, for AI calls and for external API calls alike. The calls are recorded as the
// AI layer and the recording fetch record them (their rows), and the Back Office reads them: the public entry point here
// is its two pages, as a super-admin sees them. The states themselves have no page yet (e2e/tool-quota-states.spec.ts).
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const admin = fr.admin;
const SUPER_ADMIN = "quota-office@e2e.jobbbox.test";
const databaseUrl = process.env.E2E_DATABASE_URL!;
const exhausted: string = fr.failureReasons.quota_exhausted;
const rateLimited: string = fr.failureReasons.rate_limited;

const tr = (template: string, values: Record<string, string>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");

async function seed() {
  const database = new pg.Client({ connectionString: databaseUrl });
  await database.connect();
  try {
    // OpenAI's calls: two refused for its credit spent (one with the renewal date it gave), one for its rate.
    for (const [reason, renewsAt] of [["quota_exhausted", null], ["quota_exhausted", new Date(Date.now() + 3_600_000)], ["rate_limited", null]] as const) {
      await database.query(
        `INSERT INTO ai_usage (at, task, provider, endpoint, model, input_tokens, output_tokens, cost_eur, ok, duration_ms, outcome, reason, renews_at)
         VALUES (now(), 'scoring', 'openai', 'eu.api.openai.com', 'gpt-5.5', 0, 0, 0, false, 300, 'failed', $1, $2)`,
        [reason, renewsAt],
      );
    }
    // Kaspr's external API calls: one refused for its credits spent, one for its rate.
    for (const [status, reason] of [[402, "quota_exhausted"], [429, "rate_limited"]] as const) {
      await database.query(
        `INSERT INTO external_api_usage (at, provider, operation, ok, http_status, duration_ms, cost_eur, reason) VALUES (now(), 'kaspr', 'GET /profile', false, $1, 200, NULL, $2)`,
        [status, reason],
      );
    }
  } finally {
    await database.end();
  }
}

test.describe("Quota épuisé: counted by Consommation IA and Outils like any other Failure Reason (#1114)", () => {
  // Once: both tests count what it recorded.
  test.beforeAll(seed);

  test("Consommation IA counts the AI calls refused for a quota spent apart from those refused for a rate limit", async ({ page }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    await page.goto("/admin/consommation-ia");

    const byReason = page.getByRole("table", { name: admin.aiUsage.reasonsCaption });
    const exhaustedRow = byReason.getByRole("row").filter({ hasText: exhausted });
    const limitedRow = byReason.getByRole("row").filter({ hasText: rateLimited });
    await expect(exhaustedRow).toHaveCount(1);
    await expect(limitedRow).toHaveCount(1);
    // The two refusals of OpenAI's credit, the one of its rate: nothing else in the suite is refused for a quota.
    await expect(exhaustedRow.getByRole("cell", { name: "2", exact: true })).toBeVisible();
    // By model too, the same wording (never the code, never what the provider said).
    const byModel = page.getByRole("table", { name: admin.aiUsage.reasonsByModelCaption });
    await expect(byModel.getByRole("row").filter({ hasText: "openai" }).filter({ hasText: exhausted })).toHaveCount(1);
    await expect(page.getByRole("main")).not.toContainText("insufficient_quota");
  });

  test("a Tool's page counts its AI calls and its external API calls refused for a quota spent, apart from its rate limit", async ({ page }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);

    // An AI Tool's page counts its calls by Failure Reason.
    await page.goto("/admin/outils/openai");
    const reasons = page.getByRole("table", { name: tr(admin.tools.reasonsCaption, { name: "OpenAI" }) });
    const exhaustedRow = reasons.getByRole("row").filter({ has: page.getByRole("cell", { name: "quota_exhausted", exact: true }) });
    await expect(exhaustedRow).toContainText(exhausted);
    await expect(exhaustedRow.getByRole("cell", { name: "2", exact: true })).toBeVisible();
    await expect(reasons.getByRole("row").filter({ has: page.getByRole("cell", { name: "rate_limited", exact: true }) })).toContainText(rateLimited);

    // A Tool with an external API only (Kaspr) counts them as failures and lists each call with its reason's wording.
    await page.goto("/admin/outils/kaspr");
    const figures = page.getByRole("region", { name: admin.tools.figuresTitle });
    await expect(figures.getByRole("definition").nth(1)).toHaveText("2");
    const calls = page.getByRole("table", { name: tr(admin.tools.callsCaption, { name: "Kaspr" }) });
    await expect(calls.getByRole("row").filter({ hasText: exhausted })).toHaveCount(1);
    await expect(calls.getByRole("row").filter({ hasText: rateLimited })).toHaveCount(1);
    await expect(page.getByRole("main")).not.toContainText("out_of_credits");
  });
});
