/**
 * The Coach eval suite: the real AI Coach (persona, Playbook table, Coach context) answers each
 * eval case on each model compared, and an AI judge scores every reply on playbook adherence,
 * figures outside the playbooks and tone for 40+ Candidates (see ./judge).
 *
 *   const report = await runCoachEval({ cases: COACH_EVAL_CASES, models: [{ model, ai }], judge, knowledge });
 *
 * Each model's `ai` routes the `coaching` task to it. Never throws for a failing reply or judge:
 * the case is recorded as an error and counts as not passed.
 */
import type { AiLayer } from "@jobhub/ai";
import type { CoachKnowledge } from "@jobhub/coach-knowledge";
import { COACH_MESSAGE_COST_TARGET_EUR } from "../../coach-conversations";
import { createCoach, type CoachMessageCost, type PlaybookUsed } from "../index";
import type { CoachEvalCase } from "./cases";
import { judgeReply, PASS_SCORE, JUDGE_CRITERIA, type Judgment } from "./judge";
import { EVAL_CANDIDATE_ID, evalWorkspace } from "./workspace";

export { COACH_EVAL_CASES, COACH_EVAL_SET_VERSION, type CoachEvalCase } from "./cases";
export { JUDGE_CRITERIA, PASS_SCORE, type Judgment } from "./judge";
export { renderCoachEvalReport, type CoachEvalRun } from "./report";

export interface CoachEvalOptions {
  cases: CoachEvalCase[];
  /** The models compared, each with an AI layer whose `coaching` task answers on it. */
  models: { model: string; ai: AiLayer }[];
  judge: AiLayer;
  /** The coaching knowledge the AI Coach is grounded in: everything, as in "eval". */
  knowledge: Pick<CoachKnowledge, "playbook" | "coreDigest">;
}

export interface CoachEvalCaseResult {
  caseId: string;
  reply?: string;
  cost?: CoachMessageCost;
  playbooks?: PlaybookUsed[];
  /** Null when the judge's answer was not a valid judgment. */
  judgment?: Judgment | null;
  /** Every criterion scored at least PASS_SCORE. */
  passed: boolean;
  /** "coach": the AI Coach gave no reply; "judge": the reply could not be judged. */
  error?: "coach" | "judge";
}

/** How one model did over the whole eval set. */
export interface CoachEvalSummary {
  cases: number;
  passed: number;
  /** Cases with no reply, or a reply the judge could not score. */
  errors: number;
  /** Mean score per criterion over the judged replies; null with none judged. */
  scores: Record<(typeof JUDGE_CRITERIA)[number], number> | null;
  /** Median and 90th percentile (interpolated) of the Coach Message Cost, in €; null with no reply. */
  medianEur: number | null;
  p90Eur: number | null;
  /** Median and p90 both at or under the Coach cost target (COACH_MESSAGE_COST_TARGET_EUR). */
  withinTarget: boolean;
}

export interface CoachEvalModelResult {
  model: string;
  results: CoachEvalCaseResult[];
  summary: CoachEvalSummary;
}

export interface CoachEvalReport {
  models: CoachEvalModelResult[];
  /** What the judge cost, apart from the AI Coach's own cost. */
  judge: { model: string; eur: number };
  /**
   * The model to make the AI Coach's default: the cheapest within the Coach cost target that passes
   * at least QUALITY_FLOOR of the cases, and within QUALITY_MARGIN of the best model's share.
   * Null when none does: a human decides.
   */
  recommended: { model: string | null; reason: string };
}

/** How far below the best model's share of passed cases a cheaper model may be and still be recommended. */
export const QUALITY_MARGIN = 0.1;

/** The least share of passed cases for a model to be recommended at all. */
export const QUALITY_FLOOR = 0.8;

export async function runCoachEval(options: CoachEvalOptions): Promise<CoachEvalReport> {
  const judge = { model: "", eur: 0 };
  const models: CoachEvalModelResult[] = [];
  for (const { model, ai } of options.models) {
    const results: CoachEvalCaseResult[] = [];
    for (const evalCase of options.cases) {
      const { sources, focus } = evalWorkspace(evalCase);
      const coach = createCoach({ ai, knowledge: options.knowledge, ...sources });
      const reply = await coach.reply(EVAL_CANDIDATE_ID, { messages: evalCase.messages, ...(focus ? { focus } : {}) });
      if (!reply.ok) {
        results.push({ caseId: evalCase.id, passed: false, error: "coach" });
        continue;
      }
      const replied = { caseId: evalCase.id, reply: reply.reply, cost: reply.cost, playbooks: reply.playbooks };
      const judgment = await judgeReply(options.judge, options.knowledge, evalCase, { text: reply.reply, playbooks: reply.playbooks }).then(
        (judged) => {
          judge.model = judged.model;
          judge.eur += judged.eur;
          return judged.judgment;
        },
        (error: unknown) => {
          console.warn(`[coach-evals] the judge failed on ${evalCase.id}:`, error instanceof Error ? error.message : error);
          return null;
        },
      );
      if (!judgment) {
        results.push({ ...replied, judgment: null, passed: false, error: "judge" });
        continue;
      }
      const passed = JUDGE_CRITERIA.every((criterion) => judgment[criterion].score >= PASS_SCORE);
      results.push({ ...replied, judgment, passed });
    }
    models.push({ model, results, summary: summarize(results) });
  }
  return { models, judge, recommended: recommend(models) };
}

/** The p-th percentile of `values`, interpolated between the closest ranks (as Postgres' percentile_cont). */
function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (sorted.length - 1) * p;
  const below = Math.floor(rank);
  return sorted[below]! + (sorted[Math.ceil(rank)]! - sorted[below]!) * (rank - below);
}

function summarize(results: CoachEvalCaseResult[]): CoachEvalSummary {
  const judged = results.flatMap((result) => (result.judgment ? [result.judgment] : []));
  const costs = results.flatMap((result) => (result.cost ? [result.cost.eur] : []));
  const mean = (criterion: (typeof JUDGE_CRITERIA)[number]) => judged.reduce((sum, judgment) => sum + judgment[criterion].score, 0) / judged.length;
  const medianEur = percentile(costs, 0.5);
  const p90Eur = percentile(costs, 0.9);
  return {
    cases: results.length,
    passed: results.filter((result) => result.passed).length,
    errors: results.filter((result) => result.error).length,
    scores: judged.length > 0 ? (Object.fromEntries(JUDGE_CRITERIA.map((criterion) => [criterion, mean(criterion)])) as CoachEvalSummary["scores"]) : null,
    medianEur,
    p90Eur,
    withinTarget: p90Eur !== null && medianEur! <= COACH_MESSAGE_COST_TARGET_EUR && p90Eur <= COACH_MESSAGE_COST_TARGET_EUR,
  };
}

function recommend(models: CoachEvalModelResult[]): CoachEvalReport["recommended"] {
  const share = ({ summary }: CoachEvalModelResult) => (summary.cases === 0 ? 0 : summary.passed / summary.cases);
  const best = Math.max(0, ...models.map(share));
  const bar = Math.max(QUALITY_FLOOR, best - QUALITY_MARGIN);
  const [cheapest] = models
    .filter((model) => model.summary.withinTarget && share(model) >= bar)
    .sort((a, b) => a.summary.medianEur! - b.summary.medianEur!);
  const percent = (value: number) => `${Math.round(value * 100)}%`;
  if (!cheapest) {
    return {
      model: null,
      reason: `No model is both within the Coach cost target (€${COACH_MESSAGE_COST_TARGET_EUR} median and p90) and passing ${percent(bar)} of cases or more (at least ${percent(QUALITY_FLOOR)}, and within ${percent(QUALITY_MARGIN)} of the best: ${percent(best)}).`,
    };
  }
  return {
    model: cheapest.model,
    reason: `The cheapest model within the Coach cost target (€${COACH_MESSAGE_COST_TARGET_EUR} median and p90) that passes ${percent(share(cheapest))} of cases (at least ${percent(QUALITY_FLOOR)}, and within ${percent(QUALITY_MARGIN)} of the best: ${percent(best)}).`,
  };
}
