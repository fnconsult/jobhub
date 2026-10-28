import { PgBoss } from "pg-boss";

export type JobDefinition = {
  handler: (data: unknown) => Promise<void>;
  /** Optional cron expression to run the job on a schedule, in UTC unless `tz` says otherwise. */
  cron?: string;
  /** IANA time zone the `cron` expression is read in (e.g. "Europe/Paris"); default UTC. */
  tz?: string;
  /**
   * How a job whose handler throws is tried again: `limit` more times, `delaySeconds` apart (doubling with `backoff`).
   * Default: pg-boss's (2 more times, at once).
   */
  retry?: { limit: number; delaySeconds: number; backoff?: boolean };
};

export type JobRunner = {
  /** Queues a job by name. Throws if no handler is registered for it. */
  enqueue(name: string, data?: object): Promise<void>;
  /** Stops polling, lets running jobs finish, and closes the connection. */
  stop(): Promise<void>;
};

/**
 * Starts the background-job runner on Postgres (pg-boss): creates a queue per
 * registered job, schedules the cron ones and starts working them. Crawling,
 * Job Offer re-checks, Job Digests and Follow-ups will register here.
 */
export async function startJobRunner(options: {
  connectionString: string;
  jobs: Record<string, JobDefinition>;
  pollingIntervalSeconds?: number;
  onError?: (error: Error) => void;
}): Promise<JobRunner> {
  const boss = new PgBoss({ connectionString: options.connectionString });
  boss.on("error", options.onError ?? ((error) => console.error("[job-runner]", error)));
  await boss.start();

  for (const [name, job] of Object.entries(options.jobs)) {
    await boss.createQueue(name);
    // Set on the queue even when it exists already: the web app creates one with the defaults when it sends to it first.
    if (job.retry) await boss.updateQueue(name, { retryLimit: job.retry.limit, retryDelay: job.retry.delaySeconds, retryBackoff: job.retry.backoff ?? false });
    await boss.work(name, { pollingIntervalSeconds: options.pollingIntervalSeconds ?? 2 }, async (batch) => {
      for (const { data } of batch) await job.handler(data);
    });
    if (job.cron) await boss.schedule(name, job.cron, null, job.tz ? { tz: job.tz } : {});
  }

  return {
    async enqueue(name, data = {}) {
      if (!(name in options.jobs)) throw new Error(`No handler registered for job "${name}"`);
      await boss.send(name, data);
    },
    async stop() {
      await boss.stop({ graceful: true });
    },
  };
}
