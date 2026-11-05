"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
import { toolById, type Activity, type Provenance } from "@jobhub/shared";
import { ActivityGlyph } from "@/components/ActivityGlyph";
import { consultedElements, liveLines, type LiveReply } from "@/components/coach-tool-steps";
import { Icons } from "@/components/icons";

/** A Coach Action's Activity: its glyph, the toolbox. */
const COACH_ACTION = "act" satisfies Activity;

/**
 * A reply on its way, at the place it will take (#788, variante A): one glyph on the left, morphing from step to step
 * (the toolbox for a Coach Action, then the brain and the feather as the reply is written), and a line for each Coach
 * Action, its label and the Tool it reads (« Consulte vos données · Candidatures »), ticked once done, a small accent dot
 * while under way; the reply being written last. Shown, never read out: the page announces the start and the reply.
 */
export function CoachLiveSteps({ live }: { live: LiveReply }) {
  const { t } = useTranslation();
  const { lines, current } = liveLines(live);
  if (!current) return null;
  return (
    <div className="coach-panel-live">
      <ActivityGlyph activity={current.activity} label={current.label} step={current.id} live />
      <ul className="coach-panel-steps">
        {lines.map((line) => (
          <li key={line.id} className="coach-panel-step" data-ended={line.ended || undefined}>
            {line.ended ? (
              <span className="coach-panel-step-done" aria-hidden>
                <Icons.done />
              </span>
            ) : (
              <span className="coach-panel-step-dot" aria-hidden />
            )}
            {t(`aiActivity.steps.${line.label}`)}
            {line.tool ? ` · ${toolById(line.tool)?.name ?? ""}` : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * « Le coach a consulté N éléments de Jobbbox » under a reply whose AI Coach used Coach Actions (#788), with the toolbox's
 * small glyph: it opens on each element, ticked and linked to its page. From the reply's stored Provenance, so it stays
 * after a reload; nothing for a reply without a Coach Action.
 */
export function CoachToolsConsulted({ provenance }: { provenance: Provenance | null }) {
  const { t } = useTranslation();
  const elements = consultedElements(provenance);
  if (elements.length === 0) return null;
  return (
    <details className="coach-tools-consulted">
      <summary>
        <ActivityGlyph activity={COACH_ACTION} />
        {t("coachPanel.consulted.summary", { count: elements.length })}
      </summary>
      <ul>
        {elements.map((element, index) => (
          <li key={element.href ?? `${element.tool}-${index}`}>
            <span className="coach-tools-consulted-done" aria-hidden>
              <Icons.done />
            </span>
            {element.page !== null ? <Link href={element.href}>{t(`coachPanel.consulted.pages.${element.page}`)}</Link> : (toolById(element.tool)?.name ?? element.tool)}
          </li>
        ))}
      </ul>
    </details>
  );
}
