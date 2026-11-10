import type { CoachSpaceResponse } from "@jobhub/shared/reads";
import { NextResponse } from "next/server";
import { getCurrentCandidate } from "@/auth/server";
import { hasHumanCoachIdentity } from "@/human-coaches/server";

/**
 * Whether the signed-in person is an active Human Coach (ADR-0016): the Jobbbox app shows « Espace coach » in its
 * drawer only then, and opens the Coach space in a WebView (#689). Pending contract acceptance keeps this navigation
 * entry visible; it grants no Candidate access and the destination presents the agreement (#880). 200 { humanCoach } · 401
 */
export async function GET() {
  const person = await getCurrentCandidate();
  if (!person) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body: CoachSpaceResponse = { humanCoach: await hasHumanCoachIdentity(person) };
  return NextResponse.json(body, { headers: { "cache-control": "no-store" } });
}
