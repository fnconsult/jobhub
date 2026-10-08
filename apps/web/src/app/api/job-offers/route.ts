import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { getJobOffers } from "@/job-offers/server";

/**
 * Captures a Job Offer. Needs no account: the extension's Guest flow captures
 * too, and a posting only Guests captured is forgotten within 24 hours
 * (ADR-0003). Capturing a posting already stored returns the stored Job Offer.
 * Body: { source?: { url?, name? }, title, content, employer?, location?, contractType?,
 *         remoteWork?, salary?: { min?, max? }, skills?, requiredExperienceYears? }.
 * 200 JobOffer · 400 { errors: JobOfferFieldError[] } · 403
 */
export async function POST(request: Request) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  const body: unknown = await request.json().catch(() => undefined);
  const captured = await getJobOffers().capture(body, candidate ? "candidate" : "guest");
  if (!captured.ok) return NextResponse.json({ errors: captured.errors }, { status: 400 });
  return NextResponse.json(captured.jobOffer);
}
