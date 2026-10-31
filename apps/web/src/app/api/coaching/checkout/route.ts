import { BillingError } from "@/billing";
import { candidatePosting, seeOther } from "@/billing/http";
import { ORDER_FIELDS } from "@/orders";
import { getOrders } from "@/orders/server";
import { ORDER_CGV_ERROR, routes } from "@/routes";

/**
 * The Order page's « Passer au paiement » for a Coaching Session (#512): the boxes are checked here, never in the
 * browser. With the CGV box of the version in effect ticked (while one is), sends the Candidate to Stripe Checkout at
 * their Coaching Session Price; without it, back to the Order page, and no Checkout Session is created.
 */
export async function POST(request: Request) {
  const candidate = await candidatePosting(request);
  if (!candidate) return seeOther(routes.signIn, request);
  const form = await request.formData();
  const coachId = form.get("coachId");
  if (typeof coachId !== "string" || !coachId) return seeOther(routes.coaching, request);
  try {
    const placed = await getOrders().place(
      candidate,
      { kind: "coachingSession", coachId },
      { cgv: form.get(ORDER_FIELDS.cgv), immediateExecution: form.get(ORDER_FIELDS.immediateExecution) },
      candidate.locale,
    );
    if (placed.ok) return seeOther(placed.url, request);
    if (placed.error === "not_orderable") return seeOther(routes.coaching, request);
    return seeOther(routes.coachingOrder(coachId, { error: ORDER_CGV_ERROR }), request);
  } catch (error) {
    console.error("[coaching] checkout failed", error);
    const unavailable = error instanceof BillingError && (error.code === "stripe_not_configured" || error.code === "coaching_sessions_not_configured");
    return seeOther(`${routes.coaching}?error=${unavailable ? "unavailable" : "failed"}`, request);
  }
}
