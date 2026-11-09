# Guest CVs are deleted within 24 hours

A Guest (extension user without an account) can upload a CV and get a Match Score against a captured Job Offer. Because a CV is personal data held without an account or a long-term legal basis, we keep the Guest's CV and Job Offer for the session only, and delete them within 24 hours at most. If the Guest signs up, they become the Candidate's first Profile and first Application.

The CV never leaves the browser's session storage, and the server reads it by rules alone (no AI provider, nothing saved), which also keeps an endpoint open to anyone free of AI cost. A Job Offer that only Guests captured expires after `GUEST_RETENTION_HOURS` (23, an hour of margin under the promise) and a worker job deletes it; once a Candidate captures it, it is kept.

## Amendment: a Guest's Match Score may call the AI on the Job Offer's text (issue #926, 2026-11-09)

The paragraph above says the server reads a Guest's CV by rules alone, « no AI provider », which keeps an endpoint open to anyone free of AI cost. That holds for the reading of the CV (`/api/cv/draft`: `draftFromCv` skips the AI when there is no Candidate), not for the Match Score itself, as research #912 (`docs/research/issue-912.md`, § 6, item 1) found.

A Guest's Match Score (`/api/match-score`) is computed in two phases, as a Candidate's is. The first scores by rules from the Job Offer's structured data, with no AI. When that score is not reliable enough (`ENOUGH_FROM_STRUCTURED_DATA`) and a detail is missing, the second asks the AI to read the Job Offer's text for the fields it lacks: the `offer_analysis` task (`readOfferFields`), once per Job Offer, its reading kept on the Job Offer for every later Match Score.

What keeps this within the decision:
- The AI receives the Job Offer's public text only, never the Guest's CV, which still never leaves the browser except to be read by rules and scored, and is never kept.
- The call is recorded in AI Usage and in the AI Message Log for no Candidate, as « Invité » on Activité › Appels IA (#926); nothing identifies the Guest.
- Its cost is bounded by the Job Offer, not by the Guest: a Job Offer read once is never read again, whoever scores it.

The privacy register already said so (« Guest session in the browser extension », Processors: the captured Job Offer's public text goes to Claude's direct API for `offer_analysis`, #338); this amendment brings the decision in line with it.
