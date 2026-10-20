import { NextResponse } from "next/server";
import { getCurrentCandidate } from "@/auth/server";
import { readIndustryReference } from "@/reference-data/server";

/**
 * The labels the Search Criteria's Sectors, Subsectors and Domains inputs offer (#236): NAF rév. 2
 * sections and divisions (French and English) and ROME 4.0 professional domains (French), from the
 * reference data. Signed-in Candidates only. A source that cannot be read gives no labels, never an error.
 * 200 { sectors, subsectors, domains: { code, parent?, label: { fr, en? } }[] } · 401
 */
export async function GET() {
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const reference = await readIndustryReference();
  // Kept an hour by the browser once every list is there; not while a source has not answered yet.
  const complete = reference.sectors.length > 0 && reference.subsectors.length > 0 && reference.domains.length > 0;
  return NextResponse.json(reference, { headers: { "cache-control": complete ? "private, max-age=3600" : "no-store" } });
}
