/**
 * Throwaway cost projection for #131 (not production code): what one AI Coach reply would cost on
 * each model, from the prompts the real AI Coach builds for every case of the Coach eval set.
 * Offline: a fake provider records each prompt; nothing is sent. Tokens are estimated from
 * characters (3.5 per token for French prose, 4 as a floor), output at 500, 1,000 and 2,000 tokens.
 *
 *   npx tsx docs/research/coach-evals/cost-projection.ts
 */
import { createAiLayer, costInEur } from "@jobhub/ai";
import { createFakeProvider, createMemoryUsageLog } from "@jobhub/ai/testing";
import { loadCoachKnowledge } from "@jobhub/coach-knowledge";
import { COACH_EVAL_CASES } from "../../../apps/web/src/coach/evals/index";
import { EVAL_CANDIDATE_ID, evalWorkspace } from "../../../apps/web/src/coach/evals/workspace";
import { createCoach } from "../../../apps/web/src/coach/index";

const knowledge = loadCoachKnowledge({ environment: "eval" });
const sizes: number[] = [];
for (const evalCase of COACH_EVAL_CASES) {
  const provider = createFakeProvider({ id: "anthropic" });
  const ai = createAiLayer({ providers: [provider], routes: { coaching: "anthropic" }, usage: createMemoryUsageLog() });
  const { sources, focus } = evalWorkspace(evalCase);
  await createCoach({ ai, knowledge, ...sources }).reply(EVAL_CANDIDATE_ID, { messages: evalCase.messages, ...(focus ? { focus } : {}) });
  const call = provider.calls[0]!;
  sizes.push((call.system ?? "").length + call.messages.reduce((sum, message) => sum + message.content.length, 0));
}
sizes.sort((a, b) => a - b);
const percentile = (p: number) => {
  const rank = (sizes.length - 1) * p;
  const below = Math.floor(rank);
  return sizes[below]! + (sizes[Math.ceil(rank)]! - sizes[below]!) * (rank - below);
};

console.log(`${sizes.length} cases. Prompt characters: min ${sizes[0]}, median ${percentile(0.5)}, p90 ${percentile(0.9)}, max ${sizes.at(-1)}`);
console.log("| Chars per token | Input tokens (median / p90) | Output tokens | Model | Median € | p90 € |");
console.log("|---|---|---|---|---|---|");
for (const charsPerToken of [3.5, 4]) {
  const input = (p: number) => Math.round(percentile(p) / charsPerToken);
  for (const outputTokens of [500, 1_000, 2_000]) {
    for (const model of ["claude-opus-5-5", "claude-sonnet-5-5"]) {
      const eur = (p: number) => costInEur({ provider: "anthropic", model, usage: { inputTokens: input(p), outputTokens } }).toFixed(4);
      console.log(`| ${charsPerToken} | ${input(0.5)} / ${input(0.9)} | ${outputTokens} | ${model} | €${eur(0.5)} | €${eur(0.9)} |`);
    }
  }
}
