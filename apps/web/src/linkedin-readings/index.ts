/**
 * LinkedIn Readings (ADR-0119 « LinkedIn, through the extension only », #1164): what the browser extension read, in the
 * Candidate's own browser and on their click, of a LinkedIn page they opened (a Job Offer, a company page, a company's
 * people filtered by department), and the people it named, kept as contacts of the Application or the Target Company of
 * that company, marked LinkedIn.
 *
 *   const readings = createLinkedInReadings(database);
 *   await readings.keep(candidateId, sentByTheExtension);            // { ok, reading }: where its people were filed
 *   await readings.latest(candidateId, { since, url? });              // the AI Coach's read: the latest Reading, of that page
 *   await readings.contactsOf(candidateId, { applicationId });        // the LinkedIn contacts an Application's page shows
 *   await readings.contactsOf(candidateId, { targetCompanyId });      // …and a Target Company's
 *
 * Rules kept here:
 *  - Jobbbox's server never reads LinkedIn: nothing here calls the network. It keeps what the extension sent, read through
 *    `linkedInReadingOf` (@jobhub/shared): of each person their name, role and company only, never a profile or its
 *    address. A Reading of a page that is not one a Reading may be of (a profile's) is refused.
 *  - Its people are filed with every Application whose employer is that company, and every Target Company of that name
 *    (not set aside), the Candidate's own only, compared without case, accents or legal form. With none, no one is kept:
 *    the Reading says only how many people it read (`peopleRead`), so the AI Coach can propose the Target Company first.
 *  - Read again, a person is not doubled: their role and the date they were read are brought up to date.
 *  - Contacts go with their Application or Target Company, and Readings with the Candidate; the Candidate's Readings
 *    beyond their latest KEPT_READINGS that file no one any more are forgotten.
 */
import { linkedInPageOf, linkedInReadingOf, type LinkedInPage, type LinkedInPerson } from "@jobhub/shared";
import type { Pool } from "pg";
import { nameKey } from "../company-dossiers/company-names";

/** Where a Reading's people were filed: an Application (named by its title), or a Profile's Target Company. */
export type LinkedInReadingPlace = { kind: "application"; id: string; name: string } | { kind: "target_company"; id: string; name: string; profileId: string };

export interface KeptLinkedInReading {
  id: string;
  page: LinkedInPage;
  company: string;
  department?: string;
  /** The people kept: those filed somewhere; none when the Reading was filed nowhere. */
  people: LinkedInPerson[];
  /** How many people the page named, kept or not. */
  peopleRead: number;
  filedIn: LinkedInReadingPlace[];
  readAt: Date;
}

/** A person read on LinkedIn, as an Application or a Target Company keeps them. */
export interface LinkedInContact {
  id: string;
  name: string;
  role: string;
  company: string;
  source: "linkedin";
  /** When the extension last read them. */
  readAt: Date;
}

export type KeepResult = { ok: true; reading: KeptLinkedInReading } | { ok: false; error: "invalid" };

export interface LinkedInReadings {
  keep(candidateId: string, sent: unknown): Promise<KeepResult>;
  /** The Candidate's latest Reading made at `since` or later; of the page `url` names, when given (any of its tabs). */
  latest(candidateId: string, options: { since: Date; url?: string }): Promise<KeptLinkedInReading | null>;
  contactsOf(candidateId: string, place: { applicationId: string } | { targetCompanyId: string }): Promise<LinkedInContact[]>;
}

/** How many of a Candidate's Readings are kept, beyond those whose people are filed somewhere. */
const KEPT_READINGS = 20;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ReadingRow {
  id: string;
  page_kind: LinkedInPage["kind"];
  page_url: string;
  company: string;
  department: string | null;
  people_read: number;
  read_at: Date;
}

interface ContactRow {
  id: string;
  reading_id: string;
  application_id: string | null;
  target_company_id: string | null;
  name: string;
  role: string;
  company: string;
  read_at: Date;
}

/** A person told apart in one place: by their name, without case or accents. */
const personKey = (name: string) => name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export function createLinkedInReadings(database: Pool, deps: { now?: () => Date } = {}): LinkedInReadings {
  const now = deps.now ?? (() => new Date());

  /** The Candidate's Applications at `company`, and their Target Companies of that name, not set aside. */
  async function placesOf(candidateId: string, company: string): Promise<LinkedInReadingPlace[]> {
    const key = nameKey(company);
    if (!key) return [];
    const [applications, targets] = await Promise.all([
      database.query<{ id: string; title: string; employer: string }>(
        `SELECT a.id, COALESCE(a.job_title, o.title) AS title, o.employer
           FROM application a JOIN job_offer o ON o.id = a.job_offer_id
          WHERE a.candidate_id = $1 AND o.employer IS NOT NULL ORDER BY a.created_at, a.id`,
        [candidateId],
      ),
      database.query<{ id: string; name: string; profile_id: string }>(
        `SELECT id, name, profile_id FROM target_company WHERE candidate_id = $1 AND set_aside_at IS NULL ORDER BY added_at, id`,
        [candidateId],
      ),
    ]);
    return [
      ...applications.rows.filter((row) => nameKey(row.employer) === key).map((row): LinkedInReadingPlace => ({ kind: "application", id: row.id, name: row.title })),
      ...targets.rows.filter((row) => nameKey(row.name) === key).map((row): LinkedInReadingPlace => ({ kind: "target_company", id: row.id, name: row.name, profileId: row.profile_id })),
    ];
  }

  /** The Reading `row` with its people and where they are filed. */
  async function told(candidateId: string, row: ReadingRow): Promise<KeptLinkedInReading> {
    const { rows } = await database.query<ContactRow & { place_name: string | null; profile_id: string | null }>(
      `SELECT c.id, c.reading_id, c.application_id, c.target_company_id, c.name, c.role, c.company, c.read_at,
              COALESCE(a.job_title, o.title, t.name) AS place_name, t.profile_id
         FROM linkedin_contact c
         LEFT JOIN application a ON a.id = c.application_id
         LEFT JOIN job_offer o ON o.id = a.job_offer_id
         LEFT JOIN target_company t ON t.id = c.target_company_id
        WHERE c.candidate_id = $1 AND c.reading_id = $2 ORDER BY c.position, c.id`,
      [candidateId, row.id],
    );
    const people = new Map<string, LinkedInPerson>();
    const places = new Map<string, LinkedInReadingPlace>();
    for (const contact of rows) {
      people.set(`${personKey(contact.name)}\u0000${contact.role}`, { name: contact.name, role: contact.role, company: contact.company });
      if (contact.application_id) places.set(contact.application_id, { kind: "application", id: contact.application_id, name: contact.place_name ?? "" });
      else if (contact.target_company_id)
        places.set(contact.target_company_id, { kind: "target_company", id: contact.target_company_id, name: contact.place_name ?? "", profileId: contact.profile_id ?? "" });
    }
    return {
      id: row.id,
      page: { kind: row.page_kind, url: row.page_url },
      company: row.company,
      ...(row.department ? { department: row.department } : {}),
      people: [...people.values()],
      peopleRead: row.people_read,
      filedIn: [...places.values()],
      readAt: row.read_at,
    };
  }

  return {
    async keep(candidateId, sent) {
      const reading = linkedInReadingOf(sent);
      if (!candidateId || !reading) return { ok: false, error: "invalid" };
      const at = now();
      const places = await placesOf(candidateId, reading.company);
      const client = await database.connect();
      let id: string;
      try {
        await client.query("BEGIN");
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO linkedin_reading (candidate_id, page_kind, page_url, company, department, people_read, read_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [candidateId, reading.page.kind, reading.page.url, reading.company, reading.department ?? null, reading.people.length, at],
        );
        id = inserted.rows[0]!.id;
        for (const place of places) {
          const column = place.kind === "application" ? "application_id" : "target_company_id";
          for (const [position, person] of reading.people.entries()) {
            await client.query(
              `INSERT INTO linkedin_contact (candidate_id, reading_id, ${column}, name_key, name, role, company, position, read_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
               ON CONFLICT (${column}, name_key) WHERE ${column} IS NOT NULL
               DO UPDATE SET reading_id = EXCLUDED.reading_id, name = EXCLUDED.name, role = EXCLUDED.role, company = EXCLUDED.company,
                             position = EXCLUDED.position, read_at = EXCLUDED.read_at`,
              [candidateId, id, place.id, personKey(person.name), person.name, person.role, person.company, position, at],
            );
          }
        }
        // Older Readings that file no one any more, beyond the latest KEPT_READINGS, are forgotten.
        await client.query(
          `DELETE FROM linkedin_reading r WHERE r.candidate_id = $1
              AND r.id NOT IN (SELECT id FROM linkedin_reading WHERE candidate_id = $1 ORDER BY read_at DESC, id DESC LIMIT ${KEPT_READINGS})
              AND NOT EXISTS (SELECT 1 FROM linkedin_contact c WHERE c.reading_id = r.id)`,
          [candidateId],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
      const { rows } = await database.query<ReadingRow>(`SELECT * FROM linkedin_reading WHERE id = $1`, [id]);
      return { ok: true, reading: await told(candidateId, rows[0]!) };
    },

    async latest(candidateId, { since, url }) {
      if (!candidateId) return null;
      const page = url === undefined ? undefined : linkedInPageOf(url);
      if (page === null) return null;
      const { rows } = await database.query<ReadingRow>(
        `SELECT * FROM linkedin_reading WHERE candidate_id = $1 AND read_at >= $2 AND ($3::text IS NULL OR page_url = $3)
          ORDER BY read_at DESC, id DESC LIMIT 1`,
        [candidateId, since, page?.url ?? null],
      );
      return rows[0] ? told(candidateId, rows[0]) : null;
    },

    async contactsOf(candidateId, place) {
      const [column, id] = "applicationId" in place ? ["application_id", place.applicationId] : ["target_company_id", place.targetCompanyId];
      if (!candidateId || !UUID.test(id)) return [];
      const { rows } = await database.query<ContactRow>(
        `SELECT id, reading_id, application_id, target_company_id, name, role, company, read_at FROM linkedin_contact
          WHERE candidate_id = $1 AND ${column} = $2 ORDER BY read_at DESC, position, id`,
        [candidateId, id],
      );
      return rows.map((row) => ({ id: row.id, name: row.name, role: row.role, company: row.company, source: "linkedin", readAt: row.read_at }));
    },
  };
}

/** Creates or upgrades the LinkedIn Reading tables. Run after the Applications and the Target Companies. Safe to run repeatedly. */
export async function migrateLinkedInReadings(database: Pick<Pool, "query">): Promise<void> {
  await database.query(`
    CREATE TABLE IF NOT EXISTS linkedin_reading (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      candidate_id text NOT NULL REFERENCES candidate (id) ON DELETE CASCADE,
      page_kind text NOT NULL CHECK (page_kind IN ('job_offer', 'company', 'people')),
      page_url text NOT NULL,
      company text NOT NULL,
      department text,
      people_read integer NOT NULL,
      read_at timestamptz NOT NULL
    );
    CREATE INDEX IF NOT EXISTS linkedin_reading_candidate_idx ON linkedin_reading (candidate_id, read_at);
    -- A person read on LinkedIn: their name, role and company only (ADR-0119), filed with one Application or one Target Company.
    CREATE TABLE IF NOT EXISTS linkedin_contact (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      candidate_id text NOT NULL REFERENCES candidate (id) ON DELETE CASCADE,
      reading_id uuid NOT NULL REFERENCES linkedin_reading (id) ON DELETE CASCADE,
      application_id uuid REFERENCES application (id) ON DELETE CASCADE,
      target_company_id uuid REFERENCES target_company (id) ON DELETE CASCADE,
      name_key text NOT NULL,
      name text NOT NULL,
      role text NOT NULL,
      company text NOT NULL,
      position integer NOT NULL,
      read_at timestamptz NOT NULL,
      CHECK ((application_id IS NULL) <> (target_company_id IS NULL))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS linkedin_contact_application_person ON linkedin_contact (application_id, name_key) WHERE application_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS linkedin_contact_target_company_person ON linkedin_contact (target_company_id, name_key) WHERE target_company_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS linkedin_contact_reading_idx ON linkedin_contact (reading_id);
  `);
}

/** A LinkedIn Reading as the Candidate's Data export holds it: the page, its company, and the people kept from it, where. */
export interface ExportedLinkedInReading {
  page: LinkedInPage;
  company: string;
  department: string | null;
  peopleRead: number;
  readAt: Date;
  contacts: { name: string; role: string; company: string; applicationId: string | null; targetCompanyId: string | null; readAt: Date }[];
}

/** The Candidate's LinkedIn Readings (#1164), oldest first, each with the contacts it still files. */
export async function linkedInReadingsOf(database: Pick<Pool, "query">, candidateId: string): Promise<ExportedLinkedInReading[]> {
  const [readings, contacts] = await Promise.all([
    database.query<ReadingRow>(`SELECT * FROM linkedin_reading WHERE candidate_id = $1 ORDER BY read_at, id`, [candidateId]),
    database.query<ContactRow>(
      `SELECT id, reading_id, application_id, target_company_id, name, role, company, read_at FROM linkedin_contact WHERE candidate_id = $1 ORDER BY position, id`,
      [candidateId],
    ),
  ]);
  return readings.rows.map((row) => ({
    page: { kind: row.page_kind, url: row.page_url },
    company: row.company,
    department: row.department,
    peopleRead: row.people_read,
    readAt: row.read_at,
    contacts: contacts.rows
      .filter((contact) => contact.reading_id === row.id)
      .map(({ name, role, company, application_id, target_company_id, read_at }) => ({ name, role, company, applicationId: application_id, targetCompanyId: target_company_id, readAt: read_at })),
  }));
}
