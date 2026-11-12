"use client";

import type { TFunction } from "i18next";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { readLiveDiscoveryMetrics, type CvContent, type SearchCriteria } from "@jobhub/shared";
import { bestOffers, matchingCount, scored, type FollowedSearch, type Refining, type RefiningCriterion } from "@/ai-activity/followed-search";
import { isRunning, jobSearchKey } from "@/ai-activity/live";
import { useActivityColumn } from "@/components/activity-column";
import { useAiActivityLive } from "@/components/AiActivityLive";
import type { ScoredJobOffer } from "@/job-searches";

/** The Job Offers the page has of the followed Job Search, and the ids its run found, in its order. */
type Found = { jobSearchId: string; offers: ReadonlyMap<string, ScoredJobOffer>; ids: readonly string[] };

/**
 * The page follows a Job Search as its own (#1001, ADR-0106: the onboarding's offered one on `/profils/nouveau`, `href`):
 * AI Activity counts it « ici » there and shows it in « En ce moment » with its run's measures, which its poll brings
 * (JobSearchNotifications), and what this hook counts: « offres qui vous correspondent », the Match Score (rules, no AI)
 * of each Job Offer found against the CV and the Search Criteria of the moment at FUNNEL_MATCH_SCORE or more, so it follows
 * each criterion added without a new search; « Affinée avec : … », `assumed` naming those deduced and not confirmed yet
 * (#1002); and its best Job Offers, which its history entry lists once it ended. The Job Offers are asked for
 * (`GET /api/job-searches/:id/live`, those the page has left out) each time the poll says its run analysed more, and once
 * it is over. Criteria without a target role or a location (a questionnaire started over) leave the count as it was.
 *
 * On a wide screen, the side panel opens on « Activité » as each offered search starts (ADR-0106 amendment); on a
 * phone, nothing opens.
 *
 * `jobSearchId` null: nothing more is followed than before (a search started earlier keeps being followed). The page's
 * first render lets go of any search an earlier visit followed.
 */
export function useFollowedSearch({
  jobSearchId,
  href,
  criteria,
  cv,
  assumed = [],
}: {
  jobSearchId: string | null;
  href: string;
  criteria: SearchCriteria;
  cv: CvContent;
  assumed?: readonly RefiningCriterion[];
}): void {
  const { t, i18n } = useTranslation();
  const store = useAiActivityLive();
  const follow = store?.follow;
  const action = jobSearchId ? (store?.actions.find((one) => one.key === jobSearchKey(jobSearchId)) ?? null) : null;
  const [found, setFound] = useState<Found | null>(null);

  // A visit starts following nothing: what an earlier one followed is let go.
  useEffect(() => follow?.(null), [follow]);

  // On a wide screen, the side panel opens on Activité as an offered search starts (or starts again), beside the
  // conversation; on a phone nothing opens, the compact Top Bar already shows « Activité » while it runs (ADR-0101).
  const column = useActivityColumn();
  const openColumn = column?.open;
  const wide = column?.wide ?? false;
  useEffect(() => {
    if (jobSearchId && wide) openColumn?.();
    // Once per search started: not again when the screen widens or the panel changes.
  }, [jobSearchId]);

  // The Job Offers, asked for once the run analysed more than the page has, and once it is over.
  const analysed = action?.measured?.offersAnalysed ?? 0;
  const over = action ? !isRunning(action) : false;
  const has = found?.jobSearchId === jobSearchId ? found.ids.length : 0;
  const ask = jobSearchId !== null && action !== null && (over || analysed > has);
  const asking = ask ? `${jobSearchId}:${analysed}:${over}` : null;
  useEffect(() => {
    if (!asking || !jobSearchId) return;
    let cancelled = false;
    void (async () => {
      const known = found?.jobSearchId === jobSearchId ? found.offers : new Map<string, ScoredJobOffer>();
      const query = known.size > 0 ? `?known=${[...known.keys()].join(",")}` : "";
      const response = await fetch(`/api/job-searches/${encodeURIComponent(jobSearchId)}/live${query}`, { cache: "no-store" }).catch(() => null);
      const body: unknown = response?.ok ? await response.json().catch(() => null) : null;
      if (cancelled || !body) return;
      const read = readFound(body);
      const offers = new Map(known);
      for (const jobOffer of read.jobOffers) offers.set(jobOffer.id, jobOffer);
      setFound({ jobSearchId, offers, ids: read.ids ?? [...offers.keys()] });
    })();
    return () => {
      cancelled = true;
    };
    // `found` is read when asking, never a reason to ask again.
  }, [asking, jobSearchId]);

  // The criteria counted with: those of the moment, once they hold a target role and a location.
  const complete = criteria.targetRole.trim() !== "" && criteria.locations.length > 0;
  const [counted, setCounted] = useState(criteria);
  if (complete && criteria !== counted && JSON.stringify(criteria) !== JSON.stringify(counted)) setCounted(criteria);

  // The CV as it stands, the same object while it does not change: no Match Score computed again for nothing.
  const cvKey = JSON.stringify(cv);
  const counting = useMemo(() => cv, [cvKey]);
  const assumedKey = assumed.join(",");
  const language = i18n.language;
  const followed = useMemo<FollowedSearch | null>(() => {
    if (!jobSearchId) return null;
    const list = found?.jobSearchId === jobSearchId ? scored(found.offers, found.ids, counting, counted) : [];
    return {
      jobSearchId,
      href,
      matching: matchingCount(list),
      refining: refiningOf(counted, assumedKey ? (assumedKey.split(",") as RefiningCriterion[]) : [], { t, locale: language }),
      best: bestOffers(jobSearchId, list),
    };
  }, [jobSearchId, href, found, counting, counted, assumedKey, t, language]);

  // Told to AI Activity as it changes; the same again is not told.
  const followedKey = followed ? JSON.stringify(followed) : null;
  useEffect(() => {
    if (followed) follow?.(followed);
    // `followedKey` says when it changed.
  }, [followedKey, follow]);
}

/** The Job Offers in the answer, and the ids its run found (null when it says none: one run before #1001). */
function readFound(body: unknown): { jobOffers: ScoredJobOffer[]; ids: string[] | null } {
  const value = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const jobOffers = Array.isArray(value.jobOffers)
    ? (value.jobOffers as unknown[]).filter((offer): offer is ScoredJobOffer => {
        const { id, title, content } = (offer ?? {}) as Record<string, unknown>;
        return typeof id === "string" && typeof title === "string" && typeof content === "string";
      })
    : [];
  return { jobOffers, ids: readLiveDiscoveryMetrics(value.live)?.jobOfferIds ?? null };
}

/** The Search Criteria of the moment, in words, in « Affinée avec : … »'s order; the empty ones left out. */
export function refiningOf(criteria: SearchCriteria, assumed: readonly RefiningCriterion[], { t, locale }: { t: TFunction; locale: string }): Refining[] {
  const amount = (value: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(value);
  const texts: [RefiningCriterion, string][] = [
    ["targetRole", criteria.targetRole.trim()],
    ["locations", criteria.locations.join(", ")],
    ["contractTypes", criteria.contractTypes.map((type) => t(`cvReview.contractTypes.${type}`)).join(", ")],
    ["remoteWorkOptions", criteria.remoteWorkOptions.map((option) => t(`cvReview.remoteWorkOptions.${option}`)).join(", ")],
    ["minSalary", criteria.minSalary ? t("onboardingSearch.minSalary", { amount: amount(criteria.minSalary) }) : ""],
  ];
  return texts.filter(([, text]) => text !== "").map(([key, text]) => ({ key, text, assumed: assumed.includes(key) }));
}

/**
 * What the page counts with, from the onboarding's draft: its Search Criteria of the moment, those it does not hold yet
 * left empty (no preference), and its Master CV as it stands.
 */
export function searchedWith(draft: { masterCv: CvContent; searchCriteria: Partial<SearchCriteria> & Pick<SearchCriteria, "targetRole" | "locations"> }): {
  criteria: SearchCriteria;
  cv: CvContent;
} {
  const criteria: SearchCriteria = { contractTypes: [], remoteWorkOptions: [], sectors: [], subsectors: [], domains: [], ...draft.searchCriteria };
  return { criteria, cv: draft.masterCv };
}
