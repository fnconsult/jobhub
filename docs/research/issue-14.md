# Research for issue #14: On-demand AI Coach job search

Scope: only the external facts needed to implement Job discovery (ADR-0002, ADR-0007). Fetched 2026-10-08.

## Perplexity Search API
Source: https://docs.perplexity.ai/api-reference/search-post
- `POST https://api.perplexity.ai/search`, Bearer token auth.
- Params: `query` (string or array), `max_results` (1-20 web, default 10), `search_type` (`web`, `fast`, `people`), `country` (ISO 3166-1 alpha-2), `search_domain_filter` (max 20), `search_language_filter` (ISO 639-1), `search_recency_filter` (hour/day/week/month/year), date filters (MM/DD/YYYY), `max_tokens`, `max_tokens_per_page`.
- Response: `results[]` with `title`, `url`, `snippet`, optional `date` and `last_updated`; plus `id`.
- The API returns snippets and URLs only. Full Job Offer content must be fetched by our own crawler, so robots.txt applies to us, not Perplexity.

Source: https://docs.perplexity.ai/guides/search-quickstart
- Domain filter supports denylist with `-` prefix: usable to exclude Crawler-Blocked Sites (LinkedIn, Indeed, Glassdoor).
- Language filter: this page says max 10 codes, the API reference says 20. Use `["fr"]`; the discrepancy does not matter.
- Fast Search costs $1.00 per 1,000 requests; standard Search pricing is not stated on these pages. A multi-query request is one billing unit but consumes one rate-limit unit per query.
- Rate-limit tier values and data-retention policy are NOT stated in the fetched pages.

## robots.txt
Source: RFC 9309, https://www.rfc-editor.org/rfc/rfc9309
- Match user-agent case-insensitively; fall back to the `*` group; multiple matching groups merge.
- 5xx / unreachable: MUST assume complete disallow (may use cache after ~30 days unreachable).
- 4xx (unavailable): crawler MAY access everything.
- Cache at most 24 hours unless unreachable.
- robots.txt is not access authorization; it does not replace site terms of use, which ADR-0002 also requires respecting.

## Implications for implementation
- Build queries only from Search Criteria (role, location, contract type), never CV content or names (ADR-0007).
- Set `country: "FR"`, `search_language_filter: ["fr"]`, recency filter; exclude blocked domains via denylist but still check robots.txt before every fetch.
- Fail closed on robots.txt 5xx; treat CAPTCHA, Cloudflare challenge and login walls as "skip", never bypass.
- Cost is per request: count each search against Plan Quotas (ADR-0014).

## Open items (not found in primary sources fetched)
- Standard Search pricing, rate-limit tiers, and Perplexity data retention / EU processing terms: confirm in the Perplexity dashboard or with their sales/legal before launch.
- Per-site terms of use for French job boards (e.g. France Travail API terms) were not reviewed; decide whether to add them as an official-API source.
