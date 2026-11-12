# Activité is one timeline: what runs now, then the history, Coach replies included

Status: accepted (product owner, 2026-11-05: variant C of the prototype https://claude.ai/artifact/JY21jgJyd6hom2jgxbM4hX; tracking issue and tickets in the « Activité unifiée » plan). Amends ADR-0070 (what Activity holds) and the AI Activity of #314, #332, #333.

On an object's page, Activity (the Fiche's « Activité » group, or the Activité column) showed separate blocks: the Context bar, « Sources », « Outils » and « Par élément ». The AI Coach's own steps (its Coach Actions, Tool rounds, the Guardrail check) lived in the conversation and in the Back Office only, and a Job Search running while the Candidate talked to the AI Coach showed up in a live pane apart from the reply. The product owner wants one Activity: « in a page that has a search and a running conversation with the coach, we should have them combined under the Activity ».

- **Activity is the Context bar, then « En ce moment », then the history.** The Context bar keeps its place and meaning (ADR-0070, ADR-0078): the size of the AI Coach's context, never the cost of a reply.
- **« En ce moment »** holds the Candidate's AI actions under way: this page's, then « En cours ailleurs » with a link to their page (#333). Each shows its live Activity glyph, its current step in words, the steps already finished, the time so far and its stop icon. A Coach reply under way is one of them, with its tool steps (#788). With nothing running it says « Rien ne tourne sur cette page. »
- **The history lists the page's Activité entries, newest first, by day** (« Aujourd'hui », « Le 27/10 »). One row each: glyph, title, result, cost in short and the time. Opening a row unfolds its detail. A finished action leaves « En ce moment » and becomes the first row of « Aujourd'hui ».
- **An Activité entry is one of:**
  - an AI Activity element with its Provenance: an AI Coach reply, a Job Search, a Job Offer's reading, a Company Dossier, a Tailored CV or Tailored Document, a Master CV Version read from a file, a Job Digest, an ATS Score;
  - a Master CV Version, saved by hand or from an applied Action Card, with its Origin;
  - an applied Action Card, as the change it made (« Profil modifié · Lieux : + Blagnac »).

  A pending, dismissed or withdrawn card is no entry of its own: it shows in its reply's entry.
- **An AI Coach reply's entry** shows the Candidate's question as one quoted line. It also shows its tool steps, read from its Provenance (`seen` and `action`, #788), and what it read (« Lu : CV de référence v6, ATS Score, Profil »). It names its Tools and models, its proposals with their state, and what each applied proposal led to.
- **Entries link to each other and to their object.** « suite de » points an entry at the one that caused it: a reply, then the Master CV Version its card created, then the ATS Score computed on that version. Each entry also links to its object's page and, when it came from the conversation, to its message (« Voir dans la conversation »). A reply and a card in the thread link back with « Dans l'activité ».
- **What a page shows.** An object's page shows the entries of that object and of what it holds: a Profile's page includes its Master CV Versions and ATS Scores, and a Job Search's page its run and the Job Offers read from it. It also shows the AI Coach replies of its Coach Conversation. The home page and the menus show their conversation's replies and what they started.
- **Sources and Tools move into the entries.** Each entry names its own. The page keeps one folded « Sources et outils de cette page » at the foot, where each Provenance site appears once, as before.
- **Cost is shown honestly, never in euros** (Coach Message Cost stays with Administrators):
  - What uses a Plan Quota says so, with the week's use the Usage Meter reads (Plan Quotas count per week, ADR-0032): « 1 recherche du forfait · 4 sur 7 cette semaine », the wording of #801. A feature without a Plan Quota shows no counter, at most « compté dans votre consommation ». Both link to `/abonnement#consommation` (ADR-0091, #804), which does the counting; Activity counts nothing.
  - Jetons stay a technical measure. For an AI Coach reply they are the sum of all its calls, from `coach_message` (#791): « 4 appels · 21,4k jetons envoyés ». A reply saved before #791 shows what its Provenance holds and says « dernier appel seulement ». Any other entry shows its Provenance's tokens.
  - A step or entry made by rules alone, or without AI, says « Sans IA ».
- **Profile creation is one entry, « Création du profil »** (ADR-0070, #657). It holds the CV's reading (the only AI, with its Provenance), the onboarding questionnaire (Jobbbox's questions, « Sans IA »), the review in the Work Pane, then « Profil créé » with Master CV Version 1 and its first ATS Score. It is not an AI Coach reply. The Context bar stays empty (« Le coach n'a pas encore répondu ») until the AI Coach replies in the Profile's conversation. After a reload it is rebuilt from what is stored (the reading's Provenance, the Profile's creation, Version 1, the ATS Score). Nothing new is kept about the questionnaire's timing.
- **The AI Activity button opens Activity.** It keeps its frame and its words (the page's summary, or the step under way with its stop icon), but opens the Fiche on its « Activité » group, or the Activité column, instead of its own « Cette page » pane. That pane is retired. On a phone, Activity opens full screen with « Fermer », as ADR-0070 says.
- **Unchanged:** Provenance and what it stores; the Back Office's AI Activity and AI Message Log; a Job Search's own page and its records; the conversation's tool lines (#788).

## Taken by default, open to the product owner

The product owner chose the variant. The prototype's three other questions were answered with the recommendation above, and each can be changed without undoing the rest:

- the AI Activity button opens Activity;
- Master CV Versions saved by hand are entries;
- profile creation is one grouped entry.

## Decisions of the build (#808)

- **The server builds the entries from Provenance; only the entries cross to the browser.** A raw Provenance is never sent (it stays server-side, as before). The server serves the entries of the page's elements, Master CV Versions and Coach replies about the object. The browser adds the replies its own conversation shows, with their questions and cards, and links a Master CV Version made by an applied card to the reply that proposed it.
- **A reply's message is identified by the time it was saved**, which is what « Voir dans la conversation » and « Dans l'activité » use to find each other.
- **The « Modèles » block and its Total are removed too**, as variant C has none; the three blocks named above were not the only ones.
- **A day heading and the « Dans l'activité » button stay at body size** (ADR-0057).

## Amendment (#809)

- **« Keeps its frame » means the Top Bar's « Activité » Button.** The product owner chose, on #902, to merge the AI Activity button into the « Activité » button #603 added, rather than keep a separate icon-only square beside it: two buttons doing the same toggle would be redundant. Its visible label is « Activité », with the live Activity glyph while an action runs; its words and stop icon stay beside it, and its accessible name stays « Activité IA » followed by its words. One entry point, `toggleActivity` (`ActivityColumn.toggle`), opens and closes Activity, from this button and from any other entry such as the compact phone bar's « … » (#897).

## Amendment (#810)

- **A Profile's creation is one entry, « Création du profil »**, in place of Version 1 and its ATS Score as entries of their own: the CV's reading (the only AI step), the onboarding questionnaire, the review, « Profil créé » with Version 1, and its ATS Score.
- **What only the browser knows is held in memory, never stored**: the questionnaire's answers and the review opened. Storing them would add a record of the Candidate's answers for a display; after a reload the entry shows only what is kept.
- **The Context bar says « Le coach n'a pas encore répondu. » until the coach's first reply**, with no figures, including on /profils/nouveau, rather than showing a ceiling with nothing read.

## Considered Options

- **A, one feed grouped by run, newest first, every entry a card**: complete, but what runs now scrolled away under older cards.
- **B, grouped by origin (Coach, Recherches et offres, Profil, CV et calculs) under a common header with counts**: sorted by origin rather than by time, which hid that a reply was given while a search ran.
- **C, « En ce moment » then the history** (chosen): what runs is always first, and the history stays one line per entry until opened.
- **Keeping the live pane of AI Activity apart from Activity**: two places for the same running search.
- **Showing a reply's cost in euros, or the Context bar as its cost**: euros stay with Administrators, and the Context bar measures the context, not the calls (#790).

## Consequences

- The Coach reply's cost must be served per message, not only for the latest reply (#791 serves only the latest).
- `ai-activity/pane.ts` gives way to a builder of Activité entries over the page's elements, the Coach replies with their cost, Master CV Versions and applied Action Cards. The « Par élément », « Sources » and « Outils » blocks are removed.
- The Help Articles that describe AI Activity and the Fiche are rewritten. The AI Activity e2e and the screenshot baselines of the Fiche change.

## Amended by ADR-0105: the onboarding is an interview with the AI Coach (2026-11-12)

« Création du profil » stops being « Sans IA » once the AI Coach leads the onboarding interview (#1002): its questions are the AI's, with their Provenance and cost. From the scripted questionnaire, the Profile is born once its target role and location are answered (#999), so « Profil créé » shows before the review.
