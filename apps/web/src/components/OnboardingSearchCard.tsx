"use client";

import type { TFunction } from "i18next";
import Link from "next/link";
import { useEffect, useId, useState, useSyncExternalStore, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import {
  consultedSources,
  type Activity,
  FUNNEL_MATCH_SCORE,
  readLiveDiscoveryMetrics,
  scoreMatch,
  type CvContent,
  type DiscoverySource,
  type LiveDiscoveryMetrics,
  type SearchCriteria,
} from "@jobhub/shared";
import { ActivityGlyph } from "@/components/ActivityGlyph";
import { Icons } from "@/components/icons";
import { Card } from "@/design/Card";
import { Note } from "@/design/Note";
import { Pill, type Tone } from "@/design/Pill";
import { buttonClass } from "@/design/button-class";
import { currentStep, StepPulse, Stepper, type Step, type StepStatus } from "@/design/Stepper";
import type { JobSearchFailure, JobSearchStatus, ScoredJobOffer } from "@/job-searches";
import { routes } from "@/routes";
import "./OnboardingSearchCard.css";

/** How often the card asks where its Job Search stands, while it searches: as AI Activity polls a Job Search. */
export const LIVE_POLL_MS = 1500;

/** The Search Criteria the card names in « Affinée avec : … », in this order. */
export type RefiningCriterion = "targetRole" | "locations" | "contractTypes" | "remoteWorkOptions" | "minSalary";

const PICTOGRAMS: Record<DiscoverySource, () => React.JSX.Element> = {
  france_travail: Icons.sourceFranceTravail,
  fantastic_jobs: Icons.sourceCareerSites,
  web_search: Icons.searchSites,
  ats_apis: Icons.sourceAtsApis,
  target_companies: Icons.sourceTargetCompanies,
};

const STATUS_TONE: Record<JobSearchStatus, Tone> = { searching: "accent", done: "success", stopped: "neutral", failed: "danger" };
const SEARCHING: JobSearchStatus = "searching";
/** The search's Activity glyph: the loupe. */
const SEARCH: Activity = "search";
const STATUSES: readonly JobSearchStatus[] = ["searching", "done", "stopped", "failed"];

/** Where the Job Search stands, as the card last polled it. */
interface Polled {
  status: JobSearchStatus;
  failure: JobSearchFailure | null;
  live: LiveDiscoveryMetrics | null;
}

/** One criterion of « Affinée avec : … », in words; `assumed` while it is deduced and not confirmed yet (#1002). */
interface Refining {
  key: RefiningCriterion;
  text: string;
  assumed: boolean;
}

/**
 * The search card of `/profils/nouveau` (#1001, ADR-0106): the offered Job Search, live, in the thread of the onboarding
 * interview. Its four counters are the run's own measures, polled from the Job Search every LIVE_POLL_MS while it
 * searches (`GET /api/job-searches/:id/live`): sources consulted out of the active ones, pages read, Job Offers analysed;
 * 0 until something is measured. The fourth, « offres qui vous correspondent », is counted here, never by the AI: the
 * Match Score of each Job Offer found against the CV and the Search Criteria of the moment (`criteria`, `cv`), at
 * FUNNEL_MATCH_SCORE or more, so it follows each criterion added without a new search. « Affinée avec : … » names those
 * criteria, an assumed one (#1002) said « supposé » and underlined dashed, never by colour alone.
 *
 * `compact` while the questions go on: stuck at the top of the thread, the step under way and the counters (short labels
 * when the card is narrow); else the whole card, the orbit of Jobbbox's own pictograms (no third party's logo), the
 * counters, each source's state and the Stepper, in two columns that stack by the card's own width (a container query:
 * the Work Pane open too). Every animation stops under prefers-reduced-motion. Its counters are never read out as they
 * change: only the search starting, each criterion it is narrowed with and its end are said, in a `role="status"` of its
 * own. Stopped or failed, it says so with what was found. A link opens the Job Search's page.
 */
export function OnboardingSearchCard({
  jobSearchId,
  restarted = false,
  criteria,
  cv,
  assumed = [],
  compact,
  pollMs = LIVE_POLL_MS,
}: {
  jobSearchId: string;
  restarted?: boolean;
  criteria: SearchCriteria;
  cv: CvContent;
  assumed?: readonly RefiningCriterion[];
  compact: boolean;
  pollMs?: number;
}) {
  const { t, i18n } = useTranslation();
  const headingId = useId();
  const { polled, offers } = useJobSearchLive(jobSearchId, pollMs);
  const still = useReducedMotion();
  const status = polled?.status ?? SEARCHING;
  const live = polled?.live ?? null;

  // The Job Offers the run found (kept, once over), as the page has them: the Expired ones are not.
  const ids = live ? live.jobOfferIds : [...offers.keys()];
  const found = ids.flatMap((id) => offers.get(id) ?? []);
  const matching = found.filter((jobOffer) => scoreMatch({ cv, searchCriteria: criteria, jobOffer }).score >= FUNNEL_MATCH_SCORE).length;
  const sources = live?.sources ?? [];
  const consulted = live ? consultedSources(live) : 0;
  const pages = live?.pagesRead ?? 0;
  const analysed = live?.offersAnalysed ?? 0;

  const refining = refiningOf(criteria, assumed, { t, locale: i18n.language });
  const refiningKey = JSON.stringify(refining);
  const words = (list: readonly Refining[]) => list.map((item) => (item.assumed ? `${item.text} (${t("onboardingSearch.assumed")})` : item.text)).join(" · ");
  const outcome = { analysed, matching };

  // What the status region says: the search starting (once polled), each criterion it is narrowed with, its end; never
  // a counter changing. Derived while rendering, from what was said last.
  const [said, setSaid] = useState<{ status: JobSearchStatus | null; refining: string; items: readonly Refining[]; text: string; recounted: string }>({
    status: null,
    refining: refiningKey,
    items: refining,
    text: "",
    recounted: "",
  });
  const polledStatus = polled?.status ?? null;
  if (polledStatus !== said.status) {
    const text =
      polledStatus === null
        ? said.text
        : polledStatus === "searching"
          ? t(restarted ? "onboardingSearch.announce.restarted" : "onboardingSearch.announce.started")
          : t(`onboardingSearch.announce.${polledStatus}`, outcome);
    setSaid({ ...said, status: polledStatus, text });
  } else if (refiningKey !== said.refining) {
    const added = refining.filter((item) => !said.items.some((before) => before.key === item.key && before.text === item.text && before.assumed === item.assumed));
    const named = words(added.length > 0 ? added : refining);
    setSaid({ ...said, refining: refiningKey, items: refining, text: t("onboardingSearch.announce.refined", { criteria: named }), recounted: named });
  }

  const steps = stepsOf(polled, { t, criteria: words(refining), consulted, total: sources.length, pages, analysed, matching });
  const under = currentStep(steps);
  const searching = status === SEARCHING;
  const pill = <Pill tone={STATUS_TONE[status]}>{t(`onboardingSearch.status.${status}`)}</Pill>;
  const counters = (
    <Counters
      consulted={consulted}
      total={sources.length}
      pages={pages}
      analysed={analysed}
      matching={matching}
      recounted={said.recounted ? t("onboardingSearch.recounted", { criteria: said.recounted }) : null}
    />
  );
  const refined =
    refining.length > 0 ? (
      <p className="onb-search-refined">
        <Icons.filter />
        <span>
          {t("onboardingSearch.refined")}{" "}
          {refining.map((item, index) => (
            <span key={item.key}>
              {index > 0 ? " · " : null}
              {item.assumed ? (
                <>
                  <span className="onb-search-assumed" title={t("onboardingSearch.assumedTitle")}>
                    {item.text}
                  </span>{" "}
                  ({t("onboardingSearch.assumed")})
                </>
              ) : (
                item.text
              )}
            </span>
          ))}
        </span>
      </p>
    ) : null;
  const over = status === "stopped" || status === "failed" ? <OverNote status={status} analysed={analysed} /> : null;
  const open = (
    <Link className={`onb-search-open ${buttonClass({ variant: "quiet", size: "sm" })}`} href={routes.jobSearch(jobSearchId)}>
      {t("onboardingSearch.open")}
    </Link>
  );
  const announcer = (
    <p className="visually-hidden" role="status">
      {said.text}
    </p>
  );

  if (compact)
    return (
      <li className="chat-message chat-card onb-search-wrap" data-compact="" data-motion={still ? "still" : undefined}>
        <section className="onb-search-live" aria-label={t("onboardingSearch.title")} aria-live="off">
          <div className="onb-search-live-head">
            <ActivityGlyph activity={SEARCH} live={searching} />
            <p className="onb-search-live-title">
              {t("onboardingSearch.title")}
              {under ? (
                <span className="onb-search-live-step">
                  <StepPulse still={still} />
                  {t("onboardingSearch.stepOf", { number: under.number, total: steps.length })}
                  <span className="onb-search-live-step-title" aria-hidden>
                    {" "}
                    · {under.step.title}
                  </span>
                  <span className="visually-hidden"> · {under.step.title}</span>
                </span>
              ) : null}
            </p>
            {pill}
          </div>
          {counters}
          {refined}
          {over}
          {open}
          {announcer}
        </section>
      </li>
    );

  return (
    <li className="chat-message chat-card onb-search-wrap" data-motion={still ? "still" : undefined}>
      <div className="onb-search-card" aria-live="off">
        <Card title={t("onboardingSearch.title")} headingLevel={3} headingId={headingId} actions={pill}>
          <div className="onb-search-columns">
            <div className="onb-search-visual">
              <Orbit sources={sources} done={status === "done"} searching={searching} />
              {counters}
              {sources.length > 0 ? (
                <ul className="onb-search-sources" aria-label={t("onboardingSearch.sourcesLabel")}>
                  {sources.map(({ source, state }) => {
                    const Pictogram = PICTOGRAMS[source];
                    return (
                      <li key={source} data-state={state}>
                        <Pictogram />
                        {t(`onboardingSearch.sources.${source}`)}
                        <span className="onb-search-source-state">{t(`onboardingSearch.sourceStates.${state}`)}</span>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
            <Stepper className="onb-search-steps" steps={steps} label={t("onboardingSearch.stepsLabel")} still={still} />
          </div>
          {refined}
          {over}
          {open}
          {announcer}
        </Card>
      </div>
    </li>
  );
}

/** The four counters: what was measured, 0 until then; « offres qui vous correspondent » counted here. Short labels when narrow. */
function Counters({
  consulted,
  total,
  pages,
  analysed,
  matching,
  recounted,
}: {
  consulted: number;
  total: number;
  pages: number;
  analysed: number;
  matching: number;
  recounted: string | null;
}) {
  const { t } = useTranslation();
  const rows: { key: string; value: string; label: string; short: string; note?: string | null }[] = [
    {
      key: "sources",
      value: total > 0 ? t("onboardingSearch.counters.outOf", { count: consulted, total }) : String(consulted),
      label: t("onboardingSearch.counters.sources"),
      short: t("onboardingSearch.counters.sourcesShort"),
    },
    { key: "pages", value: String(pages), label: t("onboardingSearch.counters.pages"), short: t("onboardingSearch.counters.pagesShort") },
    { key: "analysed", value: String(analysed), label: t("onboardingSearch.counters.analysed"), short: t("onboardingSearch.counters.analysedShort") },
    {
      key: "matching",
      value: String(matching),
      label: t("onboardingSearch.counters.matching"),
      short: t("onboardingSearch.counters.matchingShort"),
      note: recounted,
    },
  ];
  return (
    <dl className="onb-search-counters">
      {rows.map((row) => (
        <div key={row.key} data-counter={row.key}>
          <dt>
            <span className="visually-hidden">{row.label}</span>
            <span className="onb-search-counter-long" aria-hidden>
              {row.label}
            </span>
            <span className="onb-search-counter-short" aria-hidden>
              {row.short}
            </span>
          </dt>
          <dd>{row.value}</dd>
          {row.note ? <dd className="onb-search-counter-note">{row.note}</dd> : null}
        </div>
      ))}
    </dl>
  );
}

/** The search's own animation: the loupe, the active sources' pictograms turning around it, a check once done. Decoration only. */
function Orbit({ sources, done, searching }: { sources: LiveDiscoveryMetrics["sources"]; done: boolean; searching: boolean }) {
  return (
    <div className="onb-search-orbit" data-done={done || undefined} aria-hidden>
      <span className="onb-search-orbit-ring" />
      <span className="onb-search-orbit-halo" />
      <span className="onb-search-orbit-center">{done ? <Icons.done /> : <ActivityGlyph activity={SEARCH} live={searching} />}</span>
      <span className="onb-search-orbit-track">
        {sources.map(({ source, state }, index) => {
          const Pictogram = PICTOGRAMS[source];
          return (
            <span
              key={source}
              className="onb-search-orbit-item"
              style={{ "--i": index, "--n": sources.length } as CSSProperties}
              data-on={state !== "waiting" || undefined}
            >
              <span className="onb-search-orbit-icon">
                <Pictogram />
              </span>
            </span>
          );
        })}
      </span>
    </div>
  );
}

/** A search stopped or failed: said, with what it found, which is kept. */
function OverNote({ status, analysed }: { status: "stopped" | "failed"; analysed: number }) {
  const { t } = useTranslation();
  return (
    <Note tone={status === "failed" ? "warn" : "info"} title={t(status === "failed" ? "onboardingSearch.failedTitle" : "onboardingSearch.stoppedTitle")}>
      <p>{t("onboardingSearch.kept", { count: analysed })}</p>
    </Note>
  );
}

/**
 * The four steps (#1001): the profile read (its criteria), the search (sources and pages), the analysis (the Job Offers
 * found), the selection (those that match). Searching: the run's step is under way; done: all done. Stopped or failed:
 * the steps it went through are over (its analysis too: the worker analyses what a stopped or failed run found), the
 * selection is not made, and nothing is under way.
 */
function stepsOf(
  polled: Polled | null,
  facts: { t: TFunction; criteria: string; consulted: number; total: number; pages: number; analysed: number; matching: number },
): Step[] {
  const { t } = facts;
  const status = polled?.status ?? SEARCHING;
  const reached = polled?.live?.step === "analysis" ? 2 : 1;
  const at = (index: number): StepStatus => {
    if (index === 0 || status === "done") return "done";
    if (status === SEARCHING) return index < reached ? "done" : index === reached ? "current" : "pending";
    return index <= reached ? "done" : "pending";
  };
  const statuses = [0, 1, 2, 3].map(at);
  const shown = (index: number) => statuses[index] !== "pending";
  return [
    { id: "profile", title: t("onboardingSearch.steps.profile"), status: statuses[0]!, ...(facts.criteria ? { detail: facts.criteria } : {}) },
    {
      id: "search",
      title: t("onboardingSearch.steps.search"),
      status: statuses[1]!,
      ...(shown(1) ? { detail: t("onboardingSearch.details.search", { consulted: facts.consulted, total: facts.total, pages: facts.pages }) } : {}),
    },
    {
      id: "analysis",
      title: t("onboardingSearch.steps.analysis"),
      status: statuses[2]!,
      ...(shown(2) ? { detail: t("onboardingSearch.details.analysis", { count: facts.analysed }) } : {}),
    },
    {
      id: "selection",
      title: t("onboardingSearch.steps.selection"),
      status: statuses[3]!,
      ...(shown(3) ? { detail: t("onboardingSearch.details.selection", { count: facts.matching, threshold: FUNNEL_MATCH_SCORE }) } : {}),
    },
  ];
}

/** The Search Criteria of the moment, in words, in « Affinée avec : … »'s order; the empty ones left out. */
function refiningOf(
  criteria: SearchCriteria,
  assumed: readonly RefiningCriterion[],
  { t, locale }: { t: TFunction; locale: string },
): Refining[] {
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
 * Polls the Job Search while it searches, then once more after: where it stands, what its run measured, and the Job
 * Offers found so far, each asked for once (`known`). A poll that fails is tried again at the next tick; a Job Search
 * that is not the Candidate's (404, 401) is not asked again.
 */
function useJobSearchLive(jobSearchId: string, pollMs: number): { polled: Polled | null; offers: ReadonlyMap<string, ScoredJobOffer> } {
  const [polled, setPolled] = useState<Polled | null>(null);
  const [offers, setOffers] = useState<ReadonlyMap<string, ScoredJobOffer>>(() => new Map());
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const known = new Map<string, ScoredJobOffer>();
    async function poll() {
      const query = known.size > 0 ? `?known=${[...known.keys()].join(",")}` : "";
      const response = await fetch(`/api/job-searches/${jobSearchId}/live${query}`, { cache: "no-store" }).catch(() => null);
      if (cancelled) return;
      if (response && (response.status === 404 || response.status === 401)) return;
      const body: unknown = response?.ok ? await response.json().catch(() => null) : null;
      if (cancelled) return;
      const read = readPolled(body);
      if (read) {
        for (const jobOffer of read.jobOffers) known.set(jobOffer.id, jobOffer);
        if (read.jobOffers.length > 0) setOffers(new Map(known));
        setPolled(read.polled);
        if (read.polled.status !== SEARCHING) return;
      }
      timer = setTimeout(() => void poll(), pollMs);
    }
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [jobSearchId, pollMs]);
  return { polled, offers };
}

/** The poll's answer, checked; null when it is not one. */
function readPolled(body: unknown): { polled: Polled; jobOffers: ScoredJobOffer[] } | null {
  if (typeof body !== "object" || body === null) return null;
  const value = body as Record<string, unknown>;
  const status = STATUSES.find((one) => one === value.status);
  if (!status) return null;
  const jobOffers = Array.isArray(value.jobOffers)
    ? (value.jobOffers as unknown[]).filter((offer): offer is ScoredJobOffer => {
        const { id, title, content } = (offer ?? {}) as Record<string, unknown>;
        return typeof id === "string" && typeof title === "string" && typeof content === "string";
      })
    : [];
  return {
    polled: { status, failure: typeof value.failure === "string" ? (value.failure as JobSearchFailure) : null, live: readLiveDiscoveryMetrics(value.live) },
    jobOffers,
  };
}

/**
 * What the card counts with, from the onboarding's draft: its Search Criteria of the moment, those it does not hold yet
 * left empty (no preference), and its Master CV as it stands.
 */
export function searchedWith(draft: { masterCv: CvContent; searchCriteria: Partial<SearchCriteria> & Pick<SearchCriteria, "targetRole" | "locations"> }): {
  criteria: SearchCriteria;
  cv: CvContent;
} {
  const criteria: SearchCriteria = { contractTypes: [], remoteWorkOptions: [], sectors: [], subsectors: [], domains: [], ...draft.searchCriteria };
  return { criteria, cv: draft.masterCv };
}

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/** Whether the Candidate asked for less motion: every animation of the card stops (its CSS says so too). */
function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (changed) => {
      if (typeof window.matchMedia !== "function") return () => {};
      const query = window.matchMedia(REDUCED_MOTION);
      query.addEventListener?.("change", changed);
      return () => query.removeEventListener?.("change", changed);
    },
    () => typeof window.matchMedia === "function" && window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
}
