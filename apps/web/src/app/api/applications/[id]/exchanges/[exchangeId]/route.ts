import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { exchangesOn, getExchanges } from "@/exchanges/server";

/** Who may change an Exchange: the signed-in Candidate, from our own pages, while Exchanges are on (#1099); else the answer. */
async function candidateOf(request: Request): Promise<{ id: string } | NextResponse> {
  if (!exchangesOn()) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  return candidate ?? NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

/**
 * « Rattacher à <employeur> » (#1099, ADR-0115): ties an email offered to the Candidate to this Application, one of those
 * it was offered to. Nothing is tied without this gesture. 200 · 401 · 403 · 404 (Exchanges off, not theirs, not offered here)
 */
export async function POST(request: Request, { params }: RouteContext<"/api/applications/[id]/exchanges/[exchangeId]">) {
  const candidate = await candidateOf(request);
  if (candidate instanceof NextResponse) return candidate;
  const { id, exchangeId } = await params;
  if (!(await getExchanges().tie(candidate.id, exchangeId, id))) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ tied: true });
}

/**
 * Deletes an Exchange kept on this Application, or turns down an email offered to it (« Ignorer »): nothing of it is kept.
 * 200 · 401 · 403 · 404
 */
export async function DELETE(request: Request, { params }: RouteContext<"/api/applications/[id]/exchanges/[exchangeId]">) {
  const candidate = await candidateOf(request);
  if (candidate instanceof NextResponse) return candidate;
  const { id, exchangeId } = await params;
  const exchanges = getExchanges();
  const shown = await exchanges.onApplication(candidate.id, id);
  const kept = shown?.kept.some((exchange) => exchange.id === exchangeId) ?? false;
  const offered = shown?.offered.some((exchange) => exchange.id === exchangeId) ?? false;
  const done = kept ? await exchanges.remove(candidate.id, exchangeId) : offered ? await exchanges.dismiss(candidate.id, exchangeId) : false;
  if (!done) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
