import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { companyDossierResponse } from "@/company-dossiers/http";
import { getCompanyDossiers } from "@/company-dossiers/server";

/**
 * The Candidate names the employer behind an Application (confirming the Presumed Employer,
 * or another name or SIREN), and its Company Dossier is built.
 * Body: { employer }. 200 CompanyDossierState · 400 { errors } · 401 · 403 · 404 · 503 { error: "unavailable" }
 */
export async function PUT(request: Request, { params }: RouteContext<"/api/applications/[id]/company-dossier/employer">) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body: unknown = await request.json().catch(() => undefined);
  return companyDossierResponse(await getCompanyDossiers().confirmEmployer(candidate.id, (await params).id, body));
}
