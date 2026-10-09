import { spawn, type ChildProcess } from "node:child_process";
import { expect, test } from "@playwright/test";
import { fakeCustomerId, FAKE_STRIPE_PRICES } from "../apps/web/src/billing/fake-stripe";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";
import { derivedPort } from "./support/ports";

// Issue #73: the billing configuration refuses a Stripe product ID (prod_…) where a
// price ID (price_…) is expected, with an error naming the variable, instead of
// letting Stripe fail at checkout with "No such price". Checked through the public
// checkout form on a second build of the app started with STRIPE_PRICE_STANDARD=prod_x,
// on the suite's database and fake Stripe; the suite's own server (price_… values)
// is the control: it still sends the Candidate to Stripe Checkout.
const stripeUrl = process.env.E2E_STRIPE_URL!;

async function checkoutCalls(): Promise<{ params: Record<string, string> }[]> {
  const calls = await (await fetch(`${stripeUrl}/__calls`)).json();
  return calls.filter((call: { path: string }) => call.path === "/v1/checkout/sessions");
}

async function startServerWithProductIdAsStandardPrice() {
  const port = derivedPort(873);
  const serverOrigin = `http://localhost:${port}`;
  const env: NodeJS.ProcessEnv = { ...process.env, NEXT_TELEMETRY_DISABLED: "1" };
  delete env.NODE_OPTIONS;
  Object.assign(env, {
    DATABASE_URL: process.env.E2E_DATABASE_URL,
    APP_URL: serverOrigin,
    AUTH_SECRET: process.env.AUTH_SECRET ?? "e2e-only-secret-e2e-only-secret-e2e-only",
    MAIL_TRANSPORT: "console",
    STRIPE_SECRET_KEY: "sk_test_fake",
    STRIPE_WEBHOOK_SECRET: "whsec_test_fake",
    STRIPE_PRICE_STANDARD: "prod_x",
    STRIPE_PRICE_PREMIUM: FAKE_STRIPE_PRICES.premium,
    STRIPE_API_URL: stripeUrl,
  });
  let output = "";
  const child: ChildProcess = spawn("npx", ["next", "start", "apps/web", "-p", String(port)], { env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout!.on("data", (chunk) => (output += chunk));
  child.stderr!.on("data", (chunk) => (output += chunk));
  const stop = () => {
    try {
      process.kill(-child.pid!, "SIGTERM");
    } catch {
      // already gone
    }
  };
  try {
    await expect
      .poll(
        async () => {
          if (child.exitCode !== null) throw new Error(`web app exited (${child.exitCode}):\n${output}`);
          return fetch(`${serverOrigin}/api/health`).then((r) => r.status, () => 0);
        },
        { timeout: 90_000, message: "web app answers /api/health" },
      )
      .toBe(200);
  } catch (error) {
    stop();
    throw error;
  }
  return { origin: serverOrigin, stop, output: () => output };
}

test.describe("Stripe price IDs in the billing configuration", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  let server: Awaited<ReturnType<typeof startServerWithProductIdAsStandardPrice>>;
  test.beforeAll(async () => {
    server = await startServerWithProductIdAsStandardPrice();
  });
  test.afterAll(() => server?.stop());

  test("a product ID as STRIPE_PRICE_STANDARD is refused with an error naming the variable, before Stripe is called", async ({ page }) => {
    const email = newAddress("price-id-prod");
    await signInWithMagicLink(page, email);
    const before = server.output().length;

    // The Candidate's session carries over to the second server (same AUTH_SECRET, localhost cookies span ports).
    const checkout = await page.request.post(`${server.origin}/api/billing/checkout`, {
      form: { plan: "standard" },
      headers: { origin: server.origin },
      maxRedirects: 0,
    });

    expect(checkout.status()).toBe(303);
    expect(checkout.headers().location).toMatch(/\/abonnement\?error=failed$/);
    await expect.poll(() => server.output().slice(before)).toContain("STRIPE_PRICE_STANDARD");
    const log = server.output().slice(before);
    expect(log).toMatch(/STRIPE_PRICE_STANDARD must be a Stripe price ID \(starts price_\)/);
    expect(log).toContain("product ID (prod_…)");
    expect(log).not.toContain("No such price");
    expect((await checkoutCalls()).filter((call) => call.params.customer === fakeCustomerId(email))).toEqual([]);
  });

  test("price_… values load as before: the suite's server sends the Candidate to Stripe Checkout", async ({ page }) => {
    const email = newAddress("price-id-ok");
    await signInWithMagicLink(page, email);

    const checkout = await page.request.post("/api/billing/checkout", {
      form: { plan: "standard" },
      headers: { origin: process.env.E2E_WEB_ORIGIN! },
      maxRedirects: 0,
    });

    expect(checkout.status()).toBe(303);
    expect(checkout.headers().location).toMatch(/^https:\/\/checkout\.stripe\.test\//);
    const [call] = (await checkoutCalls()).filter((c) => c.params.customer === fakeCustomerId(email));
    expect(call?.params["line_items[0][price]"]).toBe(FAKE_STRIPE_PRICES.standard);
  });
});
