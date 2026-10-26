# Issue #399 - Brave and Tavily API facts for connection tests

Scope: only what the connection tests (Provider Secrets) need. Sources are the vendors' official docs, fetched 2026-10-26.

## Brave Search API
- Endpoint: `GET https://api.search.brave.com/res/v1/web/search` (q param = query).
- Auth: header `X-Subscription-Token: <API key>`.
- `count`: max results per page, max 20, default 20; a page may return fewer. So `count=1` is valid for a minimal test call.
- Source: https://api-dashboard.search.brave.com/app/documentation/web-search/get-started
- NOT verified (docs pages fetched did not cover them): HTTP codes for invalid key / exhausted quota, rate-limit response headers, free-plan terms and whether a test call is billed. Treat any non-2xx as failure and map 401/403 to "invalid key" and 429 to "quota/rate limit" as an assumption; confirm against the Brave API reference or a live call with a test key before relying on it.

## Tavily
- Usage endpoint: `GET https://api.tavily.com/usage`, auth `Authorization: Bearer tvly-...`; optional `X-Project-ID`. Returns `key.usage`, `key.limit`, `account.current_plan`, `plan_usage`, `plan_limit`, etc. 401 = missing/invalid key; 429 = rate limited (may carry `Retry-After`).
  Source: https://docs.tavily.com/documentation/api-reference/endpoint/usage
- The docs do NOT state whether `/usage` consumes credits. The issue says "usage endpoint if free, else one basic search": the doc gives no proof it is free, so verify with a live call (compare `usage` before/after) or use the fallback.
- Fallback search: `POST https://api.tavily.com/search`, same Bearer auth, `max_results` int 0-20 (default 10), `search_depth: "basic"` costs 1 credit (`advanced` 2). Errors: 400 invalid request, 401 bad key, 429 rate limit (`Retry-After`), 432 key/plan limit exceeded, 433 pay-as-you-go limit exceeded.
  Source: https://docs.tavily.com/documentation/api-reference/endpoint/search

## Implications for implementation
- Auth differs: Brave uses a custom header, Tavily a Bearer token.
- Treat 432/433 (Tavily) as "key valid but out of quota", distinct from 401.
- Open: Brave error codes and Tavily /usage cost (see above).
