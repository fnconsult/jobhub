import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { getHumanCoaches } from "@/human-coaches/server";

/**
 * The signed-in Human Coach cancels one of their own Coaching Sessions: its date is cleared, so the
 * Candidate sees it back under « À planifier », and the cancellation is kept in its Reschedule history as theirs.
 * 200 { id } · 401 · 403 · 404 (not a Human Coach, retired, or not their session)
 */
export async function POST(request: Request, { params }: RouteContext<"/api/coach-space/sessions/[sessionId]/cancel">) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const person = await getCurrentCandidate();
  if (!person) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const coaches = getHumanCoaches();
  const coach = await coaches.coachSignedIn(person);
  if (!coach) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const { sessionId } = await params;
  const result = await coaches.cancelCoachedSession(coach.id, sessionId);
  if (result.ok) return NextResponse.json({ id: sessionId });
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}
