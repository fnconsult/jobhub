/**
 * The platform's Recognised senders (CONTEXT.md: Recognised sender; #437, #448), as Administrators keep them on the
 * Email intake sheet of Paramètres, and « Expéditeurs proposés »: the senders Candidates added for themselves.
 *
 *   const senders = createRecognisedSenderList(database);
 *   await senders.add({ sender: "alertes.monster.fr", label: "Monster – monster.fr" }); // or a full address
 *   await senders.update("cadremploi.fr", { enabled: false });                          // or { label }
 *   await senders.enabled();                                                            // what the inbound route reads
 *
 * A sender is recognised by its domain (and those under it), or by its full address when the domain sends for many
 * (a shared sending platform such as jobs2web.com): an input with an « @ » is an address, any other a domain. Its label
 * (« plateforme ou entreprise – site ») is for reading only. A disabled sender stays listed and is no longer read.
 * Accepting a proposed sender is adding it, with its label: it then leaves the proposals. Proposals name no Candidate.
 *
 * Every write takes an optional `within`, the caller's transaction (the Back Office records it in its Audit), and
 * answers what it changed as it was before. Every input is untrusted and validated here.
 */
import { jobDiscoveryDomain } from "@jobhub/shared";
import type { Pool } from "pg";
import type { Queryable } from "../database/pool";
import type { RecognisedSender } from "./recognised-senders";

/** One of the platform's Recognised senders, as the Email intake sheet lists it. */
export interface ListedRecognisedSender extends Required<RecognisedSender> {
  enabled: boolean;
}

/** A sender Candidates added for themselves and the platform's list lacks: how many Candidates, and when one last did. */
export interface ProposedSender {
  match: RecognisedSender["match"];
  value: string;
  candidates: number;
  lastAddedAt: Date;
}

export type AddRecognisedSenderResult = { ok: true; sender: ListedRecognisedSender } | { ok: false; error: "invalid" | "exists" };
export type UpdateRecognisedSenderResult =
  | { ok: true; before: ListedRecognisedSender; after: ListedRecognisedSender }
  | { ok: false; error: "invalid" | "not_found" };

export interface RecognisedSenderList {
  /** Every sender of the platform's list, by label. */
  list(): Promise<ListedRecognisedSender[]>;
  /** The enabled ones: those whose emails Email intake reads. */
  enabled(): Promise<RecognisedSender[]>;
  /** Adds an enabled sender. `input` is untrusted: { sender: a domain or an address, label }. */
  add(input: unknown, within?: Queryable): Promise<AddRecognisedSenderResult>;
  /** Changes its label or whether it is enabled. `changes` is untrusted: { label?, enabled? }. */
  update(value: string, changes: unknown, within?: Queryable): Promise<UpdateRecognisedSenderResult>;
  /** The sender removed; null when no such sender. */
  remove(value: string, within?: Queryable): Promise<ListedRecognisedSender | null>;
  /** « Expéditeurs proposés », most Candidates first. */
  proposed(): Promise<ProposedSender[]>;
}

/** The longest label: « plateforme ou entreprise – site ». */
export const MAX_SENDER_LABEL_LENGTH = 120;

/** An email address, as an Administrator pastes a sender's: something@domain.tld, no spaces. */
const EMAIL_ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const COLUMNS = "match, value, label, aligned, enabled";

/** The sender `input` names: an address (lower case) when it has an « @ », else a domain; null when it is neither. */
function senderOf(input: unknown): Pick<RecognisedSender, "match" | "value"> | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim().toLowerCase();
  if (trimmed.includes("@")) {
    const domain = jobDiscoveryDomain(trimmed.slice(trimmed.lastIndexOf("@") + 1));
    return EMAIL_ADDRESS.test(trimmed) && domain ? { match: "address", value: trimmed } : null;
  }
  const domain = jobDiscoveryDomain(trimmed);
  return domain ? { match: "domain", value: domain } : null;
}

function labelOf(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const label = input.trim().replace(/\s+/g, " ");
  return label.length > 0 && label.length <= MAX_SENDER_LABEL_LENGTH ? label : null;
}

const fieldsOf = (input: unknown): Record<string, unknown> => (typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {});

export function createRecognisedSenderList(database: Pool): RecognisedSenderList {
  return {
    async list() {
      const { rows } = await database.query<ListedRecognisedSender>(`SELECT ${COLUMNS} FROM recognised_sender`);
      return rows.sort((a, b) => a.label.localeCompare(b.label, "fr") || a.value.localeCompare(b.value));
    },

    async enabled() {
      const { rows } = await database.query<RecognisedSender>(`SELECT match, value, label, aligned FROM recognised_sender WHERE enabled`);
      return rows;
    },

    async add(input, within = database) {
      const fields = fieldsOf(input);
      const sender = senderOf(fields.sender);
      const label = labelOf(fields.label);
      if (!sender || !label) return { ok: false, error: "invalid" };
      const { rows } = await within.query<ListedRecognisedSender>(
        `INSERT INTO recognised_sender (match, value, label) VALUES ($1, $2, $3) ON CONFLICT (value) DO NOTHING RETURNING ${COLUMNS}`,
        [sender.match, sender.value, label],
      );
      return rows[0] ? { ok: true, sender: rows[0] } : { ok: false, error: "exists" };
    },

    async update(value, changes, within = database) {
      const fields = fieldsOf(changes);
      const label = fields.label === undefined ? undefined : labelOf(fields.label);
      const enabled = typeof fields.enabled === "boolean" ? fields.enabled : undefined;
      if (label === null || (label === undefined && enabled === undefined) || (fields.enabled !== undefined && enabled === undefined)) {
        return { ok: false, error: "invalid" };
      }
      // The joined row is read from the statement's snapshot: the sender as it was.
      const { rows } = await within.query<ListedRecognisedSender & { was: ListedRecognisedSender }>(
        `UPDATE recognised_sender sender SET label = COALESCE($2, sender.label), enabled = COALESCE($3, sender.enabled)
         FROM recognised_sender was WHERE sender.value = $1 AND was.value = sender.value
         RETURNING sender.match, sender.value, sender.label, sender.aligned, sender.enabled,
                   json_build_object('match', was.match, 'value', was.value, 'label', was.label, 'aligned', was.aligned, 'enabled', was.enabled) AS was`,
        [value, label ?? null, enabled ?? null],
      );
      const row = rows[0];
      if (!row) return { ok: false, error: "not_found" };
      const { was, ...after } = row;
      return { ok: true, before: was, after };
    },

    async remove(value, within = database) {
      const { rows } = await within.query<ListedRecognisedSender>(`DELETE FROM recognised_sender WHERE value = $1 RETURNING ${COLUMNS}`, [value]);
      return rows[0] ?? null;
    },

    async proposed() {
      const { rows } = await database.query<ProposedSender>(
        `SELECT mine.match, mine.value, count(DISTINCT mine.candidate_id)::int AS candidates, max(mine.added_at) AS "lastAddedAt"
         FROM candidate_recognised_sender mine
         WHERE NOT EXISTS (SELECT 1 FROM recognised_sender platform WHERE platform.value = mine.value)
         GROUP BY mine.match, mine.value
         ORDER BY candidates DESC, "lastAddedAt" DESC, mine.value`,
      );
      return rows;
    },
  };
}
