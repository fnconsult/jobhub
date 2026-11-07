"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
import { toolById, type Activity, type Provenance } from "@jobhub/shared";
import { ActivityGlyph } from "@/components/ActivityGlyph";
import { consultedElements, liveLines, type ConsultedElement, type LiveReply, type LiveSeen, type LiveStep } from "@/components/coach-tool-steps";
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
            {lineText(line, plain(t))}
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
export function CoachToolsConsulted({ provenance, names = {} }: { provenance: Provenance | null; names?: Readonly<Record<string, string>> }) {
  const { t } = useTranslation();
  const elements = consultedElements(provenance, names);
  if (elements.length === 0) return null;
  return (
    <details className="coach-tools-consulted">
      <summary>
        <ActivityGlyph activity={COACH_ACTION} />
        {t("coachPanel.consulted.summary", { count: elements.length })}
      </summary>
      <ul>
        {elements.map((element, index) => (
          <li key={`${element.kind}-${index}`}>
            <span className="coach-tools-consulted-done" aria-hidden>
              <Icons.done />
            </span>
            <ConsultedLabel element={element} />
          </li>
        ))}
      </ul>
    </details>
  );
}

/** `t` over keys built from a Coach Action's name or a kind (#788): a string, as react-i18next's types cannot follow them. */
type T = (key: string, options?: Record<string, unknown>) => string;
const plain = (t: ReturnType<typeof useTranslation>["t"]) => t as unknown as T;

/**
 * A Coach Action's line (#788): its own label (« Ouvre la candidature »), then what it saw once it ended (« Airbus ·
 * Contrôleuse de gestion », « 12 candidatures »), « … » while under way; any other step, its step label alone.
 */
function lineText(line: LiveStep, t: T): string {
  const fallback = t(`aiActivity.steps.${line.label}`);
  if (!line.tool) return fallback;
  // A Coach Action of the shipped catalogue has its own label; any other (an Eval Run's, the e2e suite's) the step's.
  const own = t(`coachPanel.seen.steps.${line.action ?? ""}`, { defaultValue: fallback });
  const label = line.action && line.label !== "propose" ? own : fallback;
  if (!line.ended) return `${label}…`;
  const seen = line.seen.map((object) => seenText(object, t));
  return `${label} · ${seen.length > 0 ? seen.join(" · ") : (toolById(line.tool)?.name ?? "")}`;
}

/** An object a Coach Action saw: its name, else its kind; a list, how many it held. */
function seenText(object: LiveSeen, t: T): string {
  if (object.count !== undefined) return t(`coachPanel.seen.count.${object.type}`, { count: object.count });
  return object.name ?? t(`coachPanel.seen.types.${object.type}`);
}

/** One element of « Le coach a consulté… »: an object by its name (or kind), linked to its page; a list by its count. */
export function ConsultedLabel({ element }: { element: ConsultedElement }) {
  const t = plain(useTranslation().t);
  switch (element.kind) {
    case "object": {
      const label = element.name ?? (element.page ? t(`coachPanel.consulted.pages.${element.page}`) : t(`coachPanel.seen.types.${element.type}`));
      return element.href ? <Link href={element.href}>{label}</Link> : <>{label}</>;
    }
    case "count":
      return <>{t(`coachPanel.seen.count.${element.type}`, { count: element.count })}</>;
    case "page":
      return <Link href={element.href}>{t(`coachPanel.consulted.pages.${element.page}`)}</Link>;
    case "tool":
      return <>{toolById(element.tool)?.name ?? element.tool}</>;
  }
}
