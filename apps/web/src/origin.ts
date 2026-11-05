/**
 * The Origin of a change to one of the Candidate's objects (#715, ADR-0077): kept, hidden, with what it changed (an
 * Application Status, an Interview, a Master CV Version, Search Criteria) when it came from a Coach proposal the
 * Candidate applied: `coach_proposal`, the Action Card's id and when they applied it. A change they make themselves on the
 * page has none. Nothing shows it by default; an « Origine » disclosure on the element reveals « Sur proposition de votre
 * coach IA, appliqué par vous le … ». No server-only imports: the pages' components read it too.
 */
export interface Origin {
  origin: "coach_proposal";
  /** The Action Card the Candidate applied. */
  cardId: string;
  appliedAt: Date;
}

/** An Origin as kept in a jsonb column (`appliedAt` an ISO date), or null when there is none or it does not read. */
export function readOrigin(stored: unknown): Origin | null {
  if (typeof stored !== "object" || stored === null) return null;
  const { origin, cardId, appliedAt } = stored as Record<string, unknown>;
  if (origin !== "coach_proposal" || typeof cardId !== "string" || typeof appliedAt !== "string") return null;
  const at = new Date(appliedAt);
  return Number.isNaN(at.getTime()) ? null : { origin, cardId, appliedAt: at };
}
