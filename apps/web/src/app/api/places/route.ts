import { NextResponse } from "next/server";
import { getCurrentCandidate } from "@/auth/server";
import { getPlaceSuggestions } from "@/places/server";

/**
 * Places to suggest for the Search Criteria's Locations (#235), found by geo.api.gouv.fr: the
 * communes, départements and régions whose name starts like `q` (3 characters at least).
 * Signed-in Candidates only. The answer never fails: when the API cannot answer, no place is suggested.
 * 200 { places: { name, kind: "commune" | "departement" | "region" }[] } · 401
 */
export async function GET(request: Request) {
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const query = new URL(request.url).searchParams.get("q") ?? "";
  const places = await getPlaceSuggestions().suggest(query);
  return NextResponse.json({ places }, { headers: { "cache-control": "private, max-age=600" } });
}
