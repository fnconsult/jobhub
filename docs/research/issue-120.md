# Research for #120: France Travail adapter for Job discovery

Checked 2026-10-15, only what implementation needs.

## 1. Access is currently withdrawn (blocking risk)
Source: https://www.data.gouv.fr/api/1/dataservices/api-offres-demploi/ (France Travail's own listing, also covered in `job-sources.md`).
- Access type `restricted`, reason "Analyse de sécurité". The API "n'est actuellement plus exposée" on pole-emploi.io while distribution and reuse terms are reviewed; cause cited: automated mass use by some AI solutions that ignored licence terms.
- Access requests go through https://francetravail.io/contact. The licence field is empty; "conditions et licences de réutilisation" apply but are not named.
- Listed rate limit: 10 calls per second. Reported availability 99.8%.
- Described features: paged search, offer detail, reference lists (places, sectors, contracts, jobs). Filters include several jobs, communes, departments, contract types.

Implication: this matches the issue's design. The adapter must be inert unless `FRANCE_TRAVAIL_CLIENT_ID` and `FRANCE_TRAVAIL_CLIENT_SECRET` are set, and must fail soft (skip, count, log) on 401/403/404/410 or a token failure. Fixture tests only. Jobbbox is an AI product, so expect licence conditions (attribution, no training); that is for #119 and the access request, not this adapter.

## 2. Not verified against primary sources
The official docs (francetravail.io/produits-partages/catalogue/offres-emploi/documentation and /data/api/offres-emploi) are a JavaScript single-page app. Fetching returns only an empty shell, so none of the details below could be confirmed from the owner. They come from third-party clients and must be re-checked once access is granted, ideally against the official OpenAPI file or a live response. Build the adapter behind a thin client and capture real fixtures at that point.

Unverified, from third-party sources (search results; e.g. https://jobspipe.dev/blog/france-travail-api, https://pypi.org/project/api-offres-emploi, https://huggingface.co/spaces/datacipen/dashskills/blob/main/jobs.py):
- Search: `GET https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search`, Bearer token.
- Params (camelCase): `motsCles`, `codeROME`, `commune`, `departement`, `region`(?), `distance`, `typeContrat`, `minCreationDate`, `maxCreationDate` (ISO 8601), `range`.
- Paging: `range=0-149`; default returns 150; first index capped around 1000, last around 1149 (old docs, pre-rename).
- Auth: OAuth2 client credentials, `realm=/partenaire`, scope `api_offresdemploiv2` plus `o2dsoffre` and `application_{client_id}` in one client; another example uses only `api_offresdemploiv2`. Token URL not confirmed.
- Response date fields likely `dateCreation` and `dateActualisation` (ISO). Not confirmed; `dateActualisation` is probably an update date and, like Greenhouse `updated_at`, should not be treated as the posting date (see #116).

## 3. Open questions for the implementer
1. ROME mapping: the API takes `codeROME` (format like `M1805`), but the Search Criteria holds a free-text title. France Travail also publishes a ROME reference (ROME 4.0, open data). How to map title to code is undocumented here; verify the source and licence of the ROME dataset (or a reference-list endpoint) before choosing. Fall back to `motsCles` when no ROME match.
2. Confirm region and contract-type code values (reference endpoints) from a live response.
3. Confirm freshness field and whether there is an expiry signal.

## Implications for implementation
1. Keep the adapter skip-when-no-credentials; treat access withdrawal as a normal skipped outcome counted in observability, never an error that fails the search.
2. Use `minCreationDate` as the freshness pre-filter and `dateCreation` as the date, subject to confirmation; apply our own 30-day cut (#116).
3. Count each HTTP call (token plus search) against the search budget; respect the 10 calls/second limit.
4. Do not hardcode unverified parameter values; isolate them in one mapping module with fixtures marked as synthetic until real ones can be captured.
