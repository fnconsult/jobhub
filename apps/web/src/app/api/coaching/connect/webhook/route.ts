import { getCoachingConnect, getConnectStripe } from "@/coaching-connect/server";
import { getWithdrawals } from "@/withdrawals/server";
import { sharedPool } from "@/database/pool";
export async function POST(request: Request) {
  const stripe = getConnectStripe(),
    signature = request.headers.get("stripe-signature");
  if (!stripe || !signature) return Response.json({ error: "missing_signature" }, { status: 400 });
  let event;
  try {
    event = stripe.verify(await request.text(), signature);
  } catch {
    return Response.json({ error: "invalid_signature" }, { status: 400 });
  }
  if (!event.account) return Response.json({ received: true });
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded")
    await getCoachingConnect().paid(stripe.decodeCheckout(event.data.object), event.account);
  if (event.type === "refund.updated" || event.type === "refund.failed") {
    const refund = event.data.object,
      paymentIntent = typeof refund.payment_intent === "string" ? refund.payment_intent : refund.payment_intent?.id;
    // Ignore another merchant's refund, even if it copied a Jobbbox identifier into metadata.
    if (
      paymentIntent &&
      (await sharedPool().query("SELECT 1 FROM coaching_connect_payment WHERE account_id=$1 AND payment_intent=$2", [event.account, paymentIntent])).rowCount
    )
      await getWithdrawals().refundChanged({
        id: refund.id,
        status:
          refund.status === "failed"
            ? "failed"
            : refund.status === "succeeded"
              ? "succeeded"
              : refund.status === "canceled"
                ? "canceled"
                : refund.status === "requires_action"
                  ? "requires_action"
                  : "pending",
        failureReason: refund.failure_reason ?? null,
      });
  }
  return Response.json({ received: true });
}
