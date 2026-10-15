# Issue #95: country filter for people search (Lusha, Apollo)

Sources checked 2026-10-15, provider official docs only:
- Apollo People API Search: https://docs.apollo.io/reference/people-api-search
- Lusha Prospecting: https://docs.lusha.com/api-reference/prospecting/prospecting-contacts
- Lusha contract baseline: `docs/research/issue-77.md`

## Apollo: `POST /api/v1/mixed_people/api_search` (current endpoint, 0 credits)

Location filters are arrays of strings (sent as `name[]` query params, like the existing `person_titles[]`):
- `person_locations[]`: where the person lives.
- `person_not_locations[]`: exclusion counterpart.
- `organization_locations[]`: HEADQUARTERS of the person's current employer only (a person at a Boston-HQ company does not match Chicago even if an office exists there).
- `organization_not_locations[]`.
- `organization_job_locations[]`: locations of jobs the employer is actively recruiting for.

All accept cities, US states, countries and postal codes. Country names are accepted as plain lowercase-style strings (`ireland`, `spain`, `germany`). Postal codes only for US, DE, UK.

Implementation notes:
- Use `person_locations[]` with the country name for "people located in the country". `organization_locations[]` would filter on HQ, which wrongly drops people when the HQ is abroad; avoid it.
- Apollo wants country NAMES, so the app country must be mapped to an English name (e.g. France -> `france`). UNCONFIRMED: case sensitivity (docs examples are lowercase; send lowercase to match). UNCONFIRMED: whether ISO codes (`FR`) work; docs do not say, do not use them.

## Lusha: `POST /v3/contacts/prospecting`

- `filters.contacts.include.countries`: array of strings. The only documented example is `["US", "CA"]`, suggesting ISO 3166-1 alpha-2 codes. The page does not state the required format, case sensitivity, or a list of accepted values; it points to the Filters section for valid values.
- Separate `filters.contacts.include.locations`: array of objects with `country` (full name, e.g. "United States"), `countryIso2` ("US"), `city`, `state`, `continent`, `countryGrouping`, `region`. The docs do not say how `countries` and `locations` interact if both are set; send only one.
- Company filters have no `countries` field (only `locations`, zip and geographic-distance filters).
- Response `location.country` is a full name (existing fixture: "France"), so response and filter formats differ.

Implementation notes:
- Send `countries: [ISO2]` (uppercase) as the issue decided; this matches the only documented example. Because the format is not formally specified, confirm once with a live call or the Filters endpoint, and keep the mapping in one place.
- UNCONFIRMED: behaviour when the value is invalid (400 vs silently no match).

## Consequence for the design

The two providers need different country representations: Lusha ISO2, Apollo English name. Store the country once (ISO 3166-1 alpha-2 in `PeopleSearch`) and let each provider derive its form (small ISO2 -> English name map for Apollo). Neither provider's docs address country-only vs city filtering beyond the above, so the "country only" decision in the issue is supported by both APIs (both accept country alone).
