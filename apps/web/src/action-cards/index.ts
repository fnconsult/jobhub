/**
 * Action Cards: proposals from the AI Coach placed inside a page (e.g. "3 ATS
 * Fixes proposées", "Relance suggérée") that the Candidate accepts or dismisses.
 *
 * One deep module in front of Postgres. Callers get:
 *  - `createActionCards(database, { onAccept })`:
 *    - `propose` a card about what a page shows (its `focus`: a Profile or an Application);
 *    - `pending` cards for that page, oldest first (`pendingOfKinds`: across pages);
 *    - `decide` a card once: "accept" runs its kind's `onAccept` handler and
 *      records the decision in one transaction (a failing handler leaves the
 *      card pending), "dismiss" only records it. Never throws for a card that
 *      is missing, someone else's or already decided: an error code comes back.
 *  - `migrateActionCards(database)` — creates / upgrades the table.
 * Every read and decision is scoped to the Candidate. Cards are deleted with the
 * account (ADR-0010). Each kind (ATS Fix, Follow-up…) brings its own handler.
 */
import type { Pool } from "pg";
import type { CoachFocus } from "@/coach";

export type ActionCardStatus = "pending" | "accepted" | "dismissed";

export interface ActionCard {
  id: string;
  /** What the card proposes, e.g. "ats_fix"; picks the `onAccept` handler. */
  kind: string;
  /** Written by the AI Coach, in the Candidate's language. */
  title: string;
  body: string;
  /** The page the card belongs on. */
  focus: CoachFocus;
  /** What accepting it applies, read by the kind's handler. */
  payload: unknown;
  status: ActionCardStatus;
  createdAt: Date;
}

export type ActionCardProposal = Pick<ActionCard, "kind" | "title" | "body" | "focus" | "payload">;
export type ActionCardDecision = "accept" | "dismiss";
export type DecideResult = { ok: true; card: ActionCard } | { ok: false; error: "not_found" | "already_decided" | "failed" };

/** Applies an accepted card. Throwing leaves the card pending. */
export type AcceptHandler = (card: ActionCard, candidateId: string) => Promise<void>;

export interface ActionCards {
  propose(candidateId: string, proposal: ActionCardProposal): Promise<ActionCard>;
  pending(candidateId: string, focus: CoachFocus): Promise<ActionCard[]>;
  /** The cards the Candidate dismissed on that page, oldest first. */
  dismissed(candidateId: string, focus: CoachFocus): Promise<ActionCard[]>;
  /** The Candidate's pending cards of these kinds, whatever page they are on, oldest first. */
  pendingOfKinds(candidateId: string, kinds: string[]): Promise<ActionCard[]>;
  decide(candidateId: string, cardId: string, decision: ActionCardDecision): Promise<DecideResult>;
}

interface CardRow {
  id: string;
  kind: string;
  title: string;
  body: string;
  focus_kind: CoachFocus["kind"];
  focus_id: string;
  payload: unknown;
  status: ActionCardStatus;
  created_at: Date;
}

const COLUMNS = "id, kind, title, body, focus_kind, focus_id, payload, status, created_at";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cardFrom(row: CardRow): ActionCard {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    focus: { kind: row.focus_kind, id: row.focus_id },
    payload: row.payload,
    status: row.status,
    createdAt: row.created_at,
  };
}

export function createActionCards(database: Pool, options: { onAccept?: Record<string, AcceptHandler> } = {}): ActionCards {
  const handlers = options.onAccept ?? {};

  async function withStatus(candidateId: string, focus: CoachFocus, status: ActionCardStatus): Promise<ActionCard[]> {
    const { rows } = await database.query<CardRow>(
      `SELECT ${COLUMNS} FROM action_card
        WHERE candidate_id = $1 AND focus_kind = $2 AND focus_id = $3 AND status = $4
        ORDER BY created_at, id`,
      [candidateId, focus.kind, focus.id, status],
    );
    return rows.map(cardFrom);
  }
  return {
    async propose(candidateId, proposal) {
      const { rows } = await database.query<CardRow>(
        `INSERT INTO action_card (candidate_id, kind, title, body, focus_kind, focus_id, payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${COLUMNS}`,
        [candidateId, proposal.kind, proposal.title, proposal.body, proposal.focus.kind, proposal.focus.id, JSON.stringify(proposal.payload ?? null)],
      );
      return cardFrom(rows[0]!);
    },

    pending: (candidateId, focus) => withStatus(candidateId, focus, "pending"),
    dismissed: (candidateId, focus) => withStatus(candidateId, focus, "dismissed"),

    async pendingOfKinds(candidateId, kinds) {
      const { rows } = await database.query<CardRow>(
        `SELECT ${COLUMNS} FROM action_card WHERE candidate_id = $1 AND status = 'pending' AND kind = ANY($2::text[]) ORDER BY created_at, id`,
        [candidateId, kinds],
      );
      return rows.map(cardFrom);
    },

    async decide(candidateId, cardId, decision) {
      if (!UUID.test(cardId)) return { ok: false, error: "not_found" };
      const client = await database.connect();
      try {
        await client.query("BEGIN");
        const { rows } = await client.query<CardRow>(`SELECT ${COLUMNS} FROM action_card WHERE id = $1 AND candidate_id = $2 FOR UPDATE`, [
          cardId,
          candidateId,
        ]);
        const row = rows[0];
        if (!row || row.status !== "pending") {
          await client.query("ROLLBACK");
          return { ok: false, error: row ? "already_decided" : "not_found" };
        }
        const status: ActionCardStatus = decision === "accept" ? "accepted" : "dismissed";
        if (decision === "accept") {
          try {
            await handlers[row.kind]?.(cardFrom(row), candidateId);
          } catch (error) {
            await client.query("ROLLBACK");
            console.warn(`[action-cards] accepting a "${row.kind}" card failed:`, error instanceof Error ? error.message : error);
            return { ok: false, error: "failed" };
          }
        }
        await client.query(`UPDATE action_card SET status = $1, decided_at = now() WHERE id = $2`, [status, cardId]);
        await client.query("COMMIT");
        return { ok: true, card: cardFrom({ ...row, status }) };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

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
    CREATE INDEX IF NOT EXISTS action_card_page_idx ON action_card (candidate_id, focus_kind, focus_id) WHERE status = 'pending';
  `);
}
