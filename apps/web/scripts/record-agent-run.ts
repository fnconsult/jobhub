// Records one Agent Run of a delivery workflow (run `npm run db:migrate` first).
// Usage: npm run wf:record -- --issue 31 --workflow-id wf-dev --workflow-ref <script@version>
//   --workflow-instance wf_… --workflow-date <ISO date> --agent wf-dev/#31/implement
//   --model <model id> --effort high --time-ms 754000 [--round 0] --tokens 182345
import { Pool } from "pg";
import { agentRunFromArgs, recordAgentRun } from "../src/agent-runs/index";

let run;
try {
  run = agentRunFromArgs(process.argv.slice(2));
} catch (error) {
  console.error(`[wf:record] ${(error as Error).message}`);
  process.exit(2);
}
if (!process.env.DATABASE_URL) {
  console.error("[wf:record] Missing environment variable DATABASE_URL");
  process.exit(2);
}
const database = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const recorded = await recordAgentRun(database, run);
  console.info(`[wf:record] Recorded Agent Run ${recorded.id} (${recorded.agent}, issue #${recorded.issueId})`);
} finally {
  await database.end();
}
