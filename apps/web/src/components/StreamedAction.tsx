"use client";

import type { Activity, ProvenanceEvent, ProvenanceStep, StartedStep, StepLabel } from "@jobhub/shared";
import { usePathname } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { LiveKind } from "@/ai-activity/live";
import { ActivityGlyph } from "@/components/ActivityGlyph";
import { useAiActivityLive, type InRequestLive } from "@/components/AiActivityLive";
import { readNdjson } from "@/ndjson";

/**
 * An AI action a page runs in its own request (#335, ADR-0034): a Company Dossier built, a CV read. Its route streams
 * its steps (see actionResponse); they show here, beside « Arrêter », and in AI Activity, which follows them on every
 * page and can stop them too. A Stop aborts the request; what the route kept then is its business. No confirmation.
 *
 *   const action = useStreamedAction("company_dossier");
 *   const outcome = await action.run(url, { method: "POST" });   // what the route answered, or that it was stopped
 *   <StreamedActionStatus action={action} />                      // the step under way and « Arrêter »
 */

/** How the action ended: what it made, its failure (the route's status and body), or the Candidate's Stop (with what the route said of it, if it could). */
export type StreamedOutcome =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; stopped: true; at: Date; body: Record<string, unknown> }
  | { ok: false; stopped?: false; status: number; body: Record<string, unknown> };

/** What an AI action's route streams. */
type StreamedEvent =
  | { type: "step_started"; id: number; step: StartedStep; label: StepLabel }
  | { type: "step_ended"; id: number; step: ProvenanceStep }
  | { type: "done" | "stopped"; [field: string]: unknown }
  | { type: "failed"; status: number; [field: string]: unknown };

/** An ending event's fields, as the route's JSON body has them. */
const fieldsOf = (event: object): Record<string, unknown> => Object.fromEntries(Object.entries(event).filter(([key]) => key !== "type" && key !== "status"));

export interface StreamedAction {
  /** The step under way, once the first started; null when none runs. */
  step: { activity: Activity; label: StepLabel } | null;
  /** The action runs. */
  running: boolean;
  /** Sends the request to an AI action's route, its steps live; never throws. */
  run(url: string, init: { method: "POST" | "PUT"; body?: BodyInit; json?: object }): Promise<StreamedOutcome>;
  /** The Candidate's Stop. */
  stop(): void;
}

export function useStreamedAction(kind: Exclude<LiveKind, "job_search" | "coach_reply">): StreamedAction {
  const aiActivity = useAiActivityLive();
  const pathname = usePathname();
  const [step, setStep] = useState<StreamedAction["step"]>(null);
  const [running, setRunning] = useState(false);
  const stopper = useRef<AbortController | null>(null);

  const run = useCallback(
    async (url: string, init: { method: "POST" | "PUT"; body?: BodyInit; json?: object }): Promise<StreamedOutcome> => {
      const stop = new AbortController();
      stopper.current = stop;
      setRunning(true);
      setStep(null);
      const live: InRequestLive | null = aiActivity ? aiActivity.start(kind, pathname, () => stop.abort()) : null;
      const stopped = (body: Record<string, unknown> = {}): StreamedOutcome => {
        live?.end("stopped");
        return { ok: false, stopped: true, at: new Date(), body };
      };
      try {
        const response = await fetch(url, {
          method: init.method,
          headers: { accept: "application/x-ndjson", ...(init.json ? { "content-type": "application/json" } : {}) },
          body: init.json ? JSON.stringify(init.json) : init.body,
          signal: stop.signal,
        });
        if (!response.ok || !response.body || !response.headers.get("content-type")?.startsWith("application/x-ndjson")) {
          live?.end("failed");
          return { ok: false, status: response.status, body: await response.json().catch(() => ({})) };
        }
        let outcome: StreamedOutcome | null = null;
        await readNdjson(response.body, (received) => {
          const event = received as StreamedEvent;
          if (event.type === "step_started") {
            setStep({ activity: event.step.activity, label: event.label });
            live?.event({ type: "step_started", id: event.id, step: event.step } as ProvenanceEvent);
          } else if (event.type === "step_ended") {
            live?.event({ type: "step_ended", id: event.id, step: event.step });
          } else if (event.type === "done") {
            live?.end("done");
            outcome = { ok: true, body: fieldsOf(event) };
          } else if (event.type === "stopped") {
            outcome = stopped(fieldsOf(event));
          } else {
            live?.end("failed");
            outcome = { ok: false, status: Number(event.status), body: fieldsOf(event) };
          }
        });
        if (!outcome) throw new Error("the action was cut short");
        return outcome;
      } catch {
        if (stop.signal.aborted) return stopped();
        live?.end("failed");
        return { ok: false, status: 0, body: {} };
      } finally {
        stopper.current = null;
        setRunning(false);
        setStep(null);
      }
    },
    [aiActivity, kind, pathname],
  );

  const stop = useCallback(() => stopper.current?.abort(), []);

  return { step, running, run, stop };
}

/**
 * The action under way: its step's glyph and label, and « Arrêter » (named for what it stops). The step is shown, not read
 * out: AI Activity's live region says when it starts and ends.
 */
export function StreamedActionStatus({ action, stopLabel }: { action: StreamedAction; stopLabel: string }) {
  const { t } = useTranslation();
  if (!action.running) return null;
  return (
    <div className="streamed-action">
      {action.step ? (
        <p className="streamed-action-step">
          <ActivityGlyph activity={action.step.activity} live />
          {t(`aiActivity.steps.${action.step.label}`)}
        </p>
      ) : null}
      <button className="button" type="button" onClick={action.stop} aria-label={stopLabel}>
        {t("aiActivity.stop")}
      </button>
    </div>
  );
}
