import type { CoachSpaceResponse } from "@jobhub/shared/reads";
import { NextResponse } from "next/server";
import { getCurrentCandidate } from "@/auth/server";
import { getHumanCoaches } from "@/human-coaches/server";

/**
 * Whether the signed-in person is an active Human Coach (ADR-0016): the Jobbbox app shows « Espace coach » in its
 * drawer only then, and opens the Coach space in a WebView (#689). 200 { humanCoach } · 401
 */
export async function GET() {
  const person = await getCurrentCandidate();
  if (!person) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body: CoachSpaceResponse = { humanCoach: (await getHumanCoaches().coachSignedIn(person)) !== null };
  return NextResponse.json(body, { headers: { "cache-control": "no-store" } });
}
