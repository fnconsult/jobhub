import { NextResponse } from "next/server";
import { getApplications } from "@/applications/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { summarizeJobOffer } from "@/job-offers/server";

/** The fields JobOfferTiles shows: when the reading adds one, the page is shown again. */
const TILE_FIELDS = ["employer", "location", "contractType", "remoteWork", "salary", "skills", "requiredExperienceYears"] as const;

/**
 * The Job Offer Summary of one of the Candidate's Applications: the stored one, else written once by
 * the AI from the Job Offer's text (with the fields the offer lacks), stored, then returned. The
 * Application page asks for it after it is shown, never holding it up.
 * 200 { summary: string | null, fieldsAdded: boolean } · 401 · 403 · 404 · 503 { error: "unavailable" }
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const application = await getApplications().get(candidate.id, (await params).id);
  if (!application) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const before = application.jobOffer;
  if (before.summary) return NextResponse.json({ summary: before.summary, fieldsAdded: false });
  try {
    const after = await summarizeJobOffer(before.id, candidate.id);
    if (!after) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const fieldsAdded = TILE_FIELDS.some((field) => before[field] === undefined && after[field] !== undefined);
    return NextResponse.json({ summary: after.summary ?? null, fieldsAdded });
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
