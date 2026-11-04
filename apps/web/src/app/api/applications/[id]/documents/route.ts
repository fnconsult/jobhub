import type { TailoredDocumentsResponse } from "@jobhub/shared/reads";
import { NextResponse } from "next/server";
import { getCurrentCandidate } from "@/auth/server";
import { getCandidateReads } from "@/candidate-reads/server";

/**
 * The Tailored Documents of one of the Candidate's Applications (#684), its « documents » Section: the saved Tailored CV,
 * the Cover Letter and the Outreach Message it has, each in its language, when it last changed and where to download it
 * (PDF, Word). 200 TailoredDocumentsResponse · 401 · 404 (also anyone else's)
 */
export async function GET(_request: Request, { params }: RouteContext<"/api/applications/[id]/documents">) {
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const documents = await getCandidateReads().tailoredDocuments(candidate.id, (await params).id);
  if (!documents) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json<TailoredDocumentsResponse>(documents);
}
