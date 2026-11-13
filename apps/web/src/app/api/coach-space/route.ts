import {hasAssociationIdentity} from "@/coach-associations/server";
import type { CoachSpaceResponse } from "@jobhub/shared/reads";
import { NextResponse } from "next/server";
import { getCurrentCandidate } from "@/auth/server";
import { coachSpaceV2On } from "@/coach-space-v2/server";
import { getHumanCoaches, hasHumanCoachIdentity } from "@/human-coaches/server";

/**
 * Whether the signed-in person is an active Human Coach (ADR-0016): the Jobbbox app shows « Espace coach » in its
 * drawer only then, and opens the Coach space in a WebView (#689). Pending contract acceptance keeps this navigation
 * entry visible; it grants no Candidate access and the destination presents the agreement (#880). 200 { humanCoach } · 401
 */
export async function GET() {
  const person = await getCurrentCandidate();
  if (!person) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // « Espace coach v2 » off (ADR-0107): an active Human Coach only, and no Association entry.
  if (!coachSpaceV2On()) {
    const legacy: CoachSpaceResponse = { humanCoach: (await getHumanCoaches().coachSignedIn(person)) !== null };
    return NextResponse.json(legacy, { headers: { "cache-control": "no-store" } });
  }
  const body: CoachSpaceResponse = { humanCoach: await hasHumanCoachIdentity(person),...await hasAssociationIdentity(person)?{associationSpace:true}:{}, coachSpaceV2: true };
  return NextResponse.json(body, { headers: { "cache-control": "no-store" } });
}
