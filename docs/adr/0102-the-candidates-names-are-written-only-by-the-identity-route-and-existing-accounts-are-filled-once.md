# The Candidate's names are written only through the Identity route, and existing accounts are filled once

Status: accepted (#918)

The account gets a Given Name, a Family Name and a Preferred Name (Mon compte › Identité). Three rules keep them consistent.

- **Better Auth extra fields the client cannot set** (`given_name`, `family_name`, `preferred_name` on `candidate`, `input: false`). Only `PUT /api/account/identity` writes them, through `candidate-identity`, which trims, caps each at 80 characters (400 `too_long` with the field name) and sets `name` to « Prénom Nom » in the same save; with neither, `name` keeps the value it has (a Sign-in Provider's, say), else takes the Preferred Name, and is never emptied (#929 review, product owner's choice of 2026-11-09). `name` never drifts from the two names, and the sign-up and update endpoints of Better Auth cannot change them.
- **Existing accounts are filled once, by the migration, after the Profiles step.** The Given Name and Family Name come from the account's `name`, otherwise from the latest Master CV's full name; the Preferred Name is the Given Name. Words in capitals are the Family Name, written as a name (« DUPONT Marie » gives Marie / Dupont). Nothing already filled is overwritten. A one-row table, `identity_names_backfill`, records the run: a re-run does nothing, so a name the Candidate cleared stays cleared. The marker is global, not per account: an account created later starts empty and is never filled behind the Candidate's back.
- **`/compte` keeps opening on Profils**, where Candidates land after signing in and where the onboarding Motion clicks « Créer mon premier profil ». Identité is first in the list of Sections, not the page `/compte` shows (`baseShows` on `SectionsLayout`).
