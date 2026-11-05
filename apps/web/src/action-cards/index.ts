/**
 * Action Cards: proposals from the AI Coach placed inside a page (e.g. "3 ATS
 * Fixes proposées", "Relance suggérée") or in the thread of a Coach Conversation,
 * under the reply that proposes them (#715, ADR-0077), that the Candidate applies
 * or dismisses.
 *
 * One deep module in front of Postgres. Callers get:
 *  - `createActionCards(database, { onAccept, onUndo })`:
 *    - `propose` a card about what a page shows (its `focus`: a Profile, an Application…), in the thread when it names
 *      its `reply` (the AI Coach reply it goes under);
 *    - `pending` cards for that page, oldest first (`pendingOfKinds`: across pages); a thread's cards are never a page's;
 *    - `inThread` the cards of some replies, whatever their status, oldest first;
 *    - `decide` a card once: "accept" runs its kind's `onAccept` handler, with what the Candidate edited before applying
 *      (`edited`), and records the decision in one transaction (a failing handler leaves the card pending: `conflict`
 *      when it throws ActionCardConflict, the object having changed since the proposal, never merged; `invalid` when it
 *      throws ActionCardInvalid, the domain module refusing what was edited), "dismiss" only records it. A handler that
 *      gives back what puts the state before back (`undo`) makes the card undoable;
 *    - `undo` an applied card once (« Annuler »): its kind's `onUndo` handler puts the state before back, refused as a
 *      `conflict` when the object changed since it was applied (the card stays applied). A card applied with nothing to
 *      put back (a launched action) has no Annuler: `not_undoable`;
 *    - `withdraw` a pending card the AI Coach no longer proposes (e.g. an ATS
 *      Fix the Master CV no longer needs, a reply's card a newer reply replaces): it leaves the page or the thread as if
 *      never proposed. A decided card is never withdrawn.
 *    Never throws for a card that is missing, someone else's or already decided: an error code comes back.
 *  - `migrateActionCards(database)` — creates / upgrades the table; `migrateActionCardsInThread(database)`, run after the
 *    Coach Conversations, ties a thread's cards to their reply, deleted with it.
 * Every read and decision is scoped to the Candidate. Cards are deleted with the
 * account (ADR-0010). Each kind (ATS Fix, Follow-up, Coach proposal…) brings its own handlers.
 * Each card keeps its Provenance (#336), what made it: the Follow-up draft's
 * writing, an ATS Fix's rules; null (« modèle non enregistré ») for a card
 * proposed before, or whose kind keeps none.
 */
import { readProvenance, type Provenance } from "@jobhub/shared";
import type { Pool, PoolClient } from "pg";
import type { CoachFocus } from "../coach";
import type { FieldError } from "../validation";

/** What a card is about: an object In view, or the Candidate's Coach Memory (a Coach proposal to remember a fact, #719). */
export type ActionCardFocus = CoachFocus | { kind: "coach_memory"; id: string };

/** `undone`: applied, then put back with « Annuler » (#715). */
export type ActionCardStatus = "pending" | "accepted" | "dismissed" | "undone";

export interface ActionCard {
  id: string;
  /** What the card proposes, e.g. "ats_fix"; picks the `onAccept` handler. */
  kind: string;
  /** Written by the AI Coach, in the Candidate's language. */
  title: string;
  body: string;
  /** The page the card belongs on, or the object a thread's card is about. */
  focus: ActionCardFocus;
  /** What accepting it applies, read by the kind's handler. */
  payload: unknown;
  status: ActionCardStatus;
  createdAt: Date;
  /** What made it; null: « modèle non enregistré ». */
  provenance: Provenance | null;
  /** In a thread: the AI Coach reply it goes under (its message's `seq`). */
  reply?: string;
  /** When it was applied or dismissed. */
  decidedAt?: Date;
  /** What the Candidate changed before applying it (« Modifier avant d'appliquer »). */
  edited?: unknown;
  /** When « Annuler » put the state before back. */
  undoneAt?: Date;
  /** Applied, with the state before kept: « Annuler » is offered. */
  undoable?: true;
}

export type ActionCardProposal = Pick<ActionCard, "kind" | "title" | "body" | "focus" | "payload"> & { provenance?: Provenance | null; reply?: string };
export type ActionCardDecision = "accept" | "dismiss";
export type DecideResult =
  | { ok: true; card: ActionCard }
  | { ok: false; error: "not_found" | "already_decided" | "failed" | "conflict" }
  | { ok: false; error: "invalid"; errors: FieldError[] };
export type UndoResult = { ok: true; card: ActionCard } | { ok: false; error: "not_found" | "already_decided" | "not_undoable" | "failed" | "conflict" };

/** Thrown by a handler: the object changed since the card was proposed (or applied), so nothing is changed. */
export class ActionCardConflict extends Error {
  override name = "ActionCardConflict";
  constructor() {
    super("the object changed since");
  }
}

/** Thrown by an accept handler: what the Candidate edited does not read, as the domain module's own validation says. */
export class ActionCardInvalid extends Error {
  override name = "ActionCardInvalid";
  constructor(readonly errors: FieldError[]) {
    super("invalid");
  }
}

/**
 * Applies an accepted card, `edited` what the Candidate changed before applying it. Throwing leaves the card pending.
 * Gives back what `undo` needs to put the state before back, if it can be.
 */
export type AcceptHandler = (card: ActionCard, candidateId: string, edited?: unknown) => Promise<void | { undo?: unknown }>;
/** Puts back the state before an applied card, from what its AcceptHandler gave back. Throwing leaves it applied. */
export type UndoHandler = (card: ActionCard, candidateId: string, undo: unknown) => Promise<void>;

export interface ActionCards {
  propose(candidateId: string, proposal: ActionCardProposal): Promise<ActionCard>;
  pending(candidateId: string, focus: CoachFocus): Promise<ActionCard[]>;
  /** The cards the Candidate dismissed on that page, oldest first. */
  dismissed(candidateId: string, focus: CoachFocus): Promise<ActionCard[]>;
  /** The Candidate's pending cards of these kinds, whatever page they are on, oldest first. */
  pendingOfKinds(candidateId: string, kinds: string[]): Promise<ActionCard[]>;
  /** The Candidate's cards under these replies, whatever their status, oldest first. */
  inThread(candidateId: string, replies: readonly string[]): Promise<ActionCard[]>;
  decide(candidateId: string, cardId: string, decision: ActionCardDecision, options?: { edited?: unknown }): Promise<DecideResult>;
  /** « Annuler » on an applied card. */
  undo(candidateId: string, cardId: string): Promise<UndoResult>;
  /** Takes back a pending card; false when it is not the Candidate's pending card. */
  withdraw(candidateId: string, cardId: string): Promise<boolean>;
}

interface CardRow {
  id: string;
  kind: string;
  title: string;
  body: string;
  focus_kind: ActionCardFocus["kind"];
  focus_id: string;
  payload: unknown;
  status: ActionCardStatus;
  created_at: Date;
  provenance: unknown;
  reply_seq: string | null;
  decided_at: Date | null;
  edited: unknown;
  undo: unknown;
  undone_at: Date | null;
}

const COLUMNS = "id, kind, title, body, focus_kind, focus_id, payload, status, created_at, provenance, reply_seq, decided_at, edited, undo, undone_at";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** What a page lists: its own cards, never a thread's. */
const ON_A_PAGE = "reply_seq IS NULL";

function cardFrom(row: CardRow): ActionCard {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    focus: { kind: row.focus_kind, id: row.focus_id } as ActionCardFocus,
    payload: row.payload,
    status: row.status,
    createdAt: row.created_at,
    provenance: readProvenance(row.provenance),
    ...(row.reply_seq !== null ? { reply: String(row.reply_seq) } : {}),
    ...(row.decided_at ? { decidedAt: row.decided_at } : {}),
    ...(row.edited !== null && row.edited !== undefined ? { edited: row.edited } : {}),
    ...(row.undone_at ? { undoneAt: row.undone_at } : {}),
    ...(row.status === "accepted" && row.undo !== null && row.undo !== undefined ? { undoable: true as const } : {}),
  };
}

export function createActionCards(database: Pool, options: { onAccept?: Record<string, AcceptHandler>; onUndo?: Record<string, UndoHandler> } = {}): ActionCards {
  const handlers = options.onAccept ?? {};
  const undoers = options.onUndo ?? {};

  async function withStatus(candidateId: string, focus: CoachFocus, status: ActionCardStatus): Promise<ActionCard[]> {
    const { rows } = await database.query<CardRow>(
      `SELECT ${COLUMNS} FROM action_card
        WHERE candidate_id = $1 AND focus_kind = $2 AND focus_id = $3 AND status = $4 AND ${ON_A_PAGE}
        ORDER BY created_at, id`,
      [candidateId, focus.kind, focus.id, status],
    );
    return rows.map(cardFrom);
  }

  /** Runs `change` on the Candidate's card, locked, in one transaction, committed only when its result is ok. */
  async function onCard<R extends { ok: boolean }>(
    candidateId: string,
    cardId: string,
    change: (row: CardRow, client: PoolClient) => Promise<R>,
  ): Promise<R | { ok: false; error: "not_found" }> {
    if (!UUID.test(cardId)) return { ok: false, error: "not_found" };
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<CardRow>(`SELECT ${COLUMNS} FROM action_card WHERE id = $1 AND candidate_id = $2 FOR UPDATE`, [cardId, candidateId]);
      const row = rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return { ok: false, error: "not_found" };
      }
      const result = await change(row, client);
      await client.query(result.ok ? "COMMIT" : "ROLLBACK");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  /** What a handler's throw means for the Candidate: the object changed, what they edited does not read, or it failed. */
  function refusal(kind: string, error: unknown): { ok: false; error: "conflict" | "failed" } | { ok: false; error: "invalid"; errors: FieldError[] } {
    if (error instanceof ActionCardConflict) return { ok: false, error: "conflict" };
    if (error instanceof ActionCardInvalid) return { ok: false, error: "invalid", errors: error.errors };
    console.warn(`[action-cards] a "${kind}" card's handler failed:`, error instanceof Error ? error.message : error);
    return { ok: false, error: "failed" };
  }

  return {
    async propose(candidateId, proposal) {
      const { rows } = await database.query<CardRow>(
        `INSERT INTO action_card (candidate_id, kind, title, body, focus_kind, focus_id, payload, provenance, reply_seq)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING ${COLUMNS}`,
        [
          candidateId,
          proposal.kind,
          proposal.title,
          proposal.body,
          proposal.focus.kind,
          proposal.focus.id,
          JSON.stringify(proposal.payload ?? null),
          proposal.provenance ? JSON.stringify(proposal.provenance) : null,
          proposal.reply ?? null,
        ],
      );
      return cardFrom(rows[0]!);
    },

    pending: (candidateId, focus) => withStatus(candidateId, focus, "pending"),
    dismissed: (candidateId, focus) => withStatus(candidateId, focus, "dismissed"),

    async pendingOfKinds(candidateId, kinds) {
      const { rows } = await database.query<CardRow>(
        `SELECT ${COLUMNS} FROM action_card WHERE candidate_id = $1 AND status = 'pending' AND kind = ANY($2::text[]) AND ${ON_A_PAGE} ORDER BY created_at, id`,
        [candidateId, kinds],
      );
      return rows.map(cardFrom);
    },

    async inThread(candidateId, replies) {
      const seqs = replies.filter((reply) => /^\d{1,18}$/.test(reply));
      if (seqs.length === 0) return [];
      const { rows } = await database.query<CardRow>(
        `SELECT ${COLUMNS} FROM action_card WHERE candidate_id = $1 AND reply_seq = ANY($2::bigint[]) ORDER BY created_at, id`,
        [candidateId, seqs],
      );
      return rows.map(cardFrom);
    },

    async withdraw(candidateId, cardId) {
      if (!UUID.test(cardId)) return false;
      const { rowCount } = await database.query(`DELETE FROM action_card WHERE id = $1 AND candidate_id = $2 AND status = 'pending'`, [
        cardId,
        candidateId,
      ]);
      return rowCount === 1;
    },

    decide(candidateId, cardId, decision, decideOptions = {}) {
      return onCard<DecideResult>(candidateId, cardId, async (row, client) => {
        if (row.status !== "pending") return { ok: false, error: "already_decided" };
        const status: ActionCardStatus = decision === "accept" ? "accepted" : "dismissed";
        const edited = decision === "accept" ? (decideOptions.edited ?? null) : null;
        let undo: unknown = null;
        if (decision === "accept") {
          try {
            const applied = await handlers[row.kind]?.(cardFrom(row), candidateId, decideOptions.edited);
            undo = applied?.undo ?? null;
          } catch (error) {
            return refusal(row.kind, error);
          }
        }
        const { rows } = await client.query<CardRow>(
          `UPDATE action_card SET status = $1, decided_at = now(), edited = $3, undo = $4 WHERE id = $2 RETURNING ${COLUMNS}`,
          [status, row.id, edited === null ? null : JSON.stringify(edited), undo === null ? null : JSON.stringify(undo)],
        );
        return { ok: true, card: cardFrom(rows[0]!) };
      });
    },

    undo(candidateId, cardId) {
      return onCard<UndoResult>(candidateId, cardId, async (row, client) => {
        if (row.status === "dismissed" || row.status === "undone") return { ok: false, error: "already_decided" };
        const undoer = undoers[row.kind];
        if (row.status !== "accepted" || row.undo === null || !undoer) return { ok: false, error: "not_undoable" };
        try {
          await undoer(cardFrom(row), candidateId, row.undo);
        } catch (error) {
          return refusal(row.kind, error).error === "conflict" ? { ok: false, error: "conflict" } : { ok: false, error: "failed" };
        }
        const { rows } = await client.query<CardRow>(`UPDATE action_card SET status = 'undone', undone_at = now() WHERE id = $1 RETURNING ${COLUMNS}`, [row.id]);
        return { ok: true, card: cardFrom(rows[0]!) };
      });
    },
  };
}

/** What a card can be about: the kinds In view (CoachFocus), and the Coach Memory (#719). */
const FOCUS_KINDS = ["profile", "application", "job_offer", "job_search", "job_digest", "agenda", "coach_memory"] as const;

/** Creates or upgrades the Action Card table. Run after the Candidate account tables. Safe to run repeatedly. */
export async function migrateActionCards(database: Pool): Promise<void> {
  await database.query(`
    CREATE TABLE IF NOT EXISTS action_card (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      candidate_id text NOT NULL REFERENCES candidate (id) ON DELETE CASCADE,
      kind text NOT NULL,
      title text NOT NULL,
      body text NOT NULL,
      focus_kind text NOT NULL CHECK (focus_kind IN ('profile', 'application')),
      focus_id text NOT NULL,
      payload jsonb,
      status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'dismissed')),
      created_at timestamptz NOT NULL DEFAULT now(),
      decided_at timestamptz
    );
    -- What made the card (#336); null: « modèle non enregistré ».
    ALTER TABLE action_card ADD COLUMN IF NOT EXISTS provenance jsonb;
    CREATE INDEX IF NOT EXISTS action_card_page_idx ON action_card (candidate_id, focus_kind, focus_id) WHERE status = 'pending';
    -- In a Coach Conversation's thread (#715): the AI Coach reply it goes under (tied to it by migrateActionCardsInThread),
    -- what the Candidate edited before applying it, what puts the state before back, and when « Annuler » did.
    ALTER TABLE action_card ADD COLUMN IF NOT EXISTS reply_seq bigint;
    ALTER TABLE action_card ADD COLUMN IF NOT EXISTS edited jsonb;
    ALTER TABLE action_card ADD COLUMN IF NOT EXISTS undo jsonb;
    ALTER TABLE action_card ADD COLUMN IF NOT EXISTS undone_at timestamptz;
    CREATE INDEX IF NOT EXISTS action_card_reply_idx ON action_card (reply_seq) WHERE reply_seq IS NOT NULL;
    ALTER TABLE action_card DROP CONSTRAINT IF EXISTS action_card_status_check;
    ALTER TABLE action_card ADD CONSTRAINT action_card_status_check CHECK (status IN ('pending', 'accepted', 'dismissed', 'undone'));
    ALTER TABLE action_card DROP CONSTRAINT IF EXISTS action_card_focus_kind_check;
    ALTER TABLE action_card ADD CONSTRAINT action_card_focus_kind_check CHECK (focus_kind IN (${FOCUS_KINDS.map((kind) => `'${kind}'`).join(", ")}));
  `);
}

/**
 * Ties a thread's Action Cards to their AI Coach reply (#715): deleted with it, so with its Coach Conversation. Run after
 * migrateActionCards and the Coach Conversations. Safe to run repeatedly.
 */
export async function migrateActionCardsInThread(database: Pool): Promise<void> {
  await database.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'action_card_reply_seq_fkey') THEN
        DELETE FROM action_card c WHERE c.reply_seq IS NOT NULL AND NOT EXISTS (SELECT 1 FROM coach_message m WHERE m.seq = c.reply_seq);
        ALTER TABLE action_card ADD CONSTRAINT action_card_reply_seq_fkey FOREIGN KEY (reply_seq) REFERENCES coach_message (seq) ON DELETE CASCADE;
      END IF;
    END $$;
  `);
}
