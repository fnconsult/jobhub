/**
 * Propositions du coach (setting) (#717, ADR-0077): what a Coach Action's proposal shows first, the Candidate's choice in
 * Mon compte. « Carte » (`card`, the default): the Action Card under the reply. « Formulaire » (`form`): the card too, and
 * the page's form, pre-filled, opened by itself in the Work Pane as « Modifier avant d'appliquer » opens it. Both buttons
 * stay on every card whatever the choice; opening the form never applies anything. No server-only imports: the Coach
 * Conversation's page and Mon compte read it.
 */
import type { CoachProposalCard } from "../coach-proposals/card";

export const COACH_PROPOSALS_DISPLAYS = ["card", "form"] as const;
export type CoachProposalsDisplay = (typeof COACH_PROPOSALS_DISPLAYS)[number];
export const DEFAULT_COACH_PROPOSALS_DISPLAY: CoachProposalsDisplay = "card";

/** The setting `value` names, the default for anything else. */
export function readCoachProposalsDisplay(value: unknown): CoachProposalsDisplay {
  return COACH_PROPOSALS_DISPLAYS.find((display) => display === value) ?? DEFAULT_COACH_PROPOSALS_DISPLAY;
}

/**
 * The card whose form opens by itself as a reply's `cards` arrive, or null: under « Formulaire », the reply's first
 * proposal's, at most one per reply, when it offers « Modifier avant d'appliquer » (pending, a form, no Upgrade prompt);
 * never on a phone while the Candidate types, where the Work Pane would cover the box.
 */
export function formOpenedOnArrival(display: CoachProposalsDisplay, cards: readonly CoachProposalCard[], where: { phone: boolean; typing: boolean }): string | null {
  const first = cards[0];
  if (display !== "form" || !first) return null;
  if (where.phone && where.typing) return null;
  const offersForm = first.status === "pending" && first.change.fields.length > 0 && !first.change.quota?.prompt;
  return offersForm ? first.id : null;
}
