import { builtInInstructions, fillSlots, slotsIn, taskPlaybookSeed } from "@jobhub/coach-knowledge/tasks";
import { industryLabels, NO_INDUSTRY_REFERENCE, type ContractType, type IndustryReference, type RemoteWork, type SearchCriteria } from "@jobhub/shared";
import { DataResidencyError } from "./errors";

/** The languages a Job Search words its queries in. */
export type QueryLanguage = "fr" | "en";

declare const issuedByPlan: unique symbol;

/**
 * One query of a Job Search: the Search Criteria with one job title, worded in one language.
 * The title is the Search Criteria's own or one of its variants (see `planJobSearch`), never anything else.
 * Opaque: only `jobSearchQueries` makes one, and `buildSearchQuery` refuses any other (ADR-0007).
 */
export interface JobSearchQuery {
  readonly title: string;
  readonly language: QueryLanguage;
  readonly [issuedByPlan]: true;
}

/** Every query `jobSearchQueries` made, with how it opens: the only ones `buildSearchQuery` words. */
const issued = new WeakMap<object, string>();

function issue(title: string, language: QueryLanguage, opening: string): JobSearchQuery {
  const query = Object.freeze({ title, language }) as JobSearchQuery;
  issued.set(query, opening);
  return query;
}

/** The slots a query's opening holds: one job title and one location. */
const OPENING_SLOTS = ["intitulé", "lieu"];

/**
 * How a query opens in `language`, with `{{intitulé}}` and `{{lieu}}`: one job offer (not a list of them,
 * to steer away from listing pages, #105). The task Playbook's when given and usable, else the built-in one.
 */
function openingFor(language: QueryLanguage, served?: string): string {
  const usable = served !== undefined && OPENING_SLOTS.every((slot) => slotsIn(served).includes(slot));
  return usable ? served : builtInInstructions("job-search-queries", `requête ${language}`);
}

/** A task Playbook's text as it goes into a web-search query: on one line, no longer than its task allows. */
export function taskQueryText(text: string, id: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, taskPlaybookSeed(id)?.maxLength);
}

interface Wording {
  contract: Record<ContractType, string>;
  remote: Record<RemoteWork, string>;
  /** Several values of one criterion, any of which will do: "CDI ou freelance". */
  anyOf: string;
  salary(amount: number): string;
  /** The Sectors wanted, already joined: "secteur Industrie automobile ou Banque". */
  sectors(labels: string): string;
}

const WORDING: Record<QueryLanguage, Wording> = {
  fr: {
    contract: { cdi: "CDI", cdd: "CDD", freelance: "freelance", interim: "intérim" },
    remote: { on_site: "sur site", hybrid: "télétravail partiel", full_remote: "télétravail complet" },
    anyOf: " ou ",
    salary: (amount) =>
      `salaire à partir de ${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(amount).replace(/\s/g, " ")} € brut annuel`,
    sectors: (labels) => `secteur ${labels}`,
  },
  en: {
    contract: { cdi: "permanent contract", cdd: "fixed-term contract", freelance: "freelance", interim: "temporary work" },
    remote: { on_site: "on site", hybrid: "hybrid remote work", full_remote: "fully remote work" },
    anyOf: " or ",
    salary: (amount) => `salary from €${new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(amount)} gross per year`,
    sectors: (labels) => `${labels} sector`,
  },
};

const MAX_FIELD_LENGTH = 80;
const EMAIL = /\S+@\S+/g;
// Phone-like runs: optional +, then 8+ digits possibly separated by spaces, dots or dashes.
const PHONE = /\+?\d(?:[\s.-]?\d){7,}/g;

/** Free text the Candidate typed (or an AI step wrote): drop anything that looks like contact details, collapse whitespace, cap length. */
export function clean(text: string): string {
  return text.replace(EMAIL, " ").replace(PHONE, " ").replace(/\s+/g, " ").trim().slice(0, MAX_FIELD_LENGTH).trim();
}

/**
 * The only text ever sent to the web-search provider for a Job Search (ADR-0007): built field
 * by field from Search Criteria, so no CV content or name can reach it. `query` picks the job
 * title and the language; by default, the Search Criteria's own title in French. A query names
 * one place, `location`, one of the Search Criteria's (the first by default): a Job Search runs
 * one search per location (ADR-0025); the contract types and remote-work options wanted are all
 * in each ("CDI ou freelance"). The Sectors wanted are named by their labels in `industries`, the
 * public NAF nomenclature's (#236), in the query's language where it has one: never by a code,
 * and not at all without them.
 */
export function buildSearchQuery(
  criteria: SearchCriteria,
  query?: JobSearchQuery,
  location: string | undefined = criteria.locations[0],
  industries: IndustryReference = NO_INDUSTRY_REFERENCE,
): string {
  const opening = query === undefined ? openingFor("fr") : issued.get(query);
  if (opening === undefined) {
    throw new DataResidencyError("A Job Search query must be one planJobSearch issued: no other job title may reach the web-search provider");
  }
  if (location === undefined || !criteria.locations.includes(location)) {
    throw new DataResidencyError("A Job Search query names one of the Search Criteria's locations, and no other place");
  }
  const wording = WORDING[query?.language ?? "fr"];
  const parts = [taskQueryText(fillSlots(opening, { intitulé: clean(query?.title ?? criteria.targetRole), lieu: clean(location) }), "job-search-queries")];
  const anyOf = (values: string[]) => [...new Set(values)].join(wording.anyOf);
  if (criteria.contractTypes.length > 0) parts.push(anyOf(criteria.contractTypes.map((type) => wording.contract[type])));
  if (criteria.remoteWorkOptions.length > 0) parts.push(anyOf(criteria.remoteWorkOptions.map((option) => wording.remote[option])));
  if (typeof criteria.minSalary === "number" && Number.isFinite(criteria.minSalary) && criteria.minSalary > 0) {
    parts.push(wording.salary(criteria.minSalary));
  }
  const sectors = industryLabels(criteria, industries, query?.language ?? "fr").sectors.map(clean).filter(Boolean);
  if (sectors.length > 0) parts.push(wording.sectors(anyOf(sectors)));
  return parts.join(", ");
}

/** Up to this many job titles per language: the Search Criteria's own and its variants. */
const TITLES_PER_LANGUAGE = 3;

/**
 * The AI step that gives a Job Search its job title variants: it is given the Search
 * Criteria title alone (ADR-0007), cleaned like every other field. `instructions`: the
 * task Playbook's (default: the built-in ones); the JSON shape is always added.
 */
export function jobTitlesPrompt(criteria: SearchCriteria, instructions: string = builtInInstructions("job-search-queries", "intitulés")): { system: string; prompt: string } {
  return {
    system: `${instructions.trim()} Réponds uniquement par un objet JSON : {"fr": ["..."], "en": ["..."]}.`,
    prompt: clean(criteria.targetRole),
  };
}

/**
 * A Job Search's queries, from the AI step's reply (null when there is none): the Search
 * Criteria title and up to 2 French variants, then up to 3 English titles (the Search
 * Criteria title when the reply gives none), alternating French and English. Each title
 * is cleaned; an unreadable reply leaves the Search Criteria title alone, in both languages.
 */
export function jobSearchQueries(criteria: SearchCriteria, reply: string | null, openings?: Partial<Record<QueryLanguage, string>>): JobSearchQuery[] {
  const variants = titlesIn(reply);
  const own = clean(criteria.targetRole);
  const fr = distinctTitles([own, ...variants.fr]);
  const en = distinctTitles(variants.en.length ? variants.en : [own]);
  const opening = { fr: openingFor("fr", openings?.fr), en: openingFor("en", openings?.en) };
  const queries: JobSearchQuery[] = [];
  for (let index = 0; index < TITLES_PER_LANGUAGE; index++) {
    if (fr[index]) queries.push(issue(fr[index]!, "fr", opening.fr));
    if (en[index]) queries.push(issue(en[index]!, "en", opening.en));
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
 * Criteria, in the "company-facts-search" task Playbook's words (`instructions`, its
 * `{{entreprise}}` the name; default: its built-in text). It always asks for company
 * facts as JSON and for no person to be named.
 */
export function buildCompanyQuery(employer: string, instructions?: string): string {
  const words = instructions !== undefined && slotsIn(instructions).includes("entreprise") ? instructions : builtInInstructions("company-facts-search");
  return (
    `${taskQueryText(fillSlots(words, { entreprise: `« ${clean(employer)} »` }), "company-facts-search")} ` +
    `Réponds uniquement par un objet JSON avec les clés ${COMPANY_FACTS.join(", ")} (texte court, null si inconnu). ` +
    `Ne nomme aucune personne.`
  );
}
