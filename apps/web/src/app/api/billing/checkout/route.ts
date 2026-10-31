import { BillingError, PromotionCodeRefused } from "@/billing";
import { ORDER_FIELDS } from "@/orders";
import { getOrders } from "@/orders/server";
import { ORDER_CGV_ERROR, routes } from "@/routes";
import { candidatePosting, seeOther, subscriptionPage } from "@/billing/http";

/**
 * The Order page's « Passer au paiement » for a paid Plan (#512): the boxes are checked here, never in the browser. With
 * the CGV box of the version in effect ticked (while one is), sends the Candidate to Stripe Checkout, with the code of a
 * shared link if the form carries one; without it, back to the Order page, and no Checkout Session is created. A
 * Candidate who already pays goes to the customer portal.
 */
export async function POST(request: Request) {
  const candidate = await candidatePosting(request);
  if (!candidate) return seeOther(routes.signIn, request);
  const form = await request.formData();
  const plan = form.get("plan");
  if (typeof plan !== "string" || !plan) return seeOther(subscriptionPage(), request);
  // A shared link's code (/abonnement?code=…): applied at Checkout where it can be, otherwise ignored.
  const code = form.get("code");
  const promotionCode = typeof code === "string" && code.trim() ? code.trim().slice(0, 40) : undefined;
  try {
    const placed = await getOrders().place(
      candidate,
      { kind: "plan", plan, promotionCode },
      { cgv: form.get(ORDER_FIELDS.cgv), immediateExecution: form.get(ORDER_FIELDS.immediateExecution) },
      candidate.locale,
    );
    if (placed.ok) return seeOther(placed.url, request);
    // An unknown or hidden Plan (a stale page, a forged form): back to the plan comparison as it is now.
    if (placed.error === "not_orderable") return seeOther(subscriptionPage(), request);
    return seeOther(routes.planOrder(plan, { code: promotionCode, error: ORDER_CGV_ERROR }), request);
  } catch (error) {
    // A code that cannot be applied: back to the subscription page, which says why and offers to go on without it.
    if (error instanceof PromotionCodeRefused && promotionCode) {
      const query = new URLSearchParams({ code: promotionCode, codeRefused: error.reason, plan });
      return seeOther(subscriptionPage(`?${query}`), request);
    }
    if (error instanceof BillingError && error.code === "plan_not_offered") return seeOther(subscriptionPage(), request);
    console.error("[billing] checkout failed", error);
    const unavailable = error instanceof BillingError && error.code === "stripe_not_configured";
    return seeOther(subscriptionPage(`?error=${unavailable ? "unavailable" : "failed"}`), request);
  }
}
