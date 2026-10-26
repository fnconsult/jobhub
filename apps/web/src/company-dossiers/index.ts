/**
 * Company Dossiers: the research compiled about the employer behind an
 * Application's Job Offer.
 *
 * One deep module in front of Postgres, the French company register and the AI
 * layer. Callers get `createCompanyDossiers(database, { applications, register, ai })`:
 *  - `get` the Application's dossier state, as last built;
 *  - `build` it (again);
 *  - `confirmEmployer`: the Candidate names the employer, confirming the
 *    Presumed Employer or correcting it, and the dossier is built for it.
 *
 * Rules kept here:
 *  - A French employer is matched to a SIREN only when the register lists a
 *    company under that exact name (or that SIREN). When several share the name,
 *    the one large company (GE or ETI) among them is taken: a large employer's
 *    name is always also borne by small companies. A fuzzy match, or a choice
 *    between companies of the same size, is never made. A large employer known by
 *    another name than its registered one (Michelin, BlaBlaCar) is matched by the
 *    SIREN the web search gives, once the register lists that SIREN under a name
 *    that is, or bears, the employer's (its acronym or shop sign counting). The
 *    dossier then shows the register's identity, address, headcount and, when
 *    published, financials.
 *  - Any other employer (foreign, or not found in the register) gets a dossier
 *    from web sources, labelled less reliable. Only short facts of the expected
 *    shape are kept from it (no street address, nothing naming a person), and
 *    only web pages as sources or website, never a person's profile.
 *  - A sole trader's name or an unknown SIREN is never searched on the web: it is
 *    a private person, or nothing. The Candidate is asked to name the employer.
 *  - A posting from a recruiting agency only yields a Presumed Employer: no
 *    register or web lookup is made for it until the Candidate confirms it.
 *  - No private person is ever named: executives are kept as roles, and contacts
 *    are Suggested Contact Roles. Named contacts are Enriched Contacts (Premium), not here.
 *  - Each build (or rebuild) also searches the web for the employer's Company News (the AI layer's
 *    `searchCompanyNews`): up to five articles of the last twelve months, by title, outlet, date and
 *    link, never their text, none whose title may name a person. Counted against no Plan Quota, its
 *    cost logged in AI Usage like the dossier's other calls. A failed news search never fails the
 *    build: the dossier then has no news.
 *  - The wording of both web searches is their task Playbook's ("company-facts-search",
 *    "company-news-search", ADR-0026); what they are sent about the employer, the JSON asked for and
 *    "name no person" stay in the AI layer. The web facts are read in the pages the Search provider
 *    returned by the company-facts-search task Playbook's agent (#405), its call kept in AI Usage and in
 *    the Provenance like the search's. A version 1 of it served (production, until a person validates
 *    the version that reads pages) asks the search itself for the facts as before: a Search provider's
 *    pages never hold them, so the web dossier then has none, only its sources.
 *  - Each build keeps its Provenance (ADR-0034, #335): the offer read, the register and web searched, the
 *    news searched, with its Provenance sites (the register's page of the company, the web pages and
 *    articles read), each step told to `onEvent` as it starts and ends. A dossier built once the
 *    Candidate confirmed a Presumed Employer joins the reading that presumed it. A dossier built before
 *    has none (« modèle non enregistré »); `dossierSites` gives the sites its own source names.
 *  - Stop (`signal`): the finished parts are kept. Stopped during the news search, the dossier is saved
 *    with its facts and its news not searched (rebuilding searches them); stopped before its facts were
 *    found, nothing changes. Counted against no Plan Quota.
 * Every read and change is scoped to the Candidate; problems come back as results.
 */
import { AiConfigError, AiProviderError, createProvenanceRecorder, readCompanyFacts, type AiLayer, type CompanyNewsArticle, type ProvenanceRecorder } from "@jobhub/ai";
import { taskSection } from "@jobhub/coach-knowledge/tasks";
import { failureOf, isPersonPage, joinProvenance, provenanceLink, readProvenance, siteDomainOf, type FailureReason, type Provenance, type ProvenanceEvent, type ProvenanceSite } from "@jobhub/shared";
import type { Pool } from "pg";
import * as z from "zod";
import type { Application, Applications } from "../applications";
import { taskRun, type TaskPlaybookReader } from "../task-playbooks";
import { fieldErrors, type FieldError } from "../validation";
import { nameKey, sirenIn } from "./company-names";
import { CompanyRegisterUnavailable, type CompanyRegister, type FinancialYear, type RegisteredCompany } from "./french-register";

export type { CompanyRegister, FinancialYear, RegisterSearch, RegisteredCompany } from "./french-register";
export type { CompanyNewsArticle } from "@jobhub/ai";

/** Job titles to look for at the employer, never a person. Translated in the interface. */
export const SUGGESTED_CONTACT_ROLES = ["hiring_manager", "talent_acquisition", "hr_director", "hr_manager", "chief_executive"] as const;
export type SuggestedContactRole = (typeof SUGGESTED_CONTACT_ROLES)[number];

interface DossierBase {
  /** The employer's name the dossier was built for, as the Job Offer or the Candidate gave it. */
  employer: string;
  builtAt: Date;
  suggestedContactRoles: SuggestedContactRole[];
  /**
   * The employer's Company News, searched when the dossier was built (`builtAt`): up to five articles
   * of the twelve months before, newest first. Empty when none was found or the search failed, and
   * for a dossier built before Company News (`newsSearched` false: rebuilding it searches them).
   */
  news: CompanyNewsArticle[];
  newsSearched: boolean;
}

/** Built from the French company register: official data. */
export interface RegisterDossier extends DossierBase {
  source: "french_register";
  reliability: "official";
  siren: string;
  /** The registered name. */
  name: string;
  legalForm?: string;
  activity?: string;
  address?: string;
  headcount?: { min: number; max?: number };
  /** Newest year first; empty when the register publishes none. */
  financials: FinancialYear[];
  /** Roles of the registered executives, e.g. "Directeur Général". Never their names. */
  executiveRoles: string[];
}

/** Built from web sources (foreign employers, or not found in the register): less reliable, to be checked. */
export interface WebDossier extends DossierBase {
  source: "web";
  reliability: "less_reliable";
  country?: string;
  address?: string;
  industry?: string;
  headcount?: string;
  revenue?: string;
  website?: string;
  /** The web pages the facts come from. */
  sources: string[];
}

export type CompanyDossier = RegisterDossier | WebDossier;

export type CompanyDossierState =
  /** Nothing built yet. */
  | { status: "not_built" }
  /** The Job Offer names no employer: the Candidate can name it. */
  | { status: "employer_unknown" }
  /** Posted by a recruiting agency: the AI Coach's guess, to be confirmed by the Candidate before anything is looked up. */
  /**
   * `presumedEmployer` is a company name only, never a description: when the posting only describes the client
   * (e.g. "une entreprise spécialisée dans…, nom non précisé"), it is null and the description is given apart.
   */
  | { status: "awaiting_confirmation"; presumedEmployer: string | null; presumedEmployerDescription?: string; agency?: string }
  /** `provenance`: what served its build (ADR-0034); null (or absent) for a dossier built before it was kept. */
  | { status: "built"; dossier: CompanyDossier; provenance?: Provenance | null };

/** The employer the Candidate named is not a company: a sole trader (a private person), or a SIREN the register does not list. */
export interface NotACompany {
  field: "employer";
  code: "not_a_company";
}

export type CompanyDossierResult =
  | { ok: true; state: CompanyDossierState }
  | { ok: false; errors: (FieldError | NotACompany)[] }
  /** No such Application for this Candidate. */
  | { ok: false; error: "not_found" }
  /**
   * The register or the AI layer could not answer; nothing was changed. Try again later. `reason`: its Failure Reason
   * (#367), the register's outage being `provider_unavailable`; never the provider's words.
   */
  | { ok: false; error: "unavailable"; reason?: FailureReason }
  /** The Candidate stopped it (#335): `state` is the dossier as now kept, its finished parts saved. */
  | { ok: false; error: "stopped"; state: CompanyDossierState };

/**
 * How a build runs (#335): `signal`, the Candidate's Stop, stops its searches and AI calls; `onEvent` hears each step
 * start and end, as AI Activity shows them live.
 */
export interface BuildOptions {
  signal?: AbortSignal;
  onEvent?: (event: ProvenanceEvent) => void;
}

export interface CompanyDossiers {
  /** The dossier state, or null if the Application does not exist or belongs to someone else. */
  get(candidateId: string, applicationId: string): Promise<CompanyDossierState | null>;
  /** Builds the dossier for the employer the Candidate confirmed, else for the Job Offer's (unless it is a recruiting agency). */
  build(candidateId: string, applicationId: string, options?: BuildOptions): Promise<CompanyDossierResult>;
  /** The Candidate names the employer (confirming the Presumed Employer or another); builds its dossier. `input`: { employer }. */
  confirmEmployer(candidateId: string, applicationId: string, input: unknown, options?: BuildOptions): Promise<CompanyDossierResult>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_FOUND = { ok: false, error: "not_found" } as const;
const unavailable = (reason: FailureReason) => ({ ok: false, error: "unavailable", reason }) as const;
const NOT_A_COMPANY = { ok: false, errors: [{ field: "employer", code: "not_a_company" }] } satisfies CompanyDossierResult;

const confirmSchema = z.object({ employer: z.string().trim().min(1).max(200) });

const isLarge = (company: RegisteredCompany) => company.category === "GE" || company.category === "ETI";

/**
 * The company the register lists under exactly this name or SIREN, or null. Companies
 * registered under the name come before those whose acronym it is.
 * Among several active companies of that name, the only large one; null when there is none, or several.
 */
function matchIn(companies: RegisteredCompany[], employer: string): RegisteredCompany | null {
  const siren = sirenIn(employer);
  if (siren) return companies.find((company) => company.siren === siren) ?? null;
  const key = nameKey(employer);
  if (!key) return null;
  const active = companies.filter((company) => company.active);
  const registered = active.filter((company) => nameKey(company.name) === key);
  const matches = registered.length > 0 ? registered : active.filter((company) => !!company.acronym && nameKey(company.acronym) === key);
  if (matches.length === 1) return matches[0]!;
  const large = matches.filter(isLarge);
  return large.length === 1 ? large[0]! : null;
}

/**
 * Is `company`, found in the register under a SIREN from the web, the employer? Only when it is
 * active and its registered name, acronym or a shop sign is the employer's name, or, for a large
 * company, its registered name holds the employer's as whole words (COMPAGNIE GENERALE DES
 * ETABLISSEMENTS MICHELIN for Michelin). A wrong SIREN from the web is never taken for the employer.
 */
function bearsName(company: RegisteredCompany, employer: string): boolean {
  const key = nameKey(employer);
  if (!key || !company.active) return false;
  const names = [company.name, company.acronym, ...(company.shopSigns ?? [])].filter((name): name is string => !!name);
  if (names.some((name) => nameKey(name) === key)) return true;
  return isLarge(company) && ` ${nameKey(company.name)} `.includes(` ${key} `);
}

/** Who to look for, by the employer's size: large employers have recruiters and an HR director, small ones are run by their head. */
function contactRolesFor(headcount: { min: number } | undefined): SuggestedContactRole[] {
  if (!headcount) return ["hiring_manager", "hr_director", "talent_acquisition"];
  if (headcount.min >= 250) return ["hiring_manager", "talent_acquisition", "hr_director"];
  if (headcount.min >= 50) return ["hiring_manager", "hr_manager", "chief_executive"];
  return ["chief_executive", "hiring_manager"];
}

function registerDossier(employer: string, company: RegisteredCompany, builtAt: Date): RegisterDossier {
  const dossier: RegisterDossier = {
    source: "french_register",
    reliability: "official",
    employer,
    builtAt,
    siren: company.siren,
    name: company.name,
    financials: company.financials,
    executiveRoles: company.executiveRoles,
    suggestedContactRoles: contactRolesFor(company.headcount),
    news: [],
    newsSearched: false,
  };
  if (company.legalForm) dossier.legalForm = company.legalForm;
  if (company.activity) dossier.activity = company.activity;
  if (company.address) dossier.address = company.address;
  if (company.headcount) dossier.headcount = company.headcount;
  return dossier;
}

/** The first JSON object in a model's answer, or null. */
function jsonIn(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const value: unknown = JSON.parse(text.slice(start, end + 1));
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const WEB_FACTS = ["country", "address", "industry", "headcount", "revenue", "website"] as const;
/** Where each fact is in the web search's answer (see buildCompanyQuery). */
const WEB_KEYS: Record<(typeof WEB_FACTS)[number], string> = {
  country: "country",
  address: "headquarters",
  industry: "industry",
  headcount: "headcount",
  revenue: "revenue",
  website: "website",
};

/** Words and phrases that tell a fact is about a person (founder, head, home), in French or English. */
const PERSON_WORDS = new RegExp(
  "(?<![\\p{L}])(" +
    [
      "(founded|led|managed|owned|run|created|started) by",
      "(fond[ée]e?s?|cr[ée][ée]e?s?|dirig[ée]e?s?|g[ée]r[ée]e?s?|d[ée]tenue?s?) par",
      "home (of|office)",
      "co-?founders?|founders?|fondat(eur|rice)s?|cofondat(eur|rice)s?",
      "ceo|cfo|coo|pdg|chairman|chairwoman|owner|propri[ée]taire|pr[ée]sidente?|directeur|directrice|g[ée]rante?",
      "domicile|mr|mrs|ms|mme|mlle|dr",
    ].join("|") +
    ")(?![\\p{L}])",
  "iu",
);

/** The only words a headcount or a revenue may hold besides figures. */
const FIGURE_WORDS = new Set(
  (
    "k m md mds mrd mrds bn b million millions milliard milliards billion billions thousand thousands mille " +
    "salarié salariés employé employés employee employees personnes people collaborateurs " +
    "eur euro euros usd dollar dollars gbp chf environ env about approx approximately around plus de more than over en in fy ca"
  ).split(" "),
);

/** Is this the shape of a headcount or a revenue: figures, units, currencies, nothing else? */
const isFigure = (text: string) => /\d/.test(text) && !text.toLowerCase().replace(/\p{L}+/gu, (word) => (FIGURE_WORDS.has(word) ? "" : word)).match(/\p{L}/u);

/** How each web fact must look to be kept. A headquarters is a town and country only: no street address comes from the web. */
const WEB_FACT_SHAPES: Record<Exclude<(typeof WEB_FACTS)[number], "website">, (text: string) => boolean> = {
  country: (text) => text.length <= 60 && !/\d/.test(text),
  address: (text) => text.length <= 80 && !/\d/.test(text),
  industry: (text) => text.length <= 80,
  headcount: (text) => text.length <= 40 && isFigure(text),
  revenue: (text) => text.length <= 40 && isFigure(text),
};

/** A web page fit to cite as a source: http(s), and not a person's profile. */
function isPublicPage(source: string): boolean {
  if (!URL.canParse(source)) return false;
  const url = new URL(source);
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  return !isPersonPage(url);
}

/**
 * A dossier from the web search's answer. Only short facts of the expected shape,
 * under the keys asked for, are kept: any other text (where a person could be named) is dropped.
 */
function webDossier(employer: string, answer: string, sources: string[], builtAt: Date): WebDossier {
  const facts = jsonIn(answer) ?? {};
  const dossier: WebDossier = {
    source: "web",
    reliability: "less_reliable",
    employer,
    builtAt,
    sources: sources.filter(isPublicPage).slice(0, 10),
    suggestedContactRoles: [],
    news: [],
    newsSearched: false,
  };
  for (const fact of WEB_FACTS) {
    const value = facts[WEB_KEYS[fact]];
    const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
    if (!text || text.length > 200 || /^(null|inconnu|unknown|n\/a)$/i.test(text)) continue;
    if (fact !== "website" && (PERSON_WORDS.test(text) || !WEB_FACT_SHAPES[fact](text))) continue;
    dossier[fact] = text;
  }
  if (dossier.website && !/^https?:\/\//i.test(dossier.website)) dossier.website = `https://${dossier.website}`;
  // A website is a page like any source: never a person's profile (a LinkedIn /in/ page names a private person).
  if (dossier.website && !isPublicPage(dossier.website)) delete dossier.website;
  const employees = Number(/\d[\d\s.,]*/.exec(dossier.headcount ?? "")?.[0]?.replace(/[\s.,]/g, ""));
  dossier.suggestedContactRoles = contactRolesFor(Number.isFinite(employees) && employees > 0 ? { min: employees } : undefined);
  return dossier;
}

/** The SIREN the web search's answer gives for the employer, if any. */
function webSirenIn(answer: string): string | null {
  const siren = jsonIn(answer)?.siren;
  return typeof siren === "string" || typeof siren === "number" ? sirenIn(String(siren)) : null;
}

const ANALYSIS_SYSTEM =
  "Tu analyses une offre d'emploi publique. Dis si elle est publiée par un cabinet de recrutement, une agence d'intérim ou un " +
  "chasseur de têtes pour le compte d'un client, et si oui quel est le plus probablement ce client (l'employeur réel), " +
  "d'après le texte seulement. Réponds uniquement par un objet JSON : " +
  '{"recruitingAgency": true|false, "presumedEmployer": "nom de l\'entreprise" ou null, "presumedEmployerDescription": "description du client" ou null}. ' +
  "Ne mets dans presumedEmployer que le nom propre d'une entreprise ; si le texte ne la nomme pas, mets null et décris-la " +
  "en une phrase dans presumedEmployerDescription.";

/** Words that say a company's name is withheld: what holds them describes the employer, it does not name it. */
const NAME_WITHHELD =
  /\b(?:nom )?non (?:précis|precis|communiqu|mentionn|divulgu|indiqu|nomm|cit|révél|revel|dévoil|devoil)|confidenti|anonym|inconnu|undisclosed|not (?:specified|disclosed|named|given)/i;
/** Longer than any company name: a description. */
const MAX_NAME_WORDS = 7;
const DESCRIBES = /\bspécialisée?s? (?:dans|en)\b/i;

/**
 * The Presumed Employer as a name, and apart from it what describes it: an answer the analysis gives as a name
 * but that only describes the client is never taken as one (it would be prefilled as the employer and looked up).
 */
function presumedEmployerFrom(name: unknown, description: unknown): { name: string | null; description: string | null } {
  const reads = (text: unknown) => (typeof text === "string" ? text.trim().slice(0, 200) : "") || null;
  const given = reads(name);
  if (given && (NAME_WITHHELD.test(given) || DESCRIBES.test(given) || given.split(/\s+/).length > MAX_NAME_WORDS)) {
    return { name: null, description: given };
  }
  return { name: given, description: given ? null : reads(description) };
}

interface Row {
  presumed_employer: string | null;
  presumed_employer_description: string | null;
  agency: string | null;
  awaiting_confirmation: boolean;
  confirmed_employer: string | null;
  dossier: (Omit<CompanyDossier, "builtAt" | "news" | "newsSearched"> & { builtAt: string; news?: CompanyNewsArticle[] }) | null;
  provenance: unknown;
}

function stateFrom(row: Row | undefined): CompanyDossierState {
  if (!row) return { status: "not_built" };
  // A dossier built before Company News has none, and says it was never searched.
  if (row.dossier)
    return {
      status: "built",
      dossier: { ...row.dossier, news: row.dossier.news ?? [], newsSearched: row.dossier.news !== undefined, builtAt: new Date(row.dossier.builtAt) } as CompanyDossier,
      provenance: readProvenance(row.provenance),
    };
  if (row.awaiting_confirmation) {
    // Rows saved before descriptions were kept apart may hold one as the name.
    const presumed = presumedEmployerFrom(row.presumed_employer, row.presumed_employer_description);
    const state: CompanyDossierState = { status: "awaiting_confirmation", presumedEmployer: presumed.name };
    if (presumed.description) state.presumedEmployerDescription = presumed.description;
    if (row.agency) state.agency = row.agency;
    return state;
  }
  return { status: "employer_unknown" };
}

/** The company's public page in the register, its Provenance site: Annuaire des Entreprises, by its SIREN. */
const registerPage = (siren: string) => `https://annuaire-entreprises.data.gouv.fr/entreprise/${siren}`;

/** The pages a dossier was built from: the company's register page, or the web pages its facts come from; and its articles. */
function pagesOf(dossier: CompanyDossier): string[] {
  return [...(dossier.source === "french_register" ? [registerPage(dossier.siren)] : dossier.sources), ...dossier.news.map((article) => article.url)];
}

/**
 * The Provenance sites a dossier's own source names (#335): what AI Activity shows of a dossier built before its
 * Provenance was kept, each link through the link filter (no person's page, no query string).
 */
export function dossierSites(dossier: CompanyDossier): ProvenanceSite[] {
  const sites: ProvenanceSite[] = [];
  for (const page of pagesOf(dossier)) {
    const link = provenanceLink(page);
    if (!link || link.startsWith("/")) continue;
    const domain = siteDomainOf(link);
    const site = sites.find((one) => one.kind === "web" && one.domain === domain);
    if (!site) sites.push({ kind: "web", domain, links: [link] });
    else if (!site.links.includes(link)) site.links.push(link);
  }
  return sites;
}

/** The Candidate stopped the build: what was finished is kept, the rest is not done. */
class BuildStopped extends Error {
  override name = "BuildStopped";
}

/** A dossier, and whether the Candidate stopped its build during the news search (its facts are then kept, without news). */
type Built = { dossier: CompanyDossier; newsStopped: boolean };

export function createCompanyDossiers(
  database: Pool,
  {
    applications,
    register,
    ai,
    now = () => new Date(),
    taskPlaybooks,
  }: {
    applications: Pick<Applications, "get">;
    register: CompanyRegister;
    ai: AiLayer;
    now?: () => Date;
    /** The "company-facts-search" and "company-news-search" task Playbooks' served versions (ADR-0026); without it, their built-in text. */
    taskPlaybooks?: TaskPlaybookReader;
  },
): CompanyDossiers {
  async function rowOf(applicationId: string): Promise<Row | undefined> {
    const { rows } = await database.query<Row>(
      `SELECT presumed_employer, presumed_employer_description, agency, awaiting_confirmation, confirmed_employer, dossier, provenance FROM company_dossier WHERE application_id = $1`,
      [applicationId],
    );
    return rows[0];
  }

  async function save(
    applicationId: string,
    fields: Partial<Omit<Row, "dossier" | "provenance">> & { dossier?: CompanyDossier | null; provenance: Provenance },
  ): Promise<CompanyDossierState> {
    const row: Row = {
      presumed_employer: null,
      presumed_employer_description: null,
      agency: null,
      awaiting_confirmation: false,
      confirmed_employer: null,
      ...(await rowOf(applicationId)),
      dossier: null,
      ...fields,
    } as Row;
    await database.query(
      `INSERT INTO company_dossier (application_id, presumed_employer, agency, awaiting_confirmation, confirmed_employer, dossier, presumed_employer_description, provenance, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
       ON CONFLICT (application_id) DO UPDATE SET presumed_employer = $2, agency = $3, awaiting_confirmation = $4,
         confirmed_employer = $5, dossier = $6, presumed_employer_description = $7, provenance = $8, updated_at = now()`,
      [
        applicationId,
        row.presumed_employer,
        row.agency,
        row.awaiting_confirmation,
        row.confirmed_employer,
        fields.dossier ? JSON.stringify(stored(fields.dossier)) : null,
        row.presumed_employer_description,
        JSON.stringify(fields.provenance),
      ],
    );
    return stateFrom((await rowOf(applicationId))!);
  }

  /** A dossier as its jsonb keeps it: news not searched (a Stop during their search) is kept as no `news` at all. */
  function stored(dossier: CompanyDossier) {
    const { newsSearched, ...kept } = dossier;
    if (!newsSearched) delete (kept as Partial<CompanyDossier>).news;
    return kept;
  }

  /**
   * The dossier for `employer`, with its Company News: from the register when it lists the company, else from the web.
   * Null when `employer` is not a company (a sole trader, or a SIREN the register does not list): nothing is searched for it.
   * Throws BuildStopped when stopped before its facts were found; stopped during the news search, its facts are kept.
   */
  async function dossierFor(candidateId: string, employer: string, recorder: ProvenanceRecorder, signal?: AbortSignal): Promise<Built | null> {
    const dossier = await companyDossierFor(candidateId, employer, recorder, signal);
    if (!dossier) return null;
    for (const page of pagesOf(dossier)) recorder.site(page);
    // The task Playbook's words, on the web-search provider it names (else the configured one).
    const run = await taskRun(taskPlaybooks, "company-news-search", ai);
    let news: CompanyNewsArticle[];
    try {
      news = await recorder.ai.searchCompanyNews({
        candidateId,
        employer,
        instructions: run.text(),
        route: run.searchRoute,
        warnings: run.warnings,
        ...(dossier.source === "french_register" ? { registeredName: dossier.name } : {}),
        ...(dossier.source === "web" && dossier.website ? { website: dossier.website } : {}),
      });
    } catch (error) {
      if (signal?.aborted) return { dossier, newsStopped: true };
      throw error;
    }
    // The same net as for web facts, over what the AI layer already kept: no title with a person's role or honorific.
    const kept = news.filter((article) => !PERSON_WORDS.test(article.title));
    for (const article of kept) recorder.site(article.url);
    return { dossier: { ...dossier, news: kept, newsSearched: true }, newsStopped: false };
  }

  async function companyDossierFor(candidateId: string, employer: string, recorder: ProvenanceRecorder, signal?: AbortSignal): Promise<CompanyDossier | null> {
    const builtAt = now();
    const searchRegister = async (query: string) => {
      const found = await recorder.step({ tool: "recherche-entreprises" }, () => register.search(query));
      if (signal?.aborted) throw new BuildStopped();
      return found;
    };
    const { companies, soleTraderNamed } = await searchRegister(employer);
    const match = matchIn(companies, employer);
    if (match) return registerDossier(employer, match, builtAt);
    if (soleTraderNamed || sirenIn(employer)) return null;
    const found = await webFactsFor(candidateId, employer, recorder, signal);
    const webSiren = webSirenIn(found.answer);
    if (webSiren) {
      const listed = (await searchRegister(webSiren)).companies.find((company) => company.siren === webSiren);
      if (listed && bearsName(listed, employer)) return registerDossier(employer, listed, builtAt);
    }
    return webDossier(employer, found.answer, found.sources, builtAt);
  }

  /**
   * The employer's web facts as the JSON answer they were read in, and the pages they come from. The
   * company-facts-search task Playbook with its `## lecture` rules (version 2 on): the pages its search returns,
   * read by its Playbook Agent (#405). With a version 1 served: its search's own answer.
   */
  async function webFactsFor(candidateId: string, employer: string, recorder: ProvenanceRecorder, signal?: AbortSignal): Promise<{ answer: string; sources: string[] }> {
    const run = await taskRun(taskPlaybooks, "company-facts-search", ai);
    const search = { candidateId, employer, route: run.searchRoute, warnings: run.warnings };
    if (taskSection(run.text(), "lecture") === null) return recorder.ai.searchCompany({ ...search, instructions: run.text() });
    const pages = await recorder.ai.searchCompany({ ...search, instructions: run.text("requête"), forReading: true });
    if (signal?.aborted) throw new BuildStopped();
    const answer = await readCompanyFacts(recorder.aiFor("company_facts_reading"), { candidateId, employer, pages, reading: run.instructions("lecture") });
    return { answer, sources: pages.sources };
  }

  /** Is the Job Offer posted by a recruiting agency, and for whom? Public posting text only. */
  async function analyse(
    candidateId: string,
    application: Application,
    recorder: ProvenanceRecorder,
  ): Promise<{ recruitingAgency: boolean; presumedEmployer: { name: string | null; description: string | null } }> {
    const { jobOffer } = application;
    if (jobOffer.source.url) recorder.site(jobOffer.source.url);
    const { text } = await recorder.aiFor("company_dossier_agency_check").generate({
      task: "offer_analysis",
      candidateId,
      system: ANALYSIS_SYSTEM,
      prompt: `Titre : ${jobOffer.title}\nEmployeur affiché : ${jobOffer.employer ?? "(aucun)"}\n\n${jobOffer.content.slice(0, 20_000)}`,
      maxTokens: 200,
    });
    const answer = jsonIn(text);
    return {
      recruitingAgency: answer?.recruitingAgency === true,
      presumedEmployer: presumedEmployerFrom(answer?.presumedEmployer, answer?.presumedEmployerDescription),
    };
  }

  async function ownApplication(candidateId: string, applicationId: string): Promise<Application | null> {
    return UUID.test(applicationId) ? applications.get(candidateId, applicationId) : null;
  }

  /**
   * Runs a build, its steps kept by a recorder of its own: a register or AI outage leaves everything as it was; a Stop
   * keeps what `step` saved, and says so with the state as now kept.
   */
  async function attempt(
    applicationId: string,
    options: BuildOptions,
    step: (recorder: ProvenanceRecorder) => Promise<CompanyDossierState | CompanyDossierResult>,
  ): Promise<CompanyDossierResult> {
    const { signal, onEvent } = options;
    const recorder = createProvenanceRecorder(ai, { ...(signal ? { signal } : {}), ...(onEvent ? { onEvent } : {}) });
    const stopped = async (): Promise<CompanyDossierResult> => ({ ok: false, error: "stopped", state: stateFrom(await rowOf(applicationId)) });
    try {
      const outcome = await step(recorder);
      if (signal?.aborted) return stopped();
      return "ok" in outcome ? outcome : { ok: true, state: outcome };
    } catch (error) {
      if (signal?.aborted || error instanceof BuildStopped) return stopped();
      if (error instanceof CompanyRegisterUnavailable) return unavailable("provider_unavailable");
      if (error instanceof AiProviderError || error instanceof AiConfigError) return unavailable(failureOf(error).reason);
      throw error;
    }
  }

  /** Saves the dossier built (or none: the employer is not a company), its Provenance `before` this build's, if any. */
  function saveBuilt(applicationId: string, built: Built | null, recorder: ProvenanceRecorder, fields: Partial<Omit<Row, "dossier" | "provenance">>, before: Provenance | null = null) {
    return save(applicationId, { ...fields, dossier: built?.dossier ?? null, provenance: joinProvenance(before, recorder.provenance())! });
  }

  return {
    async get(candidateId, applicationId) {
      if (!(await ownApplication(candidateId, applicationId))) return null;
      return stateFrom(await rowOf(applicationId));
    },

    async build(candidateId, applicationId, options = {}) {
      const application = await ownApplication(candidateId, applicationId);
      if (!application) return NOT_FOUND;
      return attempt(applicationId, options, async (recorder) => {
        const confirmed = (await rowOf(applicationId))?.confirmed_employer;
        if (confirmed) return saveBuilt(applicationId, await dossierFor(candidateId, confirmed, recorder, options.signal), recorder, {});
        const { recruitingAgency, presumedEmployer } = await analyse(candidateId, application, recorder);
        if (options.signal?.aborted) throw new BuildStopped();
        if (recruitingAgency) {
          // Only a guess: nothing is looked up for it until the Candidate confirms it.
          return save(applicationId, {
            awaiting_confirmation: true,
            presumed_employer: presumedEmployer.name,
            presumed_employer_description: presumedEmployer.description,
            agency: application.jobOffer.employer ?? null,
            provenance: recorder.provenance(),
          });
        }
        const employer = application.jobOffer.employer;
        // No employer named, or not a company: the Candidate is asked to name it.
        const built = employer ? await dossierFor(candidateId, employer, recorder, options.signal) : null;
        return saveBuilt(applicationId, built, recorder, { awaiting_confirmation: false, presumed_employer: null, presumed_employer_description: null, agency: null });
      });
    },

    async confirmEmployer(candidateId, applicationId, input, options = {}) {
      const parsed = confirmSchema.safeParse(input, { reportInput: true });
      if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
      if (!(await ownApplication(candidateId, applicationId))) return NOT_FOUND;
      const employer = parsed.data.employer;
      return attempt(applicationId, options, async (recorder) => {
        const row = await rowOf(applicationId);
        const built = await dossierFor(candidateId, employer, recorder, options.signal);
        if (!built) return NOT_A_COMPANY;
        // The reading of the offer that presumed this employer is part of how the dossier came about.
        const presumed = row?.awaiting_confirmation ? readProvenance(row.provenance) : null;
        return saveBuilt(applicationId, built, recorder, { awaiting_confirmation: false, confirmed_employer: employer }, presumed);
      });
    },
  };
}

/** Creates or upgrades the Company Dossier table. Run after the Application table. Safe to run repeatedly. */
export async function migrateCompanyDossiers(database: Pool): Promise<void> {
  await database.query(`
    CREATE TABLE IF NOT EXISTS company_dossier (
      application_id uuid PRIMARY KEY REFERENCES application (id) ON DELETE CASCADE,
      presumed_employer text,
      agency text,
      awaiting_confirmation boolean NOT NULL DEFAULT false,
      confirmed_employer text,
      dossier jsonb,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE company_dossier ADD COLUMN IF NOT EXISTS presumed_employer_description text;
    -- What served the last build (ADR-0034, #335), null before: « modèle non enregistré ».
    ALTER TABLE company_dossier ADD COLUMN IF NOT EXISTS provenance jsonb;
  `);
}
