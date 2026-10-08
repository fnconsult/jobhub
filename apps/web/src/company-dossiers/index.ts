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
 * Every read and change is scoped to the Candidate; problems come back as results.
 */
import { AiConfigError, AiProviderError, type AiLayer } from "@jobhub/ai";
import type { Pool } from "pg";
import * as z from "zod";
import type { Application, Applications } from "../applications";
import { fieldErrors, type FieldError } from "../validation";
import { nameKey, sirenIn } from "./company-names";
import { CompanyRegisterUnavailable, type CompanyRegister, type FinancialYear, type RegisteredCompany } from "./french-register";

export type { CompanyRegister, FinancialYear, RegisterSearch, RegisteredCompany } from "./french-register";

/** Job titles to look for at the employer, never a person. Translated in the interface. */
export const SUGGESTED_CONTACT_ROLES = ["hiring_manager", "talent_acquisition", "hr_director", "hr_manager", "chief_executive"] as const;
export type SuggestedContactRole = (typeof SUGGESTED_CONTACT_ROLES)[number];

interface DossierBase {
  /** The employer's name the dossier was built for, as the Job Offer or the Candidate gave it. */
  employer: string;
  builtAt: Date;
  suggestedContactRoles: SuggestedContactRole[];
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
  | { status: "awaiting_confirmation"; presumedEmployer: string | null; agency?: string }
  | { status: "built"; dossier: CompanyDossier };

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
  /** The register or the AI layer could not answer; nothing was changed. Try again later. */
  | { ok: false; error: "unavailable" };

export interface CompanyDossiers {
  /** The dossier state, or null if the Application does not exist or belongs to someone else. */
  get(candidateId: string, applicationId: string): Promise<CompanyDossierState | null>;
  /** Builds the dossier for the employer the Candidate confirmed, else for the Job Offer's (unless it is a recruiting agency). */
  build(candidateId: string, applicationId: string): Promise<CompanyDossierResult>;
  /** The Candidate names the employer (confirming the Presumed Employer or another); builds its dossier. `input`: { employer }. */
  confirmEmployer(candidateId: string, applicationId: string, input: unknown): Promise<CompanyDossierResult>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_FOUND = { ok: false, error: "not_found" } as const;
const UNAVAILABLE = { ok: false, error: "unavailable" } as const;
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

/** Social networks, where a page is a person's profile; LinkedIn company pages excepted. */
const PROFILE_HOSTS = ["linkedin.com", "facebook.com", "instagram.com", "twitter.com", "x.com", "tiktok.com", "threads.net", "viadeo.com"];

/** A web page fit to cite as a source: http(s), and not a person's profile. */
function isPublicPage(source: string): boolean {
  if (!URL.canParse(source)) return false;
  const url = new URL(source);
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  const host = url.hostname.toLowerCase();
  const network = PROFILE_HOSTS.find((profileHost) => host === profileHost || host.endsWith(`.${profileHost}`));
  if (!network) return true;
  return network === "linkedin.com" && url.pathname.startsWith("/company/");
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
  '{"recruitingAgency": true|false, "presumedEmployer": "nom de l\'entreprise" ou null}.';

interface Row {
  presumed_employer: string | null;
  agency: string | null;
  awaiting_confirmation: boolean;
  confirmed_employer: string | null;
  dossier: (Omit<CompanyDossier, "builtAt"> & { builtAt: string }) | null;
}

function stateFrom(row: Row | undefined): CompanyDossierState {
  if (!row) return { status: "not_built" };
  if (row.dossier) return { status: "built", dossier: { ...row.dossier, builtAt: new Date(row.dossier.builtAt) } as CompanyDossier };
  if (row.awaiting_confirmation) {
    const state: CompanyDossierState = { status: "awaiting_confirmation", presumedEmployer: row.presumed_employer };
    if (row.agency) state.agency = row.agency;
    return state;
  }
  return { status: "employer_unknown" };
}

export function createCompanyDossiers(
  database: Pool,
  { applications, register, ai, now = () => new Date() }: { applications: Pick<Applications, "get">; register: CompanyRegister; ai: AiLayer; now?: () => Date },
): CompanyDossiers {
  async function rowOf(applicationId: string): Promise<Row | undefined> {
    const { rows } = await database.query<Row>(
      `SELECT presumed_employer, agency, awaiting_confirmation, confirmed_employer, dossier FROM company_dossier WHERE application_id = $1`,
      [applicationId],
    );
    return rows[0];
  }

  async function save(applicationId: string, fields: Partial<Omit<Row, "dossier">> & { dossier?: CompanyDossier | null }): Promise<CompanyDossierState> {
    const row: Row = {
      presumed_employer: null,
      agency: null,
      awaiting_confirmation: false,
      confirmed_employer: null,
      ...(await rowOf(applicationId)),
      dossier: null,
      ...fields,
    } as Row;
    await database.query(
      `INSERT INTO company_dossier (application_id, presumed_employer, agency, awaiting_confirmation, confirmed_employer, dossier, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (application_id) DO UPDATE SET presumed_employer = $2, agency = $3, awaiting_confirmation = $4,
         confirmed_employer = $5, dossier = $6, updated_at = now()`,
      [applicationId, row.presumed_employer, row.agency, row.awaiting_confirmation, row.confirmed_employer, row.dossier ? JSON.stringify(row.dossier) : null],
    );
    return stateFrom((await rowOf(applicationId))!);
  }

  /**
   * The dossier for `employer`: from the register when it lists the company, else from the web.
   * Null when `employer` is not a company (a sole trader, or a SIREN the register does not list): nothing is searched for it.
   */
  async function dossierFor(candidateId: string, employer: string): Promise<CompanyDossier | null> {
    const builtAt = now();
    const { companies, soleTraderNamed } = await register.search(employer);
    const match = matchIn(companies, employer);
    if (match) return registerDossier(employer, match, builtAt);
    if (soleTraderNamed || sirenIn(employer)) return null;
    const found = await ai.searchCompany({ candidateId, employer });
    const webSiren = webSirenIn(found.answer);
    if (webSiren) {
      const listed = (await register.search(webSiren)).companies.find((company) => company.siren === webSiren);
      if (listed && bearsName(listed, employer)) return registerDossier(employer, listed, builtAt);
    }
    return webDossier(employer, found.answer, found.sources, builtAt);
  }

  /** Is the Job Offer posted by a recruiting agency, and for whom? Public posting text only. */
  async function analyse(candidateId: string, application: Application): Promise<{ recruitingAgency: boolean; presumedEmployer: string | null }> {
    const { jobOffer } = application;
    const { text } = await ai.generate({
      task: "offer_analysis",
      candidateId,
      system: ANALYSIS_SYSTEM,
      prompt: `Titre : ${jobOffer.title}\nEmployeur affiché : ${jobOffer.employer ?? "(aucun)"}\n\n${jobOffer.content.slice(0, 20_000)}`,
      maxTokens: 200,
    });
    const answer = jsonIn(text);
    const presumed = typeof answer?.presumedEmployer === "string" ? answer.presumedEmployer.trim().slice(0, 200) : "";
    return { recruitingAgency: answer?.recruitingAgency === true, presumedEmployer: presumed || null };
  }

  async function ownApplication(candidateId: string, applicationId: string): Promise<Application | null> {
    return UUID.test(applicationId) ? applications.get(candidateId, applicationId) : null;
  }

  /** Runs a build step; a register or AI outage leaves everything as it was. */
  async function attempt(step: () => Promise<CompanyDossierState | CompanyDossierResult>): Promise<CompanyDossierResult> {
    try {
      const outcome = await step();
      return "ok" in outcome ? outcome : { ok: true, state: outcome };
    } catch (error) {
      if (error instanceof CompanyRegisterUnavailable || error instanceof AiProviderError || error instanceof AiConfigError) return UNAVAILABLE;
      throw error;
    }
  }

  return {
    async get(candidateId, applicationId) {
      if (!(await ownApplication(candidateId, applicationId))) return null;
      return stateFrom(await rowOf(applicationId));
    },

    async build(candidateId, applicationId) {
      const application = await ownApplication(candidateId, applicationId);
      if (!application) return NOT_FOUND;
      return attempt(async () => {
        const confirmed = (await rowOf(applicationId))?.confirmed_employer;
        if (confirmed) return save(applicationId, { dossier: await dossierFor(candidateId, confirmed) });
        const { recruitingAgency, presumedEmployer } = await analyse(candidateId, application);
        if (recruitingAgency) {
          // Only a guess: nothing is looked up for it until the Candidate confirms it.
          return save(applicationId, { awaiting_confirmation: true, presumed_employer: presumedEmployer, agency: application.jobOffer.employer ?? null });
        }
        const employer = application.jobOffer.employer;
        // No employer named, or not a company: the Candidate is asked to name it.
        const dossier = employer ? await dossierFor(candidateId, employer) : null;
        return save(applicationId, { awaiting_confirmation: false, presumed_employer: null, agency: null, dossier });
      });
    },

    async confirmEmployer(candidateId, applicationId, input) {
      const parsed = confirmSchema.safeParse(input, { reportInput: true });
      if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
      if (!(await ownApplication(candidateId, applicationId))) return NOT_FOUND;
      const employer = parsed.data.employer;
      return attempt(async () => {
        const dossier = await dossierFor(candidateId, employer);
        if (!dossier) return NOT_A_COMPANY;
        return save(applicationId, { awaiting_confirmation: false, confirmed_employer: employer, dossier });
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
  `);
}
