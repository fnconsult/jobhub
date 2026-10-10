import { NextResponse } from "next/server";
import { getCurrentCandidate } from "@/auth/server";
import { getCandidateData } from "@/candidate-data/server";

/**
 * Downloads all the Candidate's data (ADR-0010) as one JSON file: their account,
 * Profiles with every Master CV Version, Applications and Tailored Documents.
 * 200 file · 401
 */
export async function GET() {
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const exported = await getCandidateData().export(candidate.id);
  const day = exported.exportedAt.toISOString().slice(0, 10);
  return new Response(JSON.stringify(exported, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="jobbbox-donnees-${day}.json"`,
      "cache-control": "private, no-store",
    },
  });
}
