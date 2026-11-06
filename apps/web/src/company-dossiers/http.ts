import type { CompanyDossierRead, CompanyDossierResponse } from "@jobhub/shared/reads";
import { STOPPED, type ActionOutcome } from "../ndjson";
import type { CompanyDossier, CompanyDossierResult, CompanyDossierState } from "./index";

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


/** A built dossier as the app reads it: an absent fact null, its date an instant. */
function dossierRead(dossier: CompanyDossier): CompanyDossierRead {
  const base = { employer: dossier.employer, builtAt: dossier.builtAt.toISOString(), suggestedContactRoles: dossier.suggestedContactRoles, news: dossier.news, newsSearched: dossier.newsSearched };
  if (dossier.source === "french_register")
    return {
      ...base,
      source: dossier.source,
      reliability: dossier.reliability,
      siren: dossier.siren,
      name: dossier.name,
      legalForm: dossier.legalForm ?? null,
      activity: dossier.activity ?? null,
      address: dossier.address ?? null,
      headcount: dossier.headcount ? { min: dossier.headcount.min, max: dossier.headcount.max ?? null } : null,
      financials: dossier.financials.map(({ year, revenue, netIncome }) => ({ year, revenue: revenue ?? null, netIncome: netIncome ?? null })),
      executiveRoles: dossier.executiveRoles,
    };
  return {
    ...base,
    source: dossier.source,
    reliability: dossier.reliability,
    country: dossier.country ?? null,
    address: dossier.address ?? null,
    industry: dossier.industry ?? null,
    headcount: dossier.headcount ?? null,
    revenue: dossier.revenue ?? null,
    website: dossier.website ?? null,
    sources: dossier.sources,
  };
}

/**
 * The Company Dossier as `GET /api/applications/:id/company-dossier` answers it, the Jobbbox app's read
 * (`@jobhub/shared/reads`, ADR-0076): an absent value null, never left out; its Provenance stays on the web.
 */
export function companyDossierRead(state: CompanyDossierState): CompanyDossierResponse {
  if (state.status === "built") return { status: "built", dossier: dossierRead(state.dossier) };
  if (state.status === "awaiting_confirmation")
    return { status: state.status, presumedEmployer: state.presumedEmployer, presumedEmployerDescription: state.presumedEmployerDescription ?? null, agency: state.agency ?? null };
  return { status: state.status };
}
