// Runs the Coach eval suite (#131): the real AI Coach answers every eval case on each model, an AI judge
// scores each reply, and the run is written to docs/research/coach-evals/<date>.md and .json.
// Usage: npm run coach:eval [-- --models claude-opus-5-5,claude-sonnet-5-5 --judge claude-opus-5-5
//   --cases age-worry,statistic-trap --out <folder>]
// Reads the AI layer's configuration from the repo's .env (ANTHROPIC_ENDPOINT and its credentials):
// every model runs on Anthropic, Bedrock eu-west-3 by default. AI_FAKE=true runs it offline (smoke test).
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { createAiLayerFromEnv, type AiLayer } from "@jobhub/ai";
import { loadCoachKnowledge } from "@jobhub/coach-knowledge";
import { COACH_EVAL_CASES, COACH_EVAL_SET_VERSION, renderCoachEvalReport, runCoachEval } from "../src/coach/evals/index";

const repoRoot = path.resolve(import.meta.dirname, "../../..");

const { values } = parseArgs({
  options: {
    models: { type: "string", default: "claude-opus-5-5,claude-sonnet-5-5" },
    judge: { type: "string", default: "claude-opus-5-5" },
    cases: { type: "string" },
    out: { type: "string", default: path.join(repoRoot, "docs/research/coach-evals") },
  },
});

// The suite never searches the web, but the AI layer builds the web search provider at start-up:
// without its key (e.g. in CI), a placeholder that is never sent.
const env: Record<string, string | undefined> = { ...process.env, PERPLEXITY_API_KEY: process.env.PERPLEXITY_API_KEY || "unused-by-coach-eval" };
/** Bedrock (the default endpoint) names Claude models with an "anthropic." prefix. */
const endpointModel = (model: string) => ((env.ANTHROPIC_ENDPOINT?.trim() || "bedrock") === "bedrock" && !model.startsWith("anthropic.") ? `anthropic.${model}` : model);
/** An AI layer whose `coaching` task answers on `model`; usage is not logged (no Candidate). */
const aiOn = (model: string): AiLayer =>
  createAiLayerFromEnv({ ...env, AI_COACHING_PROVIDER: "anthropic", AI_COACHING_MODEL: endpointModel(model) }, { usage: { record() {} } });

const only = values.cases?.split(",").map((id) => id.trim());
const cases = only ? COACH_EVAL_CASES.filter((evalCase) => only.includes(evalCase.id)) : COACH_EVAL_CASES;
const unknown = only?.filter((id) => !COACH_EVAL_CASES.some((evalCase) => evalCase.id === id)) ?? [];
if (unknown.length > 0 || cases.length === 0) {
  console.error(`[coach:eval] Unknown cases: ${unknown.join(", ") || "none selected"}`);
  process.exit(2);
}
const models = values.models.split(",").map((model) => model.trim());

let judge: AiLayer;
let compared: { model: string; ai: AiLayer }[];
try {
  judge = aiOn(values.judge);
  compared = models.map((model) => ({ model, ai: aiOn(model) }));
} catch (error) {
  console.error(`[coach:eval] ${(error as Error).message}`);
  process.exit(2);
}

console.info(`[coach:eval] ${cases.length} cases × ${models.join(", ")}; judge ${values.judge}`);
const report = await runCoachEval({ cases, models: compared, judge, knowledge: loadCoachKnowledge({ environment: "eval" }) });

if (report.models.every((model) => model.results.every((result) => result.error === "coach"))) {
  console.error("[coach:eval] The AI Coach gave no reply on any model: check the AI configuration (see the warnings above). Nothing written.");
  process.exit(1);
}

const date = new Date().toISOString().slice(0, 10);
const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
const run = { date, commit, setVersion: COACH_EVAL_SET_VERSION };
mkdirSync(values.out, { recursive: true });
const markdown = path.join(values.out, `${date}.md`);
writeFileSync(markdown, renderCoachEvalReport(report, run));
writeFileSync(path.join(values.out, `${date}.json`), `${JSON.stringify({ ...run, judgeModel: values.judge, ...report }, null, 2)}\n`);

for (const { model, summary } of report.models) {
  console.info(`[coach:eval] ${model}: ${summary.passed}/${summary.cases} passed, median €${summary.medianEur?.toFixed(4) ?? "–"}, p90 €${summary.p90Eur?.toFixed(4) ?? "–"}`);
}
console.info(`[coach:eval] Recommended default: ${report.recommended.model ?? "none"}. Written to ${markdown}`);
