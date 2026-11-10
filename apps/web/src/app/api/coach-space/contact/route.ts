import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { getHumanCoaches } from "@/human-coaches/server";
import { coachSpaceV2On } from "@/coach-space/server";
import { getCoachContacts } from "@/coach-space/contacts-server";
export async function PUT(request: Request) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const person = await getCurrentCandidate();
  if (!person) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const coach = await getHumanCoaches().coachSignedIn(person);
  if (!coach || !coachSpaceV2On()) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const body = await request.json().catch(() => null);
  const saved = await getCoachContacts().save(coach.id, body?.sessionId ?? null, body?.meeting);
  return NextResponse.json(saved ? { ok: true } : { error: "invalid" }, { status: saved ? 200 : 400 });
}
