# Research for issue #398: provider facts needed for the Search providers rework

Checked 2026-10-26 against first-party docs. Builds on `docs/research/llm-search-tools.md` (#384, branch `research/llm-search-tools`), which already covers prices, limits and residence; only what #398 adds or corrects is here. **NOT VERIFIED** marks a claim no primary page confirmed. Regulations (GDPR, ADR-0007) are unchanged by this issue: the Search API receives the same sanitised queries.

## Perplexity Search API (`POST https://api.perplexity.ai/search`)
Sources: https://docs.perplexity.ai/api-reference/search-post.md, https://docs.perplexity.ai/docs/search/quickstart.md, https://docs.perplexity.ai/docs/search/filters/domain-filter.md
- Bearer auth. Only `query` is required: a string **or an array of strings**.
- Up to **5 queries per request**, each processed independently (quickstart). The OpenAPI schema itself sets no array limit, so the client must enforce 5. One successful request is one billing unit; rate limiting counts each query (5 units).
- `search_type`: `web` (default), `fast`, or `people`. `people` is out of scope.
- `max_results`: 1-50, default 10; above 20 only for `people`. Cap at 20.
- `country`: ISO 3166-1 alpha-2, exactly 2 characters (not a name, unlike Tavily).
- `search_domain_filter`: array, max 20 entries, each up to 253 chars; no protocol; root domain also matches subdomains; paths allowed. **Allowlist or denylist (`-` prefix), never mixed.**
- `search_recency_filter`: `hour|day|week|month|year`. Date filters `search_after_date_filter`, `search_before_date_filter`, `last_updated_after_filter`, `last_updated_before_filter` take **MM/DD/YYYY**; dates come back as YYYY-MM-DD.
- Other: `search_language_filter` (ISO 639-1, max 20), `max_tokens`, `max_tokens_per_page`. Not needed: send none to keep the response small.
- Response: `id`, optional `server_time`, `results[]` with `title`, `url`, `snippet`, `date` (publication, nullable), `last_updated` (nullable).
- **Multi-query response shape is not documented.** The examples read a flat `search.results`; the schema shows a flat array. **Confirm with the live test** (a 2-query call) whether results are flat or grouped per query, and whether they can be attributed to a query. The adapter should not assume attribution.
- Errors: only 200 and 422 (`detail[]` with `loc`, `msg`, `type`) are documented on the endpoint page. **401, 403 and 429 are not documented there** (NOT VERIFIED); treat by status code as the issue says. Rate-limit page: https://docs.perplexity.ai/docs/admin/rate-limits-usage-tiers (50 units/s per #384).

## Tavily
Source: https://docs.tavily.com/documentation/api-reference/endpoint/search
- `country`: a lowercase English **country name from a fixed enum** (`france`, `united kingdom`), default null, **only with `topic: "general"`**. It boosts ranking; it does not filter. An unknown value is invalid (400/422): keep an ISO-to-name map and omit the field if unmapped.
- Errors: 401 missing/invalid key; 429 rate (some responses carry `Retry-After`); **432 plan limit exceeded; 433 pay-as-you-go limit exceeded** (both mean quota out, not documented as 429); 400, 422, 500. **403 is not documented.** The fallback trigger list must add 432/433 for Tavily.
- `published_date` is returned only with `include_published_date: true`, is a best estimate that may be a last-update date, may be null, format like `Tue, 11 Mar 2025 17:00:00 GMT`. `filter_by_published_date: true` drops results with no detectable date, so for the age filter prefer `time_range` and emulate on returned pages.
- `country` is `handled` as a boost only: declare it so, and do not rely on it to exclude other countries.

## Brave Search API
Sources: https://api-dashboard.search.brave.com/app/documentation/web-search/query, .../get-started, .../responses
- `count` <= 20, `offset` 0-9 (so at most 10 pages), `country` 2-letter, `freshness` pd/pw/pm/py or a date range. `query.more_results_available` tells whether another page exists.
- No domain include/exclude parameter: exclusions are `emulated` on returned pages (as the issue says). Optionally `-site:` in `q` is a query operator; NOT VERIFIED on the pages read, so emulate regardless.
- Error codes, `X-RateLimit-*` headers and quota-exhaustion status could **not** be confirmed: the get-started page does not document them and the rate-limiting page returned 404. NOT VERIFIED; use status codes 401/403/429 generically and check the headers on a live key.
- Results page date is `page_age` (per #116), absent from the response page consulted: age emulation only "when a date is known", as the issue says.

## Linkup removal
No external fact needed. The `LINKUP_API_KEY` variable becomes unused. (#384: Linkup has no country, date or pagination.)

## What this means for the build
1. Declare Perplexity `queriesPerCall: 5`, `maxPages: 1`; domain filter `handled` as allow **or** deny, so when both lists are present apply one natively and emulate the other; country `handled` (alpha-2); age `handled` via `search_recency_filter` (coarse) or date filters (MM/DD/YYYY); result count `handled` up to 20.
2. Tavily: country `handled` as a boost; send a lowercase name; include/exclude domains `handled` (300/150); age `handled` via `time_range`/dates.
3. Fallback triggers: key missing, 401, 403, 429, 5xx/timeouts, plus Tavily 432/433. Fixtures should include them.
4. Open for the live Perplexity test: multi-query response shape, behaviour of 401/403/429 bodies.
