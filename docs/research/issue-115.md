# Issue #115: ATS public JSON APIs (Greenhouse, Lever, Ashby)

Scope: only what is needed to implement adapters that read posting date, status and deadline. Checked against vendor docs on 2026-10-13. "Not documented" means the primary source is silent; verify against live responses before relying on it.

## Greenhouse (Job Board API)
Source: https://docs.greenhouse.io/job-board.html
- Single job: `GET https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs/{job_id}`. No authentication for GET.
- Optional query params: `questions=true`, `pay_transparency=true` (adds `pay_input_ranges`).
- Fields in the documented example: `id`, `title`, `company_name`, `first_published`, `updated_at`, `application_deadline`, `location.name`, `content`, `absolute_url`, `internal_job_id`, `requisition_id`, `language`.
- Trusted posting date: `first_published`. Deadline: `application_deadline`.
- Not documented: response for closed/removed jobs (likely 404, unconfirmed); rate limits.
- Implementation note: `board_token` and `job_id` must be parsed from the found URL (boards.greenhouse.io / job-boards.greenhouse.io paths, or `gh_jid` query param on company sites); URL shapes are not covered by the docs.

## Lever (Postings API)
Source: https://github.com/lever/postings-api (README)
- Single posting: `GET https://api.lever.co/v0/postings/{site}/{posting_id}`; EU region host `https://api.eu.lever.co`. Returns only that posting as JSON.
- Documented fields: `id`, `text`, `categories`, `country`, `description*`, `lists`, `additional*`, `hostedUrl`, `applyUrl`, `workplaceType`, `salaryRange`.
- Only `published` postings are exposed; all others are "completely hidden" from the API. So a closed posting is signalled by absence; the HTTP status is not documented (treat 404 and any non-200 as "unavailable").
- GAP: `createdAt` (the posting date named in the issue) and `state` are NOT in the README field list. Verify against a live posting; if `createdAt` is absent, Lever cannot give a trusted date and the acceptance criterion needs revisiting.
- No deadline field. Rate limit documented only for application POSTs (429 above 2 req/s); none for GET.
- Must try both US and EU hosts (or detect from URL host `jobs.eu.lever.co`).

## Ashby (Public Job Postings API)
Source: https://developers.ashbyhq.com/docs/public-job-posting-api
- Only a board-level list: `GET https://api.ashbyhq.com/posting-api/job-board/{JOB_BOARD_NAME}` (name = path segment of `jobs.ashbyhq.com/{name}`), optional `includeCompensation=true`. No auth.
- No single-posting endpoint is documented: the adapter must fetch the board list and select the job by id from the URL. This is a read of one employer's own board for a known posting, not cross-employer crawling.
- Documented fields: `publishedAt` (ISO datetime, "last published", so possibly not first publication), `isListed`, `jobUrl`, `applyUrl`. `id` is not in the documented field list (verify live).
- Returns currently published postings; closed behaviour is not documented, so absence from the list = closed. `isListed=false` means direct-link only.
- No deadline field. Rate limits not documented.

## Implications for the issue
- Trusted date: Greenhouse `first_published` (documented); Ashby `publishedAt` (documented, semantic caveat); Lever `createdAt` (undocumented, verify).
- Deadline exists only in Greenhouse (`application_deadline`).
- Closed status: infer from non-200 or absence for Lever/Ashby; Greenhouse unconfirmed. Fixture tests should cover 404/absent cases explicitly.
- All three are unauthenticated public endpoints; no keys or GDPR personal data involved (job content only). Rate limits undocumented, so fetch one posting per found URL with a timeout.
