import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import pg from "pg";
import { signInWithMagicLink } from "./support/candidate";

// Issue #926 (from docs/research/issue-912.md § 6, item 3): on Activité › Appels IA, a call made for no Candidate was
// always « Aucun (invité) », an Eval Run's and a route's test call too. Now a Guest's call (the extension's Match
// Score reading a Job Offer's text, `offer_analysis`) shows « Invité » and a call made to test the AI shows « Eval / test »:
// an Eval Run's (its task, `eval`) and a route's test call in Paramètres (marked as a test when recorded). The calls are
// recorded straight into the database, as the AI layer's usage log writes them, under a model of their own.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const admin = fr.admin;
const labels = admin.aiMessages;
// Its own permanent super-admin (playwright.config.ts): two sign-ins of one address at once can pick up each other's link.
const SUPER_ADMIN = "ai-calls-for-whom-office@e2e.jobbbox.test";
const MODEL = `e2e-for-whom-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const CALLS = [
  // A Guest's Match Score reading the captured Job Offer's text.
  { task: "offer_analysis", test: false, at: "2025-02-03T09:00:03Z", shows: labels.guest },
  // An Eval Run's AI judge.
  { task: "eval", test: true, at: "2025-02-03T09:00:02Z", shows: labels.test },
  // A route's test call in Paramètres, recorded on the task whose route it tests.
  { task: "scoring", test: true, at: "2025-02-03T09:00:01Z", shows: labels.test },
] as const;

async function recordCalls(): Promise<string[]> {
  const database = new pg.Pool({ connectionString: process.env.E2E_DATABASE_URL });
  try {
    const ids: string[] = [];
    for (const call of CALLS) {
      const usage = await database.query<{ id: string }>(
        `INSERT INTO ai_usage (at, task, provider, endpoint, model, input_tokens, output_tokens, cost_eur, ok, duration_ms, outcome)
         VALUES ($1, $2, 'mistral', 'e2e', $3, 12, 4, 0, true, 300, 'ok') RETURNING id`,
        [call.at, call.task, MODEL],
      );
      const log = await database.query<{ id: string }>(
        `INSERT INTO ai_message_log (usage_id, at, messages, reply, sent, test) VALUES ($1, $2, '[]'::jsonb, 'OK', true, $3) RETURNING id`,
        [usage.rows[0]!.id, call.at, call.test],
      );
      ids.push(log.rows[0]!.id);
    }
    return ids;
  } finally {
    await database.end();
  }
}

test("Appels IA names a Guest's call « Invité » and an Eval Run's or a route test's « Eval / test », in the list and on the call (#926)", async ({ page }) => {
  const ids = await recordCalls();
  await signInWithMagicLink(page, SUPER_ADMIN);

  await page.goto(`/admin/activite/appels-ia?model=${MODEL}`);
  const rows = page.getByRole("table", { name: labels.caption }).locator("tbody tr");
  await expect(rows).toHaveCount(CALLS.length);
  for (const [index, call] of CALLS.entries()) {
    const row = rows.nth(index);
    await expect(row).toContainText(admin.aiUsage.tasks[call.task]);
    await expect(row.getByRole("cell", { name: call.shows, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("table", { name: labels.caption })).not.toContainText("Aucun (invité)");

  // Each call opened says it too.
  for (const [index, call] of CALLS.entries()) {
    await page.goto(`/admin/activite/appels-ia/${ids[index]}`);
    await expect(page.getByRole("definition").getByText(call.shows, { exact: true })).toBeVisible();
  }
});
