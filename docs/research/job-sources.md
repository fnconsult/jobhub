# Issue #98: Which job sources can feed Job discovery?

Map: #96 (Job Search efficiency). Sources checked 2026-10-12. Each claim cites the first-party page, OpenAPI spec, or a live request made that day. **UNVERIFIED** marks anything that only third-party material supports.

Constraints applied: ADR-0001 (no LinkedIn), ADR-0002 (respect robots.txt and terms, never get around bot protection), ADR-0007 (EU storage; only Search Criteria or employer names may leave the EU, never CV content). No source below receives personal data: each gets only a query built from Search Criteria. So ADR-0007 data residency is a soft criterion here, the same as for Perplexity today. Targets from #96: at least 20 Job Offers with a Match Score of 60 or more, posted less than 30 days ago, results in under 2 minutes, under €0.10 per search.

## Verdict at a glance

| Source | Manager coverage FR | Posting date / expiry | ADR-0002 fit | Cost | Verdict |
|---|---|---|---|---|---|
| France Travail *Offres d'emploi* API | Broad national market, cadres included | Creation and update dates; no expiry (UNVERIFIED) | OK if access is granted | Free | **Access currently withdrawn.** Ask through the contact form |
| APEC | Best for cadres | Offers last 30 days (APEC recruiter page) | **No.** No public API, DataDome bot wall | n/a | Exclude from server side. Capture only |
| Welcome to the Jungle | Startups and scale-ups, some managers | n/a | **No.** No public API, CloudFront blocks bots | n/a | Exclude. Capture only |
| Greenhouse Job Board API | Per employer: tech and scale-ups, many English roles | `first_published`, `updated_at`, `application_deadline` | Yes (documented public API, robots allow) | Free | **Use** for known boards |
| Lever Postings API | Per employer, same profile | `createdAt` | Yes (robots `Allow: /`, crawl-delay 1) | Free | **Use** for known boards |
| Ashby posting API | Per employer, mostly tech | `publishedAt` | Yes (documented public API) | Free | **Use** for known boards |
| SmartRecruiters Posting API | Per employer; larger corporates too | `releasedDate`, `releasedAfter` filter, `experienceLevel` | **Grey area.** API robots.txt is `Disallow: /` for everyone but LinkedInBot | Free | Ask SmartRecruiters first, or skip |
| Workable | Per employer, SMEs | `created_at` (careers-page article) | Public endpoint moved; authed API is for the account owner | Free | Low priority |
| Adzuna API | Aggregator, `fr` country (UNVERIFIED list), all levels | `created`; `max_days_old` filter | Yes via API, but ToS limits use | Free tier capped | **Licence needed** for our use after a 14-day trial |
| Jooble API | Aggregator, fr.jooble.org | No documented fields (UNVERIFIED) | API by key request | Unknown | Weak primary docs; low priority |
| Brave Search API | Whole web, independent index | `freshness` filter; date field not documented | Yes (licensed API) | $5 / 1k | **Strong candidate** alongside or instead of Perplexity |
| Exa | Whole web, neural search | `startPublishedDate`, `publishedDate` | Yes | $4–15 / 1k + $1 / 1k pages | Candidate |
| Tavily | Whole web | `start_date`, `time_range`, `published_date` (estimate) | Yes | ~$0.005–0.008 / credit | Candidate |
| Linkup | Whole web; French company | `fromDate` / `toDate` | Yes | $0.005–0.006 / query | Candidate, the only EU-headquartered option |
| Serper (Google SERP) | Google results | n/a | **No.** Resells Google results; google.com robots disallows `/search` | n/a | Exclude |
| Perplexity (today) | Whole web | Model-dependent | Yes | Search API $5 / 1k; web_search tool $2.50 / 1k | Baseline |

## Official public sources

### France Travail: API *Offres d'emploi*
- **Status, and the main finding.** France Travail's own listing on data.gouv.fr, edited 2026-10-07, says the API "n'est actuellement plus exposée" on pole-emploi.io while distribution and reuse terms are reviewed. It gives the reason: "usages automatisés massifs par certaines solutions d'intelligence artificielle" that did not respect the licence. Organisations that need access must ask through the francetravail.io contact form. Access type: `restricted`. Source: https://www.data.gouv.fr/dataservices/api-offres-demploi (also the `GET https://www.data.gouv.fr/api/1/dataservices/api-offres-demploi/` JSON).
- **What it returns.** Live active offers collected by France Travail, plus partner offers whose owners agreed to publication through the API. It supports paged search on criteria, offer detail, and reference lists (place, sector, contract, training, job type), with filters on several job types, communes, departments and contract types. Same source.
- **Rate limit:** "10 appels / seconde". Availability: 99.8%. Same source.
- **Auth and shape (UNVERIFIED, third-party wrappers only).** OAuth2 client credentials on the partner realm, scope `api_offresdemploiv2`, route `/partenaire/offresdemploi/v2/offres/search`. Results are capped at 150 per request and about 1,150 per query through `range`, with `minCreationDate` and `maxCreationDate` filters (https://pypi.org/project/api-offres-emploi/). As far as wrappers show, offer fields carry a creation and an update date but no expiry. Confirm on the official docs once access is granted.
- **Fit.** It is the official, free, French-government source, and the data stays in France. ADR-0002 fit is perfect if access is granted. Because Jobbbox is an AI product, it falls exactly in the category France Travail is reviewing. Expect a licence conversation. Nothing should depend on this source until access is granted.
- **Manager coverage.** It covers the whole French market, cadre roles included. The share of manager-level offers is not documented.

### APEC (Association pour l'emploi des cadres)
- **No public developer API found.** APEC's recruiter pages describe offers spreading to more than 20 partner sites and a recruiter dashboard, nothing developer-facing. Offers are published for 30 days and can be renewed for 30 more (https://www.apec.fr/recruteur/recruter/diffuser-une-offre/fiches-transactions/lapec-sadapte-a-vous-dans-la-creation-de-votre-offre.html, seen through search).
- **Bot protection.** `GET https://www.apec.fr/robots.txt` returns a DataDome challenge page (`geo.captcha-delivery.com`), and the CGU page returns HTTP 403 to automated clients. Under ADR-0002 we must not get around this, so APEC is out of scope for server-side Job discovery. It is the main gap for our audience. Options: a partnership request to APEC, or Capture through the extension (a candidate for the extension's automatic-detection list).

### Welcome to the Jungle
- **No public job-search API found.** Its integrations are partner-only: WTTJ opens the API scope for an ATS account by hand, under contract (https://support.teamtailor.com/en/articles/9190035-publish-jobs-on-welcome-to-the-jungle).
- `https://www.welcometothejungle.com/robots.txt` returns CloudFront 403 "Request blocked" to automated clients, so it counts as bot-protected under ADR-0002. Treat it like a Forbidden site: Capture only.

## Public ATS job feeds

How they would be used: every ATS API is scoped **per employer** (board token or company id), and none offers a directory of all employers (Greenhouse and Lever docs, below). They cannot be searched by keyword across employers. They fit as a **structured fetch step** after a web search finds a URL on an ATS domain (`job-boards.greenhouse.io`, `jobs.lever.co`, `jobs.ashbyhq.com`, `apply.workable.com`, `jobs.smartrecruiters.com`). For example, a search provider restricted to those domains (`include_domains` on Tavily, Exa or Linkup) finds the URL, and we then call the JSON API to get a reliable date and full text. This replaces HTML parsing for those offers and gives exact dates for the freshness target. Their coverage leans to tech and scale-ups and to English. Traditional French corporates, where many 40+ managers are hired, often use Workday, SAP SuccessFactors, Taleo or Cegid/Talentsoft, which have no documented public posting API.

### Greenhouse: Job Board API
- `GET https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs[?content=true]`. "Authentication is not required for any GET endpoints" (https://docs.greenhouse.io/job-board.html). No rate limits or terms are stated.
- A live list response (2026-10-12) includes `first_published`, `updated_at`, `application_deadline`, `location`, `absolute_url`, `language` and `company_name`. So the posting date is reliable, and the expiry is reliable when the employer sets it.
- `boards-api.greenhouse.io/robots.txt` disallows only `/embed/`. ADR-0002: OK.

### Lever: Postings API
- `GET https://api.lever.co/v0/postings/{site}?mode=json&skip&limit`, plus an EU instance `https://api.eu.lever.co/v0/postings/`. No key is needed to read. Filters: `location`, `commitment`, `team`, `department`, `level`. Only application POSTs are rate limited (2/s). There is no full-text search and no list of companies. The page says published postings are public (https://github.com/lever/postings-api).
- A live response includes `createdAt`, `workplaceType`, `country`, `categories`, `hostedUrl` and `salaryRange`. No expiry field.
- `api.lever.co/robots.txt`: `Allow: /`, `Crawl-delay: 1`. ADR-0002: OK, at 1 request per second or slower.

### Ashby: public job posting API
- `GET https://api.ashbyhq.com/posting-api/job-board/{name}?includeCompensation=true`. No auth is documented. Fields: `publishedAt` ("last published"), `isRemote`, `workplaceType`, `location`, `address.postalAddress.country`, `isListed` and `compensation` (https://developers.ashbyhq.com/docs/public-job-posting-api). No rate limits or terms are stated.
- `jobs.ashbyhq.com/robots.txt` disallows `/api/`. That covers the HTML host's internal API, not `api.ashbyhq.com`, which is the documented public endpoint. ADR-0002: OK. Ignore unlisted jobs (`isListed=false`).

### SmartRecruiters: Posting API
- `GET https://api.smartrecruiters.com/v1/companies/{companyIdentifier}/postings`. Security includes an empty scheme, so the public postings need no auth. Params: `q`, `limit` (max 100), `offset`, `country`, `region`, `city`, `locationType` (REMOTE/HYBRID/ONSITE), `language`, `releasedAfter`. Items carry `releasedDate`, `location.remote`, and `experienceLevel`, whose enum includes `director` and `executive` and is useful for manager targeting (OpenAPI at https://developers.smartrecruiters.com/reference/v1listpostings.md). Rate limit: 10 requests per second and 8 concurrent per credential (https://developers.smartrecruiters.com/docs/rate-limiting.md).
- **ADR-0002 concern.** `https://api.smartrecruiters.com/robots.txt` is `User-agent: LinkedInBot / Allow: /v1/companies/` and then `User-agent: * / Disallow: /`. The API is documented for customers' own career sites. A third party fetching it in bulk goes against that robots file. Recommendation: ask SmartRecruiters for permission before use, or leave it out.

### Workable
- The documented public endpoint `www.workable.com/api/accounts/{subdomain}?details=true` now returns 302 to `apply.workable.com/api/v1/widget/accounts/{subdomain}`. The authenticated `/spi/v3/jobs` needs an account-owner token with `r_jobs`. A sample job shows `created_at`, `location.telecommuting`, `country_code` and `state` (https://help.workable.com/hc/en-us/articles/115012771647). `apply.workable.com/robots.txt` sets `Content-Signal: search=yes, ai-input=yes, ai-train=no`, which allows our use (search and AI input, no training). Low priority: SME-heavy, and the public endpoint is unstable.

## Aggregators

### Adzuna
- `GET https://api.adzuna.com/v1/api/jobs/{country}/search/{page}?app_id&app_key&what&where&results_per_page&max_days_old&sort_by…`. Fields: `created`, `redirect_url`, `description` (a snippet only), `salary_min` and `salary_max` (`salary_is_predicted`), `contract_type`, `company` and `category` (https://developer.adzuna.com/docs/search, https://api.adzuna.com/v1/doc/Search.md). `fr` is a supported country per third-party lists (UNVERIFIED; adzuna.fr exists). There is a posting date but no expiry. Only a snippet comes back, so Match Scoring needs a fetch of the target page, which may be a Forbidden site.
- **Terms** (https://developer.adzuna.com/docs/terms_of_service): default limits are 25 hits per minute, 250 per day, 1,000 per week and 2,500 per month. Each ad shown needs an "Adzuna" label of at least 116×23 px linking to Adzuna. Commercial use beyond publishing listings is limited to a 14-day trial, after which "a licence agreement may be required". Queries must go through Adzuna, and contacting the third-party source is a breach. ADR-0002 fit is fine through the API, but **commercial use needs a negotiated licence**. Adzuna is a UK company (ADHUNTER LTD).

### Jooble
- A key is granted on request through a form (name, website, phone) at https://jooble.org/api/about. The first-party page documents no endpoint, fields, pricing or limits. Third parties describe `POST https://jooble.org/api/{key}` with `keywords`, `location`, `radius` and `page`, returning `snippet`, `updated`, `link` and `source` (UNVERIFIED). Results redirect through Jooble (`/away/`, `/desc/` are disallowed in fr.jooble.org's robots.txt). Low confidence. Ask Jooble for docs and terms before relying on it.

Other French boards checked only for robots stance: HelloWork's robots disallows `/fr-fr/api/` and query URLs. Cadremploi returns a Cloudflare "Sorry, you have been blocked" page. Both have no public API, so Capture only.

## Web search providers (alternatives or complements to Perplexity)

All are US-hosted unless noted. None documents EU data residency below Enterprise. That is acceptable under ADR-0007, which already allows Perplexity to receive Search Criteria queries.

| Provider | Price | Date control | Notes |
|---|---|---|---|
| **Perplexity** (today) | Search API $5 / 1k ($1 fast); web_search tool $2.50 / 1k plus model tokens (https://docs.perplexity.ai/getting-started/pricing) | Model-dependent | Baseline |
| **Brave Search API** | $5 / 1k, 50 QPS, $5 free credit per month (https://brave.com/search/api/) | `freshness` = `pd`/`pw`/`pm`/`py` or a date range; `country`, `search_lang`; `count` ≤20, `offset` ≤9 | Independent index of more than 30 billion pages. **Storing results needs a plan that "explicitly grants storage rights"**, which matters because we persist Job Offers. Check which plan, or store only our own fetch of the target page. |
| **Exa** | Search $4 (instant) to $15 / 1k, $1 / 1k pages of contents, $10 free per month (https://exa.ai/pricing) | `startPublishedDate` / `endPublishedDate`, `startCrawlDate`, `publishedDate` in results, `includeDomains`, `userLocation` (https://exa.ai/docs/exa-spec.yaml) | Can return page text, which saves our own fetch. ZDR is Enterprise only. |
| **Tavily** | 1 credit basic / 2 advanced per search; $0.005–0.008 per credit; 1,000 free per month (https://docs.tavily.com/documentation/api-credits) | `time_range`, `start_date` / `end_date`, `country` boost, `include_domains` (≤300, hard filter), `include_raw_content`, `published_date` (an estimate, may be null) (https://docs.tavily.com/documentation/api-reference/endpoint/search) | Bearer auth. Good fit for the ATS-domain search pattern. |
| **Linkup** | $0.005–0.006 per query, 4,000 free (https://www.linkup.so/pricing) | `fromDate` / `toDate`, `includeDomains` (≤100), `structured` output with a JSON schema (https://docs.linkup.so/pages/documentation/api-reference/endpoint/post-search) | **Paris-based company** (third-party sources). EU hosting **not documented** on first-party pages. Worth asking for a DPA if EU residency matters. ZDR is Enterprise only. |
| **Serper** | Not stated on the homepage; 2,500 free (https://serper.dev/) | n/a | Sells Google SERP results. `google.com/robots.txt` disallows `/search` for `*`. Buying scraped Google results conflicts with ADR-0002's spirit. **Exclude.** |

Cost check against €0.10 per search: at about $0.005 per query, 8–10 queries plus 30 ATS JSON fetches (free) stays near $0.05. That leaves room for AI scoring.

## Recommendations for #99 and the spec

1. **Request France Travail access now** through the francetravail.io contact form. Describe Jobbbox's use honestly: AI-assisted matching for a Candidate, no training on the data, with attribution. It is the only free, official, France-wide source with structured dates. Plan without it until it is granted.
2. **Add ATS JSON fetch as a structured step:** Greenhouse, Lever, Ashby, plus Workable if stable. Search provider results on ATS domains are turned into API calls that give exact `first_published`, `createdAt` or `publishedAt` dates and full text. This directly serves the freshness target and the Expired Job Offer re-checks (the job disappears from the board's JSON). Leave SmartRecruiters out until permission is given.
3. **Make the search provider pluggable** and benchmark Perplexity against Brave, Tavily and Linkup on the same Search Criteria: volume, freshness, cost. Brave and Tavily have explicit date filters. Linkup is the European option. Check Brave's storage-rights clause before persisting its snippets.
4. **Do not use** APEC, Welcome to the Jungle, HelloWork, Cadremploi or Serper server-side (bot protection or ToS). APEC is the biggest coverage gap for 40+ managers. Consider asking APEC for a partnership, and add APEC to the extension's automatic-detection list.
5. **Aggregators (Adzuna, Jooble):** only after a commercial licence. Their snippets point to Forbidden sites often enough to cut the yield.

## Open questions
- France Travail: the conditions and timeline for granting access to a private AI product, and whether partner offers (possibly including cadre boards) are included.
- Adzuna: the licence price for scoring listings in a paid product, and whether showing a Match Score counts as "publishing listings".
- Brave: which plan includes storage rights.
- Linkup and Exa: where queries and logs are processed (an EU region?).
- The share of French manager-level offers on Greenhouse, Lever and Ashby, to be measured in the #99 baseline with a sample of Search Criteria.
