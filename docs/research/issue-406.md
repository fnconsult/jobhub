# Research for #406: Target Companies (La Bonne Boite, ATS, ROME)

Checked 2026-10-26, only what implementation needs. Builds on `docs/research/france-travail-apis.md` (#385, branch `research/france-travail-apis`) and `issue-400.md`; not repeated here. No credentials used.

## Confirmed (primary sources)
- **La Bonne Boite v2**: 2 calls/s, open access, 6-month hiring potential, search by ROME and/or NAF and location (data.gouv.fr `api-la-bonne-boite`). Params of `/recherche` (`citycode` = INSEE, `distance` max 200 km, `job`, `resolved_params`), 429 `Retry-After`, `X-Ratelimit-*` headers, France Travail logo requirement: see #385 sections 3.1-3.5. Use `citycode` + `distance` (30 default).
- **ROME open data** (data.gouv.fr `repertoire-operationnel-des-metiers-et-des-emplois-rome`): ROME 4.0, Licence Ouverte, files are **xlsx/pdf, not a zip**; dataset updated 2026-10-20, next update planned March 2027. Downloading requires accepting France Travail's ROME licence. So "verify `rome.ts` against the zip" means an xlsx read by a script, run manually or yearly; do not fetch at runtime.
- **geo.api.gouv.fr** `GET /communes?nom=...&boost=population&fields=code,nom,codesPostaux,population` (or `codePostal=`, or `lat`/`lon`). The page does not state that `code` is the INSEE code (it is, for communes; check on a known commune, e.g. Nantes 44109) and documents no rate limit.
- **Greenhouse** (docs.greenhouse.io/job-board.html): `GET https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs[?content=true]`, public, no auth for GET, no documented rate limit, no EU host listed.
- **Lever** (github.com/lever/postings-api): `GET https://api.lever.co/v0/postings/{site}?mode=json&skip&limit`, EU `https://api.eu.lever.co/v0/postings/{site}`; HTTPS only; public, no key for reads; no GET rate limit documented. Fields: `text`, `categories.location`, `country`, `hostedUrl`, `applyUrl`, `workplaceType`, `descriptionPlain`.
- **Ashby** (developers.ashbyhq.com public job posting API): `GET https://api.ashbyhq.com/posting-api/job-board/{name}?includeCompensation=true`; no auth; `jobs[]` with `title`, `location`, `isListed`, `workplaceType`, `descriptionPlain`, `publishedAt`, `jobUrl`, `applyUrl`; no rate limit documented. Skip `isListed=false`.

## Implications
- Board token/site/name = the path segment of the company's hosted page (`boards.greenhouse.io/{token}`, `jobs.lever.co/{site}`, `jobs.ashbyhq.com/{name}`); detect from the careers page links once, store per company. Try Lever global then EU host.
- None of the three documents rate limits: keep our own polite throttle (the 7-day revisit delay and N cap already bound it) and treat 429/5xx as "skip".
- Postings carry location and description text, enough for the usual posting capture.

## Not verified
1. LBB scope set, real rate limit, default page size, cadre-job coverage (#385 open items 1-4).
2. ROMEO `predictionMetiers` request/response schema: only seen via #385's OpenAPI reading; no official page reachable by search this time. Re-read `GET https://francetravail.io/api-peio/v2/api/366/openapi` when implementing.
3. robots.txt/terms of company careers pages (fallback path, "read for postings"): not researched per company; honour each site's robots.txt at fetch time. The ATS JSON endpoints above are published public APIs.
4. Whether ATS operators restrict reuse of postings: no terms found in the cited docs.
