import { NextResponse } from "next/server";
import { getCurrentCandidate } from "@/auth/server";
import { getCandidateData } from "@/candidate-data/server";

/**
 * Downloads all the Candidate's personal data (ADR-0010, GDPR art. 15 / 20) as one
 * JSON file: their account, Plan, consents and settings, Profiles, Applications,
 * Coach Conversations, Coach Access, Coaching Sessions and Action Cards (see
 * CandidateDataExport). Secrets and providers' internal identifiers are left out.
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
