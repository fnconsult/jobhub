import { PgBoss } from "pg-boss";

export interface JobQueue {
  /** Queues a background job for the worker (apps/worker), which runs it. */
  send(name: string, data: object): Promise<void>;
}

let started: Promise<PgBoss> | undefined;
const created = new Set<string>();

/**
 * The worker's job queue (pg-boss on the app's database), from the web app's
 * side: it only sends jobs. Supervision and schedules stay with the worker.
 */
export function getJobQueue(): JobQueue {
  return {
    async send(name, data) {
      started ??= (async () => {
        const boss = new PgBoss({ connectionString: process.env.DATABASE_URL, supervise: false, schedule: false });
        boss.on("error", (error) => console.error("[job-queue]", error));
        await boss.start();
        return boss;
      })().catch((error) => {
        started = undefined;
        throw error;
      });
      const boss = await started;
      if (!created.has(name)) {
        // The worker creates its queues when it starts; make sure the queue is there even before it does.
        if (!(await boss.getQueue(name))) await boss.createQueue(name);
        created.add(name);
      }
      await boss.send(name, data);
    },
  };
}
