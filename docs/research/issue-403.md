# Research for issue #403: provider billing facts for « one recorded cost per billed unit »

Checked 2026-10-27 against first-party docs. Builds on `docs/research/issue-398.md` and `llm-search-tools.md` (#384). **NOT VERIFIED** marks a claim no primary page confirmed. No regulation is involved: this is cost accounting only.

## Perplexity
Source: https://docs.perplexity.ai/docs/getting-started/pricing
- Search API: $5.00 / 1,000 requests (`web`), $1.00 / 1,000 (`search_type: "fast"`).
- Billing unit is the **successful `POST /search` request**, not the query: "A successful request containing an array of up to five queries is one billing unit." Invalid, rate-limited and upstream-failed requests are not billed; a successful request with zero results is billed. So record cost per call (1-5 queries = one unit), and record nothing on failure.
- Agent API (current code path): `web_search` $0.0025 per invocation (standard) or $0.001 (fast); `fetch_url` $0.0005 per invocation. One Agent-API call can invoke the tool several times, which is why the budget must sum recorded costs, not count one search per call.
- Prices are in **USD**: the EUR/USD rate setting is needed.

## Tavily
Source: https://docs.tavily.com/documentation/api-credits
- Search: `basic` 1 credit, `advanced` 2 credits (`fast` / `ultra-fast` 1 credit per #398). Pay-as-you-go $0.008 per credit; subscriptions are cheaper per credit (0.005 to 0.0075 $ per #384), so the default list price is an upper bound and the per-Tool override matters. 1,000 free credits per month.
- Whether a **failed Search** is billed is **NOT VERIFIED**: the page only promises no charge for failed Extract/Map. Treat a non-2xx as unbilled unless an invoice shows otherwise.
- The billed unit is the credit, so cost = credits x price per credit; `advanced` must record 2 credits.

## Brave
Source: https://api-dashboard.search.brave.com/documentation/pricing (the fetched page shows no figures; plan details are behind the dashboard).
- Figures from #384 (earlier first-party read): Search plan $5 / 1,000 requests, $5 free credit per month. Billing unit: one request. **Re-confirm in the logged-in dashboard**; the public page does not show it.
- Whether failed or rate-limited requests are billed is **NOT VERIFIED**.

## Implications for #403
1. Defaults in code (USD): Perplexity Search 0.005 (web) / 0.001 (fast) per call; Brave 0.005 per request; Tavily 0.008 per credit. Mark each with source and date, per the issue.
2. The multi-query rule means the adapter must record one unit per request, however many queries it batches.
3. All three bill in USD; convert with the overridable EUR/USD rate.
4. Free monthly allowances (Brave $5, Tavily 1,000 credits) are not reflected in per-call cost; the monthly alert threshold should state whether it counts list price or net of allowance.
