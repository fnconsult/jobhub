// Creates or upgrades the database tables. Usage: npm run db:migrate
import { migrateActionCards } from "../src/action-cards/index";
import { migrateAgentRunLog } from "../src/agent-runs/index";
import { migrateApplications } from "../src/applications/index";
import { authConfigFromEnv } from "../src/auth/config";
import { migrateCandidateAccounts } from "../src/auth/index";
import { migrateJobOffers } from "../src/job-offers/index";
import { migrateJobSearches } from "../src/job-searches/index";
import { migrateProfiles } from "../src/profiles/index";
import { migrateBilling } from "../src/billing/index";

const config = authConfigFromEnv(process.env);
await migrateCandidateAccounts(config);
console.info("[migrate] Candidate accounts are up to date");
await migrateAgentRunLog(config.database);
console.info("[migrate] Agent Run log is up to date");
await migrateProfiles(config.database);
console.info("[migrate] Profiles are up to date");
await migrateJobOffers(config.database);
console.info("[migrate] Job Offers are up to date");
await migrateApplications(config.database);
console.info("[migrate] Applications are up to date");
await migrateActionCards(config.database);
console.info("[migrate] Action Cards are up to date");
await migrateBilling(config.database);
console.info("[migrate] Plans and Plan Quotas are up to date");
await migrateJobSearches(config.database);
console.info("[migrate] Job Searches are up to date");
await config.database.end();
