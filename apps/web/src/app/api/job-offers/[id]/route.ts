import { NextResponse } from "next/server";
import { getJobOffers } from "@/job-offers/server";

/** A Job Offer. Job Offers are not personal data and need no account. 200 JobOffer · 404 */
export async function GET(_request: Request, { params }: RouteContext<"/api/job-offers/[id]">) {
  const jobOffer = await getJobOffers().get((await params).id);
  if (!jobOffer) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(jobOffer);
}
