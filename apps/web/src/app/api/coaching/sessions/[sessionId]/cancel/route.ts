import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { getHumanCoaches } from "@/human-coaches/server";

/**
 * The Candidate cancels one of their own Coaching Sessions: its date is cleared, so it is back under
 * « À planifier », and the cancellation is kept in its Reschedule history. Refunds are handled outside Jobbbox.
 * 200 { id } · 401 · 403 · 404 (no such session of this Candidate)
 */
export async function POST(request: Request, { params }: RouteContext<"/api/coaching/sessions/[sessionId]/cancel">) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { sessionId } = await params;
  const result = await getHumanCoaches().cancelSession(candidate.id, sessionId);
  if (result.ok) return NextResponse.json({ id: result.session.id });
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}
