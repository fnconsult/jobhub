"use client";

import { formatDuration, formatTimeOfDay, formatTokens, type Activity, type ProvenanceStep, type StepLabel } from "@jobhub/shared";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityGlyph } from "@/components/ActivityGlyph";
import { readNdjson } from "@/ndjson";

/**
 * An AI action a page runs in its own request (#334, ADR-0034): a Tailored CV proposed, a Cover Letter or an Outreach
 * Message drafted. Its steps show live, each with its Activity's glyph and label, beside « Arrêter »; a Stop aborts the
 * request, which aborts the AI call and keeps nothing, and the action then says « Arrêtée à 10:42 » in light red with the
 * tokens and time it had spent. No confirmation on Stop.
 *
 *   const action = useLiveAction();
 *   const outcome = await action.run<Drafts>(url, body);   // what the route answered, or { stopped: true }
 *   <LiveActionStatus action={action} />                    // the step under way and « Arrêter », or the stopped line
 */

/** How the action ended: what it made, its failure (the route's status and body), or the Candidate's Stop. */
export type LiveOutcome<T> = { ok: true; body: T } | { ok: false; status: number; body: { error?: string; errors?: unknown } } | { ok: false; stopped: true };

/** The action under way: the step it is on, and the tokens spent so far. */
type Live = { step: { activity: Activity; label: StepLabel } | null; tokens: number };

/** An action the Candidate stopped: when, and what it had spent. */
type Stopped = { at: Date; tokens: number; ms: number };

/** What an AI action's route streams (see actionResponse). */
type LiveEvent =
  | { type: "step_started"; step: { activity: Activity }; label: StepLabel }
  | { type: "step_ended"; step: ProvenanceStep }
  | { type: "done"; [field: string]: unknown }
  | { type: "stopped" }
  | { type: "failed"; status: number; error?: string; errors?: unknown };

/** An ending event's fields, as the route's JSON body would have them. */
const fieldsOf = (event: object): Record<string, unknown> => Object.fromEntries(Object.entries(event).filter(([key]) => key !== "type"));

/** The tokens a step spent: none for one stopped or failed (providers say nothing then). */
const tokensOf = (step: ProvenanceStep) => (step.kind === "ai" && step.tokens ? step.tokens.input + step.tokens.output : 0);

export interface LiveAction {
  /** The action under way, or null. */
  live: Live | null;
  /** The last action, when the Candidate stopped it; null once another starts. */
  stopped: Stopped | null;
  /** POSTs `body` to `url` (an AI action's route), its steps live; never throws. */
  run<T>(url: string, body: object): Promise<LiveOutcome<T>>;
  /** The Candidate's Stop. */
  stop(): void;
}

export function useLiveAction(): LiveAction {
  const [live, setLive] = useState<Live | null>(null);
  const [stopped, setStopped] = useState<Stopped | null>(null);
  const stopper = useRef<AbortController | null>(null);

  const run = useCallback(async <T,>(url: string, body: object): Promise<LiveOutcome<T>> => {
    const stop = new AbortController();
    stopper.current = stop;
    const startedAt = Date.now();
    let spent = 0;
    setStopped(null);
    setLive({ step: null, tokens: 0 });
    const wasStopped = (): LiveOutcome<T> => {
      setStopped({ at: new Date(), tokens: spent, ms: Date.now() - startedAt });
      return { ok: false, stopped: true };
    };
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/x-ndjson" },
        body: JSON.stringify(body),
        signal: stop.signal,
      });
      if (!response.ok || !response.body || !response.headers.get("content-type")?.startsWith("application/x-ndjson")) {
        return { ok: false, status: response.status, body: await response.json().catch(() => ({})) };
      }
      let outcome: LiveOutcome<T> | null = null;
      await readNdjson(response.body, (received) => {
        const event = received as LiveEvent;
        if (event.type === "step_started") setLive({ step: { activity: event.step.activity, label: event.label }, tokens: spent });
        else if (event.type === "step_ended") {
          spent += tokensOf(event.step);
          setLive((was) => (was ? { ...was, tokens: spent } : was));
        } else if (event.type === "done") outcome = { ok: true, body: fieldsOf(event) as T };
        else if (event.type === "stopped") outcome = wasStopped();
        else outcome = { ok: false, status: event.status, body: fieldsOf(event) };
      });
      if (!outcome) throw new Error("the action was cut short");
      return outcome;
    } catch {
      return stop.signal.aborted ? wasStopped() : { ok: false, status: 0, body: {} };
    } finally {
      stopper.current = null;
      setLive(null);
    }
  }, []);

  const stop = useCallback(() => stopper.current?.abort(), []);

  return { live, stopped, run, stop };
}

/**
 * The action under way (its step's glyph and label, the tokens spent, « Arrêter »), or « Arrêtée à 10:42 » in light red
 * with the tokens and time it had spent. The step is shown, not read out: the button that started it says it is under way,
 * and the Stop is announced.
 */
export function LiveActionStatus({ action }: { action: LiveAction }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language === "en" ? "en" : "fr";
  const { live, stopped } = action;
  if (live) {
    return (
      <div className="live-action">
        {live.step ? (
          <p className="live-action-step">
            <ActivityGlyph activity={live.step.activity} />
            {t(`aiActivity.steps.${live.step.label}`)}
          </p>
        ) : null}
        <button className="button" type="button" onClick={action.stop}>
          {t("aiActivity.stop")}
        </button>
      </div>
    );
  }
  if (!stopped) return null;
  return (
    <p className="live-action-stopped" role="status">
      {t("aiActivity.stoppedAt", { time: formatTimeOfDay(stopped.at, new Date(), language) })}
      <span className="live-action-spent">
        {" · "}
        {formatTokens(stopped.tokens, language)}
        <span className="visually-hidden"> {t("provenanceLine.tokens")}</span>
        {" · "}
        {formatDuration(stopped.ms, language)}
      </span>
    </p>
  );
}
