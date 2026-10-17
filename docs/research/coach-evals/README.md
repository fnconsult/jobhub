# Coach eval suite (#131)

Map: #122 (AI Coach context). The suite checks the AI Coach's replies against Jobbbox's Coaching Playbooks and compares models on quality and on the Coach cost target (€0.03 per reply, median and p90).

## Run it

```sh
npm run coach:eval
# options: -- --models claude-opus-5-5,claude-sonnet-5-5 --judge claude-opus-5-5 --cases age-worry,statistic-trap --out <folder>
```

It reads the AI layer's configuration from the repo's `.env`: every model runs on Anthropic, through `ANTHROPIC_ENDPOINT` (Bedrock eu-west-3 by default, with `AWS_BEARER_TOKEN_BEDROCK` or the AWS credential chain). It writes `<date>.md` (summary) and `<date>.json` (every reply, cost and judgment) into this folder. Commit them when a run informs a decision. `AI_FAKE=true npm run coach:eval -- --out /tmp/x` runs it offline as a smoke test. If no model gives a single reply (missing credentials, for example), it writes nothing and exits 1.

When it runs: nightly, by hand (`workflow_dispatch`), and on pull requests that change the AI Coach's prompt, knowledge or model (`.github/workflows/coach-evals.yml`: `apps/web/src/coach/**`, `packages/coach-knowledge/**`, the AI layer's env routing and Claude adapter). It does not run on every pull request. The workflow needs the `AWS_BEARER_TOKEN_BEDROCK` repository secret. Without it, the `credentials` job logs a warning and the `eval` job is skipped, so its check shows as skipped, never as passed. Each run's Markdown goes to the job summary and both files go to the `coach-evals` artifact.

## What it does

- **The AI Coach under test is the real one.** `createCoach` runs with its persona, the Playbook table and the Coach context. It is grounded in every Coaching Playbook and the Core Digest as served in `eval`. Each case's fictional Candidate is an in-memory workspace: one Profile and, optionally, a Profile, Job Offer or Application In view (`apps/web/src/coach/evals/workspace.ts`).
- **Eval set `coach-v1`, 19 cases** (`apps/web/src/coach/evals/cases.ts`). All Candidates are fictional:
  - 13 Coach cases. Together they give the AI Coach every Coaching Playbook (a test checks this). They cover age worries, hiding one's age on a CV, a long and discouraging search, "how long will it take", a statistic trap, budget raised early (in English), a cover letter, ATS filters, an N+2 interview with salary expectations, LinkedIn outreach, a freelance daily rate, a guarantee trap and overqualification.
  - 6 cases ported from devarq `job-hub/corpus/evals/search-relevance-v1.json`. That is the only set in that folder. Each listing is In view as a Job Offer, the Candidate asks "does this offer fit me?", and the expected verdict (relevant or not, and why) goes to the judge. The `origin` field keeps the devarq case id.
- **AI judge** (`judge.ts`, default `claude-opus-5-5`). It reads the documents the reply drew on (Playbooks used), the conversation, the reply and what a good reply does. It scores each criterion from 1 to 5:
  - **adherence**: applies the Core Digest and playbooks, and does what the case expects;
  - **figures**: no figure outside the Core Digest and playbooks (5: none). The judge lists the offending figures, and the report collects them;
  - **tone**: right for a Candidate over 40. That means respectful, concrete, no ageism, no promised outcome, and a long search framed as a market fact.
  
  A case passes when all three criteria score 4 or more. The judge's cost is reported apart from the Coach's.
- **Cost** is the Coach Message Cost of each reply (`costInEur`: list prices at €0.86 per $). The suite reports the median and p90 per model against €0.03.
- **Recommended default:** the cheapest model that is within the cost target (median and p90) and passes at least 80% of cases, and no more than 10 points below the best model's pass rate. If no model qualifies, it recommends none and a human decides.

## Decision (provisional, cost only): the AI Coach's default model is Claude Sonnet 5.5

Set on 2026-10-15 in `packages/ai/src/env.ts`: on Anthropic, `coaching` defaults to `claude-sonnet-5-5`. Every other text task keeps Claude's default (`claude-opus-5-5`). `AI_COACHING_MODEL` still overrides it, for example `AI_COACHING_MODEL=anthropic.claude-opus-5-5` on Bedrock. Switching back takes a configuration change, not a deploy of new code.

Why: **Opus 5.5 cannot meet the Coach cost target and Sonnet 5.5 can** ([cost projection](2026-10-15-cost-projection.md)). On the prompts the real AI Coach builds for the 19 cases, the p90 input is about 6,000 to 6,900 tokens. At 1,000 output tokens, Opus 5.5's p90 is €0.038 to €0.041 and Sonnet 5.5's is €0.019 to €0.020. Opus 5.5 thinks on every reply, and thinking is billed as output, so 1,000 output tokens is a low estimate for it. With a fuller workspace, the system prompt grows toward the 12k-token Coach context cap. There, at 500 output tokens, one Opus reply costs about €0.056 and one Sonnet reply about €0.028. Opus costs exactly twice Sonnet for every kind of token ([research](../issue-131.md)), so any reply Opus could give within the target, Sonnet gives for half.

**Not yet measured: quality.** No suite run is committed here: neither the agent that built the suite nor CI had Bedrock credentials (the `eval` check on PR #178 skipped), so the suite has not compared the two models' replies. Until a live run is committed, this default rests on cost alone and #131's acceptance criteria are not met.

### To finish #131 (needs Bedrock credentials)

1. Run the suite live, either way:
   - locally, with `AWS_BEARER_TOKEN_BEDROCK` in the repo's `.env`: `npm run coach:eval`. It writes `<date>.md` and `<date>.json` here;
   - or set the `AWS_BEARER_TOKEN_BEDROCK` repository secret, run the **Coach evals** workflow by hand (`workflow_dispatch`), and copy the two files from its `coach-evals` artifact into this folder.
2. Read the failing cases' replies in `<date>.json` (see Caveats).
3. If the run recommends `claude-sonnet-5-5`, drop "(provisional, cost only)" and this paragraph. If it recommends another model, change `DEFAULT_MODEL` in `packages/ai/src/env.ts` to it. If it recommends none, record the human decision here with the run's date. Options for Opus 5.5: prompt caching of the persona and knowledge prefix, or a trimmed context; for Sonnet 5.5: a better prompt.
4. Commit the run and this page. `e2e/coach-evals.spec.ts` ("the decision claims no more than the committed suite runs show") checks that the latest committed run is a live, judged one and that the default matches its recommendation.

## Caveats

- The two models run at their default effort (Opus `medium`, Sonnet `high`), because the AI layer does not set effort. The production AI Coach runs the same way, so the comparison holds for production. It is not a like-for-like comparison of the models themselves.
- Prompt caching is not used by the Claude adapter today. The costs above assume no cache reads.
- The judge is an LLM, and an Opus judge may favour Opus replies. Read the failing cases' replies in `<date>.json` before acting on a close result.
- €0.86 per $ is an assumption (`EUR_PER_USD`), not a live rate. Prices were read 2026-10-15.

## Files

- `README.md`: this page and the decision.
- `2026-10-15-cost-projection.md`: the cost projection behind the decision.
- `cost-projection.ts`: the throwaway script that produced it (offline, `npx tsx docs/research/coach-evals/cost-projection.ts`).
- `<date>.md` / `<date>.json`: eval runs, written by `npm run coach:eval`.
