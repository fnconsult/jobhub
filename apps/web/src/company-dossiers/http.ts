import { NextResponse } from "next/server";
import type { CompanyDossierResult } from "./index";

/**
 * The HTTP response for the outcome of building a Company Dossier:
 * 200 CompanyDossierState · 400 { errors } · 404 · 503 { error: "unavailable" }
 */
export function companyDossierResponse(result: CompanyDossierResult): NextResponse {
  if (result.ok) return NextResponse.json(result.state);
  if ("errors" in result) return NextResponse.json({ errors: result.errors }, { status: 400 });
  return NextResponse.json({ error: result.error }, { status: result.error === "not_found" ? 404 : 503 });
}
