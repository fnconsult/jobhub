# A substantial Legal Text Version is announced 30 days ahead and readable before it takes effect

Status: accepted (ticket #547, map #494)

A substantial version of the CGU, the CGV or the privacy policy must reach Candidates at least 30 days before its effective date (ADR-0062). Three consequences are costly to undo.

- **One rule, one place.** `packages/help/src/legal-notices.ts` holds the 30 days and the texts concerned; CI, the worker and the web app all read it. CI refuses a substantial version effective less than 30 days after the day it runs, and names the first possible date. It runs again on `main` the day of the merge. A first version is not exempt: the v1 « Légal : » tickets need a date at least 30 days after their merge.
- **The Préavis is sent from Production only, once per Candidate and version.** The send and its row in `legal_text_notice` share one transaction, so a rerun or a second worker never sends twice and a failed email is retried. Only verified addresses are emailed. The privacy policy's change is also shown once in the app (`privacy_change_seen`); both tables leave with the account and appear in the Data export.
- **A substantial version still to come is served at `/legal/<texte>/<date>`**, marked « Version à venir », because the Préavis links to it. A minor one stays unserved before its effective date. This amends ADR-0062's « never served before its effective date ».

## Considered Options

- **Link the Préavis to the version in effect**: the Candidate could not read what changes.
- **Check the 30 days only at signature of the effective date**: the product owner's step is human; CI is the only gate an agent's PR cannot skip.
- **Exempt first versions**: ADR-0062 counts the first CGU as substantial.

Known limit: a PR that passes CI and waits can still go below 30 days before merge; the rerun on `main` catches it.
