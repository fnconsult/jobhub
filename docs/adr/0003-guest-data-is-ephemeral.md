# Guest CVs are deleted within 24 hours

A Guest (extension user without an account) can upload a CV and get a Match Score against a captured Job Offer. Because a CV is personal data held without an account or a long-term legal basis, we keep the Guest's CV and Job Offer for the session only, and delete them within 24 hours at most. If the Guest signs up, they become the Candidate's first Profile and first Application.

The CV never leaves the browser's session storage, and the server reads it by rules alone (no AI provider, nothing saved), which also keeps an endpoint open to anyone free of AI cost. A Job Offer that only Guests captured expires after `GUEST_RETENTION_HOURS` (23, an hour of margin under the promise) and a worker job deletes it; once a Candidate captures it, it is kept.
