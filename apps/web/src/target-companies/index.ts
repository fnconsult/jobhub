/**
 * Target Companies (CONTEXT.md, #406): the companies Job discovery aims at for one Profile, those
 * La Bonne Boite gives as likely to hire for its job and area and those the Candidate adds by name,
 * and the careers site or ATS board found for a company, shared by every Profile.
 *
 *   const targets = createTargetCompanies(database, { register });
 *   await targets.list(profileId);                                  // the Profile's, those set aside left out
 *   await targets.refresh(candidateId, profileId, { key, companies }, now); // La Bonne Boite's answer for the Profile's job and area
 *   await targets.visited(profileId, ids, now);                     // Job discovery read them in this run
 *   await targets.careersSites(["siren:552100554"]);                // Map: company key → careers site URL
 *   await targets.keepCareersSite("siren:552100554", url, now);     // found once, kept for every Profile
 *   await targets.add(candidateId, profileId, "Acme Industrie");    // the Candidate's own, resolved in the company register
 *   await targets.setAside(candidateId, profileId, id);             // for good: La Bonne Boite never brings it back
 *   await webSearchableName(register, company);                     // the name a web search may carry, null: none (ADR-0007)
 *
 * A company is the same across Profiles by its key: its SIREN when known (`siren:552100554`, an
 * establishment's SIRET gives it), else its name compared without case, accents or legal form
 * (`name:acme industrie`). The careers site register holds only public facts about companies: no
 * Candidate, no Profile. A Profile's Target Companies go with it (and with its Candidate).
 */
import type { Pool } from "pg";
import { nameKey, sirenIn } from "../company-dossiers/company-names";
import type { CompanyRegister } from "../company-dossiers/french-register";

export type TargetCompanyOrigin = "la_bonne_boite" | "candidate";

export interface TargetCompany {
  id: string;
  /** Which company it is, the same for every Profile: "siren:552100554", else "name:acme industrie". */
  companyKey: string;
  name: string;
  /** Where it came from: La Bonne Boite, or the Candidate adding it by name. */
  origin: TargetCompanyOrigin;
  /** La Bonne Boite's hiring potential, 0 to 100; null for one the Candidate added. */
  hiringScore: number | null;
  city: string | null;
  /** Its activity, as La Bonne Boite labels its NAF code. */
  activity: string | null;
  addedAt: Date;
  /** When Job discovery last read its careers site or searched for its postings; null: never. */
  lastVisitedAt: Date | null;
}

/** A company La Bonne Boite gave: one establishment (its SIRET) and its hiring potential. */
export interface LaBonneBoiteEntry {
  siret: string;
  name: string;
  hiringScore: number;
  city?: string;
  activity?: string;
}

/** La Bonne Boite's answer for a Profile: what it was asked for (`key`: its job and area), and the companies. */
export interface LaBonneBoiteListing {
  key: string;
  companies: LaBonneBoiteEntry[];
}

/** What Job discovery needs of the Target Companies. */
export interface TargetCompanyStore {
  /** The Profile's Target Companies, those set aside left out, in no particular order. */
  list(profileId: string): Promise<TargetCompany[]>;
  /** What the Profile's La Bonne Boite companies were last fetched for (`key`) and when; null: never. */
  lastRefresh(profileId: string): Promise<{ key: string; at: Date } | null>;
  /**
   * Makes `listing` the Profile's La Bonne Boite companies: new ones added, those still given updated
   * (score, city), those no longer given dropped. One set aside stays so, never listed again; the
   * Candidate's own are kept as they are, theirs even when La Bonne Boite gives them too.
   */
  refresh(candidateId: string, profileId: string, listing: LaBonneBoiteListing, at: Date): Promise<void>;
  /** Job discovery visited these Target Companies of the Profile at `at`. */
  visited(profileId: string, ids: readonly string[], at: Date): Promise<void>;
  /** The careers site (or ATS board) kept for each of these companies that has one. */
  careersSites(companyKeys: readonly string[]): Promise<Map<string, string>>;
  /** Keeps `url` as the company's careers site, for every Profile; one already kept is replaced. */
  keepCareersSite(companyKey: string, url: string, at: Date): Promise<void>;
}

/**
 * `not_a_company`: the register lists the name as a sole trader's (a private person's): the Candidate is asked to name
 * the company instead, as for a Company Dossier (ADR-0007).
 */
export type AddTargetCompanyResult = { ok: true; company: TargetCompany } | { ok: false; error: "invalid" | "exists" | "not_a_company" };

export interface TargetCompanies extends TargetCompanyStore {
  /**
   * The Candidate adds a company by name to the Profile's Target Companies, as the company register lists it
   * (its registered name and SIREN) when it does, else under the name given. Refused when the Profile is not
   * theirs, the name is empty, the register lists it as a sole trader's (a private person's), or the company is
   * already one of its Target Companies (set aside included).
   */
  add(candidateId: string, profileId: string, name: string): Promise<AddTargetCompanyResult>;
  /** The Candidate sets one of the Profile's Target Companies aside, for good. False when there is no such one of theirs. */
  setAside(candidateId: string, profileId: string, id: string): Promise<boolean>;
}

export interface TargetCompaniesOptions {
  /** Where a company the Candidate adds is resolved. Default: none, so it is kept under the name given. */
  register?: CompanyRegister;
  now?: () => Date;
}

/** The key a company is known by across Profiles: its SIREN when known (from a SIREN or a SIRET), else its compared name. */
export function companyKeyOf(company: { siret?: string | null; siren?: string | null; name: string }): string {
  const siren = company.siren ?? company.siret?.slice(0, 9);
  if (siren && /^\d{9}$/.test(siren)) return `siren:${siren}`;
  return `name:${nameKey(company.name)}`;
}

/**
 * The name a web search « title + company » may carry for a Target Company (ADR-0007: a company's, never a person's),
 * null when none may: the company register is asked by its SIREN when known, and the name goes only when it lists that
 * SIREN as a company (a sole trader's, or one it does not list, never); else by its name, which goes unless the
 * register lists it as a sole trader's or it holds a SIREN, as for a Company Dossier. The register unreachable: null.
 */
export async function webSearchableName(register: CompanyRegister, company: Pick<TargetCompany, "companyKey" | "name">): Promise<string | null> {
  try {
    const siren = /^siren:(\d{9})$/.exec(company.companyKey)?.[1];
    if (siren) {
      const { companies } = await register.search(siren);
      return companies.some((listed) => listed.siren === siren) ? company.name : null;
    }
    if (sirenIn(company.name)) return null;
    const { soleTraderNamed } = await register.search(company.name);
    return soleTraderNamed ? null : company.name;
  } catch {
    return null;
  }
}

/** The longest name kept for a company. */
const MAX_NAME_LENGTH = 200;

interface Row {
  id: string;
  company_key: string;
  name: string;
  origin: TargetCompanyOrigin;
  hiring_score: number | null;
  city: string | null;
  activity: string | null;
  added_at: Date;
  last_visited_at: Date | null;
}

const COLUMNS = "id, company_key, name, origin, hiring_score, city, activity, added_at, last_visited_at";

const companyOf = (row: Row): TargetCompany => ({
  id: row.id,
  companyKey: row.company_key,
  name: row.name,
  origin: row.origin,
  hiringScore: row.hiring_score === null ? null : Number(row.hiring_score),
  city: row.city,
  activity: row.activity,
  addedAt: row.added_at,
  lastVisitedAt: row.last_visited_at,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createTargetCompanies(database: Pick<Pool, "query" | "connect">, options: TargetCompaniesOptions = {}): TargetCompanies {
  const now = options.now ?? (() => new Date());

  /** Whether `profileId` is one of the Candidate's Profiles. */
  const owns = async (candidateId: string, profileId: string) =>
    UUID.test(profileId) && (await database.query("SELECT 1 FROM profile WHERE id = $1 AND candidate_id = $2", [profileId, candidateId])).rows.length > 0;

  /**
   * The company the register lists under `name`, its SIREN and registered name; null when it lists none or cannot
   * answer; "sole_trader" when it lists the name as a sole trader's (a private person's).
   */
  async function registered(name: string): Promise<{ siren: string; name: string } | "sole_trader" | null> {
    if (!options.register) return null;
    try {
      const { companies, soleTraderNamed } = await options.register.search(name);
      if (soleTraderNamed) return "sole_trader";
      const found = companies.find((company) => company.active) ?? null;
      return found ? { siren: found.siren, name: found.name } : null;
    } catch {
      return null;
    }
  }

  return {
    async list(profileId) {
      if (!UUID.test(profileId)) return [];
      const { rows } = await database.query<Row>(`SELECT ${COLUMNS} FROM target_company WHERE profile_id = $1 AND set_aside_at IS NULL`, [profileId]);
      return rows.map(companyOf);
    },

    async lastRefresh(profileId) {
      if (!UUID.test(profileId)) return null;
      const { rows } = await database.query<{ listing_key: string; refreshed_at: Date }>("SELECT listing_key, refreshed_at FROM target_company_refresh WHERE profile_id = $1", [profileId]);
      return rows[0] ? { key: rows[0].listing_key, at: rows[0].refreshed_at } : null;
    },

    async refresh(candidateId, profileId, listing, at) {
      // One company per key: an establishment's best score stands for its company.
      const byKey = new Map<string, LaBonneBoiteEntry & { key: string }>();
      for (const company of listing.companies) {
        const key = companyKeyOf(company);
        const kept = byKey.get(key);
        if (!kept || kept.hiringScore < company.hiringScore) byKey.set(key, { ...company, key });
      }
      const companies = [...byKey.values()];
      const client = await database.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `DELETE FROM target_company WHERE profile_id = $1 AND origin = 'la_bonne_boite' AND set_aside_at IS NULL AND NOT (company_key = ANY($2::text[]))`,
          [profileId, companies.map((company) => company.key)],
        );
        for (const company of companies) {
          await client.query(
            `INSERT INTO target_company (profile_id, candidate_id, company_key, name, origin, hiring_score, city, activity, added_at)
             VALUES ($1, $2, $3, $4, 'la_bonne_boite', $5, $6, $7, $8)
             ON CONFLICT (profile_id, company_key) DO UPDATE
               SET hiring_score = EXCLUDED.hiring_score, city = EXCLUDED.city, activity = EXCLUDED.activity
             WHERE target_company.origin = 'la_bonne_boite'`,
            [profileId, candidateId, company.key, company.name.slice(0, MAX_NAME_LENGTH), company.hiringScore, company.city ?? null, company.activity ?? null, at],
          );
        }
        await client.query(
          `INSERT INTO target_company_refresh (profile_id, listing_key, refreshed_at) VALUES ($1, $2, $3)
           ON CONFLICT (profile_id) DO UPDATE SET listing_key = EXCLUDED.listing_key, refreshed_at = EXCLUDED.refreshed_at`,
          [profileId, listing.key, at],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },

    async visited(profileId, ids, at) {
      const valid = ids.filter((id) => UUID.test(id));
      if (valid.length === 0) return;
      await database.query("UPDATE target_company SET last_visited_at = $3 WHERE profile_id = $1 AND id = ANY($2::uuid[])", [profileId, valid, at]);
    },

    async careersSites(companyKeys) {
      if (companyKeys.length === 0) return new Map();
      const { rows } = await database.query<{ company_key: string; url: string }>("SELECT company_key, url FROM company_careers_site WHERE company_key = ANY($1::text[])", [[...companyKeys]]);
      return new Map(rows.map((row) => [row.company_key, row.url]));
    },

    async keepCareersSite(companyKey, url, at) {
      await database.query(
        `INSERT INTO company_careers_site (company_key, url, found_at) VALUES ($1, $2, $3)
         ON CONFLICT (company_key) DO UPDATE SET url = EXCLUDED.url, found_at = EXCLUDED.found_at`,
        [companyKey, url, at],
      );
    },

    async add(candidateId, profileId, name) {
      const typed = name.replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH);
      if (!typed || !nameKey(typed) || !(await owns(candidateId, profileId))) return { ok: false, error: "invalid" };
      const found = await registered(typed);
      if (found === "sole_trader") return { ok: false, error: "not_a_company" };
      const company = found ? { name: found.name, key: companyKeyOf({ siren: found.siren, name: found.name }) } : { name: typed, key: companyKeyOf({ name: typed }) };
      const { rows } = await database.query<Row>(
        `INSERT INTO target_company (profile_id, candidate_id, company_key, name, origin, added_at)
         VALUES ($1, $2, $3, $4, 'candidate', $5)
         ON CONFLICT (profile_id, company_key) DO UPDATE SET origin = 'candidate', hiring_score = NULL
           WHERE target_company.origin = 'la_bonne_boite' AND target_company.set_aside_at IS NULL
         RETURNING ${COLUMNS}`,
        [profileId, candidateId, company.key, company.name, now()],
      );
      return rows[0] ? { ok: true, company: companyOf(rows[0]) } : { ok: false, error: "exists" };
    },

    async setAside(candidateId, profileId, id) {
      if (!UUID.test(id) || !UUID.test(profileId)) return false;
      const { rowCount } = await database.query(
        "UPDATE target_company SET set_aside_at = $4 WHERE id = $1 AND profile_id = $2 AND candidate_id = $3 AND set_aside_at IS NULL",
        [id, profileId, candidateId, now()],
      );
      return (rowCount ?? 0) > 0;
    },
  };
}

/** Creates or upgrades the Target Company tables. Run after the Profile table. Safe to run repeatedly. */
export async function migrateTargetCompanies(database: Pick<Pool, "query">): Promise<void> {
  await database.query(`
    CREATE TABLE IF NOT EXISTS target_company (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      profile_id uuid NOT NULL REFERENCES profile (id) ON DELETE CASCADE,
      candidate_id text NOT NULL REFERENCES candidate (id) ON DELETE CASCADE,
      company_key text NOT NULL,
      name text NOT NULL,
      origin text NOT NULL CHECK (origin IN ('la_bonne_boite', 'candidate')),
      hiring_score real,
      city text,
      activity text,
      added_at timestamptz NOT NULL DEFAULT now(),
      last_visited_at timestamptz,
      set_aside_at timestamptz,
      UNIQUE (profile_id, company_key)
    );
    CREATE INDEX IF NOT EXISTS target_company_candidate_id_idx ON target_company (candidate_id);
    -- What a Profile's La Bonne Boite companies were last fetched for (its job and area) and when.
    CREATE TABLE IF NOT EXISTS target_company_refresh (
      profile_id uuid PRIMARY KEY REFERENCES profile (id) ON DELETE CASCADE,
      listing_key text NOT NULL,
      refreshed_at timestamptz NOT NULL
    );
    -- Public facts about companies, shared by every Profile: no Candidate here.
    CREATE TABLE IF NOT EXISTS company_careers_site (
      company_key text PRIMARY KEY,
      url text NOT NULL,
      found_at timestamptz NOT NULL
    );
  `);
}
