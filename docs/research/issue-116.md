# Research for #116: Freshness rule (30-day drop, label undated)

Checked 2026-10-14, only what implementation needs. Primary sources only.

## Brave Search API: `freshness`
Source: https://api-dashboard.search.brave.com/app/documentation/web-search/query
- Values: `pd` (24h), `pw` (7d), `pm` (31 days), `py` (year), or a custom range `YYYY-MM-DDtoYYYY-MM-DD` (example given: `2022-04-01to2022-07-30`).
- There is no 30-day preset. `pm` is 31 days: use it (or a custom range ending today) as a coarse pre-filter, and still apply our own 30-day cut on the parsed date.
- The query page does not document a per-result date field. Unverified: confirm `age` / `page_age` on a live response before relying on it as the "search provider's date".

## Tavily Search: date filters
Source: https://docs.tavily.com/documentation/api-reference/endpoint/search
- `time_range`: `day|week|month|year` (or `d|w|m|y`), counted back from today. `start_date` / `end_date`: `YYYY-MM-DD`. No `days` param on this page (it belongs to the news topic in older docs; not documented here).
- Results with no detectable date are KEPT by default. `filter_by_published_date=true` removes undated results too, so do NOT set it (it would contradict "undated -> kept").
- `published_date` is returned only when `include_published_date=true` (auto for `topic=news`). It is a best estimate of published OR LAST UPDATED, so it can be later than the real posting date. Format example: `Tue, 11 Mar 2025 17:00:00 GMT` (RFC 1123, not ISO). Null when unknown. Feature is marked beta.

## JSON-LD `JobPosting.datePosted`
Source: https://developers.google.com/search/docs/appearance/structured-data/job-posting
- Required by Google; ISO 8601, date (`2017-01-24`) or date-time with offset. Meaning: the date the employer originally posted the job. Parse both forms.
- `validThrough` (ISO 8601) is the expiry date; expired jobs set it to the past or return 404/410. Related to the Expired Job Offer feature, not this rule.
- Pages may still omit or mis-fill it, so the undated path is real.

## ATS JSON date fields
- Ashby public posting API: only `jobs[].publishedAt`, ISO datetime with offset, "last published". Source: https://developers.ashbyhq.com/docs/public-job-posting-api
- Greenhouse Job Board API: list jobs has `updated_at`; retrieve-one has `updated_at`, `first_published`, `application_deadline`. The docs do not define them. `updated_at` is NOT a posting date (changes on edits) and would wrongly keep old jobs. Prefer `first_published` (needs one request per job); otherwise treat the list as undated. Source: https://docs.greenhouse.io/job-board.html
- Lever postings API: the docs field list has no date. A live call to `https://api.lever.co/v0/postings/leverdemo?mode=json` returned `createdAt` as epoch MILLISECONDS (observed, undocumented). Source: https://github.com/lever/postings-api (absence) plus live response.

## Implications for implementation
1. Normalise every source to a UTC instant or null; handle ISO date, ISO datetime, RFC 1123, epoch ms.
2. Drop only when a date is present and now - date > 30 days. Pass provider filters (Brave `pm` or custom range, Tavily `time_range=month`) as pre-filters only; never `filter_by_published_date`.
3. Provider dates can mean "updated", so they are weaker evidence than JSON-LD/ATS first-published dates. Prefer them in that order.
4. Open: Brave per-result date field name, Greenhouse field semantics, Lever `createdAt` stability. Verify against live responses in tests/fixtures.
