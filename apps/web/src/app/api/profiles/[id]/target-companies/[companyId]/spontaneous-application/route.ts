import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { getTargetCompanies } from "@/target-companies/server";

/**
 * The Candidate's Spontaneous Application to one of a Profile's Target Companies (#409), prepared the first time:
 * where its Company Dossier, Enriched Contacts and documents are. 200 { applicationId } · 401 · 403 · 404
 */
export async function POST(request: Request, { params }: RouteContext<"/api/profiles/[id]/target-companies/[companyId]/spontaneous-application">) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id, companyId } = await params;
  const prepared = await getTargetCompanies().prepareSpontaneousApplication(candidate.id, id, companyId);
  if (!prepared.ok) return NextResponse.json({ error: prepared.error }, { status: 404 });
  return NextResponse.json({ applicationId: prepared.applicationId });
}
