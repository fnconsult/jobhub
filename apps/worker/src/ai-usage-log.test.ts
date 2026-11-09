import { createAiLayer } from "@jobhub/ai";
import { createFakeProvider } from "@jobhub/ai/testing";
import { migrateAiUsage } from "@jobhub/web/ai-usage";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createThrowawayDatabase } from "../../web/src/test-support/throwaway-database";
import { workerPostgresUsageLog } from "./ai-usage-log";

describe.skipIf(!process.env.DATABASE_URL)("the worker's AI Usage (needs Postgres: DATABASE_URL)", () => {
  let throwaway: Awaited<ReturnType<typeof createThrowawayDatabase>>;
  beforeEach(async () => {
    throwaway = await createThrowawayDatabase("test_worker_ai_usage");
    // The candidate table as far as the AI Message Log needs it.
    await throwaway.pool.query("CREATE TABLE IF NOT EXISTS candidate (id text PRIMARY KEY)");
    await migrateAiUsage(throwaway.pool);
  });
  afterEach(async () => {
    await throwaway.drop();
  });

  it("records each of its AI calls as asked from the worker, on its usage and its message log (#919)", async () => {
    const recorded: Promise<void>[] = [];
    const postgres = workerPostgresUsageLog(throwaway.pool, { secrets: () => [] });
    const ai = createAiLayer({
      providers: [createFakeProvider({ id: "mistral" })],
      routes: { offer_analysis: "mistral" },
      usage: { record: (entry) => void recorded.push(Promise.resolve(postgres.record(entry))) },
    });

    await ai.generate({ task: "offer_analysis", candidateId: null, prompt: "Lis cette offre." });
    await Promise.all(recorded);

    const { rows } = await throwaway.pool.query(`SELECT u.surface AS usage, m.surface AS log FROM ai_usage u JOIN ai_message_log m ON m.usage_id = u.id`);
    expect(rows).toEqual([{ usage: "worker", log: "worker" }]);
  });
});
