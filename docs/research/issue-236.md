# Issue #236: Search Criteria sectors, subsectors and domains (NAF, ROME domains, France Travail filters)

Scope: only what implementing the issue needs. Checked on 2026-10-20 against data.gouv.fr dataservice records (via its API), INSEE pages and the France Travail open-data listing. The francetravail.io documentation pages are rendered client side and returned no content to a plain fetch, so the exact `secteurActivite` / `domaine` parameter semantics are NOT verified here (see Gaps).

## 1. BLOCKER to check first: the Offres d'emploi API is reported as no longer exposed
Source: https://www.data.gouv.fr/api/1/dataservices/api-offres-demploi/ (France Travail, metadata modified 2026-10-20)
- Its description says the API "n'est actuellement plus exposée sur francetravail.io" while France Travail analyses distribution and reuse terms, after "usages automatisés massifs" by AI solutions. Organisations needing access must apply through https://francetravail.io/contact. Access type is listed as `restricted`.
- Documented rate limit: 10 calls per second.
- Documented capabilities: search with a paginated result, offer detail, and "référentiels" of the API (places, sectors of activity, contracts, training, jobs). Filtering by several jobs, communes, departments and contract types is documented.
- Implication: the existing France Travail adapter (credentials we already hold) and the new `secteurActivite` / `domaine` filters depend on the product owner confirming that our credentials still work. Verify with a live call before building; the issue's France Travail filter work is at risk, the NAF / ROME reference data work is not.

## 2. NAF rév. 2 (sectors and subsectors)
Sources: https://www.insee.fr/fr/information/2120875 , https://www.insee.fr/fr/information/2406147
- INSEE publishes per-level files: sections `naf2008_liste_n1.xls`, divisions `naf2008_liste_n2.xls`, plus groups, classes and subclasses, all-5-levels nested `naf2008_5_niveaux.xls`, and labels `int_courts_naf_rev_2.xls`. Base path `https://www.insee.fr/fr/statistiques/fichier/2120875/<file>`. Formats are XLS and dBase only, no CSV, no JSON, no API on these pages. Labels are French only.
- Mirror: https://www.data.gouv.fr/datasets/codes-et-libelles-naf-niveau-2 (INSEE, licence "fr-lo" i.e. Licence Ouverte, last updated 2021-03-15) with CSV and JSON, but hosted on opendata.grdf.fr, a third party host.
- The page does not state the section or division counts. The issue's "21 sections and 88 divisions" is not confirmed by these sources; count from the downloaded file.
- **NAF rév. 2 is in force until the end of 2026; NAF 2025 (aligned on NACE Rev.2.1) takes effect in January 2027.** INSEE publishes a NAF rév. 2 to NAF 2025 correspondence table (XLSX, January 2026): https://www.insee.fr/fr/information/8617910 . Implication: today is 2026-10-20, so the sector reference data will change within about 10 weeks. Store the nomenclature version with the codes and plan the migration; the "refreshed monthly" job should not assume a stable code set.
- No English labels in the INSEE files; "FR + EN where the source has them" means FR only for NAF.
- Open question: whether recherche-entreprises (`activite_principale`) and France Travail `secteurActivite` use NAF rév. 2 or 2025 after the switch is not documented in the sources read.

## 3. ROME 4.0 professional domains
Sources: https://www.data.gouv.fr/api/1/dataservices/672cf64aa47b8d4c15d13d58/ , https://www.data.gouv.fr/api/1/datasets/58da857388ee384902e505f5/ , https://strategie.gouv.fr/files/2024-11/rome_4.0_-_presentation_rec.pdf
- Structure per the France Stratégie presentation: 14 grands domaines professionnels, 110 domaines professionnels, 532 métiers (via search summary of that PDF, not read in full).
- The ROME 4.0 APIs (Compétences, Métiers, Contextes de travail, Fiches métiers) are open access (registration at francetravail.io/inscription), rate limit 1 call per second. The catalogue pages are https://francetravail.io/produits-partages/catalogue/rome-4-0-metiers etc. The endpoint path and scope for domains are not verified (docs not fetchable).
- **No credentials or API needed:** France Travail publishes the whole ROME as open data, licence Licence Ouverte, updated monthly-ish (current files dated October 2026): `https://api.francetravail.fr/api-nomenclatureemploi/v1/open-data/json` (also csv, xml), plus xlsx trees: main tree (`...261014-rome_arboprincipale-octobre-2026.xlsx`), sectors-of-activity tree, and a ROME / NAF correspondence table (`...rome_arbosecteursnaf-octobre-2026.xlsx`), all under https://www.francetravail.org/files/live/sites/peorg/files/documents/Statistiques-et-analyses/Open-data/ROME/ . Technical doc: `open_data_v3.1.pdf` in the same folder.
- Implication: the worker job can load domains from the open-data JSON instead of the authenticated ROME API, avoiding a second API subscription and the 1 call/s limit. Choose this unless the issue insists on the API. Check the JSON for French labels only (English labels not documented).
- Terminology to settle: ROME "domaine professionnel" (110) vs "grand domaine" (14); the issue says "domaines professionnels", so use the 110 level, possibly grouped under the 14.

## 4. France Travail search filters `secteurActivite` and `domaine`
Source: https://www.data.gouv.fr/api/1/dataservices/api-offres-demploi/ (only describes the API in general).
- Not verified: accepted value format, whether several values are allowed (comma separated like `typeContrat` and `codeROME`, which our `searchParams` already uses), whether `secteurActivite` takes NAF divisions (2 digits) or France Travail's own sector list, and what `domaine` takes (the issue assumes a ROME domain letter code such as M, but this is unconfirmed).
- The dataservice says the API returns "Secteurs d'activités" referentials, which suggests `secteurActivite` uses France Travail's own sector codes, not necessarily NAF divisions. Verify via the API's referentials endpoint or a live call before mapping NAF divisions to it; if they differ, a NAF-to-FT-sector mapping (the ROME / NAF correspondence table above may help) is needed.

## 5. recherche-entreprises (`activite_principale`)
Not re-checked in this pass; it is an existing integration. Only the NAF version question above (rév. 2 vs 2025) affects it.

## Gaps to verify before or during implementation
1. Live call to the France Travail Offres d'emploi search with our credentials (API reported withdrawn).
2. Exact semantics, format and multi-value behaviour of `secteurActivite` and `domaine`.
3. Section and division counts in the downloaded NAF files, and which NAF version France Travail / recherche-entreprises use from January 2027.
4. Whether ROME open-data JSON exposes domain codes and labels in a stable shape.
