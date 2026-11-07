import { getCoachConversations } from "@/coach-conversations/server";
import { getJobOffers } from "@/job-offers/server";
import { servedEntries, type ServedEntry } from "./entries";
import { agendaPage, applicationPage, jobDigestPage, jobOfferPage, jobSearchPage, profilePage, type PageActivity, type PageSources } from "./index";

const sources = (): PageSources => ({ jobOffers: getJobOffers(), coachReplies: getCoachConversations() });

/**
 * The page's Activité entries the server builds (#808), what crosses to the browser. Never fails the page: without its
 * Provenance read, the history shows only what the thread adds (and the error is logged).
 */
async function quietly(load: (sources: PageSources) => Promise<PageActivity>): Promise<ServedEntry[]> {
  try {
    return servedEntries(await load(sources()));
  } catch (error) {
    console.error("[ai-activity] could not read the page's Provenance", error);
    return [];
  }
}

type Rest<F> = F extends (sources: PageSources, ...rest: infer R) => unknown ? R : never;

/** The Activité entries of each Candidate page type, read from the app's Job Offers and Coach Conversations (see ./index). */
export const loadAiActivity = {
  jobOffer: (...args: Rest<typeof jobOfferPage>) => quietly((s) => jobOfferPage(s, ...args)),
  jobSearches: (...args: Rest<typeof jobSearchPage>) => quietly((s) => jobSearchPage(s, ...args)),
  jobDigest: (...args: Rest<typeof jobDigestPage>) => quietly((s) => jobDigestPage(s, ...args)),
  application: (...args: Rest<typeof applicationPage>) => quietly((s) => applicationPage(s, ...args)),
  profile: (...args: Rest<typeof profilePage>) => quietly((s) => profilePage(s, ...args)),
  agenda: (...args: Rest<typeof agendaPage>) => quietly((s) => agendaPage(s, ...args)),
};
