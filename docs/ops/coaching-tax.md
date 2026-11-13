# DAC7 preparation (#887)

This is preparation software, not a tax-filing client. It supports the 2026-income DGFiP v1.7 format for French identities without foreign permanent establishments. All collection/preparation remains closed until current CGV, privacy and private B2B contract versions each declare `dac7` coverage. The existing `SECRETS_MASTER_KEYS` ring must be present; no plaintext fallback exists. Do not insert an approval or dummy identity to make onboarding pass. Collect accurate Seller data through Revenus and complete the operator’s due diligence; a professional individual is not an entity merely because they have a SIRET.

Sources and open classification boundaries are in `docs/research/issue-887.md`. The real Stripe SDK reads each direct charge in its frozen connected account, verifies its context/amount/commission, and lists successful refunds plus returned application fees. Actual Jobbbox-funded Coach compensation uses its frozen platform transfer and reversals, never Jobbbox’s retail gross. Income credits and bank remittances have separate quarters. Refund/reversal adjustments preserve original income periods, including later-year corrections. Pending refunds/disputes, unknown transfer outcomes, inconsistent identity, unsupported jurisdiction or negative correction totals stop preparation for human handling rather than guessing. The supported currency is EUR, matching the offer model.

## Official schema import

Obtain the official archive from the source URL in `apps/web/src/coaching-tax/schema-2026.generated.json`, preserving TLS checks. Run:

```sh
npx tsx apps/web/scripts/import-dac7-schema.ts /absolute/path/to/official-2026.zip
```

The import reads XSD files without extracting paths, normalizes imports to an offline bundle, and records the original archive SHA256. Review the source/hash and generated diff. Then run fiscal XML tests against the official bundle, both individual and entity records, and verify the standalone server includes its validator dependency. An absent/invalid bundle fails closed; synthetic test schemas cannot enable production readiness. Validation uses libxml2-wasm 0.7.2 (MIT/libxml2 MIT) with in-memory imports, no filesystem/network entity provider, and rejects DTD/entity declarations. No tax identity is fetched from or transmitted to the schema origin.

## Annual operation

1. Reconcile the original payments, transfers, refunds and bank payouts. Complete the year’s fiscal identities. Closed years only can be prepared; a still-current identity can be reused for up to three years, with a new version on correction. Historical year selection does not overwrite current-year data. Verify the actual DAC7 scope, including Coach/Association service compensation where relevant; legal approval remains human.
2. In **Coaches → DAC7**, enter the operator identity and prepare once. The financial snapshot, references and encrypted payload are immutable. Audit and persistence share the Back Office transaction. Download the draft for review; schema validation releases the prepared XML and owed-copy queue. Inspect quarterly cent-based reconciliation as well as rounded XML totals. The filename is a raw XML preparation; the authorized depositor must check its submitting identifier/sequence before filing.
3. The authorized human validates business rules and the file on the official test portal, then performs required gzip/encryption and filing in the professional portal by 31 January. Preserve the authority acknowledgement externally. The app never marks a file filed/accepted. Do not submit a second initial packet to replace an earlier one: subsequent corrections must follow the original DocRefIds/DGFiP correction rules. The current app preserves those references; corrective filing remains operator/professional handling, not an automatic second initial report.

The minute Worker sends each copy notice independently, with advisory serialization and five-minute backoff. Confirm the verified original business recipient/current Association manager exists. Account retirement does not transfer a historical Coach copy to a new account reusing the email; missing recipients remain pending human verification. SMTP acceptance before checkpoint may repeat an email after a crash, as with existing outboxes. Closing intake/legal gates does not erase existing owned financial access or suppress owed copies.

The daily Worker rotates encryption then applies ten-calendar-year retention. Keep both old/new master keys until re-encryption finishes; test opening with the new ring before removing an old key. Account deletion detaches audit/recipient links and preserves only the documented fiscal records; current role checks still apply. Export/audit download routes are private/no-store and cannot expose other Sellers’ slices.

At implementation time the runtime proxy denies the official archive origin and the bundle is intentionally absent. Draft preparation and tests remain possible; authoritative schema readiness and release of copy notifications remain blocked until the official archive can be imported and validated. No production activation, test-portal filing or tax-return submission has occurred.

## Correcting an unfiled preparation

If no initial packet for that year has been filed, use the explicit unfiled-replacement action. The administrator confirms that factual condition; this is not an authority acknowledgement or legal approval. Source facts and identity are read again, the old encrypted snapshot remains an archive, and year/copy locks serialize replacement with ongoing notices. Only one active preparation exists per year. The prior normal XML export is refused; historical draft exports are labelled SUPERSEDED. Pending old-copy notices stop and the replacement has its own notice checkpoint. A stale replacement form cannot supersede a later snapshot. After any actual filing, never use this action: the human/professional must use the DGFiP corrective procedure with the original references. The reconciliation download preserves exact cents separately from the rounded tax XML.
