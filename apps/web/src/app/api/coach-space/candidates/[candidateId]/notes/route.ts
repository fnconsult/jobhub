import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { getHumanCoaches } from "@/human-coaches/server";
import { coachSpaceV2On } from "@/coach-space/server";
import { getCoachWorkspace } from "@/coach-space/workspace-server";

export async function PUT(request: Request, { params }: { params: Promise<{ candidateId: string }> }) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const person = await getCurrentCandidate();
  if (!person) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const coach = await getHumanCoaches().coachSignedIn(person);
  if (!coach || !coachSpaceV2On()) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const body = await request.json().catch(() => null);
  const result = await getCoachWorkspace().saveNote(coach.id, (await params).candidateId, body?.sessionId ?? null, body?.text, body?.revision);
  return NextResponse.json(result, { status: result.ok ? 200 : result.error === "conflict" ? 409 : result.error === "invalid" ? 400 : 404 });
}
