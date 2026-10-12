# Job Search baseline benchmark (#97)

Map: #96 (Job Search efficiency). Run on 2026-10-12 against `origin/main` at `3ef37d5`. There were 10 Search Criteria, with one real Job Search each.

**Result in one line:** today's Job discovery turned 100 search-result URLs into **1 Job Offer**, and that offer scored **0 at 60 or more**. Time and cost are well within the targets. Volume fails by a wide margin, so freshness can barely be measured.

## Targets (map #96) vs baseline

| Target | Baseline (10 searches) | Verdict |
|---|---|---|
| ≥ 20 Job Offers with Match Score ≥ 60 per search | **0** in every search. 1 Job Offer found in all 10 searches (score 55) | Fail |
| Offers posted < 30 days ago | 1 of 1 offer (13 days). But 9 of the 15 result URLs that pointed at a single posting were already gone (404/410) or expired | Can't measure. Signs of a stale index |
| Time to results < 2 min | median 13.7 s, max 24.7 s | Pass |
| Cost < €0.10 per search | median €0.014, max €0.030 (€0.147 for all 10). That is **€0.147 for the 1 offer found** | Pass per search. Very poor per offer |

## Funnel: where offers are lost (all 10 searches)

```
Provider URLs returned ............ 100   (exactly 10 per search: Perplexity returns 10 search_results)
  of which point at ONE posting .....  15   (85 are search/category/listing pages)
Refused before reading ............  54   bot_protection 32 · login_wall 7 · gone 7 · site_terms 6 · robots 2
Read, but "not a job offer" .......  45   43 listing pages + 2 expired single postings
Job Offers extracted ..............   1
After dedup .......................   1   (0 duplicates merged)
Match Score ≥ 60 ..................   0
Judged relevant by hand ...........   1   (the one offer: right role, city and contract, salary below the minimum)
```

Single-posting URLs (15): 7 gone (404/410), 3 behind bot protection, 2 behind a login wall, 2 read but expired or not an offer, **1 captured**.

## Per Search Criteria

Columns: URLs returned (how many point at one posting), refused before reading, read but not an offer, Job Offers after dedup, Match Scores, offers ≥ 60, hand-judged relevant / partly, offers under 30 days old, offers that look expired, wall-clock (search / page fetches / LLM extraction), estimated €.

| Case | URLs (single) | Refused | Read, not offer | Offers | Scores | ≥60 | Relevant / partly | <30 d | Expired | Time s (search / fetch / LLM) | € |
|---|---|---|---|---|---|---|---|---|---|---|---|
| c01 DAF, Paris, hybrid, ≥110 k | 10 (0) | 5 | 5 | 0 | – | 0 | 0 / 0 | 0 | 0 | 13.0 (2.7 / 3.7 / 6.3) | 0.019 |
| c02 Directeur commercial B2B, Lyon | 10 (2) | 6 | 4 | 0 | – | 0 | 0 / 0 | 0 | 0 | 20.1 (2.7 / 8.0 / 8.9) | 0.011 |
| c03 DSI, Nantes, hybrid | 10 (1) | 6 | 4 | 0 | – | 0 | 0 / 0 | 0 | 0 | 12.2 (2.5 / 1.4 / 8.2) | 0.015 |
| c04 DRH, Bordeaux | 10 (3) | 8 | 2 | 0 | – | 0 | 0 / 0 | 0 | 0 | 6.4 (2.8 / 1.1 / 2.3) | 0.007 |
| c05 Directeur d'usine, Rouen, on site | 10 (2) | 6 | 4 | 0 | – | 0 | 0 / 0 | 0 | 0 | 14.5 (3.1 / 4.0 / 7.2) | 0.007 |
| c06 Chef de projet senior, Toulouse, hybrid | 10 (1) | 6 | 4 | 0 | – | 0 | 0 / 0 | 0 | 0 | 12.8 (3.1 / 0.7 / 8.9) | 0.017 |
| c07 RAF, Angoulême (small city) | 10 (1) | 6 | 4 | 0 | – | 0 | 0 / 0 | 0 | 0 | 10.1 (2.5 / 1.4 / 5.2) | 0.013 |
| c08 Directeur supply chain, Lille | 10 (2) | 4 | 5 | 1 | 55 | 0 | 1 / 0 | 1 | 0 | 24.7 (2.4 / 1.6 / 20.7) | 0.015 |
| c09 Directeur marketing, France, full remote | 10 (1) | 5 | 5 | 0 | – | 0 | 0 / 0 | 0 | 0 | 16.3 (3.0 / 4.5 / 8.5) | 0.012 |
| c10 Head of Finance Transformation (EN), Paris | 10 (2) | 2 | 8 | 0 | – | 0 | 0 / 0 | 0 | 0 | 19.1 (2.4 / 3.4 / 13.1) | 0.030 |

Which sites refused us, and why (all runs): emploi.lefigaro.fr bot_protection ×14, apec.fr bot_protection ×10, cadremploi.fr bot_protection ×7, meteojob.com login_wall ×6, fr.indeed.com site_terms ×6, candidat.francetravail.fr gone ×4. The sites we read but got no offer from: hellowork.com listing pages ×25, jobijoba.com ×7, michaelpage.fr ×4, welcometothejungle.com `/pages/` ×3. Per-URL detail is in `results/<case>.json` (`skipped`, `fetches`).

## Top causes, in order of impact

1. **The web search returns listing pages, not postings.** 85 of the 100 URLs were search, category or "métier × ville" pages. Job discovery reads one page as one Job Offer, so a page listing several postings comes out as `not_a_job_offer` (43 cases). The readable listings (HelloWork, Jobijoba, Michael Page, WTTJ) do link to individual postings, but nothing follows those links.
2. **Half the results are blocked under ADR-0002.** 50 of 100 URLs were refused for bot protection, a login wall, site terms or robots. They come from Le Figaro Emploi, APEC, Cadremploi, Meteojob and Indeed, which are the main boards for French managers. The search provider keeps sending us to sites we may not read.
3. **Hard cap of 10 URLs per search.** One Perplexity call returns exactly 10 `search_results`, and `maxPages` is 10. Even if every URL were a readable, fresh, relevant posting, a search would yield at most 10 Job Offers, so the target of 20 at ≥ 60 cannot be reached by design.
4. **The index is stale for single postings.** Of the 15 URLs that pointed at one posting, 7 answered 404/410 (France Travail, HelloWork, trabajo.org) and 1 more was a HelloWork page saying the offer is no longer available. The provider's `date` field is when the page was last crawled, not when the offer was posted, so it cannot be used to filter for freshness.
5. **The useful part of the provider's answer is thrown away.** Perplexity's text answer often names 2 to 4 concrete matching offers, with employer, city and salary. For example, c05 Rouen named CARTESIO, Taleah, a family-owned group and Exolys. Job discovery keeps only the URLs. Secondary: the Match Score matches skills by literal substring. The one relevant offer scored 55 because "Gestion de la chaîne d'approvisionnement" is not literally in a CV that says "Supply chain" and "Approvisionnement". This rests on one data point, so treat it as a hypothesis for the Match Score ticket.

Cost note: 77–96 % of each search's cost is Mistral `offer_analysis`. It reads up to 30,000 characters of every listing page only to answer "not a job offer" (median ~27 k input tokens per search). Perplexity itself bills about $0.0016 per search.

## Method

- **Dataset:** `dataset.json`, generated by `make-dataset.mjs`. It holds 10 Search Criteria for French managers aged 40+: DAF, directeur commercial, DSI, DRH, directeur d'usine, chef de projet senior, RAF in a small city, supply chain, full-remote marketing, and one English-language role. Regions are Paris, Lyon, Nantes, Bordeaux, Rouen, Toulouse, Angoulême, Lille and "France". Each case has a short **fictional** Master CV (no real person) so that `scoreMatch` can run.
- **Script:** `benchmark.ts`. Run it with `npx tsx docs/research/job-search-baseline/benchmark.ts <env file> [caseId…]`. It calls the real `createJobDiscovery` (apps/worker), so it uses the real `buildSearchQuery`, the Perplexity `/v1/responses` provider with preset `fast`, polite fetch with robots.txt, JSON-LD and LLM extraction, and the default `maxPages` of 10. It wires these through `createAiLayerFromEnv` with the repo's local `.env` routing: web_search → Perplexity, offer_analysis → Mistral `mistral-large-latest`. No queue and no DB: Job Offers go to an in-memory store that deduplicates with the same keys as `apps/web/src/job-offers` (URL key without tracking parameters, plus a content fingerprint). The script wraps `fetch`, `searchWeb` and `generate` to time each stage and collect usage. Each offer is scored with `scoreMatch(cv, offer, criteria)`. The stage times are sums of sequential calls; the total also includes robots.txt requests and crawl-delay waits.
- **Posting date and expiry:** read from the fetched page in this order: JSON-LD `datePosted`, then meta `published_time`, then "il y a N jours" / "posted N days ago", then "publiée le …". An offer looks expired if `validThrough` has passed, the page says the offer is closed or no longer available, or it was posted more than 60 days ago. Note that the extraction prompt already rejects pages that say an offer has expired, so those show up as `not_a_job_offer`.
- **Cost:** Perplexity bills each response and reports the amount in `usage.cost.total_cost`. We used that figure, which is about $0.0012–0.0018 per search: search_web $0.001 plus tokens. List prices from [docs.perplexity.ai/getting-started/pricing](https://docs.perplexity.ai/getting-started/pricing) (read 2026-10-12): the Agent API `fast` preset costs $0.20 per M input tokens and $1.20 per M output tokens, plus $0.001–0.0025 per web search. The model reported back was `openai/gpt-6-luna`. Mistral Large costs $0.5 per M input tokens and $1.5 per M output tokens ([mistral.ai/pricing](https://mistral.ai/pricing), read 2026-10-12). We converted at 1 USD = 0.86 EUR, which is an assumption. Total spend for the benchmark was about €0.17, including one earlier trial run of c01.
- **Run cadence:** one run per case, sequential, from a home connection in France, on 2026-10-12. Perplexity's results vary from run to run. An earlier trial run of c01 gave the same funnel: 10 listing URLs and 0 offers.

### Relevance rubric (hand-judged, `judgments.json`)

- **relevant:** same job family and level as the target role, in or commutable to the location (or remote as asked), and a compatible contract. A salary below the minimum is noted but does not by itself downgrade the verdict.
- **partly:** adjacent role (e.g. "Responsable" instead of "Directeur", or a neighbouring function) or wrong level, or the right role in the wrong region.
- **not:** a different job family, a junior role, or not a real opening.

Only one offer reached the judging stage, so the relevance numbers say nothing about precision yet. The real bottleneck is upstream.

## Files

- `dataset.json` and `make-dataset.mjs`: Search Criteria and fictional CVs
- `benchmark.ts`: the instrumented run (throwaway, not production code)
- `results/<case>.json`: raw output per case: query, provider URLs, the Perplexity answer, usage and billed cost, every page request with status and ms, skip reasons, and offers with score, breakdown, date and expiry
- `judgments.json`: the hand-made relevance verdicts
- `summarize.mjs` and `results/summary.json`: the aggregates behind the tables above
