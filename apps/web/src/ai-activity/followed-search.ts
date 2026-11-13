/**
 * The Job Search a page follows as its own (#1001, ADR-0106): the onboarding's offered one on `/profils/nouveau`. It has a
 * page of its own (its Job Search's), yet AI Activity counts it « ici » on the page that follows it, and « En ce moment »
 * shows it there with its run's measures (ai-activity/live, `measured`) and what the page alone counts: « offres qui vous
 * correspondent », by Match Score (rules, no AI) against the Search Criteria of the moment at FUNNEL_MATCH_SCORE, the
 * criteria it is narrowed with (« Affinée avec : … », an assumed one said so in words) and, once over, its best Job Offers.
 * Once it ended, the page's history keeps it as an entry of its own, with those Job Offers, or, when none matches, what
 * to do next (#1006).
 *
 *   followedOn(followed, pathname)        the key of the action the page at `pathname` follows, or null
 *   scored(offers, ids, cv, criteria)     the Job Offers found, each with its Match Score, the best first
 *   matchingCount(scored)                 how many reach FUNNEL_MATCH_SCORE
 *   bestOffers(jobSearchId, scored)       the 3 to 5 best, each linked to its page in the Job Search
 *   searchSteps(action)                   where each of the four steps stands, for the Stepper
 *   followedSearchEntry(followed, action) its history entry, once it ended
 *
 * Pure, and safe in the browser: the page (components/followed-search) fetches and registers; the provider holds it.
 */
import { FUNNEL_MATCH_SCORE, scoreMatch, type CvContent, type SearchCriteria } from "@jobhub/shared";
import type { ScoredJobOffer } from "../job-searches";
import { routes } from "../routes";
import type { ActivityEntry, EntryOffer, EntryStep } from "./entries";
import { isRunning, jobSearchKey, type LiveAction } from "./live";

/** The Search Criteria named in « Affinée avec : … », in this order. */
export type RefiningCriterion = "targetRole" | "locations" | "contractTypes" | "remoteWorkOptions" | "minSalary";

/** One criterion of « Affinée avec : … », in words; `assumed` while it is deduced and not confirmed yet (#1002). */
export interface Refining {
  key: RefiningCriterion;
  text: string;
  assumed: boolean;
}

/** What the page that follows a Job Search tells AI Activity of it. */
export interface FollowedSearch {
  jobSearchId: string;
  /** The page that follows it: AI Activity counts it « ici » there, and its history keeps it there once over. */
  href: string;
  /** « Offres qui vous correspondent », counted by the page on the Job Offers found so far. */
  matching: number;
  /** The Search Criteria of the moment, in words. */
  refining: readonly Refining[];
  /** Its best Job Offers so far, the best first: listed while it runs, as they are found, and once it ended (#1006). */
  best: readonly EntryOffer[];
  /** Its Profile, for « Voir mon profil » and « Relancer une recherche » when it ends with no Job Offer that matches (#1006). */
  profileId?: string | null;
  /** Whether the page has the Job Offers it ended with: until then, « offres qui vous correspondent » is not its last word. */
  settled?: boolean;
}

/** How many Job Offers it ends with: the 5 best that match, or the 3 best when fewer match. */
export const BEST_OFFERS = { most: 5, least: 3 } as const;

/** The key of the action the page at `pathname` follows, or null: it follows none, or another page does. */
export function followedOn(followed: FollowedSearch | null, pathname: string): string | null {
  return followed && followed.href === pathname ? jobSearchKey(followed.jobSearchId) : null;
}

/** A Job Offer found, with its Match Score against the criteria of the moment. */
export type Scored = { jobOffer: ScoredJobOffer; score: number };

/**
 * The Job Offers found (`ids`, in the run's order, those the page has), each with its Match Score against the CV and the
 * Search Criteria of the moment, the best first; equal ones in the run's order.
 */
export function scored(offers: ReadonlyMap<string, ScoredJobOffer>, ids: readonly string[], cv: CvContent, criteria: SearchCriteria): Scored[] {
  const found = ids.flatMap((id) => offers.get(id) ?? []);
  return found.map((jobOffer) => ({ jobOffer, score: scoreMatch({ cv, searchCriteria: criteria, jobOffer }).score })).sort((one, other) => other.score - one.score);
}

/** « Offres qui vous correspondent »: those at FUNNEL_MATCH_SCORE or more. */
export function matchingCount(list: readonly Scored[]): number {
  return list.filter((one) => one.score >= FUNNEL_MATCH_SCORE).length;
}

/** The best Job Offers: up to 5 of those that match, at least 3 when it found that many, each linked to its page in the Job Search. */
export function bestOffers(jobSearchId: string, list: readonly Scored[]): EntryOffer[] {
  const count = Math.max(BEST_OFFERS.least, Math.min(BEST_OFFERS.most, matchingCount(list)));
  return list.slice(0, count).map(({ jobOffer, score }) => ({
    title: jobOffer.title,
    employer: jobOffer.employer?.trim() || null,
    score,
    href: routes.jobSearchOffer(jobSearchId, jobOffer.id),
  }));
}

/** Where a step stands, as the Stepper draws it. */
export type SearchStepStatus = "done" | "current" | "pending";

/** The four steps (#1001): the profile read, the search (sources and pages), the analysis, the selection. */
export const SEARCH_STEPS = ["profile", "search", "analysis", "selection"] as const;
export type SearchStep = (typeof SEARCH_STEPS)[number];

/**
 * Where each of the four steps stands: the profile read at once; searching, the run's step under way (the search until
 * its measures say it analyses); done, all done; stopped or failed, the steps it went through are over (its analysis too:
 * the worker analyses what a stopped or failed run found), the selection not made, nothing under way.
 */
export function searchSteps(action: Pick<LiveAction, "status" | "measured">): Record<SearchStep, SearchStepStatus> {
  const reached = action.measured?.step === "analysis" ? 2 : 1;
  const at = (index: number): SearchStepStatus => {
    if (index === 0 || action.status === "done") return "done";
    if (action.status === "running" || action.status === "stopping") return index < reached ? "done" : index === reached ? "current" : "pending";
    return index <= reached ? "done" : "pending";
  };
  return { profile: at(0), search: at(1), analysis: at(2), selection: at(3) };
}

/** Its live steps as its history entry lists them: those ended, each with its Tool or model. */
function stepsOf(action: LiveAction): EntryStep[] {
  return action.steps
    .filter((step) => !step.running)
    .map((step) => ({ label: step.label, tool: step.tool, model: step.model, count: step.count ?? 1, ms: step.ms, tokens: step.tokens, seen: [] }));
}

/**
 * The followed Job Search's history entry once it ended (done, stopped or failed), on the page that follows it: its
 * Profile, its steps, the Job Offers it found, its best ones and its page (« Voir toutes les offres »). Offered, it used no
 * Plan Quota and is not counted in « Votre consommation » (ADR-0106). Done with no Job Offer that matches the criteria of
 * the moment, once the page has those it found (or it found none), it says so with its Profile (`noMatch`, #1006): « Voir
 * mon profil » and « Relancer une recherche », which counts in the Plan Quota. Null while it runs, or when the page follows
 * none.
 */
export function followedSearchEntry(followed: FollowedSearch | null, action: LiveAction | null): ActivityEntry | null {
  if (!followed || !action || action.key !== jobSearchKey(followed.jobSearchId) || isRunning(action)) return null;
  const end = action.status === "stopped" || action.status === "failed" ? { state: action.status, at: action.endedAt, reason: action.failure?.reason ?? null } : { state: "done" as const };
  const analysed = action.measured?.offersAnalysed ?? 0;
  const noMatch = end.state === "done" && followed.profileId && followed.matching === 0 && (followed.settled || analysed === 0) ? { profileId: followed.profileId } : null;
  return {
    key: `offered_search:${followed.jobSearchId}`,
    kind: "job_search",
    at: action.startedAt,
    object: { href: routes.jobSearch(followed.jobSearchId), label: action.name },
    origin: "jobbbox",
    result: { end, offers: analysed },
    steps: stepsOf(action),
    sites: [],
    tools: [],
    models: [],
    cost: { quota: null, tokens: action.tokens === null ? null : { count: action.tokens, calls: null, partial: false }, noAi: false, offered: true },
    offers: [...followed.best],
    ...(noMatch ? { noMatch } : {}),
  };
}
