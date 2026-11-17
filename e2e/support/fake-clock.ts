/**
 * The date the server a spec started (e2e/support/fake-clock.mjs) and the fake Stripe tell, which the spec moves forward: the
 * server's clock only ever forward, as its sessions and cookies are issued with it. The spec's own Two-step verification codes
 * follow it (e2e/support/two-step.ts reads `e2eNow`).
 */
import { writeFileSync } from "node:fs";
import Stripe from "stripe";
export const E2E_NOW = Symbol.for("jobbbox.e2e.now");
export type Clock = {
  /** Moves the server's clock, and Stripe's, to `iso`. */
  server(iso: string): Promise<void>;
  /** Moves Stripe's `created` dates alone, to `iso`: a sale of the story's past. */
  stripe(iso: string): Promise<void>;
  /** A Stripe webhook's signature header, as of the real time the server still tells. */
  sign(payload: string, secret: string): string;
};
export function fakeClock(file: string, stripeUrl: string): Clock {
  const stripe = (iso: string) => fetch(`${stripeUrl}/__connect/clock`, { method: "POST", body: new URLSearchParams({ at: iso }) }).then(() => undefined);
  return {
    stripe,
    async server(iso) {
      const set = Date.now(),
        base = Date.parse(iso);
      (globalThis as Record<symbol, unknown>)[E2E_NOW] = () => new Date(base + Date.now() - set);
      writeFileSync(file, iso);
      await stripe(iso);
      // The server reads its clock file every 20 ms.
      await new Promise((resolve) => setTimeout(resolve, 150));
    },
    sign: (payload, secret) => new Stripe("sk_test_fake").webhooks.generateTestHeaderString({ payload, secret }),
  };
}
