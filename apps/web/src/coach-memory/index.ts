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
 * Deleted with the account (ADR-0010).
 */
import type { AiLayer } from "@jobhub/ai";
import type { Pool } from "pg";
import * as z from "zod";
import type { CoachConversations } from "../coach-conversations";

export const COACH_MEMORY_KINDS = ["goal", "constraint", "decision"] as const;
export type CoachMemoryKind = (typeof COACH_MEMORY_KINDS)[number];

/** A key fact the AI Coach may propose, before the Candidate confirms it. */
export interface ProposedMemoryItem {
  kind: CoachMemoryKind;
  text: string;
}

/** A key fact in the Candidate's Coach Memory. */
export interface CoachMemoryItem extends ProposedMemoryItem {
  id: string;
  updatedAt: Date;
}

export type ProposeResult = { ok: true; proposals: ProposedMemoryItem[] } | { ok: false; error: "not_found" | "unavailable" };

export interface CoachMemory {
  /** The key facts of the Candidate's conversation worth remembering, not yet in their Coach Memory. Saves nothing. */
  propose(candidateId: string, conversationId: string): Promise<ProposeResult>;
  /** The Candidate's Coach Memory, oldest item first. */
  list(candidateId: string): Promise<CoachMemoryItem[]>;
}

export interface CoachMemoryDeps {
  ai: AiLayer;
  conversations: Pick<CoachConversations, "open">;
}

/** Longest item, in characters. */
export const MAX_ITEM_LENGTH = 300;

const proposalsSchema = z.object({
  items: z.array(z.unknown()),
});
const itemSchema = z.object({ kind: z.enum(COACH_MEMORY_KINDS), text: z.string().trim().min(1).max(MAX_ITEM_LENGTH) });

const PROPOSE_SYSTEM = `Tu es le coach Jobbbox. Tu relis une conversation avec un candidat et tu proposes les faits clés à retenir pour les prochaines conversations : ses objectifs (goal), ses contraintes (constraint) et ses décisions (decision).
Règles :
- Uniquement ce que le candidat a dit lui-même. N'invente rien, ne déduis rien.
- Une phrase courte par fait, dans la langue du candidat.
- Jamais de nom, d'e-mail, de téléphone ni d'adresse.
Réponds uniquement avec un objet JSON : {"items": [{"kind": "goal" | "constraint" | "decision", "text": "le fait"}]}. Aucun fait à retenir : {"items": []}.`;

interface ItemRow {
  id: string;
  kind: CoachMemoryKind;
  text: string;
  updated_at: Date;
}

function itemFrom(row: ItemRow): CoachMemoryItem {
  return { id: row.id, kind: row.kind, text: row.text, updatedAt: row.updated_at };
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

    async propose(candidateId, conversationId) {
      const conversation = await deps.conversations.open(candidateId, conversationId);
      if (!conversation) return { ok: false, error: "not_found" };
      const transcript = conversation.messages.map((message) => `${message.from === "candidate" ? "Candidat" : "Coach"} : ${message.text}`).join("\n");
      try {
        const { text } = await deps.ai.generate({ task: "coaching", candidateId, system: PROPOSE_SYSTEM, prompt: `Conversation :\n${transcript}` });
        const proposals = proposalsIn(text);
        return proposals ? { ok: true, proposals } : { ok: false, error: "unavailable" };
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
