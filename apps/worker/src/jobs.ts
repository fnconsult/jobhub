import type { JobDefinition } from "./job-runner";

/** Every background job the worker runs, by queue name. */
export const jobs: Record<string, JobDefinition> = {
  // Proves the runner is alive end to end; replace once real jobs land.
  "system.heartbeat": {
    cron: "*/5 * * * *",
    handler: async () => {
      console.info(`[worker] heartbeat ${new Date().toISOString()}`);
    },
  },
};
