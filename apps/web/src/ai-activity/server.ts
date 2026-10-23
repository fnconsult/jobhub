import { getCoachConversations } from "@/coach-conversations/server";
import { getJobOffers } from "@/job-offers/server";
import { getTailoredCvs } from "@/tailored-cv/server";
import { getTailoredDocuments } from "@/tailored-documents/server";
import { applicationDocumentsPage, applicationPage, jobDigestPage, jobOfferPage, jobSearchPage, profilePage, type ActivityElement, type PageSources } from "./index";

const sources = (): PageSources => ({ jobOffers: getJobOffers(), coachReplies: getCoachConversations() });

/** Never fails the page: without its Provenance read, the pane shows nothing (and the error is logged). */
async function quietly(load: (sources: PageSources) => Promise<ActivityElement[]>): Promise<ActivityElement[]> {
  try {
    return await load(sources());
  } catch (error) {
    console.error("[ai-activity] could not read the page's Provenance", error);
    return [];
  }
}

type Rest<F> = F extends (sources: PageSources, ...rest: infer R) => unknown ? R : never;

/** AI Activity's elements of each Candidate page type, read from the app's Job Offers and Coach Conversations (see ./index). */
export const loadAiActivity = {
  jobOffer: (...args: Rest<typeof jobOfferPage>) => quietly((s) => jobOfferPage(s, ...args)),
  jobSearches: (...args: Rest<typeof jobSearchPage>) => quietly((s) => jobSearchPage(s, ...args)),
  jobDigest: (...args: Rest<typeof jobDigestPage>) => quietly((s) => jobDigestPage(s, ...args)),
  application: (...args: Rest<typeof applicationPage>) => quietly((s) => applicationPage(s, ...args)),
  profile: (...args: Rest<typeof profilePage>) => quietly((s) => profilePage(s, ...args)),
};

/** `/candidatures/[id]/documents`'s elements for AI Activity: the Candidate's Tailored CV and drafts of that Application. */
export function loadApplicationDocumentsPage(candidateId: string, id: string): Promise<ActivityElement[]> {
  return applicationDocumentsPage(getTailoredCvs(), getTailoredDocuments(), candidateId, id);
}
