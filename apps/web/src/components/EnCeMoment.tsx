"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useMemo, useState } from "react";
import type { ParseKeys } from "i18next";
import { useTranslation } from "react-i18next";
import { formatDuration, formatTimeOfDay } from "@jobhub/shared";
import { enCeMoment, type NowItem } from "@/ai-activity/en-ce-moment";
import type { LiveAction, LiveStep } from "@/ai-activity/live";
import { ActivityGlyph } from "@/components/ActivityGlyph";
import { StopButton } from "@/components/AiActivity";
import { useAiActivityLive } from "@/components/AiActivityLive";
import { Icons } from "@/components/icons";

type Language = "fr" | "en";

const NO_ACTIONS: readonly LiveAction[] = [];

/** Now, every second while an action runs: its time so far. */
function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);
  return now;
}

/**
 * « En ce moment » (CONTEXT.md, ADR-0086, #806): the top of Activity, under the Context bar, in an object's Fiche or the
 * Activité column. The Candidate's AI actions under way on this page, then « En cours ailleurs » with a link to their page;
 * each with its live glyph, its step in words, the steps it finished, its time so far and its stop icon; a Coach reply
 * with its tool steps (#788). « Rien ne tourne sur cette page. » with none here. Stopped or failed, an action stays in light
 * red, in words, with its Failure Reason (#367); finished, it leaves, AI Activity's live region saying so as before. Shown,
 * never read out step by step. Reads AI Activity's live actions (useAiActivityLive), no state of its own.
 */
export function EnCeMoment() {
  const { t } = useTranslation();
  const store = useAiActivityLive();
  const pathname = usePathname();
  const titleId = useId();
  const actions = store?.actions ?? NO_ACTIONS;
  const ticking = actions.some((action) => action.status === "running" || action.status === "stopping");
  const now = useNow(ticking);
  const view = useMemo(() => enCeMoment(actions, pathname, now), [actions, pathname, now]);
  const stop = (key: string) => store?.stop(key);
  const running = [...view.here, ...view.elsewhere].some((item) => item.live);
  return (
    <section className="en-ce-moment" data-running={running || undefined} aria-labelledby={titleId}>
      <h4 id={titleId} className="en-ce-moment-title">
        {t("aiActivity.live.now")}
      </h4>
      {view.here.length === 0 ? <p className="en-ce-moment-nothing">{t("aiActivity.live.nothing")}</p> : null}
      {view.here.map((item) => (
        <NowAction key={item.action.key} item={item} elsewhere={false} stop={stop} now={now} />
      ))}
      {view.elsewhere.length > 0 ? <Elsewhere items={view.elsewhere} stop={stop} now={now} /> : null}
    </section>
  );
}

function Elsewhere({ items, stop, now }: { items: NowItem[]; stop: (key: string) => void; now: number }) {
  const { t } = useTranslation();
  const titleId = useId();
  return (
    <section className="ai-activity-elsewhere" aria-labelledby={titleId}>
      <h5 id={titleId}>{t("aiActivity.live.elsewhere")}</h5>
      {items.map((item) => (
        <NowAction key={item.action.key} item={item} elsewhere stop={stop} now={now} />
      ))}
    </section>
  );
}

function useLanguage(): Language {
  const { i18n } = useTranslation();
  return i18n.language === "en" ? "en" : "fr";
}

/**
 * One action: its glyph, live while it runs; its kind (and its Profile); what it is doing in words (its step, « Arrêt en
 * cours… », or when it stopped or failed and during which step); « 3 étapes finies · 12 s »; a failed one's reason; its
 * tool steps, each ticked once done or a small accent dot while under way; elsewhere, a link to its page; while it runs,
 * its stop icon.
 */
function NowAction({ item, elsewhere, stop, now }: { item: NowItem; elsewhere: boolean; stop: (key: string) => void; now: number }) {
  const { t } = useTranslation();
  const language = useLanguage();
  const titleId = useId();
  const { action } = item;
  const title = action.name ? `${t(`aiActivity.kinds.${action.kind}`)} · ${action.name}` : t(`aiActivity.kinds.${action.kind}`);
  return (
    <article className="ai-activity-live en-ce-moment-action" data-status={action.status} aria-labelledby={titleId}>
      <ActivityGlyph activity={item.activity} label={item.label} step={item.step} live={item.live} />
      <div className="en-ce-moment-words">
        <p id={titleId} className="ai-activity-live-title">
          {title}
        </p>
        <p className="ai-activity-live-status">
          <StatusWords action={action} now={now} />
        </p>
        <p className="ai-activity-meta">
          {t("aiActivity.live.finished", { count: item.finished })} · {formatDuration(item.ms, language)}
        </p>
        {action.status === "failed" ? (
          <p className="ai-activity-live-reason">{action.failure?.reason ? t(action.failure.reason as ParseKeys) : t("aiActivity.live.unknownReason")}</p>
        ) : null}
        {item.toolSteps.length > 0 ? (
          <ul className="ai-activity-live-steps" aria-label={t("aiActivity.live.steps")}>
            {item.toolSteps.map((step) => (
              <ToolStep key={step.id} step={step} />
            ))}
          </ul>
        ) : null}
        {elsewhere ? (
          <Link className="ai-activity-live-link" href={action.href}>
            {t(`aiActivity.live.open.${action.kind}`)}
          </Link>
        ) : null}
      </div>
      {item.live ? <StopButton action={action} stop={stop} /> : null}
    </article>
  );
}

/** What it is doing, in words: its step (« Démarrage » before the first), « Arrêt en cours… », or when it stopped or failed. */
function StatusWords({ action, now }: { action: LiveAction; now: number }) {
  const { t } = useTranslation();
  const language = useLanguage();
  const at = action.endedAt ? formatTimeOfDay(new Date(action.endedAt), new Date(now), language) : "";
  if (action.status === "stopping") return t("aiActivity.live.stopping");
  if (action.status === "stopped") return t("aiActivity.live.stopped", { time: at });
  if (action.status === "failed") {
    return action.failure?.step ? t("aiActivity.live.failedStep", { time: at, step: t(`aiActivity.steps.${action.failure.step}`) }) : t("aiActivity.live.failed", { time: at });
  }
  return action.current ? t(`aiActivity.steps.${action.current.label}`) : t("aiActivity.live.starting");
}

/** A tool step (#788): ticked once done, a small accent dot while under way; its label, then its Tool; stopped or failed, said. */
function ToolStep({ step }: { step: LiveStep }) {
  const { t } = useTranslation();
  const ended = !step.running;
  const cut = step.outcome === "stopped" || step.outcome === "failed";
  const words = [t(`aiActivity.steps.${step.label}`) + (ended ? "" : "…"), ended ? step.tool : null].filter((part) => part).join(" · ");
  return (
    <li className="ai-activity-live-step" data-running={step.running || undefined}>
      {!ended ? (
        <span className="coach-panel-step-dot" aria-hidden />
      ) : cut ? (
        <span className="coach-panel-step-done" aria-hidden />
      ) : (
        <span className="coach-panel-step-done" aria-hidden>
          <Icons.done />
        </span>
      )}
      {words}
      {cut ? ` · ${t(step.outcome === "stopped" ? "aiActivity.live.stepStopped" : "aiActivity.live.stepFailed")}` : null}
    </li>
  );
}
