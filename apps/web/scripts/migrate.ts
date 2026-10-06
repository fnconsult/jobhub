// Creates or upgrades the database tables. Usage: npm run db:migrate
import { authConfigFromEnv } from "../src/auth/config";
import { migrateCandidateAccounts } from "../src/auth/index";

const config = authConfigFromEnv(process.env);
await migrateCandidateAccounts(config);
await config.database.end();
console.info("[migrate] Candidate accounts are up to date");
