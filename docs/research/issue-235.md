# Issue #235: geo.api.gouv.fr for Locations suggestions

Checked 2026-10-20, against the live API and the official docs (https://geo.api.gouv.fr/decoupage-administratif/communes, `/departements`, `/regions`, https://github.com/etalab/api-geo). Only what the implementation needs.

## Findings

- **No API key.** Plain `GET`, anonymous calls return 200. The Etalab source repo is MIT licensed (github.com/etalab/api-geo, "Licence: MIT"). Data licence and usage terms live on https://geo.api.gouv.fr/cgu and were not readable by the tooling used here: **unverified**.
- **Endpoints** (base `https://geo.api.gouv.fr`):
  - `/communes?nom=<q>&fields=nom,code,codeDepartement,departement,region,population&boost=population&limit=N`
  - `/departements?nom=<q>` returns `nom`, `code`, `codeRegion`.
  - `/regions?nom=<q>` returns `nom`, `code`.
  - Documented: `nom` (usable for autocomplete), `boost=population`, `fields`, `format`. `limit` is not in the documented page but works (observed: `limit=3` returns 3).
- **Search behaviour (observed):**
  - Partial prefix match works from 1-2 chars (`nom=ly` returns Lyas, Lynde, Lyaud). Results carry a `_score`.
  - Accent-insensitive: `rhone` and `rhône` both find "Rhône"; `île-de` finds "Île-de-France"; `saint etienne` finds "Saint-Étienne".
  - Without `boost=population`, "ly" ranks tiny communes first; with it, `nom=lyon` puts Lyon (519127) first. Use `boost=population` on communes.
  - Commune responses include `codeDepartement` and `departement.nom`, enough to build "Lyon (69)". Homonyms (Saint-Étienne-...) are disambiguated by the department code.
- **Encoding:** a raw non-ASCII query (`nom=rhône` unencoded) returned HTTP 400. Always `encodeURIComponent` / `URLSearchParams`.
- **Caching headers:** `cache-control: public, max-age=3600, immutable`; so a short server cache (<= 1 h) is consistent with the provider.
- **CORS:** the API reflects `Origin`, but the issue calls it server-side, so it is irrelevant.
- **Coverage:** metropolitan and overseas France only. Foreign cities and "Remote" get no suggestion, which matches the issue's "Enter adds a typed place".
- **Rate limits: unverified.** The FAQ page lists "Quelle sont les limitations en vigueur sur les APIs ?" but its answer was not retrievable; no `ratelimit` response headers are sent. Debounce, 3-char minimum and cache (already in the issue) keep traffic low; handle non-2xx and timeouts by returning an empty list so Enter-to-add keeps working.

## Implications for the build

- Three upstream calls per query (communes, départements, régions), run in parallel, merged server-side. Order: communes by population, then départements, then régions; cap the merged list (e.g. 8).
- Display name: commune `"<nom> (<codeDepartement>)"`, département `"<nom>"` (the issue example "Rhône" has no code), région `"<nom>"`. A commune and a département may coincide by name (e.g. "Rhône" vs "Lyon (69)") but differ as strings; the duplicate check is on the string, as specified.
- Record each upstream call via `recordingFetch` as provider `geo-api-gouv`.

## Open items to check with the owner

- Read https://geo.api.gouv.fr/cgu for usage terms and rate limits before production traffic.
