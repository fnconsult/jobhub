import { FREE_PLAN } from "@jobhub/shared";
import { BillingError } from "@/billing";
import { getBilling } from "@/billing/server";
import { routes } from "@/routes";
import { candidatePosting, seeOther, subscriptionPage } from "@/billing/http";

/** The subscription page's "Choose this Plan" form: sends the Candidate to Stripe Checkout for an offered paid Plan. */
export async function POST(request: Request) {
  const candidate = await candidatePosting(request);
  if (!candidate) return seeOther(routes.signIn, request);
  const plan = (await request.formData()).get("plan");
  if (typeof plan !== "string" || plan === FREE_PLAN) return seeOther(subscriptionPage(), request);
  try {
    return seeOther(await getBilling().startCheckout(candidate, plan, candidate.locale), request);
  } catch (error) {
    // An unknown or hidden Plan (a stale page, a forged form): back to the plan comparison as it is now.
    if (error instanceof BillingError && error.code === "plan_not_offered") return seeOther(subscriptionPage(), request);
    console.error("[billing] checkout failed", error);
    const unavailable = error instanceof BillingError && error.code === "stripe_not_configured";
    return seeOther(subscriptionPage(`?error=${unavailable ? "unavailable" : "failed"}`), request);
  }
}
