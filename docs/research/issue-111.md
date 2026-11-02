# Issue #111: provider pricing facts for the search benchmark

Scope: only what the per-EUR pass rule needs. API request/response shapes are already in `issue-110.md`. Sources are vendor pricing pages, fetched 2026-10-12. All prices are USD; no vendor page states EUR billing. Convert at benchmark time and record the rate used.

## Cost per search request (raw results, no LLM answer)
| Provider | Price | Source |
|---|---|---|
| Perplexity Search API | $5.00 per 1,000 (standard); $1.00 per 1,000 with `search_type: "fast"`; per successful request, no token cost | https://docs.perplexity.ai/guides/pricing |
| Brave Search plan | $5 per 1,000; $5 free credit monthly (card required for identity); 50 QPS | https://brave.com/search/api/ |
| Tavily | 1 credit basic, 2 credits advanced; $0.008/credit pay-as-you-go ($0.0075 to $0.005 on monthly plans); 1,000 free credits/month, no card | https://docs.tavily.com/documentation/api-credits |
| Linkup | $0.005 standard (also fast/flash); $0.05 deep; +$0.001 for sourced answer or structured output; errors not charged | https://docs.linkup.so/pages/documentation/development/pricing |

Per 1,000 requests: Perplexity $5 (fast $1), Brave $5, Tavily $8 basic / $16 advanced (pay-as-you-go), Linkup $5 standard / $50 deep.

## Notes for the benchmark
- Current provider: the repo uses Perplexity. The Sonar chat models bill tokens plus a request fee ($5 to $14 per 1,000 by context size), much more than the Search API. Benchmark the Search API, and say which Perplexity endpoint the baseline used when comparing "per EUR".
- Tavily `advanced` doubles the cost; benchmark `basic` first and report advanced separately.
- Linkup `deep` is 10x standard; treat as a separate row.
- Free allowances (Brave $5, Tavily 1,000 credits, Linkup $20 starter credit for professional-email accounts) probably cover a 10-criteria benchmark. Estimate: 10 criteria x a few queries is far under 1,000 requests.
- Brave: the pricing page lists no separate price for its LLM-context endpoint; UNVERIFIED.
- Not checked (not needed for the benchmark): data hosting location, rate limits beyond Brave's 50 QPS (see ADR-0007 if hosting matters for the default).
- robots.txt/bot-protection of target sites is governed by ADR-0002, an internal decision, not researched here.
