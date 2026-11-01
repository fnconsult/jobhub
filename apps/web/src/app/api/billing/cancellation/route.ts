import { BillingError } from "@/billing";
import { getBilling } from "@/billing/server";
import { candidatePosting, seeOther, subscriptionPage } from "@/billing/http";
import { routes } from "@/routes";

/**
 * « Confirmer la résiliation » (#513): schedules the cancellation of the Candidate's paid Plan at the end of the paid
 * period, and emails its acknowledgement. Back to the subscription page, which then shows the end date, saying
 * whether the acknowledgement was sent; with nothing to cancel (already scheduled, a second click), back there as it is.
 */
export async function POST(request: Request) {
  const candidate = await candidatePosting(request);
  if (!candidate) return seeOther(routes.signIn, request);
  try {
    const result = await getBilling().scheduleCancellation(candidate, candidate.locale);
    if (!result.ok) return seeOther(subscriptionPage(), request);
    return seeOther(subscriptionPage(`?resiliation=${result.acknowledged ? "enregistree" : "sans-accuse"}`), request);
  } catch (error) {
    console.error("[billing] cancellation failed", error);
    const unavailable = error instanceof BillingError && error.code === "stripe_not_configured";
    return seeOther(subscriptionPage(`?error=${unavailable ? "unavailable" : "failed"}`), request);
  }
}
