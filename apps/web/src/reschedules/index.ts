/**
 * Reschedules (CONTEXT.md): a change of an Agenda Item's date and time made more
 * than an hour after it was entered or last changed. Within that hour the change
 * is a correction and leaves no trace. Each Reschedule is kept in the item's
 * Reschedule history (previous date, new date, by whom, when); a Coaching
 * Session's cancellation is kept there too, as a change to no date.
 *
 * An Agenda Item is not a thing of its own: Interviews and Coaching Sessions
 * keep their own tables and rules, and call this module whenever their date
 * changes. Callers get:
 *  - `setAgendaItemDate(client, item, change)`: sets the item's date in the
 *    caller's transaction, keeping a Reschedule when the change is one;
 *  - `rescheduleHistories(database, table, ids)`: each item's Reschedule history, oldest first;
 *  - `migrateRescheduleHistory(database, table, ...)`: the item table's history table;
 *  - `dateChangeKind` and `firstPlannedAt`: the rule, and the date first planned.
 * The history is deleted with its item, and so with the account.
 */
import type { Pool } from "pg";
import type { Queryable } from "../database/pool";

/** Who changed an Agenda Item's date: the Candidate, or for a Coaching Session its Human Coach. */
export type RescheduledBy = "candidate" | "coach";

/** One entry of a Reschedule history. `newAt` is null for a Coaching Session's cancellation: its date was cleared. */
export interface Reschedule {
  previousAt: Date;
  newAt: Date | null;
  by: RescheduledBy;
  /** When the change was made. */
  at: Date;
}

/** How long after a date is entered or last changed a new change is still a correction. */
export const CORRECTION_WINDOW_MS = 60 * 60 * 1000;

/**
 * What changing an Agenda Item's date `from` → `to` at `now` is, its date set (entered or last changed) at `dateSetAt`:
 *  - "none": the date stays the same;
 *  - "entry": there was no date yet (a Coaching Session booked, or booked again after a cancellation);
 *  - "cancellation": the date is cleared (a Coaching Session's cancellation), kept in the history at any time;
 *  - "correction": within the hour after `dateSetAt`, no trace;
 *  - "reschedule": more than an hour after, kept in the history.
 */
export function dateChangeKind({ from, to, dateSetAt, now }: { from: Date | null; to: Date | null; dateSetAt: Date | null; now: Date }): "none" | "entry" | "cancellation" | "correction" | "reschedule" {
  if (from?.getTime() === to?.getTime()) return "none";
  if (from === null) return "entry";
  if (to === null) return "cancellation";
  return dateSetAt !== null && now.getTime() - dateSetAt.getTime() <= CORRECTION_WINDOW_MS ? "correction" : "reschedule";
}

/**
 * The date first planned of an item with this history (oldest first), for « Reporté · initialement prévu le … »: the date
 * before its first Reschedule since its last cancellation (a date entered after a cancellation is a new plan); null when none.
 */
export function firstPlannedAt(history: Reschedule[]): Date | null {
  let since = 0;
  history.forEach((entry, index) => {
    if (entry.newAt === null) since = index + 1;
  });
  return history[since]?.previousAt ?? null;
}

/** The tables whose rows are Agenda Items, each with a `scheduled_at` date. */
export type AgendaItemTable = "interview" | "coaching_session";

/** Where each Agenda Item table's Reschedule history is kept, and the column naming the item. */
const HISTORY = {
  interview: { table: "interview_reschedule", item: "interview_id" },
  coaching_session: { table: "coaching_session_reschedule", item: "coaching_session_id" },
} as const;

/**
 * Sets the date of one Agenda Item (`to` null clears it: a Coaching Session's cancellation), keeping a
 * Reschedule or a cancellation in its history (see `dateChangeKind`). Run it within the caller's
 * transaction, once the caller has checked the item is the Candidate's or the Human Coach's: it locks the
 * item's row. False when there is no such item.
 */
export async function setAgendaItemDate(
  client: Queryable,
  item: { table: AgendaItemTable; id: string },
  { to, by, now }: { to: Date | null; by: RescheduledBy; now: Date },
): Promise<boolean> {
  const { rows } = await client.query<{ scheduled_at: Date | null; date_set_at: Date | null }>(
    `SELECT scheduled_at, date_set_at FROM ${item.table} WHERE id = $1 FOR UPDATE`,
    [item.id],
  );
  if (!rows[0]) return false;
  const from = rows[0].scheduled_at;
  const kind = dateChangeKind({ from, to, dateSetAt: rows[0].date_set_at, now });
  if (kind === "none") return true;
  await client.query(`UPDATE ${item.table} SET scheduled_at = $2, date_set_at = $3 WHERE id = $1`, [item.id, to, to === null ? null : now]);
  if (kind === "reschedule" || kind === "cancellation") {
    const history = HISTORY[item.table];
    await client.query(`INSERT INTO ${history.table} (${history.item}, previous_at, new_at, changed_by, changed_at) VALUES ($1, $2, $3, $4, $5)`, [
      item.id,
      from,
      to,
      by,
      now,
    ]);
  }
  return true;
}

/** The Reschedule history of each of these items of `table`, oldest first; an empty one for an item never Rescheduled. */
export async function rescheduleHistories(database: Queryable, table: AgendaItemTable, ids: string[]): Promise<Map<string, Reschedule[]>> {
  const history = HISTORY[table];
  const histories = new Map(ids.map((id) => [id, [] as Reschedule[]]));
  if (ids.length === 0) return histories;
  const { rows } = await database.query<{ item_id: string; previous_at: Date; new_at: Date | null; changed_by: RescheduledBy; changed_at: Date }>(
    `SELECT ${history.item} AS item_id, previous_at, new_at, changed_by, changed_at FROM ${history.table}
      WHERE ${history.item} = ANY($1::uuid[]) ORDER BY changed_at, seq`,
    [ids],
  );
  for (const row of rows) histories.get(row.item_id)?.push({ previousAt: row.previous_at, newAt: row.new_at, by: row.changed_by, at: row.changed_at });
  return histories;
}

/**
 * Creates or upgrades the Reschedule history of `table`, and when its date was set (`date_set_at`). Dates set
 * before are taken as set at `enteredAt` (a column of `table`, e.g. when it was created). Run it in the item
 * table's own migration, after creating it. Safe to run repeatedly.
 */
export async function migrateRescheduleHistory(database: Pool, table: AgendaItemTable, { enteredAt }: { enteredAt: string }): Promise<void> {
  const history = HISTORY[table];
  await database.query(`
    -- When its date was entered or last changed: a change within the hour after is a correction, not a Reschedule (#250).
    ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS date_set_at timestamptz;
    UPDATE ${table} SET date_set_at = ${enteredAt} WHERE date_set_at IS NULL AND scheduled_at IS NOT NULL;
    CREATE TABLE IF NOT EXISTS ${history.table} (
      seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      ${history.item} uuid NOT NULL REFERENCES ${table} (id) ON DELETE CASCADE,
      previous_at timestamptz NOT NULL,
      -- Null for a cancellation: the date was cleared.
      new_at timestamptz,
      changed_by text NOT NULL CHECK (changed_by IN ('candidate', 'coach')),
      changed_at timestamptz NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ${history.table}_${history.item}_idx ON ${history.table} (${history.item});
  `);
}
