# Account deletion removes everything except shared Job Offers

A Candidate can export all their data and delete their account themselves. The deletion becomes permanent within 30 days. It removes their Profiles, CVs, Applications, Tailored Documents, Coach Access and Coaching Session notes. Job Offers are not personal data and may be referenced by other Candidates, so they are kept.

## Amendment: deletion is immediate

Deletion takes effect at once, not within 30 days, so there is no scheduled purge to run or monitor. The Candidate's Stripe customer is deleted first, which cancels any subscription; if Stripe cannot be reached nothing is deleted, so nobody keeps paying without an account. Every table tied to a Candidate deletes with the Candidate's own record, and a test runs all migrations and fails if a new table is not reached, so a future table cannot leave personal data behind.
