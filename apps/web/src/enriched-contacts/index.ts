/**
 * Enriched Contacts: named people at an Application's employer, with contact
 * details, obtained from a licensed data provider. Premium Plan only.
 *
 * One deep module in front of Postgres and the active contact-enrichment
 * provider (Lusha, Kaspr or Apollo, `./providers`). Callers get
 * `createEnrichedContacts(database, { applications, companyDossiers, quota, provider })`:
 *  - `get` the Application's people found and Enriched Contacts;
 *  - `find` people at the employer holding the Company Dossier's Suggested
 *    Contact Roles (no contact details yet);
 *  - `reveal` one found person's contact details: they become an Enriched Contact;
 *  - `contact`: one Enriched Contact, to address an Outreach Message to.
 *
 * Rules kept here:
 *  - Off (`enabled: false`) unless a provider is configured and its DPA is
 *    confirmed signed (see `./config`): nothing is found or revealed.
 *  - Premium only: a Plan whose quota has no Enriched Contacts gets the Upgrade
 *    Prompt before any provider is asked. Each reveal counts one Enriched Contact
 *    against the monthly Plan Quota; a reveal the provider could not answer is
 *    given back, and revealing someone again costs nothing.
 *  - Who to look for comes from the built Company Dossier: the employer's name and
 *    website, and its Suggested Contact Roles as job titles.
 *  - Every person found and every Enriched Contact records its source provider,
 *    the provider's id for them, and when it was found and retrieved, to answer
 *    data-subject (GDPR) requests from the people contacted. They are deleted
 *    with the Application.
 * Every read and change is scoped to the Candidate; problems come back as results.
 */
import type { Pool } from "pg";
import type { Applications } from "../applications";
import type { QuotaDecision } from "../billing";
import type { QuotaRefusal } from "../billing/upgrade-prompt";
import type { CompanyDossier, CompanyDossiers, SuggestedContactRole } from "../company-dossiers";
import { ContactProviderError, type ContactEnrichmentProvider, type ContactProviderId } from "./providers/types";

export { CONTACT_PROVIDERS, type ContactProviderId } from "./providers/types";

/** A person a provider found at the employer: no contact details until revealed. */
export interface FoundContact {
  id: string;
  name: string;
  jobTitle?: string;
  source: { provider: ContactProviderId; providerPersonId: string; foundAt: Date };
}

/** A named person at the employer with contact details, from a licensed data provider. */
export interface EnrichedContact {
  id: string;
  name: string;
  jobTitle?: string;
  emails: string[];
  phones: string[];
  /** Where and when the details were retrieved: kept to answer the contacted person's GDPR requests. */
  source: { provider: ContactProviderId; providerPersonId: string; foundAt: Date; retrievedAt: Date };
}

export interface EnrichedContactsState {
  /** A provider is configured and its DPA signed. */
  enabled: boolean;
  /** The provider can find people by company and job title (Kaspr cannot). */
  searchable: boolean;
  /** People found, not revealed yet. */
  found: FoundContact[];
  contacts: EnrichedContact[];
}

export type EnrichedContactsResult =
  | { ok: true; state: EnrichedContactsState }
  /** The Candidate's Plan has no Enriched Contacts, or none left this month. */
  | { ok: false; error: "quota_exceeded"; refusal: QuotaRefusal }
  | {
      ok: false;
      error:
        | "not_found" /** No such Application (or person) for this Candidate. */
        | "disabled" /** No provider configured, or its DPA not signed. */
        | "no_dossier" /** The Company Dossier is not built: who to look for is unknown. */
        | "search_unsupported" /** The provider cannot find people by company and job title. */
        | "no_details" /** The provider has no contact details for this person. Not counted. */
        | "unavailable"; /** The provider could not answer. Nothing counted; try again later. */
    };

/** The monthly Enriched Contacts quota, as billing gives it (`allows`, `use`, `release` of "enrichedContacts"). */
export interface EnrichedContactQuota {
  allows(candidateId: string): Promise<QuotaDecision>;
  use(candidateId: string): Promise<QuotaDecision>;
  release(candidateId: string): Promise<void>;
}

/** Where Company Dossiers come from, as this module needs them. */
export type CompanyDossierSource = Pick<CompanyDossiers, "get">;

export interface EnrichedContacts {
  /** The Application's people found and Enriched Contacts, or null if it does not exist or belongs to someone else. */
  get(candidateId: string, applicationId: string): Promise<EnrichedContactsState | null>;
  /** Looks for people at the employer holding the Suggested Contact Roles. Not counted: nothing is revealed. */
  find(candidateId: string, applicationId: string): Promise<EnrichedContactsResult>;
  /** Reveals a found person's contact details, counting one Enriched Contact. */
  reveal(candidateId: string, applicationId: string, contactId: string): Promise<EnrichedContactsResult>;
  /** One Enriched Contact of the Application (revealed), or null. */
  contact(candidateId: string, applicationId: string, contactId: string): Promise<EnrichedContact | null>;
}

export interface EnrichedContactsDeps {
  applications: Pick<Applications, "get">;
  companyDossiers: CompanyDossierSource;
  quota: EnrichedContactQuota;
  /** The active provider; null when Enriched Contacts are off. */
  provider: ContactEnrichmentProvider | null;
  now?: () => Date;
}

/** People looked for per search: each one found may cost provider credits. */
const SEARCH_LIMIT = 10;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Each Suggested Contact Role as the job titles people at French and international employers hold. The hiring manager depends on the post: no fixed title. */
const JOB_TITLES: Record<SuggestedContactRole, string[]> = {
  hiring_manager: [],
  talent_acquisition: ["Responsable recrutement", "Chargé de recrutement", "Talent Acquisition"],
  hr_director: ["DRH", "Directeur des ressources humaines", "HR Director"],
  hr_manager: ["RRH", "Responsable des ressources humaines", "HR Manager"],
  chief_executive: ["Directeur général", "PDG", "CEO"],
};
/** Looked for when the Suggested Contact Roles give no job title. */
const DEFAULT_ROLES: SuggestedContactRole[] = ["hr_director", "talent_acquisition"];

function searchFor(dossier: CompanyDossier) {
  const roles = dossier.suggestedContactRoles.filter((role) => JOB_TITLES[role]?.length);
  const jobTitles = [...new Set((roles.length ? roles : DEFAULT_ROLES).flatMap((role) => JOB_TITLES[role]))];
  const companyName = dossier.source === "french_register" ? dossier.name : dossier.employer;
  let companyDomain: string | undefined;
  if (dossier.source === "web" && dossier.website && URL.canParse(dossier.website)) {
    companyDomain = new URL(dossier.website).hostname.replace(/^www\./, "");
  }
  return { companyName, jobTitles, limit: SEARCH_LIMIT, ...(companyDomain && { companyDomain }) };
}

interface Row {
  id: string;
  provider: ContactProviderId;
  provider_person_id: string;
  name: string;
  job_title: string | null;
  emails: string[];
  phones: string[];
  found_at: Date;
  retrieved_at: Date | null;
}

function foundFrom(row: Row): FoundContact {
  const found: FoundContact = { id: row.id, name: row.name, source: { provider: row.provider, providerPersonId: row.provider_person_id, foundAt: row.found_at } };
  if (row.job_title) found.jobTitle = row.job_title;
  return found;
}

function contactFrom(row: Row & { retrieved_at: Date }): EnrichedContact {
  const contact: EnrichedContact = {
    id: row.id,
    name: row.name,
    emails: row.emails,
    phones: row.phones,
    source: { provider: row.provider, providerPersonId: row.provider_person_id, foundAt: row.found_at, retrievedAt: row.retrieved_at },
  };
  if (row.job_title) contact.jobTitle = row.job_title;
  return contact;
}

const isRevealed = (row: Row): row is Row & { retrieved_at: Date } => row.retrieved_at !== null;

export function createEnrichedContacts(database: Pool, deps: EnrichedContactsDeps): EnrichedContacts {
  const { provider } = deps;
  const now = deps.now ?? (() => new Date());
  const COLUMNS = "id, provider, provider_person_id, name, job_title, emails, phones, found_at, retrieved_at";

  async function stateOf(applicationId: string): Promise<EnrichedContactsState> {
    const { rows } = await database.query<Row>(`SELECT ${COLUMNS} FROM enriched_contact WHERE application_id = $1 ORDER BY found_at, name`, [applicationId]);
    return {
      enabled: provider !== null,
      searchable: !!provider?.findPeople,
      found: rows.filter((row) => !isRevealed(row)).map(foundFrom),
      contacts: rows.filter(isRevealed).map(contactFrom),
    };
  }

  const ownApplication = async (candidateId: string, applicationId: string) =>
    UUID.test(applicationId) ? !!(await deps.applications.get(candidateId, applicationId)) : false;

  async function rowOf(applicationId: string, contactId: string): Promise<Row | undefined> {
    if (!UUID.test(contactId)) return undefined;
    const { rows } = await database.query<Row>(`SELECT ${COLUMNS} FROM enriched_contact WHERE application_id = $1 AND id = $2`, [applicationId, contactId]);
    return rows[0];
  }

  function providerFailed(error: unknown): EnrichedContactsResult {
    if (!(error instanceof ContactProviderError)) throw error;
    console.warn("[enriched-contacts] the provider could not answer:", error.message);
    return { ok: false, error: "unavailable" };
  }

  return {
    async get(candidateId, applicationId) {
      if (!(await ownApplication(candidateId, applicationId))) return null;
      return stateOf(applicationId);
    },

    async find(candidateId, applicationId) {
      if (!(await ownApplication(candidateId, applicationId))) return { ok: false, error: "not_found" };
      if (!provider) return { ok: false, error: "disabled" };
      if (!provider.findPeople) return { ok: false, error: "search_unsupported" };
      const decision = await deps.quota.allows(candidateId);
      if (!decision.allowed) return { ok: false, error: "quota_exceeded", refusal: decision };
      const dossierState = await deps.companyDossiers.get(candidateId, applicationId);
      if (dossierState?.status !== "built") return { ok: false, error: "no_dossier" };
      let people;
      try {
        people = await provider.findPeople(searchFor(dossierState.dossier));
      } catch (error) {
        return providerFailed(error);
      }
      const foundAt = now();
      for (const person of people) {
        // Someone found again keeps what was revealed of them.
        await database.query(
          `INSERT INTO enriched_contact (application_id, provider, provider_person_id, name, job_title, found_at) VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (application_id, provider, provider_person_id) DO UPDATE
             SET name = CASE WHEN enriched_contact.retrieved_at IS NULL THEN $4 ELSE enriched_contact.name END,
                 job_title = CASE WHEN enriched_contact.retrieved_at IS NULL THEN $5 ELSE enriched_contact.job_title END`,
          [applicationId, provider.id, person.providerPersonId, person.name, person.jobTitle ?? null, foundAt],
        );
      }
      return { ok: true, state: await stateOf(applicationId) };
    },

    async reveal(candidateId, applicationId, contactId) {
      if (!(await ownApplication(candidateId, applicationId))) return { ok: false, error: "not_found" };
      const row = await rowOf(applicationId, contactId);
      if (!row) return { ok: false, error: "not_found" };
      if (isRevealed(row)) return { ok: true, state: await stateOf(applicationId) };
      // Found through another provider than the active one: its id means nothing to this one.
      if (!provider || provider.id !== row.provider) return { ok: false, error: "disabled" };
      const decision = await deps.quota.use(candidateId);
      if (!decision.allowed) return { ok: false, error: "quota_exceeded", refusal: decision };
      let details;
      try {
        details = await provider.getContactDetails({ providerPersonId: row.provider_person_id });
      } catch (error) {
        await deps.quota.release(candidateId);
        return providerFailed(error);
      }
      if (!details || (details.emails.length === 0 && details.phones.length === 0)) {
        await deps.quota.release(candidateId);
        return { ok: false, error: "no_details" };
      }
      await database.query(
        `UPDATE enriched_contact SET name = $3, job_title = COALESCE($4, job_title), emails = $5, phones = $6, retrieved_at = $7
         WHERE application_id = $1 AND id = $2`,
        [applicationId, row.id, details.name || row.name, details.jobTitle ?? null, details.emails, details.phones, now()],
      );
      return { ok: true, state: await stateOf(applicationId) };
    },

    async contact(candidateId, applicationId, contactId) {
      if (!(await ownApplication(candidateId, applicationId))) return null;
      const row = await rowOf(applicationId, contactId);
      return row && isRevealed(row) ? contactFrom(row) : null;
    },
  };
}

/** Creates or upgrades the Enriched Contact table. Run after the Application table. Safe to run repeatedly. */
export async function migrateEnrichedContacts(database: Pool): Promise<void> {
  await database.query(`
    CREATE TABLE IF NOT EXISTS enriched_contact (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      application_id uuid NOT NULL REFERENCES application (id) ON DELETE CASCADE,
      -- Where the person's data comes from, and the provider's id for them: to answer their GDPR requests.
      provider text NOT NULL,
      provider_person_id text NOT NULL,
      name text NOT NULL,
      job_title text,
      emails text[] NOT NULL DEFAULT '{}',
      phones text[] NOT NULL DEFAULT '{}',
      found_at timestamptz NOT NULL,
      -- When the contact details were retrieved; null while the person is only found.
      retrieved_at timestamptz,
      UNIQUE (application_id, provider, provider_person_id)
    );
  `);
}
