import { BillingError } from "@/billing";
import { candidatePosting, seeOther } from "@/billing/http";
import { getBilling } from "@/billing/server";
import { getHumanCoaches } from "@/human-coaches/server";
import { routes } from "@/routes";

/** The Human Coaches page's "Book a session" form: sends the Candidate to Stripe Checkout at their Coaching Session Price. */
export async function POST(request: Request) {
  const candidate = await candidatePosting(request);
  if (!candidate) return seeOther(routes.signIn, request);
  const coachId = (await request.formData()).get("coachId");
  const coach = (await getHumanCoaches().list()).find((listed) => listed.id === coachId);
  if (!coach) return seeOther(routes.coaching, request);
  try {
    return seeOther(await getBilling().startCoachingSessionCheckout(candidate, coach.id, candidate.locale), request);
  } catch (error) {
    console.error("[coaching] checkout failed", error);
    const unavailable = error instanceof BillingError && (error.code === "stripe_not_configured" || error.code === "coaching_sessions_not_configured");
    return seeOther(`${routes.coaching}?error=${unavailable ? "unavailable" : "failed"}`, request);
  }
}
