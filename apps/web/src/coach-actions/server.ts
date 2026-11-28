import { getAgenda } from "@/agenda/server";
import { getExternalApiLog } from "@/ai-usage/external-api-log";
import { getApplications } from "@/applications/server";
import { getBilling } from "@/billing/server";
import { getCoachMemory } from "@/coach-memory/server";
import { exchangesOn, getExchanges } from "@/exchanges/server";
import { getCompanyDossiers } from "@/company-dossiers/server";
import { getEnrichedContacts } from "@/enriched-contacts/server";
import { coachSpaceV2On } from "@/coach-space-v2/server";
import { getHumanCoaches } from "@/human-coaches/server";
import { getFollowUps } from "@/follow-ups/server";
import { getJobDigests } from "@/job-digests/server";
import { getJobOffers } from "@/job-offers/server";
import { getJobSearches } from "@/job-searches/server";
import { getPlatformSettingsResolver } from "@/platform-settings/server";
import { getPlaceSuggestions } from "@/places/server";
import { profileUpgradePrompt } from "@/profiles/plan-quota";
import { getProfiles } from "@/profiles/server";
import { readIndustryReference } from "@/reference-data/server";
import { getTailoredCvs } from "@/tailored-cv/server";
import { getTailoredDocuments, getTailoredDocumentVersions } from "@/tailored-documents/server";
import { getTargetCompanies } from "@/target-companies/server";
import { candidateObjects } from "./candidate-objects";
import { shippedCoachActions } from "./catalog";
import { e2eCoachActions } from "./e2e-catalog";
import { createCoachActions, type CoachAction, type CoachActions } from "./index";
import { jobSearchQuotaOf } from "./job-searches";
import { createRedirects } from "./redirects";
import { weeklyQuotaOf } from "./quota";
import { coachActionsSettings } from "./settings";

let instance: CoachActions | undefined;
let catalog: readonly CoachAction[] | undefined;

/** How many of a Profile's Applications a Master CV proposal's Flagged Changes are checked against: the latest. */
const OFFERS_CHECKED = 10;

/** The text of the Job Offers of a Profile's latest Applications (#719): a Master CV rephrasing that brings their words is flagged. */
async function offersOf(candidateId: string, profileId: string): Promise<string[]> {
  const applications = getApplications();
  const latest = (await applications.list(candidateId)).filter((application) => application.profile.id === profileId).slice(0, OFFERS_CHECKED);
  const read = await Promise.all(latest.map((application) => applications.get(candidateId, application.id)));
  return read.flatMap((application) => (application ? [`${application.jobOffer.title} ${application.jobOffer.content}`] : []));
}

/**
 * The catalogue shipped, over the Candidate's objects through the domain modules the pages' routes use (#714, #716, #718,
 * #720, #721), its proposals applied through them (#719, #720, #721).
 */
function shipped(): readonly CoachAction[] {
  return shippedCoachActions(
    candidateObjects({
      profiles: getProfiles(),
      applications: getApplications(),
      jobSearches: getJobSearches(),
      jobDigests: getJobDigests(),
      agenda: {
        async upcoming(candidateId, now) {
          const days = await getAgenda().days(candidateId, { period: "upcoming", now });
          return days.flatMap((day) => day.items);
        },
      },
      tailoredDocuments: getTailoredDocuments(),
      tailoredCvs: getTailoredCvs(),
      // Reached when called: each is built on the Applications, as the reads are.
      companyDossiers: { get: (candidateId, applicationId) => getCompanyDossiers().get(candidateId, applicationId) },
      enrichedContacts: { get: (candidateId, applicationId) => getEnrichedContacts().get(candidateId, applicationId) },
      coachReviews: { reviews: (candidateId, applicationId) => getHumanCoaches().reviews(candidateId, applicationId) },
      // A Profile's Target Companies (#1157), their dossier and contacts those of their Spontaneous Application.
      targetCompanies: { onProfile: (candidateId, profileId) => getTargetCompanies().onProfile(candidateId, profileId) },
      // The Candidate's Plan and the week's Plan Quotas (#1158), as Mon abonnement reads them.
      plan: getBilling(),
      industries: readIndustryReference,
    }),
    {
      applications: getApplications(),
      profiles: getProfiles(),
      jobOffers: getJobOffers(),
      followUps: getFollowUps(),
      profile: {
        profiles: getProfiles(),
        // Reached when called, not built here: the Coach Memory's module is built on the Coach Conversations, whose AI Coach
        // is built on these Coach Actions.
        coachMemory: {
          list: (candidateId) => getCoachMemory().list(candidateId),
          confirm: (candidateId, input) => getCoachMemory().confirm(candidateId, input),
          delete: (candidateId, itemId) => getCoachMemory().delete(candidateId, itemId),
        },
        places: getPlaceSuggestions(),
        offersOf,
        profileUpgradePrompt: async (candidateId, language) => profileUpgradePrompt(getBilling(), getProfiles(), candidateId, language),
        industries: readIndustryReference,
      },
      jobSearches: getJobSearches(),
      jobDigests: getJobDigests(),
      jobSearchQuota: jobSearchQuotaOf(getBilling()),
      tailoredCvs: getTailoredCvs(),
      tailoredDocuments: getTailoredDocuments(),
      tailoredDocumentVersions: getTailoredDocumentVersions(),
      // An Application's Exchanges (#1099): offered only while APPLICATION_EXCHANGES_ENABLED is on, read at each reply.
      exchanges: { on: exchangesOn, exchanges: getExchanges() },
      // Reached when called, as the reads are (ADR-0114).
      companyDossiers: {
        get: (candidateId, applicationId) => getCompanyDossiers().get(candidateId, applicationId),
        confirmEmployer: (candidateId, applicationId, input) => getCompanyDossiers().confirmEmployer(candidateId, applicationId, input),
      },
      enrichedContacts: {
        get: (candidateId, applicationId) => getEnrichedContacts().get(candidateId, applicationId),
        find: (candidateId, applicationId) => getEnrichedContacts().find(candidateId, applicationId),
        reveal: (candidateId, applicationId, contactId) => getEnrichedContacts().reveal(candidateId, applicationId, contactId),
        contact: (candidateId, applicationId, contactId) => getEnrichedContacts().contact(candidateId, applicationId, contactId),
        availability: () => getEnrichedContacts().availability(),
      },
      // A company outside the Applications (ADR-0119, #1157), through the Profile's Target Companies.
      targetCompanies: {
        onProfile: (candidateId, profileId) => getTargetCompanies().onProfile(candidateId, profileId),
        resolve: (name) => getTargetCompanies().resolve(name),
        add: (candidateId, profileId, name) => getTargetCompanies().add(candidateId, profileId, name),
        prepareSpontaneousApplication: (candidateId, profileId, id) => getTargetCompanies().prepareSpontaneousApplication(candidateId, profileId, id),
      },
      enrichedContactQuota: weeklyQuotaOf(getBilling(), "enrichedContacts"),
    },
  );
}

/**
 * The Coach Actions this app offers and applies (#713, #715): the catalogue shipped, and on an e2e spec's own server only
 * (JOBHUB_TARGET=e2e and E2E_FAKE_COACH_ACTIONS=1) the suite's fake one, which proposes an Application Status.
 */
export function coachActionsInUse(env: NodeJS.ProcessEnv = process.env): readonly CoachAction[] {
  const fake = env.JOBHUB_TARGET?.trim() === "e2e" && env.E2E_FAKE_COACH_ACTIONS?.trim() === "1";
  catalog ??= fake ? [...shipped(), ...e2eCoachActions(getApplications())] : shipped();
  return catalog;
}

/** The app's Coach Actions (#713): the catalogue in use, switched on and bounded by Paramètres, each call in external_api_usage. */
export function getCoachActions(): CoachActions {
  instance ??= createCoachActions({
    catalog: coachActionsInUse(),
    settings: async () => coachActionsSettings(getPlatformSettingsResolver().current()),
    externalApis: getExternalApiLog(),
    // Typed redirects (ADR-0114), named after the Candidate's own Profiles and Applications; a Human Coach's while
    // « Espace coach v2 » is on (ADR-0107, #1158), read at each reply.
    redirects: createRedirects({ profiles: getProfiles(), applications: getApplications() }, { coachSpaceV2: coachSpaceV2On }),
  });
  return instance;
}
