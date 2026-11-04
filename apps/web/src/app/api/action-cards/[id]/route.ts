import { NextResponse } from "next/server";
import { getActionCards } from "@/action-cards/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { proposalCardOf } from "@/coach-proposals";

const STATUS = { invalid: 400, not_found: 404, already_decided: 409, conflict: 409, not_undoable: 409, failed: 500 } as const;

/**
 * The Candidate applies, dismisses or puts back one of their Action Cards.
 * Body: { decision: "accept" | "dismiss" | "undo", edited? }. `edited`: what the Candidate changed before applying a Coach
 * proposal (« Modifier avant d'appliquer », #715), the form's fields by name. "undo" is « Annuler » on an applied one.
 * `card`: a Coach proposal's card as the thread shows it, once decided.
 * 200 { status, card? } · 400 { error: "invalid", errors? } · 401 · 403 · 404 · 409 { error: "already_decided" | "conflict" | "not_undoable" }
 * (`conflict`: the object changed since the proposal, or since it was applied) · 500 { error: "failed" }
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => undefined);
  const decision = body?.decision;
  if (decision !== "accept" && decision !== "dismiss" && decision !== "undo") return NextResponse.json({ error: "invalid" }, { status: 400 });
  const edited: unknown = body?.edited;
  if (edited !== undefined && (typeof edited !== "object" || edited === null || Array.isArray(edited))) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const id = (await params).id;
  const cards = getActionCards();
  const result = decision === "undo" ? await cards.undo(candidate.id, id) : await cards.decide(candidate.id, id, decision, decision === "accept" && edited ? { edited } : {});
  if (!result.ok) return NextResponse.json({ error: result.error, ...("errors" in result ? { errors: result.errors } : {}) }, { status: STATUS[result.error] });
  const card = proposalCardOf(result.card);
  return NextResponse.json({ status: result.card.status, ...(card ? { card } : {}) });
}
