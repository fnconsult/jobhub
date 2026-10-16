import { NextResponse } from "next/server";
import { getSearchSites } from "@/search-sites/server";

/**
 * The extension's Job Sites, managed in the Back Office: where its badge may
 * show, and which sites are disabled. Public (nothing personal in it), so the
 * extension reads it for Guests too; it caches it, and falls back to its
 * built-in sites when this cannot be read.
 * 200 { sites: [{ pattern, postingPages, enabled }] }
 */
export async function GET() {
  return NextResponse.json(await getSearchSites().extensionJobSites(), { headers: { "cache-control": "public, max-age=300" } });
}
