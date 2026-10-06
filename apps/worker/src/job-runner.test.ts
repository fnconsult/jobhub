import { afterEach, describe, expect, it } from "vitest";
import { startJobRunner, type JobRunner } from "./job-runner";

const connectionString = process.env.DATABASE_URL;

describe.skipIf(!connectionString)("job runner (needs Postgres: DATABASE_URL)", () => {
  let runner: JobRunner | undefined;
  afterEach(async () => {
    await runner?.stop();
  });

  it("runs an enqueued job through its registered handler", async () => {
    const received = new Promise<unknown>((resolve) => {
      void startJobRunner({
        connectionString: connectionString!,
        pollingIntervalSeconds: 0.5,
        jobs: { "test.echo": { handler: async (data) => resolve(data) } },
      }).then(async (started) => {
        runner = started;
        await started.enqueue("test.echo", { hello: "monde" });
      });
    });

    await expect(received).resolves.toEqual({ hello: "monde" });
  }, 20_000);

  it("refuses to enqueue a job that has no registered handler", async () => {
    runner = await startJobRunner({ connectionString: connectionString!, jobs: {} });
    await expect(runner.enqueue("test.unknown", {})).rejects.toThrow(/test\.unknown/);
  }, 20_000);
});
