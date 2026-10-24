# A stopped Company Dossier keeps its facts; a stopped CV reading drafts nothing

A Company Dossier the Candidate stops while the news is searched is saved with the facts already found, and the news is marked not searched. Stopped before that, nothing is saved. The route answers 499 `{ error: "stopped", state }`. The reading of an uploaded CV, when stopped, throws `CvReadingStopped` and drafts nothing, not even the rule-based outline, so no Master CV Version can be created.

The two differ because the dossier's facts come from the register and are complete without the news, whereas a half-read CV would give a Profile that looks right and is not.

## Considered Options

- **Drop the whole dossier on any stop**: wastes register and web pages already paid for.
- **Fall back to the rule-based outline for a stopped CV reading**: the Candidate asked to stop, and an outline built from a CV the AI did not finish reading would be taken for the real reading.
- **Give a Plan Quota back**: neither action counts against one today.

## Consequences

- The Profile page sends the draft's Provenance back when saved; the server keeps it only if it is a well-formed CV reading. A Candidate could forge their own Provenance, which only changes what they see themselves.
