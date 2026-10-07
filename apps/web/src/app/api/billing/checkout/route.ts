import { PLANS, type Plan } from "@jobhub/shared";
import { BillingError } from "@/billing";
import { getBilling } from "@/billing/server";
import { routes } from "@/routes";
import { candidatePosting, seeOther, subscriptionPage } from "@/billing/http";

/** The subscription page's "Choose this Plan" form: sends the Candidate to Stripe Checkout. */
export async function POST(request: Request) {
  const candidate = await candidatePosting(request);
  if (!candidate) return seeOther(routes.signIn, request);
  const plan = (await request.formData()).get("plan");
  if (!PLANS.includes(plan as Plan) || plan === "free") return seeOther(subscriptionPage(), request);
  try {
    return seeOther(await getBilling().startCheckout(candidate, plan as Plan, candidate.locale), request);
  } catch (error) {
    console.error("[billing] checkout failed", error);
    const unavailable = error instanceof BillingError && error.code === "stripe_not_configured";
    return seeOther(subscriptionPage(`?error=${unavailable ? "unavailable" : "failed"}`), request);
  }
}
