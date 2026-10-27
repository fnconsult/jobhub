import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { getEmailIntake } from "@/email-intake/server";

/**
 * The Candidate switches Email intake on (ADR-0051): they get a Forwarding address, the date recorded.
 * Already on: kept as it is.
 * 200 { address, activatedAt } · 401 · 403
 */
export async function PUT(request: Request) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  return NextResponse.json(await getEmailIntake().switchOn(candidate.id));
}

/**
 * The Candidate switches Email intake off: their Forwarding address stops at once.
 * 204 · 401 · 403
 */
export async function DELETE(request: Request) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  await getEmailIntake().switchOff(candidate.id);
  return new Response(null, { status: 204 });
}
