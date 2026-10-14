# Issue #127: Record tokens and cost per Coach message

Scope: only the provider facts needed to record in/out/cached tokens and EUR cost per Coach message. Checked 2026-10-14. "Not documented" means the primary source is silent; verify against a live response.

## Anthropic (Messages API usage and prompt caching)
Sources: https://platform.claude.com/docs/en/build-with-claude/prompt-caching and https://platform.claude.com/docs/en/about-claude/pricing
- `usage` fields: `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, plus `cache_creation.{ephemeral_5m_input_tokens, ephemeral_1h_input_tokens}`.
- `input_tokens` does NOT include cached tokens: it is only the uncached tokens after the last cache breakpoint. Total input = `cache_read_input_tokens + cache_creation_input_tokens + input_tokens`.
- Multipliers on base input: 5m cache write 1.25x, 1h write 2x, cache read 0.1x. Opus 5.5 and Sonnet 5.5 read at 0.05x. Both 0 means nothing was cached (e.g. prompt below the minimum cacheable length; no error).
- List prices per MTok (input / output / cache read): Opus 5.5 $4 / $20 / $0.20; Sonnet 5.5 $2 / $10 / $0.10; Opus 5 $5 / $25 / $0.50; Sonnet 4.6 $3 / $15 / $0.30.

## Mistral (chat completions)
Sources: https://docs.mistral.ai/api/ , https://mistral.ai/pricing
- Documented `usage` fields in examples: `prompt_tokens`, `completion_tokens`, `total_tokens`.
- Not documented in the pages read: a cached-token field in `usage` (the `UsageInfo` schema was not retrievable). Verify live before relying on one; otherwise record cached = 0 for Mistral.
- Cached tokens are billed at 10% of the standard input price (doc for `prompt_cache_key`).
- Pricing page lists only Mistral Large: $0.50 in / $1.50 out per MTok. Medium and Small figures were not on that page.

## Implications for the issue
- Current code (`packages/ai`): `TokenUsage` has only `inputTokens`/`outputTokens`; `anthropic.ts` maps `input_tokens` and `output_tokens` only, and `cost.ts` has no cache pricing. Once the Coach uses prompt caching (playbooks ~20k tokens make this likely), cached tokens would be missed and cost under-counted: the cache fields must be read and priced separately (read 0.1x or 0.05x, write 1.25x).
- `cost.ts` Anthropic prices are stale for the Coach models: default $5/$25 and sonnet $3/$15 versus listed Sonnet 5.5 $2/$10 and Opus 5.5 $4/$20. Update the per-model table (the `sonnet` regex would also misprice Sonnet 5 and 5.5). The Coach task runs on `claude-opus-5-5`.
- Store per message: provider, model, input (uncached), cache read, cache write, output tokens, EUR cost computed at write time with the price table version in effect; list prices change.
- EUR conversion is an assumption (`EUR_PER_USD` 0.86), not a live rate; say so in any admin view.
- Mistral cached tokens: undocumented field, treat as unknown/0 until verified.
