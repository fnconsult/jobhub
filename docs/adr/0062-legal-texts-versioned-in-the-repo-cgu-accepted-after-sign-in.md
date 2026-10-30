# Legal Texts are versioned files in the repo; the CGU are accepted on a screen after sign-in

_Decided in the grilling of #502 (map #494), on the research of #496 and #498. Shapes #510 (Acceptances) and #512 (page before Checkout)._

Each Legal Text Version is a Markdown file in the repo, one per document, effective date and language (e.g. `cgu/2026-12-01.fr.md`), never edited once published: a correction is a new version. Git is the immutable archive, legal review (#507) is a pull request, and the version registry of #510 (permanent URL, SHA-256 of the French text, the binding one) is built at deploy. The CGU are accepted on one screen shown after sign-in, not on a sign-up form: `/connexion` signs people up and in alike (magic link, OAuth), so there is no sign-up step to put a box on. The same screen serves the first Acceptance and every later one. The privacy policy and the legal notice are never accepted.

## Considered Options

- **Edit the texts in the Back Office, like Help Articles**: no review trail, and a published wording could be changed in place, which breaks the proof of what was accepted.
- **A CGU box on `/connexion`**: shown to people who already have an account, and lost when OAuth creates the account on return.
- **Have the privacy policy accepted**: would read as one global consent, which GDPR forbids (art. 4(11), 7); the EU AI Consent stays the only consent.

## Consequences

- A version is marked substantial or minor in its file. Substantial: Candidates are emailed at least 30 days before its effective date, then shown the Acceptance screen at their next sign-in. Minor: published with no notice and no new Acceptance, with a line in the version history.
- The first CGU version counts as substantial for every existing Candidate.
- Until they accept, a Candidate reaches only the Acceptance screen, their Data export, their subscription (withdraw or cancel, #511 and #513) and Account deletion. A paid Plan keeps running.
- A contract keeps the CGV version accepted when it was bought; a new CGV version is accepted at the next purchase. A change for current subscribers (price, Plan Quota) follows R212-4 and L224-25-26 (#514), not a new Acceptance.
- A Candidate using English sees the translation, marked « traduction, le texte français fait foi », and accepts the version id, which is the same for both languages.
- A substantial change to the privacy policy is emailed before it takes effect and shown once in the app, with no box.
- A Guest ticks the short CGU in the extension before sending a CV; it stays in the Guest session, with no server row.
- Minimum age is 18, stated in the CGU, with no separate box.
