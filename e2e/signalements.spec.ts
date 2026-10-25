import { spawnSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #374: Signalements, stored for the signed-in Candidate through POST /api/signalements. Driven through the
// HTTP API; the clock-dependent rules (24-hour window, 12-month retention) age rows in the e2e database, and the
// nightly purge is run as the worker's schedule would (e2e/support/worker-job.ts).
const origin = process.env.E2E_WEB_ORIGIN!;
const databaseUrl = process.env.E2E_DATABASE_URL!;

const send = (page: Page, data: Record<string, unknown>, headers: Record<string, string> = {}) =>
  page.request.post("/api/signalements", { data, headers: { origin, ...headers } });
const bug = (n: number) => ({ type: "bug", message: `Le bouton ne répond plus, essai numéro ${n}`, path: "/candidatures", textSize: "standard" });

async function withDb<T>(run: (db: pg.Pool) => Promise<T>): Promise<T> {
  const db = new pg.Pool({ connectionString: databaseUrl });
  try {
    return await run(db);
  } finally {
    await db.end();
  }
}
const candidateId = (email: string) => withDb(async (db) => (await db.query<{ id: string }>("SELECT id FROM candidate WHERE lower(email) = lower($1)", [email])).rows[0]!.id);
const exportedSignalements = async (page: Page) => (await (await page.request.get("/api/account/export")).json()).signalements as Record<string, unknown>[];

function runPurge() {
  const result = spawnSync(path.resolve("node_modules/.bin/tsx"), ["e2e/support/worker-job.ts", "signalements.purge", "0"], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: "utf8",
  });
  expect(result.status, result.stdout + result.stderr).toBe(0);
}

test.describe("Signalements (#374)", () => {
  test("sending stores the row with the parsed context: no query string, no raw user agent", async ({ page }) => {
    const email = newAddress("signalement-send");
    await signInWithMagicLink(page, email);
    const userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
    const secret = "tok3n-s3cr3t";

    const sent = await send(page, { ...bug(1), path: `https://app.example/candidatures/42?email=a%40b.fr&token=${secret}#top`, textSize: "large" }, { "user-agent": userAgent });
    expect(sent.status(), await sent.text()).toBe(201);
    const { signalement } = await sent.json();
    expect(signalement).toMatchObject({
      type: "bug",
      status: "nouveau",
      context: { path: "/candidatures/42", browser: "Chrome 141, Mac", textSize: "large" },
    });

    const stored = await withDb(async (db) => (await db.query("SELECT * FROM signalement WHERE candidate_id = $1", [await candidateId(email)])).rows);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ path: "/candidatures/42", browser: "Chrome 141, Mac", text_size: "large" });
    const everything = JSON.stringify(stored) + JSON.stringify(signalement);
    expect(everything).not.toContain(secret);
    expect(everything).not.toContain("?");
    expect(everything).not.toContain("Mozilla");
    expect(everything).not.toContain("AppleWebKit");
  });

  test("a signed-out request is refused", async ({ request }) => {
    expect((await request.post("/api/signalements", { data: bug(1), headers: { origin } })).status()).toBe(401);
  });

  test("the 11th Signalement within 24 hours is refused; the 1st after the window is accepted", async ({ page }) => {
    const email = newAddress("signalement-limit");
    await signInWithMagicLink(page, email);
    for (let n = 1; n <= 10; n++) {
      const ok = await send(page, bug(n));
      expect(ok.status(), `#${n}: ${await ok.text()}`).toBe(201);
    }
    const refused = await send(page, bug(11));
    expect(refused.status(), await refused.text()).toBe(429);
    expect(await refused.json()).toEqual({ error: "too_many" });
    expect(await exportedSignalements(page)).toHaveLength(10);

    // The window moves on: the ten sent are now more than 24 hours old.
    await withDb(async (db) => db.query("UPDATE signalement SET created_at = now() - interval '25 hours' WHERE candidate_id = $1", [await candidateId(email)]));
    const after = await send(page, bug(12));
    expect(after.status(), await after.text()).toBe(201);
    expect(await exportedSignalements(page)).toHaveLength(11);
  });

  test("the account's Signalements are in the Data export without the Administrator's identity, and go with the account", async ({ page, browser }) => {
    const email = newAddress("signalement-account");
    await signInWithMagicLink(page, email);
    const question = await send(page, { type: "question", message: "La réponse du coach ne m'aide pas", path: "/coach", textSize: "standard", attachedQuestion: "Comment relancer ?", attachedCoachReply: "Attendez." });
    expect(question.status(), await question.text()).toBe(201);
    const id = (await question.json()).signalement.id as string;

    // The team handles it (the Back Office comes with #376): marked seen, replied, handled.
    await withDb((db) => db.query("UPDATE signalement SET status = 'traite', status_changed_at = now(), reply = 'Voici la marche à suivre.', reply_updated_at = now() WHERE id = $1", [id]));

    const exported = await exportedSignalements(page);
    expect(exported).toEqual([
      expect.objectContaining({ id, type: "question", status: "traite", reply: "Voici la marche à suivre.", attachedQuestion: "Comment relancer ?", attachedCoachReply: "Attendez." }),
    ]);
    const adminId = await withDb(async (db) => (await db.query<{ id: string }>("SELECT id FROM candidate WHERE lower(email) = 'back-office@e2e.jobbbox.test'")).rows[0]?.id);
    const text = JSON.stringify(exported);
    expect(text).not.toMatch(/administrator|admin_|changedBy|repliedBy|back-office@/i);
    if (adminId) expect(text).not.toContain(adminId);

    const other = await browser.newContext({ baseURL: origin, locale: "en-US" });
    const otherPage = await other.newPage();
    await signInWithMagicLink(otherPage, newAddress("signalement-account-other"));
    expect(await exportedSignalements(otherPage)).toEqual([]);
    await other.close();

    const owner = await candidateId(email);
    const deleted = await page.request.delete("/api/account", { data: { email }, headers: { origin } });
    expect(deleted.status(), await deleted.text()).toBe(204);
    const left = await withDb(async (db) => (await db.query("SELECT 1 FROM signalement WHERE candidate_id = $1 OR id = $2", [owner, id])).rowCount);
    expect(left).toBe(0);
  });

  test("the nightly purge removes a traite row from over 12 months ago and keeps a nouveau one of any age", async ({ page }) => {
    const email = newAddress("signalement-purge");
    await signInWithMagicLink(page, email);
    const ids: string[] = [];
    for (let n = 1; n <= 4; n++) ids.push((await (await send(page, bug(n))).json()).signalement.id);
    const [oldTraite, recentTraite, oldNouveau, oldVu] = ids as [string, string, string, string];
    await withDb(async (db) => {
      await db.query("UPDATE signalement SET status = 'traite', status_changed_at = now() - interval '13 months' WHERE id = $1", [oldTraite]);
      await db.query("UPDATE signalement SET status = 'traite', status_changed_at = now() - interval '11 months' WHERE id = $1", [recentTraite]);
      await db.query("UPDATE signalement SET created_at = now() - interval '5 years' WHERE id = $1", [oldNouveau]);
      await db.query("UPDATE signalement SET status = 'vu', status_changed_at = now() - interval '2 years', created_at = now() - interval '3 years' WHERE id = $1", [oldVu]);
    });

    runPurge();

    const kept = (await exportedSignalements(page)).map((s) => s.id);
    expect(kept).toHaveLength(3);
    expect(kept).toEqual(expect.arrayContaining([recentTraite, oldNouveau, oldVu]));
    expect(kept).not.toContain(oldTraite);
  });
});
