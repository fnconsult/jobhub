/**
 * Coach Memory: the key facts the AI Coach keeps about a Candidate across Coach
 * Conversations (goals, constraints, decisions), which the Candidate sees and
 * edits in the Coach Panel.
 *
 * One deep module in front of Postgres. Callers get
 * `createCoachMemory(database, { ai, conversations })`:
 *  - `propose` asks the AI Coach which key facts of one of the Candidate's Coach
 *    Conversations are worth remembering. It saves nothing: proposals go back to
 *    the Candidate, who confirms each one;
 *  - `confirm` saves one item the Candidate confirmed (untrusted `{ kind, text }`);
 *  - `list` the Candidate's items, oldest first; `edit` one; `delete` one.
 * Nothing reaches Coach Memory without the Candidate confirming or writing it.
 * Every read and change is scoped to the Candidate: another Candidate's item or
 * conversation is "not found". Never throws for bad input: an error code comes back.
 * Deleted with the account (ADR-0010). What the AI Coach is told to propose, and the AI proposing,
 * are the "coach-memory" task Playbook's (ADR-0026); no personal data and the reply's shape stay here.
 */
import type { AiLayer } from "@jobhub/ai";
import type { Pool } from "pg";
import * as z from "zod";
import type { CoachConversations } from "../coach-conversations";
import { taskRun, type TaskPlaybookReader } from "../task-playbooks";
import { COACH_MEMORY_KINDS, MAX_ITEM_LENGTH, MAX_ITEMS, type CoachMemoryKind, type ProposedMemoryItem } from "./kinds";

export { COACH_MEMORY_KINDS, MAX_ITEM_LENGTH, MAX_ITEMS, type CoachMemoryKind, type ProposedMemoryItem } from "./kinds";

/** A key fact in the Candidate's Coach Memory. */
export interface CoachMemoryItem extends ProposedMemoryItem {
  id: string;
  updatedAt: Date;
}

export type ProposeResult = { ok: true; proposals: ProposedMemoryItem[] } | { ok: false; error: "not_found" | "unavailable" };

export type ConfirmResult = { ok: true; item: CoachMemoryItem } | { ok: false; error: "invalid" | "full" };

export type EditResult = { ok: true; item: CoachMemoryItem } | { ok: false; error: "invalid" | "not_found" };

export interface CoachMemory {
  /** The key facts of the Candidate's conversation worth remembering, not yet in their Coach Memory. Saves nothing. */
  propose(candidateId: string, conversationId: string): Promise<ProposeResult>;
  /**
   * Saves one item the Candidate confirmed, a proposal or their own words: untrusted
   * `{ kind, text }`, text trimmed to 1 to MAX_ITEM_LENGTH characters. An item the Coach
   * Memory already holds (same words, whatever the case and spacing) is not saved twice.
   * "full" once the Coach Memory holds MAX_ITEMS items.
   */
  confirm(candidateId: string, input: unknown): Promise<ConfirmResult>;
  /** The Candidate's Coach Memory, oldest item first. */
  list(candidateId: string): Promise<CoachMemoryItem[]>;
  /** Replaces an item's kind and words: untrusted `{ kind, text }`, as for `confirm`. */
  edit(candidateId: string, itemId: string, input: unknown): Promise<EditResult>;
  /** False when there is no such item of the Candidate's to delete. */
  delete(candidateId: string, itemId: string): Promise<boolean>;
}

export interface CoachMemoryDeps {
  ai: AiLayer;
  conversations: Pick<CoachConversations, "open">;
  /** The "coach-memory" task Playbook's served version (ADR-0026); without it, its built-in text. */
  taskPlaybooks?: TaskPlaybookReader;
}


const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const proposalsSchema = z.object({
  items: z.array(z.unknown()),
});
const itemSchema = z.object({ kind: z.enum(COACH_MEMORY_KINDS), text: z.string().trim().min(1).max(MAX_ITEM_LENGTH) });

/** No personal data, and the reply's shape: after the "coach-memory" task Playbook's instructions (ADR-0026). */
const PROPOSE_RULES = `- Jamais de nom, d'e-mail, de téléphone ni d'adresse.
Réponds uniquement avec un objet JSON : {"items": [{"kind": "goal" | "constraint" | "decision", "text": "le fait"}]}. Aucun fait à retenir : {"items": []}.`;

interface ItemRow {
  id: string;
  kind: CoachMemoryKind;
  text: string;
  updated_at: Date;
}

/** The same fact, whatever the case and spacing. */
function sameFact(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLocaleLowerCase("fr");
}

/** The proposals neither already remembered nor proposed twice, in order. */
function newFacts(proposals: ProposedMemoryItem[], remembered: CoachMemoryItem[]): ProposedMemoryItem[] {
  const seen = new Set(remembered.map((item) => sameFact(item.text)));
  const fresh: ProposedMemoryItem[] = [];
  for (const proposal of proposals) {
    if (seen.has(sameFact(proposal.text))) continue;
    seen.add(sameFact(proposal.text));
    fresh.push(proposal);
  }
  return fresh;
}

function itemFrom(row: ItemRow): CoachMemoryItem {
  return { id: row.id, kind: row.kind, text: row.text, updatedAt: row.updated_at };
}

function promptFor(transcript: string, remembered: CoachMemoryItem[]): string {
  const already = remembered.length ? remembered.map((item) => `- ${item.text}`).join("\n") : "(rien)";
  return `Déjà retenu (ne le propose pas à nouveau) :\n${already}\n\nConversation :\n${transcript}`;
}

/** The proposals in the AI Coach's answer, or null when it holds no readable JSON. */
function proposalsIn(answer: string): ProposedMemoryItem[] | null {
  const start = answer.indexOf("{");
  const end = answer.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let json: unknown;
  try {
    json = JSON.parse(answer.slice(start, end + 1));
  } catch {
    return null;
  }
  const parsed = proposalsSchema.safeParse(json);
  if (!parsed.success) return null;
  return parsed.data.items.flatMap((item) => {
    const valid = itemSchema.safeParse(item);
    return valid.success ? [valid.data] : [];
  });
}

export function createCoachMemory(database: Pool, deps: CoachMemoryDeps): CoachMemory {
  async function list(candidateId: string): Promise<CoachMemoryItem[]> {
    const { rows } = await database.query<ItemRow>(`SELECT id, kind, text, updated_at FROM coach_memory_item WHERE candidate_id = $1 ORDER BY created_at, id`, [
      candidateId,
    ]);
    return rows.map(itemFrom);
  }

  return {
    list,

    async confirm(candidateId, input) {
      const parsed = itemSchema.safeParse(input);
      if (!parsed.success) return { ok: false, error: "invalid" };
      const { kind, text } = parsed.data;
      const items = await list(candidateId);
      const known = items.find((item) => sameFact(item.text) === sameFact(text));
      if (known) return { ok: true, item: known };
      if (items.length >= MAX_ITEMS) return { ok: false, error: "full" };
      const { rows } = await database.query<ItemRow>(
        `INSERT INTO coach_memory_item (candidate_id, kind, text) VALUES ($1, $2, $3) RETURNING id, kind, text, updated_at`,
        [candidateId, kind, text],
      );
      return { ok: true, item: itemFrom(rows[0]!) };
    },

    async edit(candidateId, itemId, input) {
      const parsed = itemSchema.safeParse(input);
      if (!parsed.success) return { ok: false, error: "invalid" };
      if (!UUID.test(itemId)) return { ok: false, error: "not_found" };
      const { rows } = await database.query<ItemRow>(
        `UPDATE coach_memory_item SET kind = $3, text = $4, updated_at = now() WHERE id = $1 AND candidate_id = $2 RETURNING id, kind, text, updated_at`,
        [itemId, candidateId, parsed.data.kind, parsed.data.text],
      );
      return rows[0] ? { ok: true, item: itemFrom(rows[0]) } : { ok: false, error: "not_found" };
    },

    async delete(candidateId, itemId) {
      if (!UUID.test(itemId)) return false;
      const { rowCount } = await database.query(`DELETE FROM coach_memory_item WHERE id = $1 AND candidate_id = $2`, [itemId, candidateId]);
      return rowCount === 1;
    },

    async propose(candidateId, conversationId) {
      const conversation = await deps.conversations.open(candidateId, conversationId);
      if (!conversation) return { ok: false, error: "not_found" };
      const remembered = await list(candidateId);
      const transcript = conversation.messages.map((message) => `${message.from === "candidate" ? "Candidat" : "Coach"} : ${message.text}`).join("\n");
      try {
        const run = await taskRun(deps.taskPlaybooks, "coach-memory", deps.ai);
        const { text } = await deps.ai.generate({ task: "coaching", candidateId, system: `${run.text()}\n${PROPOSE_RULES}`, prompt: promptFor(transcript, remembered), ...run.agent });
        const proposals = proposalsIn(text);
        if (!proposals) return { ok: false, error: "unavailable" };
        return { ok: true, proposals: newFacts(proposals, remembered) };
      } catch (error) {
        console.warn("[coach-memory] the AI Coach could not propose:", error instanceof Error ? error.message : error);
        return { ok: false, error: "unavailable" };
      }
    },
  };
}

/** Creates or upgrades the Coach Memory table. Run after the Candidate table. Safe to run repeatedly. */
export async function migrateCoachMemory(database: Pool): Promise<void> {
  await database.query(`
    CREATE TABLE IF NOT EXISTS coach_memory_item (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      candidate_id text NOT NULL REFERENCES candidate (id) ON DELETE CASCADE,
      kind text NOT NULL CHECK (kind IN ('goal', 'constraint', 'decision')),
      text text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS coach_memory_item_candidate_idx ON coach_memory_item (candidate_id, created_at);
  `);
}
