/**
 * The ProvenanceRecorder (ADR-0034, #319 §3–4): the steps of one AI action, as they run and as they are stored
 * in its result's Provenance. It wraps the AI layer, the way Job discovery's `costing` wrapper does, and times
 * the Tools and rules the action calls.
 *
 *   const recorder = createProvenanceRecorder(ai, { onEvent });   // the action starts
 *   await recorder.ai.generate({ task: "writing", ... });          // an AI step, its task's Activity
 *   await recorder.aiFor("read_job_page").generate({ ... });       // a feature step's own Activity
 *   await recorder.step({ tool: "france-travail" }, () => ...);    // a Tool call, timed
 *   await recorder.step({ rule: "match_score" }, () => ...);       // rules, timed
 *   recorder.site(offer.sourceUrl);                                 // a Provenance site, through the link filter
 *   row.provenance = recorder.provenance();                        // what is stored, with the wall-clock time
 *
 * Each call emits `step_started` and `step_ended` to `onEvent`, unfolded; the stored Provenance folds repeated
 * calls per Activity, AI task, Tool or rule, provider, endpoint, model and Outcome into one step with a count,
 * their tokens and durations summed, so a Job Search stays a few dozen steps. A step that fails or is stopped is
 * recorded so, and its error rethrown. A sink that throws never stops the action.
 */
import {
  failureOf,
  provenanceLink,
  siteDomainOf,
  storableProvenance,
  type Activity,
  type Provenance,
  type ProvenanceEvent,
  type ProvenanceRule,
  type ProvenanceSite,
  type ProvenanceStep,
  type StartedStep,
  type StepOutcome,
} from "@jobhub/shared";
import { activityOf, FEATURE_STEPS, type FeatureStep, type StepTool } from "./activity";
import type { AiLayer, GenerateResult, SearchResult } from "./ai-layer";
import type { TextTask } from "./types";

export interface ProvenanceRecorderOptions {
  /** Where each step's start and end go, as they happen: the action's response stream, or its run row. */
  onEvent?: (event: ProvenanceEvent) => void;
  /** Default: the system clock. The action starts when the recorder is made. */
  now?: () => Date;
}

export interface ProvenanceRecorder {
  /** The AI layer, each of its calls a step with its AI task's Activity. */
  readonly ai: AiLayer;
  /** The AI layer, each of its calls a step with this feature step's Activity. */
  aiFor(featureStep: FeatureStep): AiLayer;
  /** Runs a Tool call or rules as one step, timed; returns what `run` returns, or rethrows. */
  step<T>(subject: { tool: StepTool } | { rule: ProvenanceRule }, run: () => T | Promise<T>): Promise<T>;
  /** Adds a page the result was built from to its Provenance sites; a link the link filter refuses is left out. */
  site(link: string): void;
  /** The Provenance so far, as it may be stored: steps folded, the wall-clock time until now. */
  provenance(): Provenance;
}

type Subject = { kind: "ai"; task: TextTask | "web_search" } | { kind: "tool"; tool: StepTool } | { kind: "rules"; rule: ProvenanceRule };

/** What an AI call that worked says of itself. */
type CallFacts = Pick<GenerateResult | SearchResult, "provider" | "endpoint" | "model" | "usage" | "durationMs" | "outcome">;

export function createProvenanceRecorder(ai: AiLayer, options: ProvenanceRecorderOptions = {}): ProvenanceRecorder {
  const now = options.now ?? (() => new Date());
  const startedAt = now();
  const steps: ProvenanceStep[] = [];
  const sites: ProvenanceSite[] = [];
  let lastId = 0;

  const emit = (event: ProvenanceEvent) => {
    try {
      options.onEvent?.(event);
    } catch {
      // The live view is a convenience: the action goes on without it.
    }
  };

  /** Runs one step: its start and end emitted, the ended step kept. `ended` builds it from what `run` returned. */
  async function record<T>(subject: Subject, activity: Activity, run: () => T | Promise<T>, ended: (value: T) => Partial<ProvenanceStep>, signal?: AbortSignal): Promise<T> {
    const id = ++lastId;
    const start = now();
    const started = { ...subject, activity, at: start.toISOString() } as StartedStep;
    emit({ type: "step_started", id, step: started });
    const end = (outcome: StepOutcome, facts: Partial<ProvenanceStep> = {}) => {
      const step = { ...started, ms: Math.max(0, now().getTime() - start.getTime()), outcome, count: 1, ...facts } as ProvenanceStep;
      steps.push(step);
      emit({ type: "step_ended", id, step });
    };
    let value: T;
    try {
      value = await run();
    } catch (error) {
      end(signal?.aborted || failureOf(error).reason === "stopped" ? "stopped" : "failed");
      throw error;
    }
    end("ok", ended(value));
    return value;
  }

  /** An AI call's facts, as its step keeps them: input counts the cached input. */
  const callStep = (call: CallFacts): Partial<ProvenanceStep> => ({
    provider: call.provider,
    endpoint: call.endpoint,
    model: call.model,
    tokens: { input: call.usage.inputTokens + (call.usage.cachedInputTokens ?? 0), output: call.usage.outputTokens },
    ms: Math.round(call.durationMs),
    outcome: call.outcome,
  });
  /** A call that returns a call that may have failed (null) instead of throwing. */
  const maybeCall = (call: CallFacts | null): Partial<ProvenanceStep> => (call ? callStep(call) : { outcome: "failed" });

  function layer(activity?: Activity): AiLayer {
    const as = (task: TextTask | "web_search") => activity ?? activityOf({ kind: "ai", task });
    return {
      generate: (request) => record({ kind: "ai", task: request.task }, as(request.task), () => ai.generate(request), callStep, request.signal),
      planJobSearch: (request) => record({ kind: "ai", task: "job_titles" }, as("job_titles"), () => ai.planJobSearch(request), (plan) => maybeCall(plan.call)),
      searchWeb: (request) => record({ kind: "ai", task: "web_search" }, as("web_search"), () => ai.searchWeb(request), callStep, request.signal),
      searchCompany: (request) => record({ kind: "ai", task: "web_search" }, as("web_search"), () => ai.searchCompany(request), callStep, request.signal),
      searchCompanyNews: async (request) => (await recordedNews(request)).articles,
      searchCompanyNewsWithCall: (request) => recordedNews(request),
      agentModels: () => ai.agentModels(),
      searchModels: () => ai.searchModels(),
      // An Eval Run's calls are no Candidate's content: nothing to keep.
      forEval: () => ai.forEval(),
    };
    function recordedNews(request: Parameters<AiLayer["searchCompanyNewsWithCall"]>[0]) {
      return record({ kind: "ai", task: "web_search" }, as("web_search"), () => ai.searchCompanyNewsWithCall(request), (news) => maybeCall(news.call), request.signal);
    }
  }

  return {
    ai: layer(),
    aiFor: (featureStep) => layer(FEATURE_STEPS[featureStep]),
    step(subject, run) {
      const kind: Subject = "tool" in subject ? { kind: "tool", tool: subject.tool } : { kind: "rules", rule: subject.rule };
      return record(kind, activityOf(kind), run, () => ({}));
    },
    site(link) {
      const kept = provenanceLink(link);
      if (!kept) return;
      const site = kept.startsWith("/") ? siteOf(sites, { kind: "candidate", links: [] }) : siteOf(sites, { kind: "web", domain: siteDomainOf(kept), links: [] });
      if (!site.links.includes(kept)) site.links.push(kept);
    },
    provenance: () =>
      storableProvenance({ v: 1, steps: folded(steps), sites: structuredClone(sites), startedAt: startedAt.toISOString(), wallMs: Math.max(0, now().getTime() - startedAt.getTime()) }),
  };
}

/** The site already listed that `site` is (the Candidate's, or the same domain), else `site`, added. */
function siteOf(sites: ProvenanceSite[], site: ProvenanceSite): ProvenanceSite {
  const listed = sites.find((other) => other.kind === site.kind && (other.kind === "candidate" || (site.kind === "web" && other.domain === site.domain)));
  if (listed) return listed;
  sites.push(site);
  return site;
}

/** What a step is, for folding: two calls alike in all of it are one step. */
function foldKey(step: ProvenanceStep): string {
  const what = step.kind === "ai" ? [step.task, step.provider, step.endpoint, step.model] : [step.kind === "tool" ? step.tool : step.rule];
  return JSON.stringify([step.kind, step.activity, step.outcome, ...what]);
}

/** Repeated calls folded into one step each, in the order of their first: count, tokens and ms summed, the first start kept. */
function folded(steps: readonly ProvenanceStep[]): ProvenanceStep[] {
  const byKey = new Map<string, ProvenanceStep>();
  for (const step of steps) {
    const key = foldKey(step);
    const into = byKey.get(key);
    if (!into) {
      byKey.set(key, structuredClone(step));
      continue;
    }
    into.count += step.count;
    into.ms += step.ms;
    if (into.kind === "ai" && step.kind === "ai" && step.tokens) {
      into.tokens = { input: (into.tokens?.input ?? 0) + step.tokens.input, output: (into.tokens?.output ?? 0) + step.tokens.output };
    }
  }
  return [...byKey.values()];
}
