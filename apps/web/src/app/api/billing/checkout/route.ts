import { FREE_PLAN } from "@jobhub/shared";
import { BillingError } from "@/billing";
import { getBilling } from "@/billing/server";
import { routes } from "@/routes";
import { candidatePosting, seeOther, subscriptionPage } from "@/billing/http";

/**
 * The subscription page's "Choose this Plan" form: sends the Candidate to Stripe Checkout for an offered
 * paid Plan, with the code of a shared link if the form carries one.
 */
export async function POST(request: Request) {
  const candidate = await candidatePosting(request);
  if (!candidate) return seeOther(routes.signIn, request);
  const form = await request.formData();
  const plan = form.get("plan");
  if (typeof plan !== "string" || plan === FREE_PLAN) return seeOther(subscriptionPage(), request);
  // A shared link's code (/abonnement?code=…): applied at Checkout where it can be, otherwise ignored.
  const code = form.get("code");
  const promotionCode = typeof code === "string" && code.trim() ? code.trim().slice(0, 40) : undefined;
  try {
    return seeOther(await getBilling().startCheckout(candidate, plan, candidate.locale, { promotionCode }), request);
  } catch (error) {
    // An unknown or hidden Plan (a stale page, a forged form): back to the plan comparison as it is now.
    if (error instanceof BillingError && error.code === "plan_not_offered") return seeOther(subscriptionPage(), request);
    console.error("[billing] checkout failed", error);
    const unavailable = error instanceof BillingError && error.code === "stripe_not_configured";
    return seeOther(subscriptionPage(`?error=${unavailable ? "unavailable" : "failed"}`), request);
  }
}
