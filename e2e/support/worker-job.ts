// Runs one of the worker's scheduled jobs once, as its schedule would, with the
// worker's clock set `hours` ahead: `tsx e2e/support/worker-job.ts <job> <hours>`.
// DATABASE_URL names the database, and APP_URL, MAIL_TRANSPORT… the rest, as for
// the worker itself (apps/worker/src/main.ts). Without AI configuration, as the
// worker runs without it: Follow-ups are drafted from their template.
import pg from "pg";
import { createBilling } from "../../apps/web/src/billing";
import { createAppointmentReminders } from "../../apps/web/src/appointment-reminders";
import { mailerFromEnv } from "../../apps/web/src/auth/config";
import { followUpsFromEnv } from "../../apps/web/src/follow-ups/env";
import { createQuotaReductions } from "../../apps/web/src/quota-reductions";
import { createPushNotifications } from "../../apps/web/src/push-notifications";
import { createJobs } from "../../apps/worker/src/jobs";

const [name, hours = "0"] = process.argv.slice(2);
const database = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const later = new Date(Date.now() + Number(hours) * 3_600_000);
// The worker's own events queue their Push notifications (#699); the queue is a stand-in here, as the runner's: what was
// queued shows in the Data export (pushNotifications.sent), which e2e/push-notification-events.spec.ts reads.
const pushNotifications = createPushNotifications(database, { senders: () => ({}), now: () => later, queue: { send: async () => {} } });
const job = createJobs({
  database,
  now: () => later,
  discovery: { unavailable: "not run by e2e/support/worker-job.ts" },
  profiles: { get: async () => null },
  jobSearches: { record: async () => {} },
  followUps: followUpsFromEnv(database, process.env, undefined, undefined, pushNotifications),
  quotaReductions: createQuotaReductions(database, {
    billing: createBilling({ database, baseURL: process.env.APP_URL! }),
    mailer: mailerFromEnv(process.env),
    baseURL: process.env.APP_URL!,
    now: () => later,
  }),
  appointmentReminders: createAppointmentReminders(database, { mailer: mailerFromEnv(process.env), baseURL: process.env.APP_URL!, now: () => later, push: pushNotifications }),
})[name!];
if (!job) throw new Error(`The worker has no job named ${name}`);
try {
  await job.handler({});
} finally {
  await database.end();
}
