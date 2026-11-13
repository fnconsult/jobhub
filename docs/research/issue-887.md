# DAC7 implementation evidence — #887

Checked 2026-11-11. This is engineering research, not approval of legal text or a tax return.

## Reporting scope and basis

The [DAC7 directive, Annex V](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32021L0514), sections I.B(4)(d), II.B and III, limits the low-volume exclusion to sales of goods. Coaching is time/task-based personal service, so the implementation must not apply the goods transaction/value thresholds. Report consideration paid **or credited**, net of platform-charged fees/commissions/taxes, in its payment/credit quarter and currency. Bank payouts alone are not the full reporting basis; preparation must reconcile credits with remittances and remaining balances. Seller copies and the authority report are due by 31 January following the reporting year. Individuals require birth information; entities require business identification. Identity validation and due diligence remain operator responsibilities.

## Current French interface

The [DGFiP official landing page](https://www.impots.gouv.fr/transfert-dinformations-en-application-des-dispositifs-dpi-dac7-plateformes-deconomie-collaborative) links the current 2026-income schema and guide. DAC7 replaced the older Écollab return; the current framework cites CGI 1649 ter A–E rather than treating the former 242 bis file as current.

[Guide v1.7](https://www.impots.gouv.fr/sites/default/files/media/1_metier/3_partenaire/tiers_declarants/cdc_td_bilateral/cdc-dac7-v.1.7.pdf), dated 9 November 2026, applies to 2026 income filed in 2027. Its identity rules distinguish an individual professional from an entity: a professional individual belongs in IndividualSeller, with the professional French SIRET/IDSP as TIN where applicable. PersonalServices requires consideration, activity counts, fees and taxes for each quarter. Prepare both individual and entity records; never classify a sole trader as an entity merely because they have a SIRET. Fail closed on incomplete identity or unreviewed reconciliation.

The [official filename rules](https://www.impots.gouv.fr/sites/default/files/media/1_metier/3_partenaire/tiers_declarants/cdc_td_bilateral/nommage_collecte-dpi-dac7.pdf) specify DPIDAC7, income year, submitting SIREN/IDSP, three-digit sequence and 14-digit creation timestamp. A raw XML export is preparation; actual filing additionally requires gzip, encryption with the current DGFiP key, the authorized professional portal, and acknowledgement handling. The app must never label a downloaded draft as filed or accepted.

## Verification boundary

The runtime Cloud proxy currently denies direct access to www.impots.gouv.fr (CONNECT 403). The web connector reads the official guide but cannot download its ZIP. The [official 2026 XSD archive](https://www.impots.gouv.fr/sites/default/files/media/1_metier/3_partenaire/tiers_declarants/cdc_td_bilateral/schema-xsd-de-collecte-dpi-dac7---revenus-2026.zip) must be retrieved and used for validation before export can claim schema readiness. Domain access requested through the parent agent; no proxy bypass attempted. No tax filing, test-portal registration or legal approval has been performed.

## Refunds and platform-funded compensation

The [OECD MRDP FAQ, Section III question 1](https://www.oecd.org/content/dam/oecd/en/topics/policy-issues/tax-transparency-and-international-co-operation/model-reporting-rules-for-digital-platforms-faqs.pdf) says refunds reduce consideration and later-period refunds may require a corrected earlier report. The implementation preserves the original income period and refund observation date; it does not silently create a second initial packet or discard a negative correction.

The [Luxembourg DAC7 authority FAQ, definition 2.1 and questions 5.16–17](https://impotsdirects.public.lu/dam-assets/fr/echanges-electroniques/dac7/foire-aux-questions-informations-dclarer-par-les-oprateurs-de-plateform-loi-dac7.pdf) is corroborating EU implementation guidance, not a substitute for French Legal Review: a platform buying personal services in its own name may still facilitate relevant third-party activity; refunds are adjustments, not additional activities. Therefore preparation separates Jobbbox retail receipts from the actual credited Coach/Association compensation and retains distinct remittance reconciliation. Human #889/#890/#518 review must settle the actual contractual/reporting perimeter before activation. Cross-border/unsupported identity cases stop rather than inheriting an assumed French treatment.
