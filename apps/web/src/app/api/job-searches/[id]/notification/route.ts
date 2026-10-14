import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { getJobSearches } from "@/job-searches/server";

/** Dismisses the notification of one of the Candidate's finished Job Searches. 204 · 401 · 403 */
export async function DELETE(request: Request, { params }: RouteContext<"/api/job-searches/[id]/notification">) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await getJobSearches().dismissNotification(candidate.id, (await params).id);
  return new NextResponse(null, { status: 204 });
}
