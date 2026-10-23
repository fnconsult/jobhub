import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { getJobSearches } from "@/job-searches/server";

const STATUS = { not_found: 404, forbidden: 403, over: 409 } as const;

/**
 * Stops one of the Candidate's Job Searches still searching (#331): the worker stops it between two steps, and the AI
 * call on its way, and keeps the Job Offers it had found. Only its own Candidate can.
 * 202 · 401 · 403 (another Candidate's, or not from the app) · 404 · 409 { error: "over" } (it is no longer searching)
 */
export async function POST(request: Request, { params }: RouteContext<"/api/job-searches/[id]/stop">) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const stopped = await getJobSearches().stop(candidate.id, (await params).id);
  if (stopped.ok) return new NextResponse(null, { status: 202 });
  return NextResponse.json({ error: stopped.error }, { status: STATUS[stopped.error] });
}
