# Research for #400: France Travail, one token per API

Checked 2026-10-26, only what implementation needs. Builds on `docs/research/france-travail-apis.md` (#385, branch `research/france-travail-apis`); not repeated here. No credentials were used.

## What is confirmed (primary sources)
- Scopes per API (france-travail-apis.md, from francetravail.io catalogue pages and OpenAPI): Offres d'emploi `api_offresdemploiv2 o2dsoffre`; La Bonne Boite `api_labonneboitev2` (OpenAPI also lists `search`, `office`); ROMEO `api_romeov2`.
- A token request containing any unknown or not-granted scope fails as a whole with `invalid_scope` ("Unknown/invalid scope(s): [...]"). Source: francetravail.io doc "4.9 Erreurs fréquentes" (`https://francetravail.io/api-peio/v2/pages/page?slug=produits-partages/documentation/utilisation-api-france-travail/erreurs-frequentes`). Hence one token request per API, each with only its own scopes, as the issue says.
- The error body is distinguishable: a live call to the token endpoint (`POST https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire`) with a bogus client returned HTTP 400 `{"error":"invalid_client","error_description":"Client authentication failed"}`, whereas a valid client with a non-granted scope yields `invalid_scope` (doc above, and #385). So the test can map: `invalid_client` -> client invalid; `invalid_scope` -> "accès refusé" for that API; other/network/5xx -> "erreur". The doc's examples show the 302 redirect form (authorization-code flow); client-credentials returns JSON 400 (observed for invalid_client; invalid_scope as JSON 400 is from #385's reading of the same doc).

## Not verified (needs the real client on staging)
1. Whether La Bonne Boite needs `search office` besides `api_labonneboitev2`. Try `api_labonneboitev2 search office` first, then `api_labonneboitev2` alone, keep the one that works (as the issue says). Caveat: if `search`/`office` are not granted, the first attempt returns `invalid_scope`, so a failure there is not proof the client is invalid; only `invalid_client` is.
2. Whether Offres d'emploi refusal shows as `invalid_scope` at token time (expected, the API is withdrawn for new applications: data.gouv.fr `api-offres-demploi`, `restricted`, "Analyse de sécurité") or as 403 at call time for an already-authorised client. Treat both, plus 401/404/410 (existing rule from #120), as "accès refusé".
3. Real rate limits: read `X-Ratelimit-Burst-Capacity-Clientidlimiter`; respect 429 `Retry-After` (#385 section 3.5). Token requests are not documented as rate-limited separately.

## Implications
- Cache tokens per (client, API); never reuse one API's token for another.
- Connection test order: La Bonne Boite token (validates the client), then Offres d'emploi and ROMEO tokens independently; store ok / refused / error per API; pass when the La Bonne Boite step succeeds.
