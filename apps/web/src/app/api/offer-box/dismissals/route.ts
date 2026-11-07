import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { getOfferBox } from "@/offer-box/server";

/** The most entries one « Tout écarter » names: more than the Offer box's 30 days ever hold in one tier. */
const MAX_ENTRIES = 500;

/** The `entryIds` of the body, or null when it holds none or too many. */
async function entryIdsOf(request: Request): Promise<unknown[] | null> {
  const body: unknown = await request.json().catch(() => null);
  const ids = body && typeof body === "object" && "entryIds" in body ? body.entryIds : null;
  return Array.isArray(ids) && ids.length <= MAX_ENTRIES ? ids : null;
}

/**
 * « Tout écarter (n) » in « Précédemment » (ADR-0090, #817): the signed-in Candidate's entries of one Importance tier,
 * within the source chip, as the page shows them, écartées without a reason. Those « Suivies » or already écartées, and
 * ids naming none of the Candidate's entries, are left out of the answer.
 * Body: { entryIds: string[] } (500 at most).
 * 200 { dismissed: string[] } · 400 { error: "invalid_entries" } · 401 · 403
 */
export async function POST(request: Request) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const ids = await entryIdsOf(request);
  if (!ids) return NextResponse.json({ error: "invalid_entries" }, { status: 400 });
  return NextResponse.json(await getOfferBox().dismissAll(candidate.id, ids));
}

/** « Tout écarter »'s « Annuler »: the entries it écarta (`dismissed`) à traiter again. Body: { entryIds }. 204 · 400 · 401 · 403 */
export async function DELETE(request: Request) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const ids = await entryIdsOf(request);
  if (!ids) return NextResponse.json({ error: "invalid_entries" }, { status: 400 });
  await getOfferBox().reconsiderAll(candidate.id, ids);
  return new NextResponse(null, { status: 204 });
}
