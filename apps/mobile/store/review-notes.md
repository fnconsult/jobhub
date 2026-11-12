# Notes pour la revue des stores : brouillon

_#708, ADR-0076. **Brouillon, à confirmer par #707** (les positions sur les paiements) **et à compléter par l'éditeur** (les comptes de démonstration, le contact). Rien n'est soumis. Les notes se saisissent en anglais : App Store Connect, « App Review Information » › « Notes » (4 000 caractères au plus) ; Play Console, « Accès aux applications » › instructions, et la réponse à une demande de la revue._

## Ce qui manque avant de pouvoir les envoyer

1. **Le contact de la revue** (prénom, nom, e-mail, téléphone d'une personne joignable) : [ENTITÉ À CONFIRMER]. Pour cette raison `../store.config.json` n'a pas de rubrique `review` : la saisir dans App Store Connect.
2. **Les deux comptes de démonstration**, sur la Production : un Candidate et un Human Coach, aux données inventées (les noms de `maestro/seed.ts` conviennent), sans vérification en deux étapes.
3. **Comment le relecteur se connecte : à trancher, le produit ne le permet pas encore.** #708 demande une « connexion par code fourni dans les notes de revue ». Or le code de connexion n'existe que dans l'e-mail, vaut 15 minutes et une seule fois (`apps/web/src/auth/sign-in-code.ts`) : un code écrit dans les notes ne marche pas, et les stores refusent une app qu'ils ne peuvent pas ouvrir (règle 2.1). Deux voies, au choix du product owner :
   - **un code de revue fixe**, accepté pour les deux seuls comptes de démonstration, réglé et coupé dans le Back Office : un changement de code, donc une issue à part avec sa revue de sécurité (recommandé : c'est ce que #708 décrit) ;
   - **une boîte e-mail de démonstration** dont l'accès est donné au relecteur dans les notes : rien à coder, mais un secret partagé à changer après chaque revue.
4. La confirmation de #707 sur les paragraphes « Payments » ci-dessous.

## Notes (anglais, à coller)

<!-- notes:start -->
Jobbbox is a job-search coaching service for candidates in France and French-speaking countries. This app is a companion to the web app at jobbbox.ai and uses the same account. It serves two roles in one app: Candidates and Human Coaches. The interface is in French and English and follows the device language.

SIGNING IN
There is no password. On « Sign in to Jobbbox », enter the demo email address, tap « Send me a sign-in link », then enter the 6-digit code under « Enter the code from the email » and tap « Sign in with this code ».
Demo Candidate: [TO BE COMPLETED: email and how to get the code]
Demo Human Coach: [TO BE COMPLETED: email and how to get the code]
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
