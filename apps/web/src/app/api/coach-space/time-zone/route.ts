import { requireCoachSpaceV2 } from "@/coach-space-v2/server";
import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { getHumanCoaches } from "@/human-coaches/server";
import { getCoachingTimeZones } from "@/coaching-time/server";

export async function PUT(request: Request) {
    requireCoachSpaceV2(); // « Espace coach v2 » off (ADR-0106): this route answers 404.
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const person = await getCurrentCandidate();
  if (!person) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const coach = await getHumanCoaches().coachSignedIn(person);
  if (!coach) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const body = await request.json().catch(() => null);
  const saved = await getCoachingTimeZones().saveCoach(coach.id, body?.timeZone);
  return NextResponse.json(saved ? { ok: true } : { error: "invalid" }, { status: saved ? 200 : 400 });
}
