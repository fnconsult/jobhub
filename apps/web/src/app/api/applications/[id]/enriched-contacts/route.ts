import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { enrichedContactsResponse } from "@/enriched-contacts/http";
import { getEnrichedContacts } from "@/enriched-contacts/server";
import { localeOf } from "@/i18n/server";

/** The people found and Enriched Contacts of one of the Candidate's Applications. 200 EnrichedContactsState · 401 · 404 */
export async function GET(_request: Request, { params }: RouteContext<"/api/applications/[id]/enriched-contacts">) {
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const state = await getEnrichedContacts().get(candidate.id, (await params).id);
  if (!state) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(state);
}

/**
 * Looks for people at the employer holding the Company Dossier's Suggested Contact Roles (Premium).
 * Nothing is revealed, nothing counted. 200 EnrichedContactsState · 401 · 402 · 403 · 404 · 409 · 503
 */
export async function POST(request: Request, { params }: RouteContext<"/api/applications/[id]/enriched-contacts">) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return enrichedContactsResponse(await getEnrichedContacts().find(candidate.id, (await params).id), localeOf(candidate));
}
