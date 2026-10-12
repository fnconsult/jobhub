# Issue #110: web search provider API facts (Brave, Tavily, Linkup)

Scope: only what the adapters behind `AiProvider.search` need. Sources are each vendor's official API reference, fetched 2026-10-12. Items marked UNVERIFIED were not stated in the fetched page.

## Brave Search API
Source: https://api-dashboard.search.brave.com/app/documentation/web-search/query
- `GET https://api.search.brave.com/res/v1/web/search`, auth header `X-Subscription-Token: <key>`.
- Params: `q` (operators such as `site:` go inside `q`), `count` (max 20), `offset` (0-9), `freshness`, `country`, `search_lang`, `extra_snippets=true`.
- Freshness: `pd` (24h), `pw` (7d), `pm` (31d), `py` (year), or custom range `YYYY-MM-DDtoYYYY-MM-DD`.
- Domain filter: no include/exclude param. Use `site:example.com` in `q` (OR several together); Goggles exist for re-ranking only.
- Response: `web.results[]` with `title`, `url`, `description`; `extra_snippets` (up to 5) only when enabled. `age`/`page_age` are not documented on this page: treat as optional and tolerate absence.
- UNVERIFIED: rate limits, data hosting location.

## Tavily Search API
Source: https://docs.tavily.com/documentation/api-reference/endpoint/search
- `POST https://api.tavily.com/search`, header `Authorization: Bearer tvly-...`.
- Body: `query` (required), `max_results` (0-20, default 10), `search_depth` (`basic` 1 credit, `advanced` 2 credits, `fast`, `ultra-fast`), `topic` (`general|news|finance`), `time_range` (`day|week|month|year` or `d|w|m|y`), `start_date`/`end_date` (`YYYY-MM-DD`), `include_domains` (max 300), `exclude_domains` (max 150), `include_answer`.
- Response: `results[]` with `title`, `url`, `content`, `score`, `published_date` (only when `include_published_date` is true, automatic for `topic: news`; can be null). Also `answer`, `response_time`, `request_id`.
- Errors: 400, 401, 422 (field details in `detail`), 429 (may send `Retry-After`), 432 (plan limit), 433 (pay-as-you-go limit), 500.

## Linkup Search API
Source: https://docs.linkup.so/pages/documentation/api-reference/endpoint/post-search
- `POST https://api.linkup.so/v1/search`, header `Authorization: Bearer <key>`.
- Body: `q`, `depth` (`fast|standard|deep|flash`), `outputType` (`searchResults|sourcedAnswer|structured`) are all required. Optional: `includeDomains` (max 100), `excludeDomains`, `fromDate`/`toDate` (`YYYY-MM-DD`, from < to, after 1970-01-01), `maxResults` (min 1), `includeImages`.
- Response for `searchResults`: a `results` array (the page names this key `results`; confirm against a real response when recording fixtures). Text items: `type:"text"`, `name`, `url`, `content`, `favicon`. Image items (`type:"image"`) have no `content`: filter to `type === "text"`.
- Errors: 400, 401, 402 (no key; x402 payment header), 429 (rate limit or insufficient credits).
- Linkup has no `published` date field in results.

## Implications for the adapters
- Mapping to `SearchOutput.sources`: title = `title`/`name`, url, snippet = `description`/`content`. Dates are only reliably available from Tavily (news topic).
- Freshness: Brave and Tavily support relative and absolute ranges; Linkup only absolute dates, so convert relative windows to `fromDate`.
- Domains: Tavily/Linkup have native include/exclude; Brave needs `site:` query rewriting (include only; exclusion via `-site:` is UNVERIFIED).
- All three use API keys in headers (Brave custom header, others Bearer).
- ADR-0007 amendment: vendor hosting/EU residency was not established from these pages (UNVERIFIED). The amendment's argument should rest on queries containing only Search Criteria, as the issue states, not on vendor location.
