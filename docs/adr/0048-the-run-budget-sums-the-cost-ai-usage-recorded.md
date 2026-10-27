# The run budget sums the cost AI Usage recorded, with the Tools' prices as Platform Settings

The Job discovery budget (`JOB_DISCOVERY_BUDGET_EUR`) priced each web search with its own estimate, apart from what AI Usage recorded, so the two could disagree and a search billed in several units (Tavily's advanced search, 2 credits) counted as one. Decided in #403, building on ADR-0042 (prices overridable on the provider's sheet) and ADR-0043.

- **One cost**: every AI layer result carries `CallFacts.costEur`, the cost AI Usage records for the call (tokens plus each billed unit at the price in use; a unit with no known price counts 0). The worker's budget sums it. Merged multi-call searches add theirs up.
- **Billed units**: Perplexity one call ($0.001 "fast", $0.005 "web"), Brave one request ($0.005), Tavily one credit ($0.008, 2 for an advanced search). A Tool with no price entry is recorded with cost null (« prix inconnu »).
- **Prices are Platform Settings** in a `prices` group (`PERPLEXITY_FAST_SEARCH_PRICE_USD`, `PERPLEXITY_SEARCH_PRICE_USD`, `BRAVE_SEARCH_PRICE_USD`, `TAVILY_CREDIT_PRICE_USD`, `EUR_PER_USD`); the code default is the list price, with its source URL and date. A change rebuilds the AI layers, so the next call uses it. Token prices stay in code.
- **Monthly alert**: `WEB_SEARCH_MONTHLY_ALERT_EUR` emails super-admins once per Paris-time month and shows a Consommation IA banner; nothing is cut. The month's alert is recorded (`web_search_alert`) before the emails go out, removed if sending fails.

Not yet: Coach Message Cost, evals and the Back Office Assistant still use `costInEur` at list prices, so a changed `EUR_PER_USD` does not reach them.

## Considered Options

- **Keep the worker's own estimate**: simplest, but the budget and AI Usage drift apart and multi-unit calls are undercounted.
- **Prices in code only**: a list price change needs a deploy.
- **Cut web search when the threshold is reached**: a Candidate's search would fail on a figure nobody can check live; the alert tells a person instead.
