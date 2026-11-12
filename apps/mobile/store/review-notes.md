# Notes pour la revue des stores : brouillon

_#708, ADR-0076. **Brouillon, à confirmer par #707** (les positions sur les paiements) **et à compléter par l'éditeur** (les comptes de démonstration, le contact). Rien n'est soumis. Les notes se saisissent en anglais : App Store Connect, « App Review Information » › « Notes » (4 000 caractères au plus) ; Play Console, « Accès aux applications » › instructions, et la réponse à une demande de la revue._

## Ce qui manque avant de pouvoir les envoyer

1. **Le contact de la revue** (prénom, nom, e-mail, téléphone d'une personne joignable) : [ENTITÉ À CONFIRMER]. Pour cette raison `../store.config.json` n'a pas de rubrique `review` : la saisir dans App Store Connect.
2. **Les deux comptes de démonstration**, sur la Production : un Candidate et un Human Coach, aux données inventées (les noms de `maestro/seed.ts` conviennent), sans Back Office Role, leurs adresses des boîtes de `jobbbox.ai` que l'équipe lit. Le Candidate, sans vérification en deux étapes.
   **TODO (product owner) : le Human Coach de démonstration.** Un Human Coach doit avoir la vérification en deux étapes (#665), et le code de revue ne la contourne pas (#981). Le relecteur se verra donc demander une deuxième étape sur ce compte. À trancher : donner la deuxième étape dans les notes (par exemple un code de secours du compte de démonstration), ou retirer le Human Coach de la démonstration. La phrase « Neither demo account has two-step verification » des notes ne vaut que pour le Candidate tant que ce n'est pas tranché.
3. **Comment le relecteur se connecte : le code de revue des stores (#981).** Le product owner a choisi un code fixe plutôt qu'une boîte e-mail de démonstration partagée. Coupé par défaut, il s'allume dans le `.env` de la Production juste avant la soumission, pour les deux seuls comptes de démonstration, et se coupe après la revue : procédure dans `docs/ops/mobile.md`, « Code de revue des stores ». Le relecteur suit le parcours habituel (adresse, e-mail demandé, code saisi) ; chaque connexion est inscrite au Journal. Au moment de saisir les notes dans App Store Connect et la Play Console, y remplacer `[REVIEW CODE]` et les adresses par les valeurs de ce `.env`, **jamais dans ce fichier** : le code est un secret, tiré à nouveau pour chaque revue.
4. La confirmation de #707 sur les paragraphes « Payments » ci-dessous.

## Notes (anglais, à coller)

<!-- notes:start -->
Jobbbox is a job-search coaching service for candidates in France and French-speaking countries. This app is a companion to the web app at jobbbox.ai and uses the same account. It serves two roles in one app: Candidates and Human Coaches. The interface is in French and English and follows the device language.

SIGNING IN
There is no password. On « Sign in to Jobbbox », enter the demo email address, tap « Send me a sign-in link », then enter the 6-digit code under « Enter the code from the email » and tap « Sign in with this code ».
Demo Candidate: [TO BE COMPLETED: email], code [REVIEW CODE]
Demo Human Coach: [TO BE COMPLETED: email], code [REVIEW CODE]
The review code works only for these two demo accounts, during the review. You may type it as soon as you have asked for the sign-in email: there is no need to open the email. If a code is refused 5 times, ask for a new email and type the same code again.
Neither demo account has two-step verification. « Continue with Apple » (Sign in with Apple) is offered beside the other sign-in providers.

THE AI COACH
The coach in every conversation is an AI, not a person. It says so in a fixed first message at the top of every conversation, and each of its replies is labelled « AI Coach ». Its replies pass through content checks before they are shown. « Report a problem », under every conversation, lets a person report a reply.

PAYMENTS
The app has no in-app purchase.
- Subscription plans: the app shows the person's plan with the sentence « Your subscription is managed on jobbbox.ai. », with no price and no purchase link. Plans are bought on the web only (guideline 3.1.3(b), multiplatform services).
- Coaching sessions: in « My human coaches », a candidate books and pays a session with a human coach, an HR professional. Each session is a live, one-to-one video session between the candidate and that coach, a real-time person-to-person service (guideline 3.1.3(d)). It is paid with Stripe Checkout in the in-app browser, and the candidate then picks the time of the session. To see it: sign in as the demo Candidate, open « Menu », then « My human coaches ». [TO BE COMPLETED: Stripe test card or a prepaid demo session]

ACCOUNT DELETION
In the app: « Menu », « My account », « My data », « Delete my account ». The account is closed at once and its data deleted (guideline 5.1.1(v)). The same page offers a download of all the person's data.

PERMISSIONS
- Notifications: asked in context, after an explanation screen, when the person starts a job search or adds an interview; never at first launch. Each kind has its switch in « My account », « Reminders ».
- Calendar: write-only, through the system's new-event sheet. The app never reads the calendar.
- Face ID: only if the person turns on « Lock the app » in « App settings ». It is a device setting, never a sign-in step.

SHARE EXTENSION
From Safari or another app, « Share », then Jobbbox, opens the app on « Share to Jobbbox » with the shared link or text. Nothing is sent until the person taps « Send to Jobbbox ». The extension reads no page and holds no session.

PRIVACY
No advertising, no analytics SDK, no advertising identifier, no tracking: the App Tracking Transparency prompt is never shown. Crash reports are stored in the EU without a user identifier.

HUMAN COACH ROLE
Sign in as the demo Human Coach and open « Menu », then « Coach space »: the coach's pages open in a web view of jobbbox.ai, already signed in.
<!-- notes:end -->

## Google Play, « Accès aux applications »

- « Tout ou partie des fonctionnalités est restreint » : oui, par la connexion.
- Instructions : le paragraphe « SIGNING IN » ci-dessus, avec les deux comptes de démonstration.
- Aucun abonnement ni achat à déclarer.
