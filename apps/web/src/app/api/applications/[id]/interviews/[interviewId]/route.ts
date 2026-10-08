import { NextResponse } from "next/server";
import { applicationResponse } from "@/applications/http";
import { getApplications } from "@/applications/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";

/** Removes one of an Application's Interviews. 200 { id } · 401 · 403 · 404 */
export async function DELETE(request: Request, { params }: RouteContext<"/api/applications/[id]/interviews/[interviewId]">) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id, interviewId } = await params;
  return applicationResponse(await getApplications().removeInterview(candidate.id, id, interviewId));
}
