# Issue 243: Fantastic.jobs `active-ats` (research, 2026-10-20)

Sources: developer.fantastic.jobs docs (authentication, credit-usage, how-fantastic-jobs-api-works), developer.fantastic.jobs/terms, fantastic.jobs/api (pricing).

## API
- Auth: bearer token, `Authorization: Bearer <key>`. Docs suggest an env var such as `FANTASTIC_JOBS_API_KEY`; never client-side. Keys are managed on the subscriptions page. (authentication doc)
- Example URL: `https://data.fantastic.jobs/v1/active-ats?time_frame=24h`. Base URL is inferred (`/v1`), not stated explicitly. (authentication doc)
- `active-ats`: ATS jobs from company career pages. `active-jb`: LinkedIn, Wellfound, Y Combinator listings. (how-it-works doc)
- Rate limit: 600 requests/minute per plan. (credit-usage doc)
- Responses carry `x-api-*` headers with job/request balances, reset dates and `x-api-jobs-this-request`; quota values may lag a few seconds. (credit-usage doc)
- Design intent: recurring requests stored in your own DB. On-demand per-user queries are higher latency (seconds), return overlapping results and burn credits; the provider advises moving to recurring after the MVP. (how-it-works doc) This weighs on the "live search" decision in the issue.

## Plan and budget
- Jobs credits: 1 per job returned, only on `active-ats`/`active-jb`. API Requests credits: 1 per call, hard limit on all plans; Jobs overage only on some plans. Modified/expired/ats-organizations endpoints cost no Jobs credits. (credit-usage doc)
- Plans (monthly, ex tax, fantastic.jobs/api): trial free 14 days (500 jobs, 100 requests); $45 (5k jobs, 2.5k req); $95 (20k, 10k); $175 (50k, 25k); $250 (100k, 50k, $0.0025/job over); $500 (250k, 125k); larger Enterprise tiers above.
- Live search cost: each search consumes requests and one job credit per returned job, so budget = searches x jobs per search. The sample answer had 3 jobs per call; the trial's 100 requests is the binding limit.

## Terms of use (developer.fantastic.jobs/terms)
- Allowed: internal use; powering features of your own product, e.g. showing matched jobs to end users (s9.1-9.2).
- Forbidden: reselling/sublicensing/bulk redistribution of the raw data; building a competing job aggregation/resale service; bypassing rate limits; automated access outside the documented API (s9.2, s9.4, s7.2).
- Provider does not own underlying job data; original source terms still apply (s1.3, s10.2).
- Storage/caching limits and attribution: not addressed.
- `ai_*` fields may be inaccurate; validate before consequential decisions (s1.4). Matters for Match Score inputs.
- Violations can mean immediate suspension without refund (s9.3).

## Personal data
- The terms defer to the privacy policy (not read). The issue already excludes `active-jb` for recruiter personal data. The sample `active-ats` payload includes `ai_hiring_manager_name` and `ai_hiring_manager_email_address` (null in the sample): decide whether to drop them at ingestion (GDPR minimisation, data not needed for matching).

## Open / unverified
- Rate-limit behaviour on 429, exact API key per-environment model (staging vs prod): not documented; use separate subscriptions/keys per environment if per-environment quota isolation is wanted.
- Privacy policy and DPA terms for EU processing: not read.
- Free trial use in staging is possible; production needs a paid plan sized as above.
