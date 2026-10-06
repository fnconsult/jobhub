// Creates or upgrades the database tables. Usage: npm run db:migrate
import { migrateAgentRunLog } from "../src/agent-runs/index";
import { authConfigFromEnv } from "../src/auth/config";
import { migrateCandidateAccounts } from "../src/auth/index";

const config = authConfigFromEnv(process.env);
await migrateCandidateAccounts(config);
console.info("[migrate] Candidate accounts are up to date");
await migrateAgentRunLog(config.database);
console.info("[migrate] Agent Run log is up to date");
await config.database.end();
