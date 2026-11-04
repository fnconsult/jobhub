/**
 * The Recipient list (ADR-0064, #338): the public page « Destinataires des données », generated from the Tool catalog
 * at request time.
 *
 *   recipientsSwitchedOn(state)              Jobbbox's Hosts, then each Tool that can be called (`toolStatus`, as the
 *                                            Outils page and Paramètres' warning read it) and receives personal data
 *   datedRecipientList(database, list, now)  the list with the day it last changed
 *
 * The day it last changed is the first time this list, as it reads now, was served: each answer's fingerprint (its
 * recipients and every fact the page shows) is compared with the latest one recorded, and a different one is recorded
 * with the time. Switching a recipient on or off, or changing a fact in the catalog, so dates the list on its next view.
 * The table names no one: it holds the fingerprint and the time only.
 */
import { createHash } from "node:crypto";
import { recipientList, type ListedRecipient } from "@jobhub/shared";
import type { Pool } from "pg";
import { SWITCHED_ON } from "../tools/recipients";
import { toolStatus, type ToolsState } from "../tools/index";

/** The recipients as the page lists them, from the Tools' state now. */
export function recipientsSwitchedOn(state: ToolsState): ListedRecipient[] {
  return recipientList((tool) => SWITCHED_ON.includes(toolStatus(tool, state).status));
}

export interface DatedRecipientList {
  recipients: ListedRecipient[];
  /** When the list last changed: the first time it was served as it reads now. */
  changedAt: Date;
}

/** A fingerprint of everything the page shows of `recipients`. */
export function fingerprintOf(recipients: readonly ListedRecipient[]): string {
  return createHash("sha256").update(JSON.stringify(recipients)).digest("hex");
}

/**
 * `recipients` with the day the list last changed. The first view of a list unlike the latest one recorded records it
 * with `now`; two views at once may both record it, a few milliseconds apart, which dates it the same day.
 */
export async function datedRecipientList(database: Pick<Pool, "query">, recipients: ListedRecipient[], now: Date): Promise<DatedRecipientList> {
  const fingerprint = fingerprintOf(recipients);
  const latest = await database.query<{ fingerprint: string; since: Date }>("SELECT fingerprint, since FROM recipient_list_change ORDER BY since DESC, id DESC LIMIT 1");
  const row = latest.rows[0];
  if (row && row.fingerprint === fingerprint) return { recipients, changedAt: row.since };
  await database.query("INSERT INTO recipient_list_change (fingerprint, since) VALUES ($1, $2)", [fingerprint, now]);
  return { recipients, changedAt: now };
}

export async function migrateRecipientList(database: Pick<Pool, "query">): Promise<void> {
  await database.query(`
    CREATE TABLE IF NOT EXISTS recipient_list_change (
      id bigserial PRIMARY KEY,
      -- SHA-256 of the list as the page showed it: its recipients and their facts. Names no one.
      fingerprint text NOT NULL,
      since timestamptz NOT NULL
    );
    CREATE INDEX IF NOT EXISTS recipient_list_change_since_idx ON recipient_list_change (since DESC);
  `);
}
