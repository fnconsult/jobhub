# Issue #131: external facts for the Coach eval suite (Opus vs Sonnet)

Researched 2026-10-15 against Anthropic's first-party docs. Scope: only what #131 needs (model IDs, prices, cost levers). No product code.

## Sources
- Models overview: https://platform.claude.com/docs/en/about-claude/models/overview
- Pricing: https://platform.claude.com/docs/en/about-claude/pricing

## Facts

| | `claude-opus-5-5` | `claude-sonnet-5-5` |
|---|---|---|
| API ID (pinned snapshot, no alias needed) | `claude-opus-5-5` | `claude-sonnet-5-5` |
| Base input | $4 / MTok | $2 / MTok |
| Output | $20 / MTok | $10 / MTok |
| 5m cache write | $5 / MTok | $2.50 / MTok |
| 1h cache write | $8 / MTok | $4 / MTok |
| Cache hit / refresh | $0.20 / MTok (0.05x) | $0.10 / MTok (0.05x) |
| Default effort | `medium` | `high` |
| Thinking | adaptive, always on | adaptive |
| Context / max output | 1M / 128K | 1M / 128K |
| Retirement | not before 2027-09-22 | not before 2027-09-28 |

- Prices are in USD; the target in the issue is EUR 0.03/message, so the harness must convert with a stated, fixed rate (not from the docs).
- Batch API is 50% off (pricing page). Suitable for the nightly eval run, which is not latency sensitive; not for live Coach traffic.
- Opus costs exactly 2x Sonnet on every token class, so the cost ratio at equal token counts is 2x. Real ratio depends on output/thinking tokens, which differ by model and effort.
- Default effort differs (Opus `medium`, Sonnet `high`). Set `effort` explicitly on both in the eval, or the comparison is confounded and Sonnet may emit more thinking tokens by default.
- Thinking tokens are billed as output; measure `usage` from each response rather than estimating from visible text.
- Data residency: `inference_geo: "us"` applies a 1.1x multiplier; the first-party API is global by default. Relevant only if the EU/AI-consent work requires region pinning; check the data-residency page before relying on EU options.
- Haiku 5.5 (`claude-haiku-5-5`) also exists (from $0.10 / $0.50 per MTok). Optional as a judge model to cut cost; not in the issue's scope.

## Implications for the suite
- Cost per message = (input*in_price + output*out_price + cache terms) from the response `usage` object; compare against EUR 0.03 after conversion. Report prompt-cache hit assumptions explicitly, since the playbook context is a large stable prefix and cache reads at 0.05x dominate the real cost.
- Judge model should differ from, or be at least as strong as, the candidates; record the judge's own cost separately from the Coach cost.
- Pin the model IDs above in results files so runs are reproducible (IDs are pinned snapshots).

## Not verified / out of scope
- Nothing about Perplexity, Mistral, or GDPR was needed for this issue. Per project memory, identity-bearing prompts route to Mistral under EU AI consent (#121); whether eval fixtures contain real identity data is a repo question, not researched here.
- Pricing may change; re-check the pricing page when the default is set.
