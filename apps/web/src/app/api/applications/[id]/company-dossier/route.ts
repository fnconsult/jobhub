import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { companyDossierResponse } from "@/company-dossiers/http";
import { getCompanyDossiers } from "@/company-dossiers/server";

/** The Company Dossier of one of the Candidate's Applications, as last built. 200 CompanyDossierState · 401 · 404 */
export async function GET(_request: Request, { params }: RouteContext<"/api/applications/[id]/company-dossier">) {
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const state = await getCompanyDossiers().get(candidate.id, (await params).id);
  if (!state) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(state);
}

/**
 * Builds (again) the Company Dossier of one of the Candidate's Applications. A recruiting
 * agency's posting only yields a Presumed Employer to confirm.
 * 200 CompanyDossierState · 401 · 403 · 404 · 503 { error: "unavailable" }
 */
export async function POST(request: Request, { params }: RouteContext<"/api/applications/[id]/company-dossier">) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return companyDossierResponse(await getCompanyDossiers().build(candidate.id, (await params).id));
}
