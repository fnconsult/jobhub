import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { COACH_PROPOSALS_DISPLAYS } from "@/coach-proposals-display";
import { getCoachProposalsDisplays } from "@/coach-proposals-display/server";

const body = z.object({ display: z.enum(COACH_PROPOSALS_DISPLAYS) });

/**
 * The Candidate chooses « Propositions du coach » (Mon compte, Préférences, #717): « card » or « form ».
 * Body: { display: "card" | "form" }.
 * 200 { display } · 400 · 401 · 403
 */
export async function PUT(request: Request) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = body.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  return NextResponse.json({ display: await getCoachProposalsDisplays().choose(candidate.id, parsed.data.display) });
}
