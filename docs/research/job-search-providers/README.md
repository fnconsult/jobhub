# Search provider benchmark (#111)

Map: #96 (Job Search efficiency). Decided in #99 (Q1, Q19). This re-runs the 10 baseline Search Criteria of #97 with each web search provider (Perplexity, Brave, Tavily, Linkup) and keeps the same funnel.

**Status: incomplete. Only the Perplexity row exists, so there is no winner yet.** Brave, Tavily and Linkup need real API keys (`BRAVE_SEARCH_API_KEY`, `TAVILY_API_KEY`, `LINKUP_API_KEY`), and none was available when this was prepared. The harness, the pass rule and the verdict are ready and tested. With the keys, finishing it takes three commands (see "Finishing the benchmark"). Until then `AI_WEB_SEARCH_PROVIDER` stays `perplexity`.

## Pass rule

The issue's rule is: **the most single-posting URLs on sites readable under ADR-0002, per €.** The code is in `pass-rule.ts` and is tested in `pass-rule.test.ts`.

- **Single posting:** a result URL that points at one job posting, not at a search, category or "métier × ville" page. It is judged from the URL shape alone (`isSinglePosting`), using the posting URL patterns of the boards and career sites in the results (HelloWork `/emplois/<id>.html`, France Travail `/offres/recherche/detail/<id>`, WTTJ `/companies/<c>/jobs/`, ATS `/job(s)/<id>`, and so on). It agrees with the #97 hand count: 15 of the 100 Perplexity URLs.
- **Readable:** Job discovery actually read the page. It was not refused under ADR-0002 (robots, site terms, bot protection, login wall), it was not gone (404/410, a stale index), and it was not unreachable. A page that was read and judged "not a job offer" (often an expired posting) still counts, because the site was readable and the URL was a posting.
- **Per €:** distinct readable single postings ÷ the web searches' cost in €. That is the provider's fee plus tokens. It does not include the LLM reading pages, which depends on the pages and not on the provider. The all-in cost is reported next to it.
- **Verdict (`verdict`):** the provider with the highest per € wins. A tie goes to the one with more readable single postings. It is a **fan-out of the top two** when, together, they find at least 1.5 times the winner's distinct readable single postings, because then the runner-up mostly finds *other* postings. There is **no winner** if no provider sent a single readable posting, and the result is **incomplete** while any provider has not been run.

The fan-out threshold of 1.5 is this benchmark's proposal. The issue does not set it.

## Results so far

| Provider | Cases | URLs | Single postings | Readable single postings | Refused | Read, not an offer | Job Offers | ≥60 | <30 d | Median s | Search € | Total € | Readable single postings per search € |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| perplexity | 10 | 100 | 15 | 3 | 54 | 45 | 1 | 0 | 1 | 13.7 | 0.0136 | 0.1471 | 220.6 |
| brave | not run | | | | | | | | | | | | |
| tavily | not run | | | | | | | | | | | | |
| linkup | not run | | | | | | | | | | | | |

Verdict: `{"kind":"incomplete","notRun":["brave","tavily","linkup"]}`

The Perplexity row is the #97 baseline, copied unchanged into `results/perplexity/` from `research/job-search-baseline` (458fc63). Its search cost is the amount Perplexity billed (`usage.cost.total_cost`). It used the **Agent API** (`/v1/responses`, preset `fast`, about $0.0016 per search). It did not use Perplexity's raw Search API ($5 per 1,000), which the repo has no adapter for. The 3 readable single postings are the one Job Offer captured (HelloWork, c08), one HelloWork posting read as no longer an offer, and one Robert Half posting read as not an offer.

## List prices per search (from `docs/research/issue-111.md`, USD)

| Provider | Price per request | Variant benchmarked by default |
|---|---|---|
| Perplexity Agent API, preset `fast` | ~$0.0012–0.0018 billed (fee + tokens) | baseline |
| Brave Search | $0.005 | web search, 20 results |
| Tavily | $0.008 basic, $0.016 advanced | `basic` (run `tavily:advanced` as a separate row) |
| Linkup | $0.005 standard, $0.05 deep | `standard` (run `linkup:deep` as a separate row) |

`packages/ai/src/cost.ts` holds these prices, and the benchmark uses it. Conversion is at `EUR_PER_USD` = 0.86, an assumption.

## Finishing the benchmark

Put the three keys in an env file that also routes `offer_analysis` the way the baseline did (Mistral, `mistral-large-latest`). Then:

```sh
npx tsx docs/research/job-search-providers/benchmark.ts <env file> brave
npx tsx docs/research/job-search-providers/benchmark.ts <env file> tavily
npx tsx docs/research/job-search-providers/benchmark.ts <env file> linkup
npx tsx docs/research/job-search-providers/summarize.ts   # table + verdict, writes results/summary.json
```

Optional extra rows: `tavily:advanced` and `linkup:deep`. They are not part of `summarize.ts`'s verdict, which compares the four default variants.

Expected spend: the searches cost under €0.10 per provider. The free allowances cover them (Brave $5/month, Tavily 1,000 credits/month, Linkup starter credit). The LLM reading pages costs about €0.15–0.30 per provider, more than the baseline because up to 20 URLs are read instead of 10.

Then act on the verdict:

- **winner:** set `AI_WEB_SEARCH_PROVIDER` to it in `.env.example`, in `DEFAULT_PROVIDER.web_search` (`packages/ai/src/env.ts`) and in the setup script, and update ADR-0007's "Perplexity stays the default".
- **fan-out:** implement querying both providers in Job discovery and merging their URLs.
- Update the "Decisions so far" of map #96 either way.

## Method

- **Dataset:** `dataset.json` is the #97 dataset, unchanged. It holds 10 Search Criteria for French managers aged 40+, each with a fictional Master CV. `judgments.json` holds the #97 hand verdicts.
- **Script:** `benchmark.ts` is the #97 script with the provider as a parameter. It calls the real `createJobDiscovery` (apps/worker) through `createAiLayerFromEnv`, with `AI_WEB_SEARCH_PROVIDER` (and `AI_WEB_SEARCH_MODEL` for `provider:model`) set to the provider under test. Pages go through the real polite fetch (robots.txt, ADR-0002) and the real JSON-LD and LLM extraction. Offers go to an in-memory store with the same dedup keys, and each offer is scored with `scoreMatch`. It refuses to start without the provider's key.
- **Difference from #97:** every URL the provider returns is looked at (`maxPages` unlimited), not just the first 10. Brave and Tavily can return 20 results per search, and the pass rule counts the readable postings among all of them. Perplexity returned exactly 10, so the baseline row is comparable.
- **Funnel:** the same as #97: provider URLs, single postings, refused before reading (by Skip reason), read but not a Job Offer, Job Offers after dedup, Match Score ≥ 60, posted < 30 days ago, wall-clock and €.
- **Run cadence:** one run per case, sequential, the same as #97. Results vary from run to run for every provider.

## Files

- `pass-rule.ts`, `pass-rule.test.ts`: the pass rule and the verdict. Run the tests with `npx tsx --test docs/research/job-search-providers/pass-rule.test.ts`.
- `benchmark.ts`: the instrumented run, one provider at a time. It is throwaway and not production code.
- `summarize.ts`: aggregates `results/<provider>/*.json` into `results/summary.json` and prints the table and the verdict.
- `results/perplexity/`: the #97 baseline runs.
- `dataset.json`, `judgments.json`: from #97.
