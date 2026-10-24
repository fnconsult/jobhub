import { STOPPED, type ActionOutcome } from "../ndjson";
import type { CompanyDossierResult } from "./index";

/**
 * How building a Company Dossier ended, as its route answers:
 * 200 CompanyDossierState · 400 { errors } · 404 · 499 { error: "stopped", state } (the dossier as now kept, #335) · 503 { error: "unavailable" }
 */
export function companyDossierOutcome(result: CompanyDossierResult): ActionOutcome {
  if (result.ok) return { status: 200, body: result.state };
  if ("errors" in result) return { status: 400, body: { errors: result.errors } };
  if (result.error === "stopped") return { status: STOPPED, body: { error: result.error, state: result.state } };
  return { status: result.error === "not_found" ? 404 : 503, body: { error: result.error } };
}

