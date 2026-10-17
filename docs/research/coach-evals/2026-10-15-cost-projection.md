# Coach cost projection, 2026-10-15

What one AI Coach reply would cost on `claude-opus-5-5` and `claude-sonnet-5-5`, measured on the prompts the real AI Coach builds for the 19 cases of eval set `coach-v1`. These are the Coach's persona, the grounding rules, the Core Digest and 1 or 2 playbooks, the Coach context, and the conversation. It ran offline with `npx tsx docs/research/coach-evals/cost-projection.ts`, so no model was called and quality was not measured. List prices: Opus 5.5 $4 / $20 and Sonnet 5.5 $2 / $10 per million input / output tokens, no cache reads, at €0.86 per $. The Coach cost target is €0.03 per reply, median and p90.

Prompt size over the 19 cases: 11,269 to 25,502 characters (median 13,512, p90 24,085). Tokens are estimated at 3.5 characters per token (French prose) and at 4 (a floor). Output tokens include thinking, which is billed as output.

| Chars per token | Input tokens (median / p90) | Output tokens | Model | Median € | p90 € |
|---|---|---|---|---|---|
| 3.5 | 3861 / 6881 | 500 | claude-opus-5-5 | €0.0219 | **€0.0323** |
| 3.5 | 3861 / 6881 | 500 | claude-sonnet-5-5 | €0.0109 | €0.0161 |
| 3.5 | 3861 / 6881 | 1000 | claude-opus-5-5 | **€0.0305** | **€0.0409** |
| 3.5 | 3861 / 6881 | 1000 | claude-sonnet-5-5 | €0.0152 | €0.0204 |
| 3.5 | 3861 / 6881 | 2000 | claude-opus-5-5 | **€0.0477** | **€0.0581** |
| 3.5 | 3861 / 6881 | 2000 | claude-sonnet-5-5 | €0.0238 | €0.0290 |
| 4 | 3378 / 6021 | 500 | claude-opus-5-5 | €0.0202 | €0.0293 |
| 4 | 3378 / 6021 | 500 | claude-sonnet-5-5 | €0.0101 | €0.0147 |
| 4 | 3378 / 6021 | 1000 | claude-opus-5-5 | €0.0288 | **€0.0379** |
| 4 | 3378 / 6021 | 1000 | claude-sonnet-5-5 | €0.0144 | €0.0190 |
| 4 | 3378 / 6021 | 2000 | claude-opus-5-5 | **€0.0460** | **€0.0551** |
| 4 | 3378 / 6021 | 2000 | claude-sonnet-5-5 | €0.0230 | €0.0276 |

Bold: over €0.03.

The eval cases have small workspaces: one Profile, at most one item In view. A real Candidate's workspace pushes the system prompt toward the 12k-token Coach context cap, about 13,700 tokens at 3.5 characters per token. At that size, with 500 output tokens, one reply costs about €0.056 on Opus 5.5 and €0.028 on Sonnet 5.5. With 1,000 output tokens it costs €0.064 and €0.032.

**Result:** Sonnet 5.5 is within the Coach cost target in every row up to 2,000 output tokens. Opus 5.5 misses it at p90 in every row with 1,000 output tokens or more, and Opus thinks on every reply. Opus 5.5 would need prompt caching or a smaller context to fit. That makes Sonnet 5.5 the default (see [README](README.md)), until the eval suite's first live run measures the quality gap.
