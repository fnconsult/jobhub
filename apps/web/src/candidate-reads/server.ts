import {getCoachPages} from "@/coach-pages/server";
import {getCoachAssociations} from "@/coach-associations/server";
import {getCoachingOffers} from "@/coaching-offers/server";
import { coachSpaceV2On } from "@/coach-space/server";
import { getCoachContacts } from "@/coach-space/contacts-server";
import { getCoachingTimeZones } from "@/coaching-time/server";
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
    coachPages:ids=>coachSpaceV2On()?getCoachPages().approved(ids):Promise.resolve([]),
    coachAssociations:ids=>coachSpaceV2On()?getCoachAssociations().providers(ids):Promise.resolve([]),
    coachingMeetings: async (id) => coachSpaceV2On() ? getCoachContacts().forCandidate(id) : null,
    coachingTimeZone: (id) => getCoachingTimeZones().candidate(id),
    coachingOffer:(candidateId,coachId)=>getCoachingOffers().sale(candidateId,coachId),
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
