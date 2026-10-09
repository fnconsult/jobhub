// Creates or upgrades the database tables. Usage: npm run db:migrate
import { authConfigFromEnv } from "../src/auth/config";
import { migrateDatabase } from "../src/migrations";

const config = authConfigFromEnv(process.env);
await migrateDatabase(config, (done) => console.info(`[migrate] ${done}`));
await config.database.end();
