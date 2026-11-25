# A reached quota is read from each Tool's recorded calls

Status: accepted (2026-11-24, #1114; rule decided in #1110, under #1108). Builds on ADR-0031 (Fantastic.jobs' quota guard).

The product owner wants to know when a Tool with an API (an AI model, a web search provider, a contact-enrichment provider, Fantastic.jobs) has reached its quota at its provider. Before #1114, a refusal for a quota was recorded as `rate_limited` (a 429) or `provider_rejected`, so a credit spent and a burst of calls looked alike, and no Tool had a quota state at all (research #1109).

## Decision

- **Two states per Tool, from the first refusal.** « limite atteinte » (`rate_limited`): its rate limit, an HTTP 429. « quota épuisé » (`quota_exhausted`, « Quota épuisé chez le fournisseur »): its credit or plan spent. Each starts at the provider's **first** refusal; no threshold, no count of refusals.
- **It ends with the provider.** A state lasts while the provider refuses. It ends at the first call of that Tool the provider accepts, or at the renewal date the provider gave (`retry-after`, Fantastic.jobs' `x-api-next-billing-date`), whichever comes first. A date we guessed ourselves (Fantastic.jobs' `QUOTA_HOLD_MS`) is not a renewal date.
- **Each provider's documented answers classify it** (`quotaRefusalOf` in `@jobhub/shared`): Anthropic's 400 « credit balance is too low » (API, Bedrock, Vertex), OpenAI's 429 `insufficient_quota`, a 402 or a plan spent for Mistral, Perplexity and Brave, Tavily's 432 and 433, Lusha's, Kaspr's and Apollo's 402 `out_of_credits` give `quota_exhausted`; any other 429 stays `rate_limited`. Fantastic.jobs gives `quota_exhausted` for a 402 and `rate_limited` for a 429; a search its quota guard holds back (ADR-0031) is recorded in `external_api_usage` as a failed call never made, with the reason it is held for and the renewal date Fantastic.jobs gave.
- **Read from the recorded calls, never stored.** The reason is written where every call already is: AI Usage (`ai_usage.reason`) or `external_api_usage.reason`, with the renewal date in `renews_at`. `apps/web/src/tool-quotas` reads each Tool's state from them every time it is asked: its refusals since its latest accepted call, the latest one's reason, since the first refusal of that reason, and its renewal date. Nothing else is written.
- **The guard keeps the reason of its hold.** A search held after a 429 is recorded `rate_limited`, one held after a 402 or spent credits or requests `quota_exhausted`, so a rate limit never reads as a spent quota.
- **A 402 switches to the Fallback Search provider**, like Tavily's 432 and 433: a spent plan (ADR-0043).
- **Only Tools with a quota.** A Tool without one at its provider (a public API, a Tool of our own, Stripe, whose 402 is a declined card) has no quota state; its answers keep their own Failure Reason.

## Considered Options

- **A stored state per Tool, set on a refusal and cleared on a success**: a second record of what the calls already say, which a crash between the call and its write, or a worker and the web app writing at once, would leave wrong. Read from the calls, the state cannot disagree with them, and is gone when they are purged.
- **A threshold of refusals before a state**: the product owner wants to know at the first refusal (#1110); a credit spent does not come back by retrying.
- **Polling each provider's usage endpoint**: not every provider has one, it costs calls of its own, and it would need each provider's keys outside the calls that use them.
- **Keeping one reason for both**: a rate limit passes by itself within seconds, a credit spent needs someone to pay; the Back Office must tell them apart.

## Consequences

- `quota_exhausted` joins the Failure Reason catalog, counted on Consommation IA and Outils like any other reason.
- A state is as fresh as the Tool's latest call: a Tool no one calls keeps its last state until its renewal date, if any.
- A Tool's quota state lasts no longer than its calls are kept (24 months).
- A connection test of a Tool is not a call the provider accepted: it never ends a state (#1115). A state restarts after a renewal date that had passed.
- States are cached 30 s across Back Office requests (none on the e2e target), so the Tool quota banner of every page goes within half a minute (#1115).
