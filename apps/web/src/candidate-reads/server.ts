import { cancellationPolicyOn } from "@/coaching-cancellations/server";
import { getCoachingBooking } from "@/coaching-booking/server";
import { getCoachPages } from "@/coach-pages/server";
import { getCoachAssociations } from "@/coach-associations/server";
import { getCoachingOffers } from "@/coaching-offers/server";
import { getCoachContacts } from "@/coach-space/contacts-server";
import { getCoachingTimeZones } from "@/coaching-time/server";
import { coachSpaceV2On } from "@/coach-space-v2/server";
import { getAgenda } from "@/agenda/server";
import { getApplications } from "@/applications/server";
import { getAtsScoring } from "@/ats-score/server";
import { getBilling } from "@/billing/server";
import { getCoachConversations } from "@/coach-conversations/server";
import { getFollowUps } from "@/follow-ups/server";
import { getHumanCoaches } from "@/human-coaches/server";
import { getJobDigests } from "@/job-digests/server";
import { getJobSearches } from "@/job-searches/server";
import { getOrders } from "@/orders/server";
import { getOfferBox } from "@/offer-box/server";
import { getProfiles } from "@/profiles/server";
import { getTailoredCvs } from "@/tailored-cv/server";
import { getTailoredDocuments } from "@/tailored-documents/server";
import { getWithdrawals } from "@/withdrawals/server";
import { createCandidateReads, type CandidateReads } from "./index";
let instance: CandidateReads | undefined;
/** The app's reads over HTTP (#684), on the modules the pages read, on the database named by DATABASE_URL. */
export function getCandidateReads(): CandidateReads {
    instance ??= createCandidateReads({
        // « Espace coach v2 » (ADR-0106), per request: off, the reads answer the app as before the Human Coach epic.
        coachSpaceV2: coachSpaceV2On,
        coachPages: (ids) => (getCoachPages().approved(ids)),
        coachAssociations: (ids) => (getCoachAssociations().providers(ids)),
        coachingCancellations: cancellationPolicyOn,
        coachingBookings: (id) => getCoachingBooking().paths(id),
        coachingMeetings: async (id) => (getCoachContacts().forCandidate(id)),
        coachingTimeZone: (id) => getCoachingTimeZones().candidate(id),
        coachingOffer: (candidateId, coachId) => getCoachingOffers().sale(candidateId, coachId),
        applications: getApplications(),
        followUps: getFollowUps(),
        profiles: getProfiles(),
        jobSearches: getJobSearches(),
        jobDigests: getJobDigests(),
        agenda: getAgenda(),
        humanCoaches: getHumanCoaches(),
        billing: getBilling(),
        withdrawals: getWithdrawals(),
        orders: getOrders(),
        atsScoring: getAtsScoring(),
        tailoredCvs: getTailoredCvs(),
        tailoredDocuments: getTailoredDocuments(),
        coachConversations: getCoachConversations(),
        offerBox: getOfferBox(),
    });
    return instance;
}
