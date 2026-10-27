# Discovery run figures are kept 24 months with no link to the Candidate; the rest 30 days

The Back Office's Recherches tab needs to compare runs over time and to show what a run actually searched. Query texts are built from the Search Criteria, so they can reveal the Candidate's job search.

We split each Discovery run in two. `discovery_run` holds the figures (counts, cost, duration, Stop reason, search kinds) with no Candidate, Profile or Job Search link, for 24 months. `discovery_run_detail` holds the Candidate, Profile pseudonym, Search Criteria, query texts and Job Search link for 30 days; it is in the Candidate's Data export and deleted with their account or Profile. A nightly worker job (`discovery-runs.purge`) does both purges.

## Considered options

- One table kept 30 days: loses the trend over months that cost and fallback decisions need.
- One table kept 24 months with query texts: keeps personal data far past any need.
- Anonymise query texts in place: criteria stay re-identifiable from free text; deleting is safer.

## Consequences

- After 30 days a run can no longer be tied to a Profile or its Job Search; the row shows « Effacé après 30 jours ».
- The Profile pseudonym is purged with the detail, since it is tied to the Candidate.
- Only super-admins open the Job Search behind a run, and each opening is audited.
