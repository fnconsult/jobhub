# A Job Offer from a recruiter's message is private to the Candidate; one from an alert is shared

Email intake (#426, #434) turns the offer emails a Candidate receives into Job Offers. A Job Offer is otherwise shared: one posting, referenced by every Candidate who finds it. An alert from a job board or a careers site describes a public posting, so its Job Offer is shared and deduplicated like any other. A recruiter's message describes a role offered to that Candidate, often for an unnamed client, sometimes never published: its Job Offer is visible to that Candidate only, deleted with their account and part of their Data export.

The reason is that a recruiter's message is correspondence addressed to one person: sharing what it describes with other Candidates would publish something its sender never made public, and would make Jobbbox the place where a confidential search leaks.

## Considered Options

- **Every Job Offer from an email shared**: simplest, one kind of Job Offer; rejected because it publishes private correspondence.
- **Every Job Offer from an email private**: rejected because the same public posting would be stored once per Candidate who has the alert, losing deduplication, the shared Job Offer Summary and re-checks for expiry.
- **A recruiter's message kept as a note on an Application rather than a Job Offer**: rejected because the Candidate could not score it, tailor documents to it or follow it like any offer.

## Consequences

- A Job Offer carries who may see it: everyone, or one Candidate. Deduplication never merges a private Job Offer with a shared one or with another Candidate's.
- A private Job Offer is never put in another Candidate's Job Search, Job Digest or Coach reply, and is deleted with its Candidate.
- If the same posting later turns up publicly (an alert, a search), it becomes a shared Job Offer of its own; the private one stays as it was.
