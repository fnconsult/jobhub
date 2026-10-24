import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { companyDossierOutcome } from "@/company-dossiers/http";
import { getCompanyDossiers } from "@/company-dossiers/server";
import { actionResponse } from "@/ndjson";

/** The Company Dossier of one of the Candidate's Applications, as last built. 200 CompanyDossierState · 401 · 404 */
export async function GET(_request: Request, { params }: RouteContext<"/api/applications/[id]/company-dossier">) {
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const state = await getCompanyDossiers().get(candidate.id, (await params).id);
  if (!state) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(state);
}

/**
 * Builds (again) the Company Dossier of one of the Candidate's Applications, with its Provenance. A recruiting
 * agency's posting only yields a Presumed Employer to confirm.
 * 200 CompanyDossierState · 401 · 403 · 404 · 499 { error: "stopped", state } · 503 { error: "unavailable", reason? } (its Failure Reason, #367)
 *
 * Live (#335), with `Accept: application/x-ndjson`: each step as it starts and ends, then { type: "done", ...state }
 * · { type: "stopped", error, state } · { type: "failed", status, ... } (see actionResponse). Aborting the request is
 * the Stop: the finished parts are kept (the facts found, the news not searched), `state` says what is now kept.
 */
export async function POST(request: Request, { params }: RouteContext<"/api/applications/[id]/company-dossier">) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  return actionResponse(request, async (live) => companyDossierOutcome(await getCompanyDossiers().build(candidate.id, id, live)));
}
