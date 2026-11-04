/**
 * The Coach Actions shipped (ADR-0077), group by group as each ticket delivers them, each one built on the domain module
 * its page's route calls, with its Eval Cases: the reads of every group (#714) so far. Proposals arrive with their groups
 * (Candidatures, Agenda, Profil, Recherches d'offres et Job Digests, Documents).
 *
 *   shippedCoachActions(candidateObjects(sources))   // the app's, over the Candidate's objects
 *   shippedCoachActions(NO_OBJECTS)                  // on no one's data: every read finds nothing
 */
import { coachActionCatalog, type CoachAction } from "./index";
import { readCoachActions, type CoachObjectReader } from "./reads";

export function shippedCoachActions(objects: CoachObjectReader): readonly CoachAction[] {
  return coachActionCatalog(readCoachActions(objects));
}

/** No one's objects: the index is empty and every read is not_found (an Eval Run's default, the guard tests). */
export const NO_OBJECTS: CoachObjectReader = { index: async () => [], read: async () => null };
