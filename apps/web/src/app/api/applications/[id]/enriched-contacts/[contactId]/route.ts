import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { enrichedContactsResponse } from "@/enriched-contacts/http";
import { getEnrichedContacts } from "@/enriched-contacts/server";
import { localeOf } from "@/i18n/server";

/**
 * Reveals a found person's contact details: one Enriched Contact, counted against the Plan Quota.
 * 200 EnrichedContactsState · 401 · 402 · 403 · 404 · 409 · 503
 */
export async function POST(request: Request, { params }: RouteContext<"/api/applications/[id]/enriched-contacts/[contactId]">) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id, contactId } = await params;
  return enrichedContactsResponse(await getEnrichedContacts().reveal(candidate.id, id, contactId), localeOf(candidate));
}
