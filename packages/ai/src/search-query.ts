import type { ContractType, RemoteWork, SearchCriteria } from "@jobhub/shared";

/** The languages a Job Search words its queries in. */
export type QueryLanguage = "fr" | "en";

/**
 * One query of a Job Search: the Search Criteria with one job title, worded in one language.
 * The title is the Search Criteria's own or one of its variants (see `planJobSearch`), never anything else.
 */
export interface JobSearchQuery {
  title: string;
  language: QueryLanguage;
}

interface Wording {
  /** The opening: one job offer (not a list of them, to steer away from listing pages, #105). */
  offer(title: string, location: string): string;
  contract: Record<ContractType, string>;
  remote: Record<RemoteWork, string>;
  salary(amount: number): string;
}

const WORDING: Record<QueryLanguage, Wording> = {
  fr: {
    offer: (title, location) => `Offre d'emploi « ${title} » à ${location}`,
    contract: { cdi: "CDI", cdd: "CDD", freelance: "freelance", interim: "intérim" },
    remote: { on_site: "sur site", hybrid: "télétravail partiel", full_remote: "télétravail complet" },
    salary: (amount) =>
      `salaire à partir de ${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(amount).replace(/\s/g, " ")} € brut annuel`,
  },
  en: {
    offer: (title, location) => `Job offer "${title}" in ${location}`,
    contract: { cdi: "permanent contract", cdd: "fixed-term contract", freelance: "freelance", interim: "temporary work" },
    remote: { on_site: "on site", hybrid: "hybrid remote work", full_remote: "fully remote work" },
    salary: (amount) => `salary from €${new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(amount)} gross per year`,
  },
};

const MAX_FIELD_LENGTH = 80;
const EMAIL = /\S+@\S+/g;
// Phone-like runs: optional +, then 8+ digits possibly separated by spaces, dots or dashes.
const PHONE = /\+?\d(?:[\s.-]?\d){7,}/g;

/** Free text the Candidate typed (or an AI step wrote): drop anything that looks like contact details, collapse whitespace, cap length. */
function clean(text: string): string {
  return text.replace(EMAIL, " ").replace(PHONE, " ").replace(/\s+/g, " ").trim().slice(0, MAX_FIELD_LENGTH).trim();
}

/**
 * The only text ever sent to the web-search provider for a Job Search (ADR-0007): built field
 * by field from Search Criteria, so no CV content or name can reach it. `query` picks the job
 * title and the language; by default, the Search Criteria's own title in French.
 */
export function buildSearchQuery(criteria: SearchCriteria, query?: JobSearchQuery): string {
  const wording = WORDING[query?.language ?? "fr"];
  const parts = [wording.offer(clean(query?.title ?? criteria.targetRole), clean(criteria.location))];
  if (criteria.contractType) parts.push(wording.contract[criteria.contractType]);
  if (criteria.remoteWork) parts.push(wording.remote[criteria.remoteWork]);
  if (typeof criteria.minSalary === "number" && Number.isFinite(criteria.minSalary) && criteria.minSalary > 0) {
    parts.push(wording.salary(criteria.minSalary));
  }
  return parts.join(", ");
}

/** The keys a company web search is asked to answer with. */
export const COMPANY_FACTS = ["country", "headquarters", "industry", "headcount", "revenue", "website", "siren"] as const;

/**
 * The only text ever sent to the web-search provider for a Company Dossier: built
 * from the employer's name alone (a company, not a person), cleaned like Search
 * Criteria. It asks for company facts as JSON and for no person to be named.
 */
export function buildCompanyQuery(employer: string): string {
  return (
    `Fiche d'entreprise de « ${clean(employer)} » : pays, adresse du siège, secteur d'activité, effectif, chiffre d'affaires, site web, numéro SIREN si elle est française. ` +
    `Réponds uniquement par un objet JSON avec les clés ${COMPANY_FACTS.join(", ")} (texte court, null si inconnu). ` +
    `Ne nomme aucune personne.`
  );
}
