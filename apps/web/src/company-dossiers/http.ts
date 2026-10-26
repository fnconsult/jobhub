import { STOPPED, type ActionOutcome } from "../ndjson";
import type { CompanyDossierResult } from "./index";

/**
 * How building a Company Dossier ended, as its route answers:
 * 200 CompanyDossierState · 400 { errors } · 404 · 499 { error: "stopped", state } (the dossier as now kept, #335)
 * · 503 { error: "unavailable", reason? } (its Failure Reason, #367)
 * · 503 { error: "web_search_unavailable", reason: "key_missing" } (a foreign employer's, without the Search provider's key, #399)
 */
export function companyDossierOutcome(result: CompanyDossierResult): ActionOutcome {
  if (result.ok) return { status: 200, body: result.state };
  if ("errors" in result) return { status: 400, body: { errors: result.errors } };
  if (result.error === "stopped") return { status: STOPPED, body: { error: result.error, state: result.state } };
  if (result.error === "not_found") return { status: 404, body: { error: result.error } };
  if (result.error === "web_search_unavailable") return { status: 503, body: { error: result.error, reason: "key_missing" } };
  return { status: 503, body: { error: result.error, ...(result.reason ? { reason: result.reason } : {}) } };
}

