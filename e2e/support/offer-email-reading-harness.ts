import { createI18n } from "@jobhub/shared/i18n";
import { Pool } from "pg";
import { createCoachingPlaybooks, migrateCoachingPlaybooks } from "../../apps/web/src/coaching-playbooks";
import { importedPlaybooks } from "../../apps/web/src/coaching-playbooks/import";
import { playbookServing } from "../../apps/web/src/coaching-playbooks/serving";
import { emailIntakeHeldBack } from "../../apps/web/src/email-intake/playbook-state";

// Email intake's hold-back (#444) through its public entry point, `emailIntakeHeldBack(reader)`, on a
// throwaway database migrated and seeded like a real deployment's. Prints one `OER_RESULT <json>` line.
// env: ADMIN_DATABASE_URL (a Postgres server), argv: [target].
const [target = "production"] = process.argv.slice(2);
const admin = new Pool({ connectionString: process.env.ADMIN_DATABASE_URL });
const name = `e2e_offer_email_${process.pid}`;
await admin.query(`CREATE DATABASE ${name}`);
const url = new URL(process.env.ADMIN_DATABASE_URL!);
url.pathname = `/${name}`;
const pool = new Pool({ connectionString: url.toString() });
try {
  await migrateCoachingPlaybooks(pool, () => importedPlaybooks({}));
  const playbooks = createCoachingPlaybooks(pool, { serving: playbookServing({ NODE_ENV: "production", JOBHUB_TARGET: target }), agentModels: () => [], evalRunOn: async () => true });
  const reader = (id: string) => playbooks.servedTask(id);
  const before = await emailIntakeHeldBack(reader);
  await playbooks.validate({ email: "paul@jobbbox.fr", name: "Paul Martin" }, "job-offer-email-reading", 1);
  const after = await emailIntakeHeldBack(reader);
  const t = createI18n("fr").t;
  console.log("OER_RESULT " + JSON.stringify({ before, after, label: before ? t(`admin.platformSettings.sources.reasons.${before}`) : null }));
} finally {
  await pool.end();
  await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
  await admin.end();
}
