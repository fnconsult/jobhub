import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STRIPE_WEBHOOK_EVENTS } from "./webhook-events";

describe("the Stripe events the webhook acts on", () => {
  it("include the refunds' later updates and failures, which a Withdrawal's failed refund comes from (#511)", () => {
    expect(STRIPE_WEBHOOK_EVENTS).toEqual(expect.arrayContaining(["refund.updated", "refund.failed"]));
  });

  it("are each named in the operator's Stripe checklist, so the destination is subscribed to them all", () => {
    const checklist = readFileSync(new URL("../../../../docs/ops/billing.md", import.meta.url), "utf8");
    const endpoint = checklist.split("\n").find((line) => line.includes("**The webhook endpoint**")) ?? "";
    expect(STRIPE_WEBHOOK_EVENTS.filter((event) => !endpoint.includes(`\`${event}\``))).toEqual([]);
  });
});
