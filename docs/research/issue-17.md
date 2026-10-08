# Research for issue #17: Company Dossier (public data)

Scope: only the external facts needed to implement the issue. Checked 2026-10-08 by calling the live APIs and reading their own docs. Product code is out of scope.

## 1. French company identity, address, financials, executives: API Recherche d'Entreprises (recommended)

Source: https://recherche-entreprises.api.gouv.fr (live calls, plus the OpenAPI description at `/openapi.json`).

- Open access: no key, no auth. The data.gouv.fr listing gives the rate limit as 7 calls per second (it may be lowered under load) and the licence as Licence Ouverte 2.0.
- Search by name, address or executive: `GET /search?q=...` (min 3 chars, otherwise HTTP 400 with an error message) or filters. `per_page` and `minimal` are supported.
- Observed in a live response for a SIREN-registered company: `siren`, `nom_complet`, `siege` (full address, SIRET, NAF, headcount range, `etat_administratif`), `nature_juridique`, `categorie_entreprise`, `dirigeants`, `finances` (e.g. `{"2024": {"ca": ..., "resultat_net": ...}}`), `statut_diffusion`, `complements`.
- Financials are limited to turnover (`ca`) and net result (`resultat_net`) per year, and only when present. Treat as optional ("financials shown when available" matches the AC).
- The data.gouv.fr summary page says the API has no financial data. The live API contradicts it, so rely on the live response and re-check before shipping.
- Non-diffusible companies are not returned by the API (stated in its OpenAPI description). Companies refused RCS registration are not returned either. The dossier needs an explicit "no public data" state.
- `dirigeants` contains named private persons (surname, first names, birth year/month, role). This is the GDPR trap, see section 4.
- No SLA. Plan for caching, timeouts, and the 7 req/s cap.
- It is a search API, not the full Sirene base. Full Sirene needs the INSEE API (OAuth key required; could not verify its quotas, the portal URL tried returned 404). Not needed for the AC.

Implication: matching a French employer to a SIREN is a name search. Results are fuzzy, so store the SIREN only after a confidence check or a Candidate confirmation. Never fabricate a match.

## 2. BODACC (legal announcements)

Source: Opendatasoft dataset `annonces-commerciales` on https://bodacc-datadila.opendatasoft.com (live call).

- Open, no key. Query by SIREN: `.../api/explore/v2.1/catalog/datasets/annonces-commerciales/records?where=registre like "552032534"`. Returns `typeavis`, `familleavis_lib` (e.g. accounts filings, judgments), `dateparution`, `tribunal`, `commercant`, `listepersonnes`.
- Useful for insolvency and procedure signals. Optional for the AC.
- Licence text not verified (data.gouv.fr page returned 404). Check before launch; assume Licence Ouverte until confirmed.

## 3. Pappers

- Docs (https://www.pappers.fr/api/documentation) returned 403 to automated fetch. Pricing, credits and reuse terms are NOT verified.
- The Recherche d'Entreprises and BODACC APIs cover the AC without Pappers. Decision for the implementer/maintainer: skip Pappers in v1, or verify terms manually first.

## 4. GDPR and "no private persons named" (CNIL)

Source: CNIL, "La réutilisation des données publiquement accessibles en ligne à des fins de démarchage commercial" (https://www.cnil.fr/fr/la-reutilisation-des-donnees-publiquement-accessibles-en-ligne-des-fins-de-demarchage-commercial).

- Public availability does not make personal data freely reusable. Source disclosure (art. 14), minimisation, opt-out and a legal basis still apply.
- Consequence for the AC: the register's `dirigeants` list is personal data. The Company Dossier should not store or display named executives outside the Premium Enriched Contacts feature. Show Suggested Contact Roles (job titles/functions, such as "Président" or "DRH") only. Drop the person fields from the API response at the integration boundary; do not persist them.
- Open question for a legal reviewer: whether showing company-register executives is allowed under the issue's own wording ("company-register executives" vs "no private persons named"). The AC wins as written; the two statements need a product decision.
- Other CNIL points are not verified here: the page was read through a summariser, and the rules on direct prospecting by email and calls are not relevant to a dossier.

## 5. Foreign employers

- No primary source checked. No single open API exists. The AC already requires a reliability label. Any web-scraping approach needs a separate check of each site's terms and robots.txt, and of the search/LLM provider's terms. Not researched.

## 6. Presumed Employer (recruiting-agency posts)

- Internal rule, no external facts. Implementation constraint from the AC: no lookups against any API until the Candidate confirms the Presumed Employer.

## Summary for implementation

1. Use `recherche-entreprises.api.gouv.fr` for SIREN match, address, headcount, legal form, optional financials. Handle 400, 429 and non-diffusible (no result).
2. Optionally add BODACC by SIREN.
3. Strip `dirigeants` person data; expose roles only.
4. Unverified: INSEE Sirene quotas, Pappers terms, BODACC licence wording, foreign-company sources.
