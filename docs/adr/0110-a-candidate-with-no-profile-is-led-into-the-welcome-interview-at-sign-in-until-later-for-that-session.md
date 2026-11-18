# A Candidate with no Profile is led into the « Entretien d'accueil » at sign-in, until « Plus tard », for that session

#1050 (A1, under #1041) opens the « Entretien d'accueil » (ADR-0106) as soon as a Candidate signs in, instead of leaving them on Mon compte to find « Créer mon premier profil ». Sign-in stays first, before any interview (#1042, decided with the product owner on 18/11/2026).

## Decision

- **`/` and `/compte` lead to `/profils/nouveau`** when `leadsToOnboarding(session)` (`apps/web/src/onboarding-arrival`) is true: the session has not chosen « Plus tard », the Candidate has no Profile at all (archived and « Création à terminer » ones count as having one), and the account is not a Human Coach's, an Administrator's or an Association's. Roles are read only when there is no Profile. `/compte/profils` never redirects.
- **« Plus tard » is stored on the sign-in session**, as the Better Auth session field `onboardingPostponed` (boolean, default false, `input: false` so the client cannot set it). It holds for that session only: signing in again, on another device or after signing out, leads to the interview again. No cookie is added.
- **« Plus tard » is offered on `/profils/nouveau`**, among the opening suggestions, to a Candidate with no Profile only. It is a form posting to a server action, so it works before the page's script loads, and leads to Mon compte.
- **The CGU Acceptance still comes first**: `/profils/nouveau` goes through the acceptance gate (ADR-0062).
- **No redirect inside the Jobbbox app's WebView**: the app opens Mon compte from its own menu and has its « Pour commencer » card.
- **The landing page's « Créer mon compte » links to `/connexion?suite=%2Fprofils%2Fnouveau`.** Signing up from the extension therefore also lands on the interview, since the account has no Profile yet when the Jobbbox tab loads.

## Considered Options

- **A cookie for « Plus tard »**: it outlives the sign-in and is a new storage to disclose; the session field ends with the session and needs no notice.
- **A stored « postponed » flag on the Candidate**: the Candidate would never be led again, which loses the point of the redirect.
- **Redirect in the sign-in callback only**: a Candidate who returns to `/` or `/compte` in the same session would not be led again, and a deep link would skip it.
