import { test } from "@playwright/test";
import { startFakeStripe, type FakeStripe } from "../apps/web/src/billing/fake-stripe";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";
import { configuredStripe, expectComparisonWithoutPrices, startServer } from "./support/plan-prices";

// Issue #103: the Plans comparison on /abonnement carries a price row, read from
// Stripe. When Stripe cannot be reached or never answers, the page still renders,
// quickly, without that row. (The row with prices, in both Interface Languages, is
// covered in billing.spec.ts against the fake Stripe; Stripe not configured, which
// only the development server allows, in plan-prices-dev.spec.ts.)
// Checked on second builds of the app (`next start`) on the suite's database.
type Variant = { name: string; offset: number; stripe: () => Promise<Record<string, string>> };
let hangingStripe: FakeStripe | undefined;
const variants: Variant[] = [
  { name: "Stripe cannot be reached", offset: 831, stripe: async () => ({ ...configuredStripe, STRIPE_API_URL: "http://127.0.0.1:9" }) },
  {
    // An outage where Stripe takes the request and never answers: the page must not wait on it.
    name: "Stripe never answers",
    offset: 832,
    stripe: async () => {
      hangingStripe = await startFakeStripe();
      hangingStripe.stopAnswering();
      return { ...configuredStripe, STRIPE_API_URL: hangingStripe.url };
    },
  },
];

for (const variant of variants) {
  test.describe(`Plan prices when ${variant.name}`, () => {
    test.describe.configure({ mode: "serial", timeout: 180_000 });
    let server: Awaited<ReturnType<typeof startServer>>;
    test.beforeAll(async () => {
      server = await startServer(variant.offset, await variant.stripe(), "start");
    });
    test.afterAll(async () => {
      server?.stop();
      await hangingStripe?.stop();
      hangingStripe = undefined;
    });

    // The first visit is the timed one: after a failed lookup the app stops asking Stripe for a minute.
    test("/abonnement still renders its comparison, without the price row", async ({ page }) => {
      await signInWithMagicLink(page, newAddress("plan-prices-down"));
      await expectComparisonWithoutPrices(page, server);
    });
  });
}
