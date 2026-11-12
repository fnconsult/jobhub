# Onboarding is an interview with the AI Coach; the Profile is born at its target role and location, and its first Job Search is offered

Status: accepted (product owner, 2026-11-12, decisions 1 to 8 of #994; map #992; built from #999 on, then #1000 to #1004). Amends ADR-0086 (creation « Sans IA ») and ADR-0070 (the Onboarding Questionnaire on `/profils/nouveau`).

The product owner wants the Job Search to start « before even finishing the CV » and to « start narrowing down based on criteria that are being added to the profil ». A Job Search needs a Profile, so the Profile can no longer wait for the review's save.

- **Without a CV, the AI Coach leads the interview** (#1002), in place of the scripted Onboarding Questionnaire: one question at a time; it challenges a vague answer and, when it can deduce something, proposes it for the Candidate to validate. Nothing enters the Profile that does not come from an answer or a validation (ADR-0006). No Plan Quota, its cost traced; the exchange is not kept as a Coach Conversation. The scripted questionnaire stays its fallback, when the AI is unavailable.
- **With a CV**, after the reading, the AI Coach asks only what is missing (contracts, remote work, minimum salary, the target role and a location when absent), proposing a deduction when it can; each question can be skipped (#1003).
- **The Profile is born once the target role and a location are validated**, read from the CV and confirmed, or answered: it is what a Job Search needs (#999). It is created with its onboarding in progress (`profile.onboarding = 'in_progress'`) and counts in the Plan Quota from then on; the quota is still checked on entering the page, and a refusal at the birth shows the Upgrade prompt in the thread. Each answer validated afterwards is saved on it: a change of its Search Criteria through their usual update, and one Master CV Version at the end of the interview, not one per answer. Until it is finished, the Profile is named after its target role and its page says « Création à terminer » with « Reprendre la création », which reopens `/profils/nouveau?profil=<id>` where it stopped. Finished, it is `done`; a Profile created otherwise (the extension, a duplicate) has no onboarding.
- **Its first Job Search is offered and runs during the collection** (#1000, #1001): once per Profile created, outside the Plan Quota. It narrows as criteria are added: the « offres qui vous correspondent » are recomputed live by the Match Score (rules, no AI) on the Search Criteria of the moment. If the target role or the locations change, it is started again, offered too, once more at most. Its progress shows in AI Activity's « En ce moment » (amended below, #1001), with the real `DiscoveryMetrics` counters and no figure that is not measured.
- **The summary is composed by Jobbbox, not by an AI** (#1004): « Voici comment je comprends ce que vous recherchez. Ai-je bien compris ? », « Cela semble correct » / « Modifier ». The free text of « Modifier » is translated by the AI into Search Criteria changes for the Candidate to validate, then the summary is composed again. « Voir le détail » opens the review form. After « Cela semble correct », the search's 3 to 5 best Job Offers show as cards; « Continuer vers mon profil » is offered at any time, the search going on with its Job Search Notification.
- **« Partir de zéro » disappears** (#1002).

## Amendment (#1001, product owner, 2026-11-12): the search's progress is Activity's, not a card in the thread

The product owner turned down the search card in the thread, stuck or scrolling, after the Design System audit.

- **No card in the thread.** The thread says at most, in one line of the coach (text, no frame, ADR-0053), that the search has started, or started again.
- **Its progress is the `job_search` entry of « En ce moment »** in the side panel's « Activité » view (#985). `/profils/nouveau` follows its offered Job Search as its own: AI Activity counts it « ici » there, though its page is the Job Search's; no other page changes. Its entry adds, in Design System components: the four steps (Stepper), its measures (Stats: sources consultées, pages lues, offres analysées, offres qui vous correspondent), each source's state (Status, a dot and its words) and « Affinée avec : … », a deduced criterion not yet confirmed followed by « (supposé) » in words. No orbit, no tint, no accent border. AI Activity's live region says its start and its end, never a counter.
- **Its found Job Offers need no new view** (option B over an « Offres trouvées » view on this page): once over, it leaves « En ce moment » as every action does (ADR-0086), and the page's history keeps an entry of its own, « Recherche d'offres », built by the browser from what it followed (like « Création du profil », gone once the page is loaded again): its steps, the Job Offers it analysed, « Offerte, hors forfait », its 3 to 5 best Job Offers (title, employer, Match Score, each linked to its page in the Job Search) and « Voir toutes les offres », its page.

## Amends ADR-0086

« Création du profil » is no longer « Sans IA » once the AI Coach leads the interview (#1002): its questions are the AI's, with their Provenance and cost. Until then the scripted questionnaire keeps « Questions écrites par Jobbbox » and « Sans IA ». « Profil créé » now shows when the Profile is born, before the review (#999).

## Considered Options

- **Creating the Profile at the review's save, as before**: no Job Search can run during the collection, which is what the product owner asked for.
- **A draft Profile outside the Profiles until the end**: a second kind of object for the Job Search, the Plan Quota and the Profile switcher to know of; a Profile with its onboarding in progress is an ordinary Profile with one more column.
- **One Master CV Version per answer**: a version history of fragments; the interview's answers are one change, saved once.
- **Counting the first Job Search in the Plan Quota**: the free Plan's one weekly search would be spent before the Candidate saw their Profile.
- **The summary written by the AI**: a paragraph that could say what no answer said (ADR-0006); Jobbbox composes it from the Search Criteria themselves.
- **Keeping « Partir de zéro »**: an empty form duplicating what the interview does one question at a time.

## Consequences

- `profile.onboarding` (`in_progress` | `done` | null) is added by `migrateProfiles`, read with the Profile and in the Personal Data Export. `POST /api/profiles` takes `onboarding`; `POST /api/profiles/:id/onboarding` saves the one Master CV Version and finishes it.
- `job_search.offered` (`first` | `restart` | null), added by `migrateJobSearches`, with a unique index on (`profile_id`, `offered`), marks the offered Job Searches (#1000): `JobSearches.startOffered`, behind `POST /api/profiles/:id/onboarding-search`, starts them only while the Profile's onboarding is in progress, uses no Plan Quota (so « Votre consommation » does not count them), gives none back when they fail or stop empty, and stops the first, still searching, when it starts the restart. The Personal Data Export says which Job Searches were offered.
- The answers are kept on the Profile as they are validated, no longer only in the browser until the save (privacy register, « Création du profil »).
- The run's Live discovery metrics (#1001), written by the worker on `job_search.live` while it runs and kept once over, come with its steps in AI Activity's poll (`GET /api/job-searches/notifications`, without the Job Offers' ids); the onboarding's page asks `GET /api/job-searches/:id/live` for the Job Offers found each time the run analysed more, and once over. « Offres qui vous correspondent » is the page's own count, by Match Score against the Search Criteria of the moment (FUNNEL_MATCH_SCORE), so it follows each criterion without a new search.
- `CONTEXT.md`: **Onboarding interview** replaces **Onboarding Questionnaire**; **Profile** and **Job Search** say how the onboarding creates and searches.
