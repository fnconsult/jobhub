/**
 * The Coach Actions shipped (ADR-0077), group by group as each ticket delivers them, each one built on the domain module
 * its page's route calls, with its Eval Cases: the reads of every group (#714) and the Agenda's proposals (#718) so far.
 * The other groups' proposals arrive with their tickets (Candidatures, Profil, Recherches d'offres et Job Digests, Documents).
 *
 *   shippedCoachActions(candidateObjects(sources), { applications })   // the app's, over the Candidate's objects
 *   shippedCoachActions(NO_OBJECTS)                                     // on no one's data: every read and proposal finds nothing
 */
import type { ApplicationChangeResult } from "../applications";
import { agendaCoachActions, type AgendaApplications } from "./agenda";
import { coachActionCatalog, type CoachAction } from "./index";
import { readCoachActions, type CoachObjectReader } from "./reads";

/** The domain modules the proposing Coach Actions apply through. */
export interface CoachActionWrites {
  applications: AgendaApplications;
}

export function shippedCoachActions(objects: CoachObjectReader, writes: CoachActionWrites = NO_WRITES): readonly CoachAction[] {
  return coachActionCatalog([...readCoachActions(objects), ...agendaCoachActions(writes.applications)]);
}

/** No one's objects: the index is empty and every read is not_found (an Eval Run's default, the guard tests). */
export const NO_OBJECTS: CoachObjectReader = { index: async () => [], read: async () => null };

const NOT_FOUND: ApplicationChangeResult = { ok: false, error: "not_found" };

/** No one's Applications: every proposal finds nothing to change (an Eval Run never runs one, the guard tests). */
export const NO_WRITES: CoachActionWrites = {
  applications: {
    list: async () => [],
    get: async () => null,
    statusOf: async () => null,
    interviewOf: async () => null,
    change: async () => NOT_FOUND,
    addInterview: async () => NOT_FOUND,
    editInterview: async () => NOT_FOUND,
    cancelInterview: async () => NOT_FOUND,
    removeInterview: async () => NOT_FOUND,
    restoreInterview: async () => NOT_FOUND,
  },
};
