// Runs the worker's `exchanges.check` job once for each Exchange id given (#1099), as the job runner would on the message
// the inbound route queued: `tsx e2e/support/worker-exchange-check.ts <id>…`. Wired as the worker is (apps/worker/src/main.ts):
// the AI layer from the environment and the Guardrails as the Back Office tunes them (the « Contenu piégé dans un email »
// Guardrail). DATABASE_URL names the database, SECRETS_MASTER_KEYS the keyring the Exchanges are sealed under, NODE_OPTIONS preloads the fake Mistral. Prints `CHECKED <id> <outcome>`.
// Not a long-lived worker: that would take the jobs other specs queue on the same queue.
import { createAiLayerFromEnv } from "@jobhub/ai";
import pg from "pg";
import { createExchanges } from "@jobhub/web/exchanges";
import { secretCipherFromEnv } from "@jobhub/web/provider-secrets";
import { checkExchange } from "@jobhub/web/exchanges/check";
import { workerGuardrails } from "@jobhub/web/guardrails/checks";
import { createJobs } from "../../apps/worker/src/jobs";

const database = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const ai = createAiLayerFromEnv(process.env);
const cipher = secretCipherFromEnv(process.env);
const jobs = createJobs({
  database,
  discovery: { unavailable: "not run by e2e/support/worker-exchange-check.ts" },
  profiles: { get: async () => null },
  jobSearches: { record: async () => {} },
  exchangeCheck: (id: string) => checkExchange({ exchanges: createExchanges(database, { cipher: () => cipher }), guardrails: workerGuardrails(database, ai) }, id),
  log: (line: string) => console.log(line),
} as Parameters<typeof createJobs>[0]);
try {
  for (const id of process.argv.slice(2)) await jobs["exchanges.check"]!.handler({ exchangeId: id });
} finally {
  await database.end();
}
