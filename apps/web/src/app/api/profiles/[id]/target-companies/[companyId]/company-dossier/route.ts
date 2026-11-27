import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { companyDossierOutcome } from "@/company-dossiers/http";
import { getCompanyDossiers } from "@/company-dossiers/server";
import { actionResponse } from "@/ndjson";
import { getTargetCompanies } from "@/target-companies/server";

/**
 * Builds (again) the Company Dossier of one of a Profile's Target Companies (#1157): its Spontaneous Application prepared
 * first when it has none (#409), then its dossier built as the Application's own route builds it, with its Provenance.
 * What the AI Coach's card « Mettre à jour » runs on the Candidate's click (ADR-0119).
 * 200 CompanyDossierState · 401 · 403 · 404 · 499 { error: "stopped", state } · 503 { error: "unavailable", reason? }
 *
 * Live, with `Accept: application/x-ndjson`, as /api/applications/[id]/company-dossier: aborting the request is the Stop.
 */
export async function POST(request: Request, { params }: RouteContext<"/api/profiles/[id]/target-companies/[companyId]/company-dossier">) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id, companyId } = await params;
  const prepared = await getTargetCompanies().prepareSpontaneousApplication(candidate.id, id, companyId);
  if (!prepared.ok) return NextResponse.json({ error: prepared.error }, { status: 404 });
  return actionResponse(request, async (live) => companyDossierOutcome(await getCompanyDossiers().build(candidate.id, prepared.applicationId, live)));
}
