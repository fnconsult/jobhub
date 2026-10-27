import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { getTargetCompanies } from "@/target-companies/server";

/**
 * The Candidate sets one of a Profile's Target Companies aside, for good (#409): La Bonne Boite never brings it back
 * for this Profile, Job discovery no longer visits it. 204 · 401 · 403 · 404
 */
export async function POST(request: Request, { params }: RouteContext<"/api/profiles/[id]/target-companies/[companyId]/set-aside">) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id, companyId } = await params;
  if (!(await getTargetCompanies().setAside(candidate.id, id, companyId))) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
