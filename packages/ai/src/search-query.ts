import type { ContractType, RemoteWork, SearchCriteria } from "@jobhub/shared";

const CONTRACT_LABELS: Record<ContractType, string> = {
  cdi: "CDI",
  cdd: "CDD",
  freelance: "freelance",
  interim: "intérim",
};

const REMOTE_LABELS: Record<RemoteWork, string> = {
  on_site: "sur site",
  hybrid: "télétravail partiel",
  full_remote: "télétravail complet",
};

const MAX_FIELD_LENGTH = 80;
const EMAIL = /\S+@\S+/g;
// Phone-like runs: optional +, then 8+ digits possibly separated by spaces, dots or dashes.
const PHONE = /\+?\d(?:[\s.-]?\d){7,}/g;

/** Free text the Candidate typed: drop anything that looks like contact details, collapse whitespace, cap length. */
function clean(text: string): string {
  return text.replace(EMAIL, " ").replace(PHONE, " ").replace(/\s+/g, " ").trim().slice(0, MAX_FIELD_LENGTH).trim();
}

/**
 * The only text ever sent to the web-search provider (ADR-0007): built field by field
 * from Search Criteria, so no CV content or name can reach it.
 */
export function buildSearchQuery(criteria: SearchCriteria): string {
  const parts = [`Offres d'emploi « ${clean(criteria.targetRole)} » à ${clean(criteria.location)}`];
  if (criteria.contractType) parts.push(CONTRACT_LABELS[criteria.contractType]);
  if (criteria.remoteWork) parts.push(REMOTE_LABELS[criteria.remoteWork]);
  if (typeof criteria.minSalary === "number" && Number.isFinite(criteria.minSalary) && criteria.minSalary > 0) {
    const amount = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(criteria.minSalary).replace(/\s/g, " ");
    parts.push(`salaire à partir de ${amount} € brut annuel`);
  }
  return parts.join(", ");
}
