"use client";

import { useContext, useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AiActivityControl, StepWords, StopButton, UnderWayGlyph, useSummary } from "@/components/AiActivity";
import { useActivityColumn } from "@/components/activity-column";
import { Icons } from "@/components/icons";
import { TOP_BAR_RANK, useTopBarAction } from "@/components/top-bar";

const NO_ENTRIES: never[] = [];

/**
 * AI Activity's button, « Activité », as the compact Top Bar has it on a phone (#897): under « … », or the icon shown on a
 * page with no main action of its own, and while one of the Candidate's AI actions runs on this page (#333), back under
 * « … » when it ends. It calls the very toggle AI Activity's button calls (useActivityColumn, #809), and is named as that
 * button is: « Activité IA », then, while Activity is not shown, the page's summary or the step under way (StepWords);
 * « Activité IA » its tooltip. While an action runs, its live glyph, and its stop icon before it (StopButton, #369),
 * not while Activity is shown, which has it. Offers nothing outside AiActivityProvider or without a column, where AI
 * Activity's button renders nothing. Returns what useTopBarAction returns, for FicheButtons to render.
 */
export function useActivityTopBarAction(): ReactNode {
  const { t } = useTranslation();
  const control = useContext(AiActivityControl);
  const column = useActivityColumn();
  const summary = useSummary(control?.entries ?? NO_ENTRIES);
  const underWay = control?.live.underWay ?? null;
  const stop = control?.stop;
  const shown = column?.shown ?? false;
  const label = t("aiActivity.label");
  // Made again only when they change: the Top Bar is told of a change only then.
  const look = useMemo(() => {
    const words = shown ? null : underWay ? <StepWords action={underWay} /> : summary;
    return {
      name:
        words === null ? (
          label
        ) : (
          <>
            {label} {words}
          </>
        ),
      glyph: underWay ? <UnderWayGlyph action={underWay} /> : null,
      beside: underWay && stop && !shown ? <StopButton action={underWay} stop={stop} /> : null,
    };
  }, [underWay, stop, shown, summary, label]);
  return useTopBarAction(
    control && column
      ? {
          id: "activity",
          rank: TOP_BAR_RANK.activity,
          label: t("fiche.activity"),
          tooltip: label,
          icon: Icons.aiActivity,
          run: column.toggle,
          expanded: column.shown,
          controls: column.controls,
          running: underWay !== null,
          ...look,
        }
      : null,
  );
}
