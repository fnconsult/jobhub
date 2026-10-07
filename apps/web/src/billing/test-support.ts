import { signInWithMagicLink, startTestAuth } from "../auth/test-support";
import { FAKE_STRIPE_PRICES, FAKE_STRIPE_SECRET_KEY, FAKE_STRIPE_WEBHOOK_SECRET, startFakeStripe } from "./fake-stripe";
import { createBilling, migrateBilling, type BillingConfig } from "./index";

export { connectionString } from "../auth/test-support";

/**
 * The billing module on a throwaway database (with the Candidate accounts it
 * hangs off), talking to a fake Stripe over HTTP, on a clock the test moves.
 */
export async function startTestBilling(overrides: Partial<BillingConfig> = {}) {
  const testAuth = await startTestAuth();
  const stripe = await startFakeStripe();
  const clock = { now: new Date("2026-10-15T10:00:00+02:00") };
  const config: BillingConfig = {
    database: testAuth.database,
    baseURL: "http://localhost:3000",
    stripe: {
      secretKey: FAKE_STRIPE_SECRET_KEY,
      webhookSecret: FAKE_STRIPE_WEBHOOK_SECRET,
      prices: FAKE_STRIPE_PRICES,
      apiUrl: stripe.url,
    },
    now: () => clock.now,
    ...overrides,
  };
  await migrateBilling(config.database);
  const billing = createBilling(config);

  return {
    billing,
    stripe,
    clock,
    /** Runs the billing migration again, as every deployment does. */
    migrateAgain: () => migrateBilling(config.database),
    /** Signs a new Candidate up; returns who they are. */
    async signUp(email: string) {
      const cookie = await signInWithMagicLink(testAuth, email);
      const session = await (await testAuth.request("/api/auth/get-session", { cookie })).json();
      return { id: session.user.id as string, email: session.user.email as string };
    },
    async stop() {
      await stripe.stop();
      await testAuth.stop();
    },
  };
}

export type TestBilling = Awaited<ReturnType<typeof startTestBilling>>;
