import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { getSignalements } from "@/signalements/server";

/** Closes the notification of one of the Candidate's Signalements (#377); nothing for anyone else's. 204 · 401 · 403 */
export async function DELETE(request: Request, { params }: RouteContext<"/api/signalements/[id]/notification">) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await getSignalements().closeNotifications(candidate.id, (await params).id);
  return new NextResponse(null, { status: 204 });
}
