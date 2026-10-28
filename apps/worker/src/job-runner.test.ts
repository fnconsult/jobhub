import { PgBoss } from "pg-boss";
import { afterEach, describe, expect, it } from "vitest";
import { startJobRunner, type JobRunner } from "./job-runner";

const connectionString = process.env.DATABASE_URL;

describe.skipIf(!connectionString)("job runner (needs Postgres: DATABASE_URL)", () => {
  let runner: JobRunner | undefined;
  afterEach(async () => {
    await runner?.stop();
    runner = undefined;
  });

  it("runs an enqueued job through its registered handler", async () => {
    // A runner that fails to start (or to enqueue) fails the test with its
    // own error, instead of leaving `received` pending until the timeout.
    let deliver!: (data: unknown) => void;
    const received = new Promise<unknown>((resolve) => (deliver = resolve));
    runner = await startJobRunner({
      connectionString: connectionString!,
      pollingIntervalSeconds: 0.5,
      jobs: { "test.echo": { handler: async (data) => deliver(data) } },
    });
    await runner.enqueue("test.echo", { hello: "monde" });

    await expect(received).resolves.toEqual({ hello: "monde" });
  }, 20_000);

  it("schedules a cron job in the time zone it names (Job Digests go out at 07:00 in Paris)", async () => {
    runner = await startJobRunner({
      connectionString: connectionString!,
      jobs: { "test.paris": { cron: "0 7 * * *", tz: "Europe/Paris", handler: async () => {} } },
    });
    const boss = new PgBoss({ connectionString: connectionString! });
    await boss.start();
    try {
      const [schedule] = await boss.getSchedules("test.paris");
      expect(schedule).toMatchObject({ cron: "0 7 * * *", options: expect.objectContaining({ tz: "Europe/Paris" }) });
      await boss.unschedule("test.paris");
    } finally {
      await boss.stop({ graceful: false });
    }
  }, 20_000);

  it("gives a job's queue the tries it names, even a queue the web app created first (Email intake's reading, #445)", async () => {
    const boss = new PgBoss({ connectionString: connectionString! });
    await boss.start();
    try {
      // The web app creates a queue with pg-boss's defaults when it sends the first job to it.
      if (!(await boss.getQueue("test.retried"))) await boss.createQueue("test.retried");
      runner = await startJobRunner({
        connectionString: connectionString!,
        jobs: { "test.retried": { retry: { limit: 2, delaySeconds: 600, backoff: true }, handler: async () => {} } },
      });

      expect(await boss.getQueue("test.retried")).toMatchObject({ retryLimit: 2, retryDelay: 600, retryBackoff: true });
    } finally {
      await runner?.stop();
      runner = undefined;
      await boss.deleteQueue("test.retried");
      await boss.stop({ graceful: false });
    }
  }, 20_000);

  it("refuses to enqueue a job that has no registered handler", async () => {
    runner = await startJobRunner({ connectionString: connectionString!, jobs: {} });
    await expect(runner.enqueue("test.unknown", {})).rejects.toThrow(/test\.unknown/);
  }, 20_000);
});
