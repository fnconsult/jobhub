// Runs the worker's monthly Seller payout once (the job `coachingConnect.runMonthly`, apps/worker/src/main.ts) as of the
// date it is given, against the database DATABASE_URL names and the fake Stripe STRIPE_API_URL names:
// `tsx e2e/support/connect-monthly.ts 2026-03-01T12:00Z`.
import pg from "pg";
import { coachingConnect } from "../../apps/web/src/coaching-connect";
import { stripeConnect } from "../../apps/web/src/coaching-connect/stripe";

const at = new Date(process.argv[2]!);
if (Number.isNaN(+at)) throw new Error("a date is required");
const database = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const result = await coachingConnect(database, {
    stripe: stripeConnect({ secretKey: process.env.STRIPE_SECRET_KEY!, webhookSecret: process.env.STRIPE_CONNECT_WEBHOOK_SECRET!, apiUrl: process.env.STRIPE_API_URL, now: () => at }),
    baseURL: process.env.APP_URL!,
    now: () => at,
    permitted: async () => true,
    maySell: async () => true,
    recordPaid: async () => undefined,
    attachSale: async () => undefined,
    confirmOrder: async () => undefined,
  } as never).runMonthly();
  console.log(JSON.stringify(result));
} finally {
  await database.end();
}
