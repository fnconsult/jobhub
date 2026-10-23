/**
 * A run's progress (ADR-0034, #319 §4): the live steps of an AI action that runs outside the web request (a Job
 * Search, in the worker), written on its row after each step starts and ends, and read by the page that polls it.
 * Its events are the same as the web streams': each step's latest, `step_ended` in place of its `step_started`.
 *
 *   const progress = createRunProgress((events) => jobSearches.progress(id, events));
 *   createProvenanceRecorder(ai, { onEvent: progress.onEvent });   // each step written as it starts and ends
 *   await progress.flush();                                        // the last write landed, before the outcome
 *   readRunProgress(row.progress)                                  // the events, for the page
 *
 * One write at a time: what comes while one is on its way is written once after it, with the latest steps.
 * A write that fails is skipped; the run never stops for its progress.
 */
import { readProvenanceEvent, type ProvenanceEvent } from "./provenance";

/** The most events a run's progress keeps: the steps still running, and the latest ended ones. */
export const MAX_PROGRESS_EVENTS = 200;

export interface RunProgress {
  /** Takes a step's start or end: a ProvenanceRecorder's sink. Never throws. */
  onEvent(event: ProvenanceEvent): void;
  /** Resolves once every event taken so far is written (or its write failed). */
  flush(): Promise<void>;
}

export function createRunProgress(write: (events: ProvenanceEvent[]) => Promise<void>): RunProgress {
  let events: ProvenanceEvent[] = [];
  /** The write on its way, if any. */
  let writing: Promise<void> | null = null;
  /** Events came since the write on its way took its copy. */
  let dirty = false;

  function writeNow() {
    dirty = false;
    const copy = [...events];
    writing = write(copy)
      .catch((error: unknown) => {
        console.warn("[run-progress] could not write a run's progress:", error instanceof Error ? error.message : error);
      })
      .then(() => {
        writing = null;
        if (dirty) writeNow();
      });
  }

  return {
    onEvent(event) {
      const index = event.type === "step_ended" ? events.findIndex((other) => other.id === event.id) : -1;
      if (index >= 0) events[index] = event;
      else events.push(event);
      events = kept(events);
      if (writing) dirty = true;
      else writeNow();
    },
    async flush() {
      while (writing) await writing;
    },
  };
}

/** The steps running, and the latest ended ones, in order: at most MAX_PROGRESS_EVENTS. */
function kept(events: ProvenanceEvent[]): ProvenanceEvent[] {
  let over = events.length - MAX_PROGRESS_EVENTS;
  if (over <= 0) return events;
  return events.filter((event) => !(event.type === "step_ended" && over-- > 0));
}

/** The progress stored on a run's row: its events, leaving out any that is not a step's; none when nothing was written. */
export function readRunProgress(stored: unknown): ProvenanceEvent[] {
  if (!Array.isArray(stored)) return [];
  return stored.flatMap((event) => readProvenanceEvent(event) ?? []);
}
