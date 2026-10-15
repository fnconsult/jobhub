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
import { createCoach, type CoachMessageCost, type PlaybookUsed } from "../index";
import type { CoachEvalCase } from "./cases";
import { judgeReply, PASS_SCORE, JUDGE_CRITERIA, type Judgment } from "./judge";
import { EVAL_CANDIDATE_ID, evalWorkspace } from "./workspace";

export { COACH_EVAL_CASES, COACH_EVAL_SET_VERSION, type CoachEvalCase } from "./cases";
export { JUDGE_CRITERIA, PASS_SCORE, type Judgment } from "./judge";

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

export interface CoachEvalModelResult {
  model: string;
  results: CoachEvalCaseResult[];
}

export interface CoachEvalReport {
  models: CoachEvalModelResult[];
  /** What the judge cost, apart from the AI Coach's own cost. */
  judge: { model: string; eur: number };
}

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
    models.push({ model, results });
  }
  return { models, judge };
}
