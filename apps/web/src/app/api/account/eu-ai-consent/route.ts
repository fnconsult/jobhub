import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { getEuAiConsents } from "@/eu-ai-consent/server";

/**
 * The Candidate gives EU AI consent (ADR-0007 amendment): their identity-bearing AI calls go to Mistral.
 * Already given: kept with its first date.
 * 200 { givenAt } · 401 · 403
 */
export async function PUT(request: Request) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const givenAt = await getEuAiConsents().give(candidate.id);
  return NextResponse.json({ givenAt });
}

/**
 * The Candidate withdraws EU AI consent.
 * 204 · 401 · 403
 */
export async function DELETE(request: Request) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  await getEuAiConsents().withdraw(candidate.id);
  return new Response(null, { status: 204 });
}
