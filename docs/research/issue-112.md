# Issue #112: Perplexity Agent API filters and paging (job search query variants)

Scope: only what mapping Search Criteria to provider filters and paging needs, for the Perplexity adapter (`POST /v1/responses`, `web_search` tool). Sources are Perplexity's official docs, fetched 2026-10-14. Items marked UNVERIFIED were not stated in the fetched pages.

## Filters on the Agent API `web_search` tool
Source: https://docs.perplexity.ai/api-reference/responses-post
- Filters live in the tool object, not top level: `tools: [{ type: "web_search", filters: {...}, user_location: {...}, max_results }]`.
- `filters.search_domain_filter`: string[], max 20 entries, each up to 253 chars.
- `filters.search_recency_filter`: enum `hour|day|week|month|year` (publication recency). This is the freshness filter.
- `filters.search_after_date_filter` / `search_before_date_filter` / `last_updated_after_filter` / `last_updated_before_filter`: dates sent as `MM/DD/YYYY` (returned as `YYYY-MM-DD`).
- `user_location`: `country` (ISO 3166-1 alpha-2), also `city`, `region`, `latitude`, `longitude`. This is the only region filter on the tool; it biases location, it is not documented as a hard restriction (UNVERIFIED).
- `max_results`: 1-50, outside that range is HTTP 400. Upper bound per call.
- Top-level `language_preference` (ISO 639-1) sets the response language, not the search language.

## Language filter
Source: https://docs.perplexity.ai/docs/search/filters/language-filter
- `search_language_filter`: lowercase ISO 639-1 array, max 10, invalid codes error. Documented for the Search API only; UNVERIFIED on the Agent API `web_search` tool. Do not rely on it: FR/EN variants should be expressed in the query wording.

## Domain filter semantics
Source: https://docs.perplexity.ai/docs/search/filters/domain-filter
- No prefix = allowlist; `-` prefix = denylist (e.g. `-reddit.com`). Allow and deny cannot be mixed in one request. Max 20.
- A root domain matches its subdomains. Path filters (`nature.com/articles`) also apply.
- Implication for #105: steering away from listing pages is a denylist (`-indeed.com` etc.), so no allowlist can be used in the same call.

## Paging
Source: https://docs.perplexity.ai/api-reference/responses-post
- No offset, cursor or page parameter exists. "Next page" cannot be a provider concept: it must be a new call (e.g. higher `max_results`, a different query variant, or a narrower date window). UNVERIFIED whether repeated identical calls return different results.
- `max_tokens` / `max_tokens_per_page` bound search context; `search_type` is `web` or `fast`.

## Implications
- Region: `user_location.country`; contract type and remote work have no provider filter, keep them in query wording.
- Freshness: map to `search_recency_filter`; Search Criteria freshness windows must round to hour/day/week/month/year.
- Paging stop rule must be implemented app-side (stop when a page yields no new readable posting, or the budget is spent), over distinct requests.
