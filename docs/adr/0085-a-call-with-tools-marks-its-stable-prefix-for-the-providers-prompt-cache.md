# A call with tools marks its stable prefix for the provider's prompt cache

Status: accepted (#790)

A Coach reply with Coach Actions (ADR-0077) makes up to three Turns, and each sends the same tools, system text (persona, rules, Playbook digest, Coach context) and conversation again, then the Turns before it. The provider bills each Turn whole, so the input of one reply was about three times its context (#790's measure: 17 356 tokens sent for a median Eval Case, 39 831 for a reply at the limits; on the Beta, « 56,7k » for « 4k / 12k jetons »). Claude and Mistral both cache a prompt's prefix and price what they read from it at a tenth of the input or less.

- **The AI layer marks the prefix, provider-neutral.** A call with tools gives each of its Turns `TextInput.cache`: one key for the call and `prefixMessages`, the length of the conversation asked. Each adapter says it its way; a call without tools is sent exactly as before, and so are the Guardrails', the Playbook Agents' and every other task's.
- **Claude: three `cache_control` breakpoints** (of the four allowed): on the system text (which, after the tools, Claude caches with it), at the end of the conversation asked, at the end of the latest message. Turn 2 reads the tools, system and conversation from the cache, Turn 3 also Turn 2's. The default 5-minute TTL, refreshed at each read: a reply's Turns follow within seconds, so the 1-hour TTL (2× to write) would buy nothing. The same syntax on the direct API, Bedrock and Vertex (Anthropic's prompt caching page lists both as stable). A prefix under the model's minimum (512 tokens for the 5.5 models, 1 024 for Sonnet 5, Bedrock's) is simply not cached, without error. Writing costs 1.25× the input once, on Turn 1: a reply that never calls a tool pays that for nothing (+25 % on its input); with a Tool round it is recovered by the second Turn.
- **Mistral: `prompt_cache_key`**, the call's key on each Turn, which routes them to the same cache; Mistral caches the prefix by itself and reports `usage.prompt_tokens_details.cached_tokens`, already read. The parameter is in Mistral's official SDK (`@mistralai/mistralai` 3.5.0, `ChatCompletionRequest.promptCacheKey`) and its prompt caching page (docs.mistral.ai/studio-api/conversations/advanced/prompt-caching, found by search; docs.mistral.ai could not be fetched from the session that wrote this, so its retention terms were not read: see #792).
- **OpenAI** caches by itself; nothing is sent.
- **A provider that caches nothing** (`AiProvider.promptCache` absent) is resent the earlier Tool rounds' results as a digest: their first 600 characters, ended at a space, and a mark that the model read the whole at that round; the latest round's results and every error whole. With a cache, the results are kept whole: in the cached prefix they cost a tenth or less, less than a digest resent whole, and the final answer keeps every fact the model read. The digest is cut after Redaction, so it never splits an identity value.
- **The read budget stays (#714)**: 1 500 tokens per read, 4 000 per reply; the mark that ends a cut read now tells the model not to guess what is missing.
- **Recorded.** `cached_input_tokens` and the cache writes (in `input_tokens`, priced 1.25×) per Turn, as before; « Cette réponse » and the AI Message Log (#790, ADR-0078) show the cached share.

## Measured (fake provider counting ~4 characters a token, simulating Claude's cache; Claude Opus 5.5 list prices; `apps/web/scripts/measure-coach-cost.ts`)

| | input sent / reply | processed (not cached) | cached share | € / reply |
|---|---|---|---|---|
| 72 Eval Cases, 3 Turns, before | 17 356 | 17 356 | 0 % | 0.0607 |
| 72 Eval Cases, 3 Turns, after | 17 356 | 5 846 | 66 % | 0.0281 (−54 %) |
| Reply at the limits, before | 39 831 | 39 831 | 0 % | 0.1378 |
| Reply at the limits, after | 39 831 | 15 082 | 62 % | 0.0698 (−49 %) |
| Reply at the limits, no prompt cache (digest) | 38 262 | 38 262 | 0 % | 0.1324 (−4 %) |

Latency is not measured by the fake provider; a cache hit shortens a Turn's time to first token, which the Beta's AI Message Log (`durationMs` per Turn) will show.

## Considered Options

- **Cache only the system text**: Turn 3 would still pay Turn 2's tool results whole; the conversation would too.
- **The 1-hour TTL, to reuse a prefix across replies**: the system text starts with the time of day (« HH:MM ») and changes with the Coach context, so the next reply rarely shares it; 2× to write for nothing.
- **Digest earlier results always**: cheaper only without a cache, and it drops facts the final answer may need.
- **Drop the Tool results between Turns**: the model would read again what it already read, or answer without it.

## Consequences

- `TextInput.cache`, `AiProvider.promptCache`; the fake provider can count its tokens (`measured`) and simulate a cache (`promptCache`, `cacheHits`).
- Privacy register (Coach Conversations): the providers' prompt caches; #792 (« Légal : ») on their retention.
- What the AI Coach may do is unchanged (ADR-0077).
