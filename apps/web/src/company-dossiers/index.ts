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
 *    company under that exact name (or that SIREN) and no other: a fuzzy or
 *    ambiguous match is never taken. The dossier then shows the register's
 *    identity, address, headcount and, when published, financials.
 *  - Any other employer (foreign, or not found in the register) gets a dossier
 *    from web sources, labelled less reliable.
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
import { CompanyRegisterUnavailable, type CompanyRegister, type FinancialYear, type RegisteredCompany } from "./french-register";

export type { CompanyRegister, FinancialYear, RegisteredCompany } from "./french-register";

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

export type CompanyDossierResult =
  | { ok: true; state: CompanyDossierState }
  | { ok: false; errors: FieldError[] }
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

const confirmSchema = z.object({ employer: z.string().trim().min(1).max(200) });

/** Words that decorate a company's name without telling companies apart. */
const DECORATIONS = new Set(["sa", "sas", "sasu", "sarl", "eurl", "sca", "snc", "se", "groupe", "group", "france"]);

/** A company name compared without case, accents, punctuation or legal-form words. */
function nameKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " et ")
    .replace(/\([^)]*\)/g, " ")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word && !DECORATIONS.has(word))
    .join(" ");
}

/** A SIREN (9 digits) or SIRET (14 digits, whose first 9 are the SIREN) typed as the employer. */
function sirenIn(employer: string): string | null {
  const digits = employer.replace(/[\s.]/g, "");
  return /^\d{9}$/.test(digits) ? digits : /^\d{14}$/.test(digits) ? digits.slice(0, 9) : null;
}

/** The one active company the register lists under exactly this name or SIREN, or null when none or several do. */
function matchIn(companies: RegisteredCompany[], employer: string): RegisteredCompany | null {
  const siren = sirenIn(employer);
  if (siren) return companies.find((company) => company.siren === siren) ?? null;
  const key = nameKey(employer);
  if (!key) return null;
  const matches = companies.filter((company) => company.active && [company.name, ...company.otherNames].some((name) => nameKey(name) === key));
  return matches.length === 1 ? matches[0]! : null;
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

/**
 * A dossier from the web search's answer. Only short facts under the keys asked
 * for are kept; any other text the answer holds (where a person could be named) is dropped.
 */
function webDossier(employer: string, answer: string, sources: string[], builtAt: Date): WebDossier {
  const facts = jsonIn(answer) ?? {};
  const dossier: WebDossier = { source: "web", reliability: "less_reliable", employer, builtAt, sources: sources.slice(0, 10), suggestedContactRoles: [] };
  for (const fact of WEB_FACTS) {
    const value = facts[WEB_KEYS[fact]];
    const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
    if (text && text.length <= 200 && !/^(null|inconnu|unknown|n\/a)$/i.test(text)) dossier[fact] = text;
  }
  if (dossier.website && !/^https?:\/\//i.test(dossier.website)) dossier.website = `https://${dossier.website}`;
  if (dossier.website && !URL.canParse(dossier.website)) delete dossier.website;
  const employees = Number(/\d[\d\s.,]*/.exec(dossier.headcount ?? "")?.[0]?.replace(/[\s.,]/g, ""));
  dossier.suggestedContactRoles = contactRolesFor(Number.isFinite(employees) && employees > 0 ? { min: employees } : undefined);
  return dossier;
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

  /** The dossier for `employer`: from the register when it lists exactly one company under that name, else from the web. */
  async function dossierFor(candidateId: string, employer: string): Promise<CompanyDossier> {
    const builtAt = now();
    const match = matchIn(await register.search(employer), employer);
    if (match) return registerDossier(employer, match, builtAt);
    const found = await ai.searchCompany({ candidateId, employer });
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
  async function attempt(step: () => Promise<CompanyDossierState>): Promise<CompanyDossierResult> {
    try {
      return { ok: true, state: await step() };
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
        if (!employer) return save(applicationId, { awaiting_confirmation: false, presumed_employer: null, agency: null });
        return save(applicationId, { awaiting_confirmation: false, presumed_employer: null, agency: null, dossier: await dossierFor(candidateId, employer) });
      });
    },

    async confirmEmployer(candidateId, applicationId, input) {
      const parsed = confirmSchema.safeParse(input, { reportInput: true });
      if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
      if (!(await ownApplication(candidateId, applicationId))) return NOT_FOUND;
      const employer = parsed.data.employer;
      return attempt(async () => save(applicationId, { awaiting_confirmation: false, confirmed_employer: employer, dossier: await dossierFor(candidateId, employer) }));
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
