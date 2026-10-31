# Acceptances outlive the account by a pseudonym, counted from the day of deletion

_Builds on ADR-0010 (Account deletion, operations record) and ADR-0062 (Legal Texts) for #510._

An Acceptance proves that a Candidate agreed to one CGU or CGV version. Jobbbox needs that proof after the Candidate deletes their account (C. conso. L213-1 and D213-1 for the CGV; a claim about the CGU can come after the account too). It is also the Candidate's own data while the account lives. So `legal_acceptance` is the first table that is both: it is in `OPERATIONS_RECORD_TABLES` and in `EXPORTED_TABLES`.

- **Export**: while the account lives, the Data export holds each Acceptance (version, permanent URL, SHA-256, channel, date, the immediate-performance request at a payment). It never holds the pseudonym or Stripe's Checkout session id.
- **Who the row names after deletion**: a pseudonym, never the email. The pseudonym is the HMAC-SHA256 of the email, keyed with the app's secret. The Account deletion sets `candidate_id` to null; the row keeps the pseudonym, with no email and no name. With the secret, Jobbbox can find a person's rows again from the email they give; without it, no one can.
- **Retention**: counted from the Account deletion, not from the row's creation. A database trigger writes `account_deleted_at` when `candidate_id` becomes null, so no code path can forget it. The worker's nightly `acceptances.purge` deletes CGU rows 5 years after that day and CGV rows 10 years after it. A living Candidate's rows are never purged: the proof is needed as long as the contract runs.

## Considered Options

- **Like the Back Office Audit: keep the email, purge 3 years after creation**: the email names the person for years after they asked to be forgotten, and a 3-year clock from creation would delete the proof of a contract that still runs.
- **Delete the rows with the account, like Candidate data**: no proof left for a dispute or a check by the DGCCRF.
- **Count retention from the row's creation**: a Candidate who accepted in year 1 and deletes in year 8 would have no proof left for the last years of the contract.
- **Write `account_deleted_at` in the Account deletion code**: a later deletion path (a Back Office tool, a script) could set `candidate_id` to null and leave the date empty, so the row would never be purged.

## Consequences

- ADR-0010's rule that operations record tables are left out of the export now has one exception: a table listed in both `OPERATIONS_RECORD_TABLES` and `EXPORTED_TABLES` is exported while the account lives. The deletion-reach test accepts it.
- Changing the app's secret (`AUTH_SECRET`) breaks the link between an email and its old rows. The rows stay valid as proof, but a person can no longer be matched to them.
- The 5-year and 10-year periods are assumptions made without a lawyer (#510). The Legal Review (#507) may change them; only the constants in `apps/web/src/acceptances/index.ts` and the privacy register change with them.
