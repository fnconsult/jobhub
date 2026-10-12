import { test } from "@playwright/test";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";
import { expectComparisonWithoutPrices, startServer } from "./support/plan-prices";

// Issue #103: the Plans comparison on /abonnement still renders, quickly, without its
// price row when Stripe is not configured. A production build requires Stripe; only
// the development server (`next dev`) runs without it.
//
// In the root-env project, not web: Next.js refuses a second `next dev` in apps/web
// ("Another next dev server is already running"), and root-env.spec.ts and
// dev-servers.spec.ts run `npm run dev` there; that project runs one spec at a time.
//
// `next dev` compiles a route on its first request: tens of seconds while the other
// projects load the machine. That compile is not what the timing checks, so /abonnement
// is requested once, with the Candidate's session, before the timed visit. Stripe is
// not configured, so there is no Stripe lookup for that first request to warm up. It is
// an HTTP request, not a visit: a page left open on the development server keeps its
// live-reload connection, whose rebuilds can stall the next visit's load event.
test.use({ baseURL: process.env.E2E_WEB_ORIGIN, locale: "en-US" });

test.describe("Plan prices when Stripe is not configured (development server)", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });
  let server: Awaited<ReturnType<typeof startServer>>;
  test.beforeAll(async () => {
    server = await startServer(830, {}, "dev");
  });
  test.afterAll(() => server?.stop());

  test("/abonnement still renders its comparison, without the price row", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("plan-prices-down"));
    await page.request.get(`${server.origin}/abonnement`, { timeout: 120_000 });
    await expectComparisonWithoutPrices(page, server);
  });
});
