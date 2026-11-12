// « Espace coach v2 » (ADR-0106): a 404 while it is off, as before the Human Coach epic.
import { coachSpaceV2On } from "@/coach-space-v2/server";
import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { getCoachingCancellations } from "@/coaching-cancellations/server";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!coachSpaceV2On()) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const result = await getCoachingCancellations().choose(candidate.id, (await params).id, body.choice, body.peerCoachId);
  return NextResponse.json(result, { status: result.ok ? 200 : 409 });
}
