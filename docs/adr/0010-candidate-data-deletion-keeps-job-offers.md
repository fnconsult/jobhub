# Account deletion removes everything except shared Job Offers

A Candidate can export all their data and delete their account themselves. The deletion becomes permanent within 30 days. It removes their Profiles, CVs, Applications, Tailored Documents, Coach Access and Coaching Session notes. Job Offers are not personal data and may be referenced by other Candidates, so they are kept.

## Amendment: deletion is immediate

Deletion takes effect at once, not within 30 days, so there is no scheduled purge to run or monitor. The Candidate's Stripe customer is deleted first, which cancels any subscription; if Stripe cannot be reached nothing is deleted, so nobody keeps paying without an account. Every table tied to a Candidate deletes with the Candidate's own record, and a test runs all migrations and fails if a new table is not reached, so a future table cannot leave personal data behind.

## Amendment: Jobbbox's own operations record

Some tables are Jobbbox's own operations record, not Candidate data. They are kept when an account is deleted, with the Candidate's id set to null, and left out of the data export. `OPERATIONS_RECORD_TABLES` declares them, so the deletion-reach test treats them apart from Candidate data. The Back Office Audit is the first: an Administrator's changes must stay readable after they leave, and the entries describe Jobbbox's configuration, not the Administrator.

## Amendment: an operations record can also be the Candidate's data

The Acceptances of the CGU and CGV (#510) are Jobbbox's proof and the Candidate's data at once. Their table is in `OPERATIONS_RECORD_TABLES` and in `EXPORTED_TABLES`: exported while the account lives, kept after the deletion. An operations record table is left out of the export unless `EXPORTED_TABLES` also lists it. ADR-0073 sets how the Acceptances are kept after the deletion: a pseudonym instead of the email, and a retention counted from the day of deletion.
