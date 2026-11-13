"use client";

import { useTranslation } from "react-i18next";
import { consultedSources, type LiveSourceState } from "@jobhub/shared";
import { SEARCH_STEPS, searchSteps, type FollowedSearch } from "@/ai-activity/followed-search";
import { isRunning, type LiveAction } from "@/ai-activity/live";
import { Stat, Stats } from "@/design/Card";
import { Status, type StatusTone } from "@/design/Pill";
import { Stepper } from "@/design/Stepper";
import { BestOffers } from "@/components/ActivityHistory";

/** Each source's state in words, its dot only repeating them: consulted, refused, failed; to come and under way, neutral. */
const SOURCE_TONE: Record<LiveSourceState, StatusTone> = { waiting: "neutral", searching: "neutral", searched: "success", refused: "warn", failed: "danger" };

/**
 * The Job Search the page follows as its own (#1001, ADR-0106), in its « En ce moment » entry: the four steps (Stepper),
 * its run's measures (Stats: sources consulted out of its active ones, pages read, Job Offers analysed, 0 until measured)
 * with « offres qui vous correspondent », counted by the page against the Search Criteria of the moment; each source's
 * state (Status, a dot and its words); and « Affinée avec : … », an assumed criterion followed by « (supposé) » in words.
 * Then, as they are found, its best Job Offers so far, and that the Candidate may go on: its Job Search Notification will
 * tell them when it is over (#1006).
 * Shown, never read out as it changes: AI Activity's live region says its start and its end only.
 */
export function FollowedSearchNow({ action, followed }: { action: LiveAction; followed: FollowedSearch }) {
  const { t } = useTranslation();
  const measured = action.measured;
  const sources = measured?.sources ?? [];
  const consulted = measured ? consultedSources(measured) : 0;
  const statuses = searchSteps(action);
  const running = isRunning(action);
  const steps = SEARCH_STEPS.map((id) => ({ id, title: t(`onboardingSearch.steps.${id}`), status: statuses[id] }));
  return (
    <div className="en-ce-moment-followed">
      <Stepper steps={steps} label={t("onboardingSearch.stepsLabel")} />
      <Stats label={t("onboardingSearch.countersLabel")}>
        <Stat label={t("onboardingSearch.counters.sources")} value={sources.length > 0 ? t("onboardingSearch.counters.outOf", { count: consulted, total: sources.length }) : String(consulted)} />
        <Stat label={t("onboardingSearch.counters.pages")} value={String(measured?.pagesRead ?? 0)} />
        <Stat label={t("onboardingSearch.counters.analysed")} value={String(measured?.offersAnalysed ?? 0)} />
        <Stat label={t("onboardingSearch.counters.matching")} value={String(followed.matching)} />
      </Stats>
      {sources.length > 0 ? (
        <ul className="ai-activity-list" aria-label={t("onboardingSearch.sourcesLabel")}>
          {sources.map(({ source, state }) => (
            <li key={source}>
              <Status tone={SOURCE_TONE[state]}>
                {t(`onboardingSearch.sources.${source}`)} · {t(`onboardingSearch.sourceStates.${state}`)}
              </Status>
            </li>
          ))}
        </ul>
      ) : null}
      {followed.refining.length > 0 ? (
        <p className="en-ce-moment-refined">
          {t("onboardingSearch.refined")}{" "}
          {followed.refining.map((item) => (item.assumed ? `${item.text} (${t("onboardingSearch.assumed")})` : item.text)).join(" · ")}
        </p>
      ) : null}
      {running && followed.best.length > 0 ? <BestOffers offers={followed.best} label={t("onboardingSearch.bestSoFar")} /> : null}
      {running ? <p className="ai-activity-meta">{t("onboardingSearch.running")}</p> : null}
    </div>
  );
}
