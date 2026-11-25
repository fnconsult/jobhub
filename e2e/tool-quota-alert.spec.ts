import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { PgBoss } from "pg-boss";
import pg from "pg";

// Issue #1117: once a Tool reaches its quota at its provider, every Administrator gets one « Quota atteint » email a day.
//
// Public entry point: the worker process (`npm run start -w @jobhub/worker`), which runs the job `tool-quotas.daily-alert`
// every 10 minutes. Each scenario starts it on a throwaway, migrated database with MAIL_TRANSPORT=console (the emails
// are printed in its output), queues the job exactly as the cron would (pg-boss), and reads the emails it printed and
// the day's row in `tool_quota_alert`. The Tools' states are read from the calls recorded in Postgres, as in
// production; the emails' look is in e2e/email-html.spec.ts.

const baseUrl = process.env.DATABASE_URL ?? "postgres://jobhub:jobhub@localhost:5432/jobhub";
const JOB = "tool-quotas.daily-alert";
const tsx = path.resolve("node_modules/.bin/tsx");
const workerDir = path.resolve("apps/worker");

const databaseUrlOf = (name: string) => {
  const url = new URL(baseUrl);
  url.pathname = `/${name}`;
  return url.toString();
};
async function adminQuery(sql: string) {
  const admin = new pg.Client({ connectionString: baseUrl });
  await admin.connect();
  try {
    await admin.query(sql);
  } finally {
    await admin.end();
  }
}

const template = `jobhub_e2e_quota_alert_template_${process.pid}`;
test.beforeAll(async () => {
  await adminQuery(`CREATE DATABASE ${template}`);
  const migrated = spawnSync("npm", ["run", "db:migrate"], { env: { ...process.env, DATABASE_URL: databaseUrlOf(template) }, encoding: "utf8", timeout: 240_000 });
  if (migrated.status !== 0) throw new Error(`db:migrate failed:\n${migrated.stdout}\n${migrated.stderr}`);
});
test.afterAll(async () => {
  await adminQuery(`DROP DATABASE IF EXISTS ${template} WITH (FORCE)`);
});

interface Mail {
  to: string;
  subject: string;
  text: string;
}

class Worker {
  output = "";
  private child: ChildProcess;
  constructor(databaseUrl: string, env: Record<string, string>) {
    this.child = spawn(tsx, ["src/main.ts"], {
      cwd: workerDir,
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", DATABASE_URL: databaseUrl, ADMIN_EMAILS: "ops@jobbbox.fr", ...env },
    });
    this.child.stdout!.on("data", (chunk: Buffer) => (this.output += chunk.toString()));
    this.child.stderr!.on("data", (chunk: Buffer) => (this.output += chunk.toString()));
  }
  async started() {
    await expect.poll(() => this.output, { timeout: 60_000, intervals: [500] }).toMatch(/running \d+ job\(s\)/);
  }
  /** The emails printed so far, by the console mailer. */
  mails(): Mail[] {
    return [...this.output.matchAll(/\[mail\] to (\S+): (.*)\nFrom: .*\n([\s\S]*?)(?=\n\[(?:mail|worker|tool-quota-alert)|$)/g)].map((m) => ({ to: m[1]!, subject: m[2]!, text: m[3]! }));
  }
  async stop() {
    if (this.child.exitCode !== null) return;
    const exited = new Promise((resolve) => this.child.once("exit", resolve));
    this.child.kill("SIGTERM");
    setTimeout(() => this.child.kill("SIGKILL"), 10_000).unref();
    await exited;
  }
}

/** Queues the job as the 10-minute cron does. */
async function runJob(databaseUrl: string) {
  const boss = new PgBoss({ connectionString: databaseUrl });
  boss.on("error", () => {});
  await boss.start();
  try {
    await boss.send(JOB, {});
  } finally {
    await boss.stop({ graceful: false });
  }
}

async function scenario(env: Record<string, string>, run: (ctx: { url: string; db: pg.Pool; worker: () => Promise<Worker>; pass: (w: Worker, mails: number) => Promise<void> }) => Promise<void>) {
  const name = `jobhub_e2e_quota_alert_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
  await adminQuery(`CREATE DATABASE ${name} TEMPLATE ${template}`);
  const url = databaseUrlOf(name);
  const db = new pg.Pool({ connectionString: url });
  const workers: Worker[] = [];
  try {
    await run({
      url,
      db,
      worker: async () => {
        const w = new Worker(url, { MAIL_TRANSPORT: "console", ...env });
        workers.push(w);
        await w.started();
        return w;
      },
      // One pass of the job, then waits until it printed `mails` emails in all.
      pass: async (w, mails) => {
        await runJob(url);
        await expect.poll(() => w.mails().length, { timeout: 30_000, intervals: [300] }).toBe(mails);
      },
    });
  } finally {
    await Promise.all(workers.map((w) => w.stop()));
    await db.end();
    await adminQuery(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  }
}

async function administrator(db: pg.Pool, id: string, email: string, language: "fr" | "en", roles: string[]) {
  await db.query(`INSERT INTO candidate (id, name, email, "emailVerified", "interfaceLanguage") VALUES ($1, $1, $2, true, $3)`, [id, email, language]);
  for (const role of roles) await db.query(`INSERT INTO administrator_role (candidate_id, role) VALUES ($1, $2)`, [id, role]);
}

/** A call to a Tool's provider, refused for its quota (or accepted), recorded as the worker and web app record them. */
async function call(db: pg.Pool, provider: string, outcome: "quota_exhausted" | "rate_limited" | "ok", at = new Date()) {
  await db.query(`INSERT INTO external_api_usage (at, provider, operation, ok, http_status, duration_ms, reason) VALUES ($1, $2, 'enrich', $3, $4, 10, $5)`, [
    at,
    provider,
    outcome === "ok",
    outcome === "ok" ? 200 : outcome === "rate_limited" ? 429 : 402,
    outcome === "ok" ? null : outcome,
  ]);
}

const days = async (db: pg.Pool) => (await db.query<{ day: string; tools: string[] }>(`SELECT day, tools FROM tool_quota_alert ORDER BY day`)).rows;
const recipients = (mails: Mail[]) => mails.map((m) => m.to).sort();

test.describe("The « Quota atteint » email (#1117), sent by the worker's job tool-quotas.daily-alert", () => {
  test("a first quota reached in the day emails every Administrator, whatever their role, in their language", async () => {
    await scenario({}, async ({ db, worker, pass }) => {
      await administrator(db, "c-coach", "coach@jobbbox.fr", "fr", ["coach-manager"]);
      await administrator(db, "c-plat", "platform@jobbbox.fr", "en", ["platform-manager"]);
      await administrator(db, "c-super", "super@jobbbox.fr", "fr", ["super-admin"]);
      await administrator(db, "c-nobody", "candidate@example.fr", "fr", []); // a Candidate, not an Administrator
      await call(db, "lusha", "quota_exhausted");
      const w = await worker();
      await pass(w, 4);

      const mails = w.mails();
      // The three Administrators and the permanent super-admin of ADMIN_EMAILS, who has no account; no Candidate.
      expect(recipients(mails)).toEqual(["coach@jobbbox.fr", "ops@jobbbox.fr", "platform@jobbbox.fr", "super@jobbbox.fr"]);
      const byRecipient = Object.fromEntries(mails.map((m) => [m.to, m]));
      expect(byRecipient["coach@jobbbox.fr"]!.subject).toContain("quota atteint pour Lusha");
      expect(byRecipient["platform@jobbbox.fr"]!.subject).toBe("Jobbbox: quota reached for Lusha");
      for (const mail of mails) expect(mail.text).toContain("Lusha");
      expect(await days(db)).toEqual([{ day: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), tools: ["lusha"] }]);
      expect(w.output).toContain("[tool-quota-alert]");
    });
  });

  test("a second Tool reaching its quota the same day sends no new email; the next day's email lists the Tools still reached", async () => {
    await scenario({}, async ({ db, url, worker, pass }) => {
      await administrator(db, "c-sup", "support@jobbbox.fr", "fr", ["support"]);
      await call(db, "lusha", "quota_exhausted");
      const w = await worker();
      await pass(w, 2); // support + ops

      // A second Tool reaches its quota; the job runs again: no new email.
      await call(db, "apollo", "quota_exhausted");
      await runJob(url);
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      expect(w.mails()).toHaveLength(2);
      expect((await days(db)).map((row) => row.tools)).toEqual([["lusha"]]);

      // The day passes: the day's row is yesterday's.
      await db.query(`UPDATE tool_quota_alert SET day = '2000-01-01'`);
      await pass(w, 4);
      const next = w.mails().slice(2);
      expect(recipients(next)).toEqual(["ops@jobbbox.fr", "support@jobbbox.fr"]);
      for (const mail of next) {
        expect(mail.text).toContain("Lusha");
        expect(mail.text).toContain("Apollo");
      }
    });
  });

  test("a Tool available again is not in the next day's email, and no email goes when none is reached", async () => {
    await scenario({}, async ({ db, url, worker, pass }) => {
      await call(db, "lusha", "quota_exhausted", new Date(Date.now() - 60_000));
      await call(db, "apollo", "quota_exhausted", new Date(Date.now() - 60_000));
      const w = await worker();
      await pass(w, 1); // ops alone
      expect(w.mails()[0]!.text).toContain("Apollo");

      await call(db, "lusha", "ok"); // Lusha accepts calls again
      await db.query(`UPDATE tool_quota_alert SET day = '2000-01-01'`);
      await pass(w, 2);
      const next = w.mails()[1]!;
      expect(next.text).toContain("Apollo");
      expect(next.text).not.toContain("Lusha");

      // Every Tool available again: nothing is sent, and the day is not taken.
      await call(db, "apollo", "ok");
      await db.query(`DELETE FROM tool_quota_alert`);
      await runJob(url);
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      expect(w.mails()).toHaveLength(2);
      expect(await days(db)).toEqual([]);
    });
  });

  test("a day without a quota reached sends no email", async () => {
    await scenario({}, async ({ db, url, worker }) => {
      await call(db, "lusha", "ok");
      const w = await worker();
      await runJob(url);
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      expect(w.mails()).toEqual([]);
      expect(await days(db)).toEqual([]);
      expect(w.output).not.toMatch(/Error|ECONN/);
    });
  });

  test("a send that fails gives the day back, and the next pass tries again", async () => {
    await scenario({}, async ({ db, url, pass }) => {
      await call(db, "lusha", "quota_exhausted");
      // The relay refuses the connection: the emails cannot be sent, the job fails.
      const broken = new Worker(url, { SMTP_URL: "smtp://127.0.0.1:1", MAIL_FROM: "Jobbbox <no-reply@jobbbox.fr>" });
      try {
        await broken.started();
        await runJob(url);
        // The run fails (pg-boss keeps the error, and tries it again later), it does not pass.
        const attempts = async () => (await db.query<{ state: string; output: unknown }>(`SELECT state, output FROM pgboss.job WHERE name = $1 AND state <> 'completed' AND retry_count > 0 OR name = $1 AND state = 'failed'`, [JOB])).rows;
        await expect.poll(async () => (await attempts()).length, { timeout: 30_000, intervals: [300] }).toBeGreaterThan(0);
        expect(JSON.stringify((await attempts())[0]!.output)).toMatch(/ECONNREFUSED|connect/i);
        // The day was given back: nothing is kept for it.
        await expect.poll(async () => (await days(db)).length, { timeout: 10_000 }).toBe(0);
      } finally {
        await broken.stop();
      }
      // The relay is back (the console, here): the next pass sends the emails.
      const working = new Worker(url, { MAIL_TRANSPORT: "console" });
      try {
        await working.started();
        await pass(working, 1);
        expect(recipients(working.mails())).toEqual(["ops@jobbbox.fr"]);
        expect((await days(db)).map((row) => row.tools)).toEqual([["lusha"]]);
      } finally {
        await working.stop();
      }
    });
  });
});
