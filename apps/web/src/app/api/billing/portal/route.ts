import { BillingError } from "@/billing";
import { getBilling } from "@/billing/server";
import { routes } from "@/routes";
import { candidatePosting, seeOther, subscriptionPage } from "@/billing/http";

/** The subscription page's "Manage my subscription" form: opens the Stripe customer portal. */
export async function POST(request: Request) {
  const candidate = await candidatePosting(request);
  if (!candidate) return seeOther(routes.signIn, request);
  try {
    const url = await getBilling().openCustomerPortal(candidate.id, candidate.locale);
    return seeOther(url ?? subscriptionPage(), request);
  } catch (error) {
    console.error("[billing] customer portal failed", error);
    const unavailable = error instanceof BillingError && error.code === "stripe_not_configured";
    return seeOther(subscriptionPage(`?error=${unavailable ? "unavailable" : "failed"}`), request);
  }
}
