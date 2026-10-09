# Issue #77: Lusha v3 API contract (Prospecting + Enrich Contacts)

Sources checked 2026-10-09, Lusha official docs only:
- Prospecting: https://docs.lusha.com/api-reference/prospecting/prospecting-contacts
- Enrich Contacts: https://docs.lusha.com/api-reference/enrich/enrich-contacts
- Overview and error codes: https://docs.lusha.com (v3 base page)

Base `https://api.lusha.com`, header `api_key`, JSON. Error body: `{ statusCode, message, errors? }`.

## Prospecting: `POST /v3/contacts/prospecting`

Request:
- `pagination` (required): `page` 0-1000 (default 0), `size` 10-100 (default 25).
- `filters` (required): `contacts.include|exclude` (`jobTitles`, `seniorityIds`, `departments`, `countries`, ...), `companies.include|exclude` (`domains`, `names`, `linkedinUrls`, ...).
- `options` (optional): `includePartialProfiles` (bool, default true), `excludeDnc` (bool), `maxContactsPerCompany` (int 1-20; caps contacts per company, does NOT change page size, `pagination.size` still controls it).
- `tableId` optional (persists results to a table; do not send).
- Confirms the cause of the 400: `excludeDnc` belongs under `options`, not top level.

Response 200:
- `results[]`: `id` (string), `firstName`, `lastName`, `jobTitle` = object `{ title, departments[], seniority }`, `company {id,name,domain}`, `location`, `socialLinks.linkedin`, `has[]`, `canReveal[] {field: emails|phones, credits}`, optional `error {code, message}` (codes `NOT_FOUND`, `COMPLIANCE_RESTRICTED`, `ENRICH_FAILED`, `NO_SCORE`).
- `pagination {page,size,total,totalGuaranteed,totalDescription}`, `billing {creditsCharged, resultsReturned}`.
- Docs oddity: example request sends `size: 100`, example response shows `size: 50`; not explained. Do not rely on echoed size.

Costs: previous research (issue-23) records that each returned result is charged at search time; the v3 page exposes `billing.creditsCharged` but its text does not state the per-result rate. Keep `size` at the minimum (10) that covers `SEARCH_LIMIT`; note the 10 minimum means `SEARCH_LIMIT` < 10 still pays for 10 unless `maxContactsPerCompany` limits it. UNCONFIRMED: whether `maxContactsPerCompany` reduces the number of results returned (and so billed) when a single company filter is used; the docs say it caps contacts per company, which implies yes.

## Enrich Contacts: `POST /v3/contacts/enrich`

Request:
- `ids` (required): array of string, 1-100, from the Search response `id`.
- `reveal` optional: `["emails","phones"]`; omit for both.
- `waterfallEnabled` optional (default true if Data Waterfall enabled on the account). Waterfall may return a partial result with an async `job`.
- `tableId` optional; do not send.

Response 200 (`results[]` of enriched contacts, one per id):
- `emails[]`: `{ email, type: work|private|unknown, confidence (nullable), updateDate, dataSource?, credits? }`.
- `phones[]`: `{ number, type: mobile|direct|work|unknown, doNotCall (bool), updateDate, dataSource?, credits? }`.
- Also `id`, `firstName`, `lastName`, `fullName`, `jobTitle {title,departments,seniority}`, `location.isEuContact`, `company`.
- Per-entry `error {code,message}`; `missingDataPoints[]` (max 2, `type` email|phone, `status` NOT_FOUND|BILLING_FAILED).
- `billing {creditsCharged, resultsReturned}`.
- Optional `status` (`completed|partial|halted|OUT_OF_CREDITS|PARTIAL_OUT_OF_CREDITS`), `statusReason`, and `job {id,status,expiresAt,retryAfter}` when async providers are still working (poll `GET /v3/contacts/jobs/{jobId}`, free).
- Billing: per revealed field (email or phone); a data point is billed once; re-enriching already-revealed data (`canReveal.credits` 0) is free.

Implementation notes:
- The old `getContactDetails` path/body must change to `POST /v3/contacts/enrich` with `{ ids: [id], reveal: [...] }`; read `results[0]`.
- Responses without emails/phones are valid (`emails: []`, `phones: []`, as in the docs example). Treat an entry with `error` as no details.
- `phones[].doNotCall` exists: consider not surfacing numbers flagged true (decision for implementer; not specified by the issue).
- Consider `waterfallEnabled: false` to avoid async partial results and extra external-provider credits; UNCONFIRMED whether the product wants that. If left default and `job` is present, the first response may be missing data.

## Status codes (both endpoints)

200; 400 bad request; 401 missing/invalid key; 402 insufficient credits; 403 account inactive, V3 not enabled, or plan lacks the feature; 429 rate limit (headers `x-minute-requests-left`, `x-daily-requests-left`). The general error table also lists 451 (blocked for GDPR reasons), 499 and 5XX; these are not in the per-endpoint tables. Existing mapping (401/403 unauthorized, 402 out of credits, 429 rate limited) matches the docs; 451 would currently fall to a generic error.
