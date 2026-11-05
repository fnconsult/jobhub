/**
 * The Coach Actions shipped (ADR-0077), group by group as each ticket delivers them, each one built on the domain module
 * its page's route calls, with its Eval Cases: the reads of every group (#714), the Agenda's proposals (#718), the
 * Candidatures proposals (#716) and the Profil group's proposals (#719) so far. The other groups' proposals arrive with
 * their tickets (Recherches d'offres et Job Digests, Documents).
 *
 *   shippedCoachActions(candidateObjects(sources), domain)   // the app's, over the Candidate's objects
 *   shippedCoachActions(NO_OBJECTS)                          // on no one's data: every read finds nothing, nothing to propose on
 */
import type { ApplicationChangeResult } from "../applications";
import { agendaCoachActions, type AgendaApplications } from "./agenda";
import { applicationCoachActions, type ApplicationActionSources } from "./applications";
import { coachActionCatalog, type CoachAction } from "./index";
import { profileCoachActions, type ProfileActionSources } from "./profile";
import { readCoachActions, type CoachObjectReader } from "./reads";

/** The domain modules the proposals go through; a Job Offer's reach is the reads' (`objects`). */
export type CoachActionDomain = Omit<ApplicationActionSources, "applications" | "reachesJobOffer"> & {
  applications: AgendaApplications & ApplicationActionSources["applications"];
  /** The Profil group's: Search Criteria, Master CV, archive and restore, Coach Memory. */
  profile: ProfileActionSources;
};

export function shippedCoachActions(objects: CoachObjectReader, domain: CoachActionDomain = NO_DOMAIN): readonly CoachAction[] {
  // A Job Offer out of view is within reach when a read finds it: one of the Candidate's objects shows it.
  const reachesJobOffer = async (candidateId: string, jobOfferId: string) => (await objects.read(candidateId, "job_offer", jobOfferId, 100)) !== null;
  return coachActionCatalog([
    ...readCoachActions(objects),
    ...agendaCoachActions(domain.applications),
    ...applicationCoachActions({ ...domain, reachesJobOffer }),
    ...profileCoachActions(domain.profile),
  ]);
}

/** No one's objects: the index is empty and every read is not_found (an Eval Run's default, the guard tests). */
export const NO_OBJECTS: CoachObjectReader = { index: async () => [], read: async () => null };

const NOT_FOUND: ApplicationChangeResult = { ok: false, error: "not_found" };

/** No one's domain: every proposal finds nothing to propose on (an Eval Run never runs one, the guard tests). */
export const NO_DOMAIN: CoachActionDomain = {
  applications: {
    save: async () => ({ ok: false, error: "not_found" }),
    get: async () => null,
    list: async () => [],
    statusOf: async () => null,
    profileOf: async () => null,
    interviewOf: async () => null,
    change: async () => NOT_FOUND,
    removeIntact: async () => ({ ok: false, error: "not_found" }),
    addInterview: async () => NOT_FOUND,
    editInterview: async () => NOT_FOUND,
    cancelInterview: async () => NOT_FOUND,
    removeInterview: async () => NOT_FOUND,
    restoreInterview: async () => NOT_FOUND,
  },
  profiles: { list: async () => [] },
  jobOffers: { get: async () => null },
  followUps: { sentOf: async () => null, markSent: async () => ({ ok: false, error: "not_found" }), unmarkSent: async () => ({ ok: false, error: "not_found" }) },
  profile: {
    profiles: {
      get: async () => null,
      list: async () => [],
      changeSearchCriteria: async () => ({ ok: false, error: "not_found" }),
      saveMasterCv: async () => null,
      masterCvVersions: async () => null,
      archive: async () => ({ ok: false, error: "not_found" }),
      restore: async () => ({ ok: false, error: "not_found" }),
    },
    coachMemory: { list: async () => [], confirm: async () => ({ ok: false, error: "invalid" }), delete: async () => false },
    places: { suggest: async () => [] },
    offersOf: async () => [],
    profileUpgradePrompt: async () => null,
  },
};
