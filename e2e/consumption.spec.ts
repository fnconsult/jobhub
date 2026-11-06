import { spawnSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";
import { parisDay } from "./support/paris-days";
import { subscribe } from "./support/plan";

// Issue #799 (ADR-0091): the per-Candidate daily count of uses per Tool, « Votre consommation »'s store. Nothing of it is
// shown yet, so it is driven through the public entry points that touch it: the AI Coach's HTTP API (POST /api/coach,
// whose reply counts once whatever its Tool rounds), the Data export (GET /api/account/export, its `consumption` section),
// the account's deletion (DELETE /api/account), and the worker's nightly purge (e2e/support/worker-job.ts). The table is read
// straight from the e2e database only to prove what no response shows (its columns, rows left after a deletion).
// The Job Search given back is in consumption-job-search.spec.ts (it needs the worker); the « one place per Tool » rule
// is a unit test (apps/web/src/consumption/consumption-sites.test.ts), as no public entry point can list call sites.
const origin = process.env.E2E_WEB_ORIGIN!;
const databaseUrl = process.env.E2E_DATABASE_URL!;
const ENABLED = "COACH_ACTIONS_ENABLED";
const ROUNDS = "COACH_TOOL_ROUNDS_MAX";

type Row = { day: string; tool: string; count: number };

async function query<T extends pg.QueryResultRow>(sql: string, values: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return (await client.query<T>(sql, values)).rows;
  } finally {
    await client.end();
  }
}

async function setSetting(name: string, value: string | null) {
  if (value === null) await query("DELETE FROM platform_setting WHERE name = $1", [name]);
  else await query(`INSERT INTO platform_setting (name, value, updated_by_email) VALUES ($1, $2, 'e2e@jobbbox.ai') ON CONFLICT (name) DO UPDATE SET value = excluded.value, updated_at = now()`, [name, value]);
  await query("SELECT pg_notify('platform_settings_changed', '')");
}

const candidateId = async (email: string) => (await query<{ id: string }>("SELECT id FROM candidate WHERE email = $1", [email]))[0]!.id;

/** The `consumption` section of the Candidate's Data export. */
async function exportedConsumption(page: Page): Promise<Row[]> {
  const response = await page.request.get("/api/account/export");
  expect(response.status()).toBe(200);
  const exported = await response.json();
  expect(Array.isArray(exported.consumption), "the Data export holds a consumption section").toBe(true);
  return exported.consumption as Row[];
}

const countOf = (rows: Row[], tool: string, day = parisDay(0)) => rows.filter((row) => row.tool === tool && row.day === day).reduce((sum, row) => sum + row.count, 0);

async function reply(page: Page, message: string) {
  const response = await page.request.post("/api/coach", { headers: { origin }, data: { message } });
  expect(response.status(), await response.text()).toBe(200);
}

function purge(hours: number) {
  const run = spawnSync(path.resolve("node_modules/.bin/tsx"), ["e2e/support/worker-job.ts", "consumption.purge", String(hours)], {
    env: { ...process.env, DATABASE_URL: databaseUrl, MAIL_TRANSPORT: "console" },
    encoding: "utf8",
  });
  expect(run.status, run.stderr).toBe(0);
}

async function seed(id: string, day: string, tool: string, count: number) {
  await query("INSERT INTO consumption_day (candidate_id, day, tool, count) VALUES ($1, $2, $3, $4) ON CONFLICT (candidate_id, day, tool) DO UPDATE SET count = excluded.count", [id, day, tool, count]);
}

test.describe("Consumption: a per-Candidate daily count of uses per Tool (#799)", () => {
  test.afterAll(async () => {
    await setSetting(ENABLED, null);
    await setSetting(ROUNDS, null);
  });

  test("one Coach reply adds exactly 1 to `coach` for the day, with a Tool round or none", async ({ page }) => {
    const email = newAddress("consumption-coach");
    await signInWithMagicLink(page, email);
    await subscribe(page, email, "standard");
    expect(countOf(await exportedConsumption(page), "coach")).toBe(0);

    await reply(page, "Bonjour, aidez-moi à préparer ma recherche.");
    expect(countOf(await exportedConsumption(page), "coach")).toBe(1);

    // With Coach Actions on, a reply that calls a tool is two AI calls (one AI Usage row each) and still one reply.
    await setSetting(ENABLED, "true");
    await setSetting(ROUNDS, "3");
    await reply(page, `Quelles sont mes candidatures ?\nE2E_COACH_TOOL=list_objects:{"type":"application"}`);
    const after = await exportedConsumption(page);
    expect(countOf(after, "coach")).toBe(2);
    // Counted nothing else: no other Tool was used.
    expect(after.filter((row) => row.tool !== "coach")).toEqual([]);
  });

  test("the Data export holds the day, the Tool key and the count, and nothing of another Candidate", async ({ page, browser }) => {
    const email = newAddress("consumption-export");
    await signInWithMagicLink(page, email);
    const id = await candidateId(email);
    await seed(id, parisDay(-3), "jobSearch", 2);
    await seed(id, parisDay(-3), "tailoredCv", 1);

    const other = await browser.newPage({ baseURL: origin });
    const otherEmail = newAddress("consumption-export-other");
    await signInWithMagicLink(other, otherEmail);
    await seed(await candidateId(otherEmail), parisDay(-3), "coach", 9);

    const rows = await exportedConsumption(page);
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(expect.arrayContaining([{ day: parisDay(-3), tool: "jobSearch", count: 2 }, { day: parisDay(-3), tool: "tailoredCv", count: 1 }]));
    for (const row of rows) expect(Object.keys(row).sort()).toEqual(["count", "day", "tool"]);
    await other.close();
  });

  test("the worker's nightly job purges the days more than 12 months old, and only those", async ({ page }) => {
    const email = newAddress("consumption-purge");
    await signInWithMagicLink(page, email);
    const id = await candidateId(email);
    await seed(id, parisDay(-400), "coach", 4);
    await seed(id, parisDay(-366), "matchScore", 1);
    await seed(id, parisDay(-300), "atsScore", 2);
    await seed(id, parisDay(0), "coach", 1);

    purge(0);

    const kept = await exportedConsumption(page);
    expect(kept.map((row) => row.tool).sort()).toEqual(["atsScore", "coach"]);
    expect(countOf(kept, "atsScore", parisDay(-300))).toBe(2);
    expect(countOf(kept, "coach")).toBe(1);
  });

  test("deleting the account leaves no row", async ({ page }) => {
    const email = newAddress("consumption-delete");
    await signInWithMagicLink(page, email);
    const id = await candidateId(email);
    await seed(id, parisDay(-1), "coach", 3);
    await seed(id, parisDay(0), "companyDossier", 1);
    expect(await query("SELECT 1 FROM consumption_day WHERE candidate_id = $1", [id])).toHaveLength(2);

    const deleted = await page.request.delete("/api/account", { headers: { origin }, data: { email } });
    expect(deleted.status(), await deleted.text()).toBe(204);

    expect(await query("SELECT 1 FROM consumption_day WHERE candidate_id = $1", [id])).toEqual([]);
    expect((await page.request.get("/api/account/export")).status()).toBe(401);
  });

  test("nothing in the table can identify a result, a model or a provider (its columns)", async () => {
    const columns = await query<{ column_name: string; data_type: string }>("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'consumption_day' ORDER BY column_name");
    expect(columns.map((column) => column.column_name)).toEqual(["candidate_id", "count", "day", "tool"]);
    expect(columns.find((column) => column.column_name === "day")!.data_type).toBe("date");
    // The only foreign key is the Candidate's: no link to a result or to `ai_usage`.
    const references = await query<{ target: string }>(
      `SELECT confrelid::regclass::text AS target FROM pg_constraint WHERE conrelid = 'consumption_day'::regclass AND contype = 'f'`,
    );
    expect(references).toEqual([{ target: "candidate" }]);
    // And a Tool key is one of the shared list.
    const [check] = await query<{ definition: string }>(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid = 'consumption_day'::regclass AND conname = 'consumption_day_tool_check'`);
    for (const tool of ["coach", "jobSearch", "matchScore", "tailoredCv", "tailoredDocument", "atsScore", "companyDossier", "enrichedContact", "cvReading"]) expect(check!.definition).toContain(`'${tool}'`);
    expect(check!.definition).not.toMatch(/mistral|claude|gpt|perplexity/i);
  });
});
