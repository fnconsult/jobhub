# A Version is born at its Promotion from the Beta, and the extension and its API are versioned apart

_For #505 (map #494), following the scheme of the Charabia project (`fnconsult/game-hub`)._

Jobbbox has one Version `X.Y.Z` for the web app and the worker. `main` deploys to the Beta (staging) and already carries the next Version, shown with its commit. A Version is tagged `vX.Y.Z` and gets its GitHub Release only at its Promotion: the product owner runs a script that checks the preconditions, moves a `prod` branch onto that commit, tags it, pushes both atomically and deploys Production. No agent may Promote. Unless nothing a Candidate can see changed, a Release Note in French and in English, written for Candidates, must exist before the Promotion; it feeds Nouveautés, and a workflow publishes the GitHub Release once the tag exists. The extension has its own Extension Version on two store listings (public and beta), and its contract with the web app has an API Version, a whole number raised only on a breaking change, with the current and the previous one served.

## Considered Options

- **A Version at every staging deploy**: tags things no Candidate ever received, and Nouveautés would announce Versions Production never ran.
- **A `-beta.N` suffix**: the browser stores accept only digits, and the Beta already shows its commit.
- **One number for the web app and the extension**: a store review can hold the extension back, and many Versions change nothing in the extension.
- **`/api/v1/…` URL prefixes**: every route would have to move, for a contract only the extension uses.
- **Rebuilding past Versions from the 15 staging deploys**: their Release Notes would be invented. The history starts at 0.1.0 with one Release Note that sums up what already existed.

## Consequences

- The `deploy-staging` skill no longer tags or publishes Releases; it checks that the next Version's Release Note exists.
- Production can only run a tagged Version; `deploy.yml` production deploys come from the Promotion.
- A Version with nothing a Candidate can see gets its tag and a technical Release, but no Release Note in Nouveautés.
