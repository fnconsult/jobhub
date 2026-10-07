import { BillingError } from "@/billing";
import { getBilling } from "@/billing/server";

/** Stripe webhook endpoint: subscriptions created, changed or ended (ADR-0014). */
export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) return Response.json({ error: "missing_signature" }, { status: 400 });
  try {
    await getBilling().handleStripeWebhook(await request.text(), signature);
  } catch (error) {
    if (error instanceof BillingError) return Response.json({ error: error.code }, { status: 400 });
    throw error; // 500: Stripe retries the delivery.
  }
  return Response.json({ received: true });
}
