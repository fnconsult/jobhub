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

  it("refuses to enqueue a job that has no registered handler", async () => {
    runner = await startJobRunner({ connectionString: connectionString!, jobs: {} });
    await expect(runner.enqueue("test.unknown", {})).rejects.toThrow(/test\.unknown/);
  }, 20_000);
});
