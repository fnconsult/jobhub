import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { getHumanCoaches } from "@/human-coaches/server";

/**
 * The Candidate enters or edits the date of one of their own Coaching Sessions, booked on the
 * Human Coach's Cal.com page (ADR-0027). Body: { scheduledAt (French time without an offset),
 * durationMinutes?, videoLink? (http or https), note? }; it replaces all four.
 * 200 { id } · 400 { errors } · 401 · 403 · 404 (no such session of this Candidate).
 * There is no DELETE: a Candidate never deletes a Coaching Session.
 */
export async function PATCH(request: Request, { params }: RouteContext<"/api/coaching/sessions/[sessionId]">) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { sessionId } = await params;
  const body: unknown = await request.json().catch(() => undefined);
  const result = await getHumanCoaches().scheduleSession(candidate.id, sessionId, body);
  if (result.ok) return NextResponse.json({ id: result.session.id });
  if ("errors" in result) return NextResponse.json({ errors: result.errors }, { status: 400 });
  return NextResponse.json({ error: result.error }, { status: 404 });
}
