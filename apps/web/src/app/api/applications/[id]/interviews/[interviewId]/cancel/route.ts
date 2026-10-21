import { NextResponse } from "next/server";
import { applicationResponse } from "@/applications/http";
import { getApplications } from "@/applications/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";

/**
 * Cancels one of an Application's Interviews: it stays, struck through, with the date it was cancelled
 * (a Cancelled Agenda Item). Removing it instead (DELETE on the Interview) is for an entry made by mistake.
 * 200 { id } · 401 · 403 · 404
 */
export async function POST(request: Request, { params }: RouteContext<"/api/applications/[id]/interviews/[interviewId]/cancel">) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id, interviewId } = await params;
  return applicationResponse(await getApplications().cancelInterview(candidate.id, id, interviewId));
}
