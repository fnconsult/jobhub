import { NextResponse } from "next/server";
import { getCurrentCandidate } from "@/auth/server";
import { getJobSearches } from "@/job-searches/server";

/** The most Job Offer ids `known` takes: far above any run's budget. */
const MAX_KNOWN = 500;

/**
 * One of the signed-in Candidate's Job Searches as the onboarding's page reads it (#1001), each time AI Activity's poll
 * says its run analysed more Job Offers, and once it is over: where it stands, what its run has measured so far, and the
 * Job Offers found until then (kept, once over) as the Match Score reads them, but the Expired ones and those whose ids
 * `known` lists (comma-separated), which the page already has. Reading it changes nothing.
 * 200 JobSearchLive · 401 · 404 (also anyone else's)
 */
export async function GET(request: Request, { params }: RouteContext<"/api/job-searches/[id]/live">) {
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const known = (new URL(request.url).searchParams.get("known") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, MAX_KNOWN);
  const polled = await getJobSearches().live(candidate.id, (await params).id, known);
  if (!polled) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(polled, { headers: { "cache-control": "no-store" } });
}
