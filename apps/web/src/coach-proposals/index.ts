/**
 * Coach proposals in the thread (#715, ADR-0077): what a reply proposes through Coach Actions becomes an Action Card
 * under it, of kind COACH_PROPOSAL_CARD, which the Candidate applies (« Appliquer », or « Modifier avant d'appliquer »
 * with the page's form pre-filled in the Work Pane), dismisses (« Ignorer ») and, applied, puts back (« Annuler »).
 *
 * One deep module over Action Cards and the Coach Actions catalogue:
 *  - `coachProposalHandlers(catalog)`: the card kind's `onAccept` and `onUndo`, registered with the Action Cards. Applying
 *    calls the proposing Coach Action's `apply`, which calls the domain module (the same validation as the page's route)
 *    with the version the proposal saw: the object changed since is a conflict (ActionCardConflict, « L'objet a changé
 *    depuis la proposition »), never merged, the card left pending; what the Candidate edited is kept to the form's fields.
 *    The object keeps its Origin (coach_proposal, the card's id). « Annuler » calls its `undo`, refused as a conflict once
 *    the object changed since it was applied. A Coach Action with no `undo` (a launched one) has no Annuler.
 *  - `createCoachProposals({ catalog, actionCards })`:
 *    - `place` a reply's proposals under it: one card each that its Coach Action can apply (a ProposedChange and an
 *      `apply`), the others left out; a pending card of an earlier reply of the conversation proposing a change to the
 *      same thing (same object, same field) is withdrawn: the new reply no longer proposes it;
 *    - `ofReplies` the cards under some replies, as the thread shows them (CoachProposalCard).
 */
import { ActionCardConflict, ActionCardInvalid, type AcceptHandler, type ActionCard, type ActionCards, type UndoHandler } from "../action-cards";
import { proposedChangeSchema, type CoachAction, type CoachProposal, type ProposedChange } from "../coach-actions";
import type { CoachProposalCard } from "./card";

export type { CardDecisionError, CoachProposalCard } from "./card";

/** The Action Card kind of a Coach proposal in the thread. */
export const COACH_PROPOSAL_CARD = "coach_proposal";

/** What a Coach proposal's card keeps: the Coach Action that prepared it and its ProposedChange. */
interface ProposalPayload {
  action: string;
  change: ProposedChange;
}

function payloadOf(card: Pick<ActionCard, "payload">): ProposalPayload | null {
  const payload = card.payload as Partial<ProposalPayload> | null;
  if (!payload || typeof payload.action !== "string") return null;
  const change = proposedChangeSchema.safeParse(payload.change);
  return change.success ? { action: payload.action, change: change.data } : null;
}

/** What the Candidate edited, kept to the form's own fields, as text. */
function editedValue(change: ProposedChange, edited: unknown): Record<string, string> {
  if (typeof edited !== "object" || edited === null) return {};
  const names = new Set(change.fields.map((field) => field.name));
  return Object.fromEntries(Object.entries(edited).filter(([name, value]) => names.has(name) && typeof value === "string"));
}

/** The card kind's handlers, registered with the Action Cards: applying and putting back through each Coach Action. */
export function coachProposalHandlers(catalog: readonly CoachAction[], now: () => Date = () => new Date()): { onAccept: Record<string, AcceptHandler>; onUndo: Record<string, UndoHandler> } {
  const actionOf = (card: ActionCard) => {
    const payload = payloadOf(card);
    const action = payload ? catalog.find((each) => each.name === payload.action) : undefined;
    if (!payload || !action?.apply) throw new Error(`no Coach Action applies the card's proposal`);
    return { payload, action, apply: action.apply.bind(action) };
  };
  return {
    onAccept: {
      [COACH_PROPOSAL_CARD]: async (card, candidateId, edited) => {
        const { payload, apply } = actionOf(card);
        const change = { ...payload.change, value: { ...payload.change.value, ...editedValue(payload.change, edited) } };
        const applied = await apply(change, { candidateId, cardId: card.id, at: now() });
        if (applied.ok) return applied.undo === undefined ? {} : { undo: applied.undo };
        if (applied.error === "invalid") throw new ActionCardInvalid(applied.errors);
        // Gone since (deleted, archived) or changed since: either way, not what was proposed any more.
        throw new ActionCardConflict();
      },
    },
    onUndo: {
      [COACH_PROPOSAL_CARD]: async (card, candidateId, undo) => {
        const { action } = actionOf(card);
        if (!action.undo) throw new Error(`Coach Action "${action.name}" has no Annuler`);
        const undone = await action.undo(undo, { candidateId, cardId: card.id, at: now() });
        if (!undone.ok) throw new ActionCardConflict();
      },
    },
  };
}

/** A card as the thread shows it; null for one that is not a Coach proposal's, or whose proposal does not read. */
export function proposalCardOf(card: ActionCard): CoachProposalCard | null {
  if (card.kind !== COACH_PROPOSAL_CARD) return null;
  const payload = payloadOf(card);
  if (!payload) return null;
  // The version it saw stays on the server, which checks it.
  const change: Omit<ProposedChange, "version"> = { ...payload.change };
  delete (change as Partial<ProposedChange>).version;
  const edited = typeof card.edited === "object" && card.edited !== null ? editedValue(payload.change, card.edited) : null;
  return {
    id: card.id,
    status: card.status,
    change,
    ...(edited && Object.keys(edited).length > 0 ? { edited } : {}),
    ...(card.decidedAt ? { decidedAt: card.decidedAt.toISOString() } : {}),
    ...(card.undoneAt ? { undoneAt: card.undoneAt.toISOString() } : {}),
    undoable: card.undoable === true,
  };
}

export interface CoachProposals {
  /**
   * Places `proposals` under the reply `reply` (its message's seq), withdrawing the pending cards of the conversation's
   * `earlier` replies about the same object and field; gives back the reply's cards.
   */
  place(candidateId: string, at: { reply: string; earlier: readonly string[] }, proposals: readonly CoachProposal[]): Promise<CoachProposalCard[]>;
  /** The cards under each of `replies`, oldest first; a reply without any is left out. */
  ofReplies(candidateId: string, replies: readonly string[]): Promise<Map<string, CoachProposalCard[]>>;
}

export function createCoachProposals(deps: { catalog: readonly CoachAction[]; actionCards: Pick<ActionCards, "propose" | "inThread" | "withdraw"> }): CoachProposals {
  const applies = (name: string) => deps.catalog.some((action) => action.name === name && action.kind === "propose" && action.apply);
  const sameThing = (a: ProposedChange, b: ProposedChange) => a.target.kind === b.target.kind && a.target.id === b.target.id && a.what === b.what;

  return {
    async place(candidateId, { reply, earlier }, proposals) {
      const placeable = proposals.flatMap((proposal) => {
        const change = proposedChangeSchema.safeParse(proposal.data);
        return change.success && applies(proposal.action) ? [{ action: proposal.action, change: change.data }] : [];
      });
      if (placeable.length === 0) return [];
      for (const card of await deps.actionCards.inThread(candidateId, earlier)) {
        const payload = card.status === "pending" ? payloadOf(card) : null;
        if (payload && placeable.some(({ change }) => sameThing(change, payload.change))) await deps.actionCards.withdraw(candidateId, card.id);
      }
      const placed: CoachProposalCard[] = [];
      for (const { action, change } of placeable) {
        const card = await deps.actionCards.propose(candidateId, {
          kind: COACH_PROPOSAL_CARD,
          title: `${change.what} · ${change.target.name}`,
          body: `${change.before} → ${change.after}`,
          focus: { kind: change.target.kind, id: change.target.id },
          payload: { action, change } satisfies ProposalPayload,
          reply,
        });
        const shown = proposalCardOf(card);
        if (shown) placed.push(shown);
      }
      return placed;
    },

    async ofReplies(candidateId, replies) {
      const byReply = new Map<string, CoachProposalCard[]>();
      for (const card of await deps.actionCards.inThread(candidateId, replies)) {
        const shown = proposalCardOf(card);
        if (!shown || !card.reply) continue;
        byReply.set(card.reply, [...(byReply.get(card.reply) ?? []), shown]);
      }
      return byReply;
    },
  };
}
