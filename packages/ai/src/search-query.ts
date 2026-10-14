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

/** Up to this many job titles per language: the Search Criteria's own and its variants. */
const TITLES_PER_LANGUAGE = 3;

/**
 * The AI step that gives a Job Search its job title variants: it is given the Search
 * Criteria title alone (ADR-0007), cleaned like every other field.
 */
export function jobTitlesPrompt(criteria: SearchCriteria): { system: string; prompt: string } {
  return {
    system:
      "Tu aides à chercher des offres d'emploi. On te donne un intitulé de poste. Donne les autres intitulés que les recruteurs " +
      `emploient pour ce même poste : jusqu'à ${TITLES_PER_LANGUAGE - 1} en français et jusqu'à ${TITLES_PER_LANGUAGE} en anglais, ` +
      "les plus courants d'abord, sans changer de niveau ni de métier. " +
      'Réponds uniquement par un objet JSON : {"fr": ["..."], "en": ["..."]}.',
    prompt: clean(criteria.targetRole),
  };
}

/**
 * A Job Search's queries, from the AI step's reply (null when there is none): the Search
 * Criteria title and up to 2 French variants, then up to 3 English titles (the Search
 * Criteria title when the reply gives none), alternating French and English. Each title
 * is cleaned; an unreadable reply leaves the Search Criteria title alone, in both languages.
 */
export function jobSearchQueries(criteria: SearchCriteria, reply: string | null): JobSearchQuery[] {
  const variants = titlesIn(reply);
  const own = clean(criteria.targetRole);
  const fr = distinctTitles([own, ...variants.fr]);
  const en = distinctTitles(variants.en.length ? variants.en : [own]);
  const queries: JobSearchQuery[] = [];
  for (let index = 0; index < TITLES_PER_LANGUAGE; index++) {
    if (fr[index]) queries.push({ title: fr[index]!, language: "fr" });
    if (en[index]) queries.push({ title: en[index]!, language: "en" });
  }
  return queries;
}

function titlesIn(reply: string | null): Record<QueryLanguage, string[]> {
  const json = reply?.match(/\{[\s\S]*\}/)?.[0];
  let parsed: unknown;
  try {
    parsed = json ? JSON.parse(json) : null;
  } catch {
    parsed = null;
  }
  const list = (value: unknown) => (Array.isArray(value) ? value.filter((title): title is string => typeof title === "string") : []);
  const object = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  return { fr: list(object.fr), en: list(object.en) };
}

/** Cleaned, non-empty, each once (ignoring case), at most TITLES_PER_LANGUAGE. */
function distinctTitles(titles: string[]): string[] {
  const kept = new Map<string, string>();
  for (const title of titles.map(clean)) {
    if (title && !kept.has(title.toLocaleLowerCase("fr"))) kept.set(title.toLocaleLowerCase("fr"), title);
  }
  return [...kept.values()].slice(0, TITLES_PER_LANGUAGE);
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
