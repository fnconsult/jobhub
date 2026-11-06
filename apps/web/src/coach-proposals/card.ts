/**
 * A Coach proposal's Action Card as the thread shows it (#715, ADR-0077), under the AI Coach reply that proposes it: what
 * changes on which object (a link to it), before → after, « Proposé par votre coach IA », the Plan Quota it will use (or
 * the Upgrade prompt without room), the page's form to edit it before applying, and once decided, how. No server-only
 * imports: the Coach Conversation's page reads it.
 */
import type { ActionCardStatus } from "../action-cards";
import type { ProposedChange, UndoNote } from "../coach-actions";

export interface CoachProposalCard {
  id: string;
  status: ActionCardStatus;
  /** The change, as the Coach Action prepared it, without the version it saw (the server's to check). */
  change: Omit<ProposedChange, "version">;
  /** What the Candidate edited before applying it. */
  edited?: Record<string, string>;
  /** A reviewed proposal (a Master CV change, #719): the ids of the changes the Candidate accepted with it. */
  accepted?: string[];
  /** When it was applied or dismissed, an ISO date. */
  decidedAt?: string;
  /** When « Annuler » put the state before back, an ISO date. */
  undoneAt?: string;
  /** What « Annuler » left as it was, said on the card (#770). */
  undoNote?: UndoNote;
  /** Applied, the state before kept: « Annuler » is offered. */
  undoable: boolean;
}

/** What the server says to « Appliquer », « Ignorer » or « Annuler » on a card, as `/api/action-cards/[id]` answers it. */
export type CardDecisionError = "conflict" | "already_decided" | "not_undoable" | "invalid" | "not_found" | "failed" | "quota";
