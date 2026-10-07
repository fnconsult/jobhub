import { NextResponse } from "next/server";
import { getActionCards } from "@/action-cards/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";

const STATUS = { not_found: 404, already_decided: 409, failed: 500 } as const;

/**
 * The Candidate accepts or dismisses one of their Action Cards.
 * Body: { decision: "accept" | "dismiss" }.
 * 200 { status } · 400 { error: "invalid" } · 401 · 403 · 404 · 409 { error: "already_decided" } · 500 { error: "failed" }
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => undefined);
  const decision = body?.decision;
  if (decision !== "accept" && decision !== "dismiss") return NextResponse.json({ error: "invalid" }, { status: 400 });

  const result = await getActionCards().decide(candidate.id, (await params).id, decision);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: STATUS[result.error] });
  return NextResponse.json({ status: result.card.status });
}
