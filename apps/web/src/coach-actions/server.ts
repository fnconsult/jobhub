import { getAgenda } from "@/agenda/server";
import { getExternalApiLog } from "@/ai-usage/external-api-log";
import { getApplications } from "@/applications/server";
import { getBilling } from "@/billing/server";
import { getCoachMemory } from "@/coach-memory/server";
import { getCompanyDossiers } from "@/company-dossiers/server";
import { getEnrichedContacts } from "@/enriched-contacts/server";
import { exchangesOn, getExchanges } from "@/exchanges/server";
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
      },
      enrichedContactQuota: weeklyQuotaOf(getBilling(), "enrichedContacts"),
