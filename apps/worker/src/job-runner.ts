import { PgBoss } from "pg-boss";

export type JobDefinition = {
  handler: (data: unknown) => Promise<void>;
  /** Optional cron expression (UTC) to run the job on a schedule. */
  cron?: string;
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
    await boss.work(name, { pollingIntervalSeconds: options.pollingIntervalSeconds ?? 2 }, async (batch) => {
      for (const { data } of batch) await job.handler(data);
    });
    if (job.cron) await boss.schedule(name, job.cron);
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
