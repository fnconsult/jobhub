/**
 * Human Coaches (CONTEXT.md): the HR professionals Jobbbox selects, whom a
 * Candidate books for paid Coaching Sessions and may grant Coach Access to.
 *
 * One deep module. `createHumanCoaches(database, deps)` answers:
 *  - who are the Human Coaches?        `add`, `list`, `retire` (Back Office)
 * and `migrateHumanCoaches(database)` creates its tables.
 */
import type { Pool } from "pg";
import * as z from "zod";
import { fieldErrors, type FieldError } from "../validation";

export interface HumanCoach {
  id: string;
  name: string;
  /** The address they sign in with to read what Candidates granted them Coach Access to. */
  email: string;
  /** Their public Cal.com booking page, shown to a Candidate once a Coaching Session is paid. */
  bookingUrl: string;
  /** A few words for Candidates choosing a Human Coach. Empty when none. */
  bio: string;
}

export type AddHumanCoachResult =
  | { ok: true; coach: HumanCoach }
  | { ok: false; errors: FieldError[] }
  /** Another (not retired) Human Coach already has this email. */
  | { ok: false; error: "email_taken" };

export interface HumanCoaches {
  /** Adds a Human Coach (Back Office). `input` is untrusted: { name, email, bookingUrl, bio? }. */
  add(input: unknown): Promise<AddHumanCoachResult>;
  /** The Human Coaches Candidates can choose from, by name. */
  list(): Promise<HumanCoach[]>;
  /** Retires a Human Coach: no longer listed, and no longer reads anything. Their past Coaching Sessions are kept. */
  retire(coachId: string): Promise<void>;
}

/** Cal.com's hosted sites (cal.com, its EU instance cal.eu, and their subdomains). */
const CAL_COM_HOSTS = /(^|\.)cal\.(com|eu)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A Cal.com booking page: https, on Cal.com, naming someone (a path past "/"). */
function isCalComBookingPage(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && CAL_COM_HOSTS.test(url.hostname) && url.pathname.replace(/\/+$/, "") !== "";
  } catch {
    return false;
  }
}

const coachSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.email().trim().toLowerCase().max(320),
  bookingUrl: z.string().trim().max(500).refine(isCalComBookingPage),
  bio: z.string().trim().max(2000).default(""),
});

interface CoachRow {
  id: string;
  name: string;
  email: string;
  booking_url: string;
  bio: string;
}

const COACH_COLUMNS = "id, name, email, booking_url, bio";
const coachFrom = (row: CoachRow): HumanCoach => ({ id: row.id, name: row.name, email: row.email, bookingUrl: row.booking_url, bio: row.bio });

export function createHumanCoaches(database: Pool): HumanCoaches {
  return {
    async add(input) {
      const parsed = coachSchema.safeParse(input, { reportInput: true });
      if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
      const { name, email, bookingUrl, bio } = parsed.data;
      const { rows } = await database.query<CoachRow>(
        `INSERT INTO human_coach (name, email, booking_url, bio) VALUES ($1, $2, $3, $4)
         ON CONFLICT (email) WHERE retired_at IS NULL DO NOTHING
         RETURNING ${COACH_COLUMNS}`,
        [name, email, bookingUrl, bio],
      );
      return rows[0] ? { ok: true, coach: coachFrom(rows[0]) } : { ok: false, error: "email_taken" };
    },

    async list() {
      const { rows } = await database.query<CoachRow>(`SELECT ${COACH_COLUMNS} FROM human_coach WHERE retired_at IS NULL ORDER BY name, created_at`);
      return rows.map(coachFrom);
    },

    async retire(coachId) {
      if (!UUID.test(coachId)) return;
      await database.query("UPDATE human_coach SET retired_at = now() WHERE id = $1 AND retired_at IS NULL", [coachId]);
    },
  };
}

/** Creates or upgrades the Human Coach tables. Run after the Candidate accounts' migration. Safe to run repeatedly. */
export async function migrateHumanCoaches(database: Pool): Promise<void> {
  await database.query(`
    CREATE TABLE IF NOT EXISTS human_coach (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      email text NOT NULL,
      booking_url text NOT NULL,
      bio text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now(),
      retired_at timestamptz
    );
    CREATE UNIQUE INDEX IF NOT EXISTS human_coach_email_idx ON human_coach (email) WHERE retired_at IS NULL;
  `);
}
