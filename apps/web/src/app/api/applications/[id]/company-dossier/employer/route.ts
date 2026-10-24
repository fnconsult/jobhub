import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { companyDossierOutcome } from "@/company-dossiers/http";
import { getCompanyDossiers } from "@/company-dossiers/server";
import { actionResponse } from "@/ndjson";

/**
 * The Candidate names the employer behind an Application (confirming the Presumed Employer,
 * or another name or SIREN), and its Company Dossier is built.
 * Body: { employer }. 200 CompanyDossierState · 400 { errors } · 401 · 403 · 404 · 499 { error: "stopped", state } · 503 { error: "unavailable", reason? } (its Failure Reason, #367)
 * Live, with `Accept: application/x-ndjson`, and stopped by aborting the request, as POST ../company-dossier (#335).
 */
export async function PUT(request: Request, { params }: RouteContext<"/api/applications/[id]/company-dossier/employer">) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body: unknown = await request.json().catch(() => undefined);
  const { id } = await params;
  return actionResponse(request, async (live) => companyDossierOutcome(await getCompanyDossiers().confirmEmployer(candidate.id, id, body, live)));
}
