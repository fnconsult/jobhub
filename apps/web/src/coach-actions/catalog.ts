/**
 * The Coach Actions shipped (ADR-0077), group by group as each ticket delivers them, each one built on the domain module
 * its page's route calls, with its Eval Cases: the reads of every group (#714), the Agenda's proposals (#718), the
 * Candidatures proposals (#716), the Profil group's proposals (#719), the Recherches d'offres and Job Digests proposals
 * (#720), the Documents proposals (#721), the drafts reworked from the conversation (ADR-0109) and the versions of the
 * documents, read and restored (#1079), the Tailored CV read in full and reworked change by change (#1097, ADR-0113),
 * an Application's Exchanges, read and answered (#1099, behind its feature flag); and the employer's side of an
 * Application, its Company Dossier and Enriched Contacts (ADR-0114); and a company outside the Applications, through the
 * Target Companies of a Profile (ADR-0119, #1157).
 *
 *   shippedCoachActions(candidateObjects(sources), domain)   // the app's, over the Candidate's objects
 *   shippedCoachActions(NO_OBJECTS)                          // on no one's data: every read finds nothing, nothing to propose on
 */
import type { ApplicationChangeResult } from "../applications";
import { agendaCoachActions, type AgendaApplications } from "./agenda";
import { applicationCoachActions, type ApplicationActionSources } from "./applications";
import { documentCoachActions, type DocumentActionSources } from "./documents";
import { employerCoachActions, type EmployerActionSources } from "./employer";
import { draftCoachActions, type DraftActionSources } from "./drafts";
import { documentVersionCoachActions, type DocumentVersionActionSources } from "./versions";
import { tailoredCvCoachActions, type TailoredCvActionSources } from "./tailored-cv";
import { exchangeCoachActions, type ExchangeActionSources } from "./exchanges";
import { coachActionCatalog, type CoachAction } from "./index";
import { profileCoachActions, type ProfileActionSources } from "./profile";
import { searchCoachActions, type SearchActionSources } from "./job-searches";
import { readCoachActions, type CoachObjectReader } from "./reads";
import { targetCompanyCoachActions, type TargetCompanyActionSources } from "./target-companies";

/** The domain modules the proposals go through; a Job Offer's reach is the reads' (`objects`). */
export type CoachActionDomain = Omit<ApplicationActionSources, "applications" | "reachesJobOffer" | "profiles"> &
  Omit<SearchActionSources, "profiles"> & {
    applications: AgendaApplications & ApplicationActionSources["applications"];
    profiles: ApplicationActionSources["profiles"] & SearchActionSources["profiles"];
    /** The Profil group's: Search Criteria, Master CV, archive and restore, Coach Memory. */
    profile: ProfileActionSources;
  } & Pick<EmployerActionSources, "companyDossiers" | "enrichedContactQuota"> & {
    /** The Tailored CV: proposed (#721), read in full and reworked from the conversation (ADR-0113). */
    tailoredCvs: DocumentActionSources["tailoredCvs"] & TailoredCvActionSources["tailoredCvs"];
    /**
     * The Enriched Contacts, searched and revealed (ADR-0114), the one an Outreach Message is addressed to, and whether
     * they can be searched at all (a Target Company's, #1157).
     */
    enrichedContacts: EmployerActionSources["enrichedContacts"] & DocumentActionSources["enrichedContacts"] & TargetCompanyActionSources["enrichedContacts"];
    /** A Profile's Target Companies (ADR-0119, #1157): read, added, their dossier, contacts and Spontaneous Application. */
    targetCompanies: TargetCompanyActionSources["targetCompanies"];
    /** The Documents group's: the drafts launched (#721), and reworked from the conversation (ADR-0109). */
    tailoredDocuments: DocumentActionSources["tailoredDocuments"] & DraftActionSources["tailoredDocuments"];
    followUps: ApplicationActionSources["followUps"] & DraftActionSources["followUps"];
    /** The versions of an Application's documents, read and restored (#1079). */
    tailoredDocumentVersions: DocumentVersionActionSources["tailoredDocumentVersions"] & TailoredCvActionSources["tailoredDocumentVersions"];
    /** An Application's Exchanges (#1099), behind APPLICATION_EXCHANGES_ENABLED: none, off. */
    exchanges?: Pick<ExchangeActionSources, "exchanges" | "on">;
  };

export function shippedCoachActions(objects: CoachObjectReader, domain: CoachActionDomain = NO_DOMAIN): readonly CoachAction[] {
  // A Job Offer out of view is within reach when a read finds it: one of the Candidate's objects shows it.
  const reachesJobOffer = async (candidateId: string, jobOfferId: string) => (await objects.read(candidateId, "job_offer", jobOfferId, 100)) !== null;
  return coachActionCatalog([
    ...readCoachActions(objects),
    ...agendaCoachActions(domain.applications),
    ...applicationCoachActions({ ...domain, reachesJobOffer }),
    ...profileCoachActions(domain.profile),
    ...searchCoachActions(domain),
    ...documentCoachActions(domain),
    ...employerCoachActions(domain),
    ...targetCompanyCoachActions(objects, domain),
    ...draftCoachActions(domain),
    ...documentVersionCoachActions(domain),
    ...tailoredCvCoachActions(domain),
    ...exchangeCoachActions({ on: () => false, exchanges: NO_EXCHANGES, ...domain.exchanges, applications: domain.applications, profiles: domain.profiles }),
  ]);
}

/** No one's objects: the index is empty and every read is not_found (an Eval Run's default, the guard tests). */
export const NO_OBJECTS: CoachObjectReader = { index: async () => [], read: async () => null };

const NOT_FOUND: ApplicationChangeResult = { ok: false, error: "not_found" };

/** No one's Exchanges (#1099). */
const NO_EXCHANGES: ExchangeActionSources["exchanges"] = { onApplication: async () => null, get: async () => null };

/** No one's domain: every proposal finds nothing to propose on (an Eval Run never runs one, the guard tests). */
export const NO_DOMAIN: CoachActionDomain = {
  applications: {
    save: async () => ({ ok: false, error: "not_found" }),
    get: async () => null,
    list: async () => [],
    statusOf: async () => null,
    profileOf: async () => null,
    titleOf: async () => null,
    interviewOf: async () => null,
    change: async () => NOT_FOUND,
    removeIntact: async () => ({ ok: false, error: "not_found" }),
    addInterview: async () => NOT_FOUND,
    editInterview: async () => NOT_FOUND,
    cancelInterview: async () => NOT_FOUND,
    removeAddedInterview: async () => NOT_FOUND,
    restoreInterview: async () => NOT_FOUND,
  },
  profiles: { list: async () => [], get: async () => null },
  jobOffers: { get: async () => null },
  jobSearches: {
    start: async () => ({ ok: false, error: "not_found" }),
    stop: async () => ({ ok: false, error: "not_found" }),
    get: async () => null,
    latest: async () => null,
    searching: async () => null,
  },
  jobDigests: {
    settings: async () => null,
    allows: async () => ({ ok: false, error: "not_found" }),
    subscribe: async () => ({ ok: false, error: "not_found" }),
    unsubscribe: async () => {},
    get: async () => null,
  },
  jobSearchQuota: async () => ({ used: 0, limit: 0, refusal: null }),
  tailoredCvs: {
    get: async () => null,
    revisable: async () => null,
    reviseSaved: async () => ({ ok: false, error: "not_found" }),
    reviseProposal: async () => ({ ok: false, error: "not_found" }),
    answerAll: async () => ({ ok: false, error: "not_found" }),
  },
  companyDossiers: { get: async () => null, confirmEmployer: async () => ({ ok: false, error: "not_found" }) },
  enrichedContacts: {
    get: async () => null,
    find: async () => ({ ok: false, error: "not_found" }),
    reveal: async () => ({ ok: false, error: "not_found" }),
    contact: async () => null,
    availability: () => ({ enabled: false, searchable: false }),
  },
  targetCompanies: {
    onProfile: async () => null,
    resolve: async () => ({ ok: false, error: "invalid" }),
    add: async () => ({ ok: false, error: "invalid" }),
    prepareSpontaneousApplication: async () => ({ ok: false, error: "not_found" }),
  },
  enrichedContactQuota: async () => ({ used: 0, limit: 0, refusal: null }),
  tailoredDocuments: { get: async () => null, rework: async () => ({ ok: false, error: "not_found" }), unrework: async () => ({ ok: false, error: "not_found" }) },
  tailoredDocumentVersions: { list: async () => null, restore: async () => ({ ok: false, error: "not_found" }) },
  followUps: {
    sentOf: async () => null,
    markSent: async () => ({ ok: false, error: "not_found" }),
    unmarkSent: async () => ({ ok: false, error: "not_found" }),
    draftOf: async () => null,
    reword: async () => ({ ok: false, error: "not_found" }),
    unreword: async () => ({ ok: false, error: "not_found" }),
  },
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
