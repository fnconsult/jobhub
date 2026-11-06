# Recherche : l'existant de l'Espace coach et du parcours d'une Coaching Session (#842)

Carte : #841. Lu le 2026-11-06 sur `main` (e8c6d0c).

## Question

Que sait faire aujourd'hui un Human Coach dans Jobbbox, et où le parcours d'une Coaching Session casse-t-il, du paiement à l'après-séance ?

## Sources lues

- Code : `apps/web/src/human-coaches/index.ts` (module et migrations), `apps/web/src/app/espace-coach/**`, `apps/web/src/app/coachs/**`, `apps/web/src/app/api/coach-space/**`, `apps/web/src/app/api/coaching/**`, `apps/web/src/app/admin/coachs/page.tsx`, `apps/web/src/billing/index.ts` (remise), `apps/mobile/src/navigation/{Sidebar.tsx,human-coach.ts,pages.ts}`, `apps/mobile/src/coaching/**`.
- ADR : 0016, 0027, 0028, 0029, 0071, 0074, 0076, 0088, 0089.
- Glossaire : Human Coach, Coaching Session, Unscheduled Coaching Session, Coach Access, Coach Review, Coach space, Retired Human Coach, Coaching Session Price, Plan Feature, Order, Withdrawal, Agenda, Reschedule, Calendar file, Appointment Reminder.
- Aide : `packages/help/articles/fr/` (`page-coach-space`, `page-human-coaches`, `page-coaching-order`, `tutorial-book-coaching-session`, `tutorial-coach-session-date`, `tutorial-coach-review`, `faq-coach-access`, `faq-retired-human-coach`, `faq-coach-app-notifications`, `faq-coach-two-step-verification`, `faq-coach-app-two-step-verification`), motion `reserver-seance-coach`.
- Registre : `docs/privacy/register.md` (Stripe, Back Office Audit, Acceptances).
- Issues : #554, #694, #796, #518, #255, #707.

## Ce qui existe

### Le Human Coach

- **Identité** (ADR-0016) : une ligne de `human_coach` (nom, e-mail, `booking_url` Cal.com, `bio`, `retired_at`), saisie par un Administrator dans le Back Office (`/admin/coachs`, Back Office Audit). Pas de compte propre : le coach se connecte comme un Candidate et est reconnu par son e-mail vérifié. Aucune photo, spécialité, langue, tarif ou disponibilité ; le coach ne modifie rien de sa fiche.
- **Retraite** : un Retired Human Coach n'est plus listé et ne lit plus rien ; ses Coaching Sessions et Coach Reviews restent.

### Le Coach space (`/espace-coach`)

- Une page unique, deux sections :
  1. **Ses Coaching Sessions** (`coachSessions`) : Unscheduled d'abord, puis datées ; Candidate en prénom + initiale (sans Coach Access) ; date en heure de Paris, durée, lien visio (« Rejoindre ») ; date de paiement ; boîte de dialogue pour saisir ou corriger date, durée et lien (`scheduleCoachedSession`, Reschedule « modifié par le coach ») ; annulation par le coach (`cancelCoachedSession` : la séance redevient Unscheduled).
  2. **Ses Candidates sous Coach Access** : nom et e-mail, puis une page par Candidate (Profiles et Applications en lecture) et une par Application (Tailored Documents, formulaire de Coach Review).
- Pas de Sidebar ni de Top Bar propres : `CoachSpaceShell`, hors de la conversation au centre (ADR-0070 ; #585 l'exclut). Sortie par `/espace-coach/sortie`.
- **Jobbbox app** : « Espace coach » au pied du Sidebar quand `GET /api/coach-space` dit `humanCoach` (#689) ; les Push notifications du coach passent par le compte de son e-mail vérifié (ADR-0089).
- **Aide** : rubrique « Espace coach » (#554) : page, FAQ Coach Access et Retired Human Coach, tutoriels date de séance et Coach Review, double authentification.

### Le parcours du Candidate

1. **Mes coachs humains** (`/coachs`) : les Human Coaches (nom, bio), Coach Access à accorder ou retirer, les Coaching Sessions et leur statut, la remise du Plan (Plan Feature `coachingSessionDiscount`).
2. **Order** (`/coachs/commande`, ADR-0074) : récapitulatif, prix TTC, case CGV, Immediate Performance Request ; sur l'app, App Order screen (ADR-0088).
3. **Stripe Checkout** : deux Stripe Prices (régulier, remisé) choisis côté serveur ; la Coaching Session n'existe qu'au webhook signé (ADR-0016), une fois par Checkout Session.
4. **Réservation** : le lien Cal.com du coach, montré après paiement ; Jobbbox n'apprend pas l'heure réservée (ADR-0016, ADR-0027).
5. **Date saisie à la main** par le Candidate ou le coach (date, durée, lien visio, note du Candidate) ; Reschedule history au-delà d'une heure ; « À planifier » en tête de l'Agenda tant qu'il n'y a pas de date.
6. **Avant la séance** : Calendar file (.ics) par Agenda Item, sans synchronisation (ADR-0029) ; Appointment Reminder la veille à 18:00 (e-mail et push), **pour le Candidate seulement**.
7. **Annulation** par l'un ou l'autre : la séance redevient Unscheduled ; **aucun remboursement** dans Jobbbox.
8. **Withdrawal** (`/abonnement/retractation`, ADR-0071) : remboursement Stripe automatique et intégral, le coach est prévenu ; la séance quitte l'Agenda et le Coach space (`withdrawn_at`).
9. **Pendant et après** : rien. La séance se tient sur l'outil du lien (`video_link`, quelconque) ; aucune trace de son contenu ; la Coach Review est attachée à un Tailored Document, pas à une séance.

### Le modèle de données

| Table | Colonnes utiles | Remarque |
|---|---|---|
| `human_coach` | name, email, booking_url, bio, retired_at | Pas de profil public, de prix, de fuseau, de compte de paiement. |
| `coach_access` | candidate_id, coach_id, granted_at | Lecture seule du Profile et des Applications. |
| `coach_review` | application_id, document, text | Par Tailored Document. |
| `coaching_session` | stripe_checkout_session_id, amount, currency, paid_at, scheduled_at, duration_minutes, video_link, note, changed_by, withdrawn_at | Une séance = un paiement. Pas de statut tenu / non tenu, pas de remboursement hors Withdrawal, pas de fournisseur visio. |
| Reschedules | historique partagé avec les Interviews | `setAgendaItemDate`. |

## Manques, par axe de la carte

| Axe | Ce qui manque | Ce qui contraint |
|---|---|---|
| Espace coach au quotidien | Accueil « du jour » ; fiche Candidate qui réunit séances, Profile, Applications ; préparation d'une séance ; profil public éditable (photo, spécialités, langues) ; revenus ; contrat (#518) ; notifications par e-mail au coach (seule la push existe) ; aide au-delà de 5 articles. | ADR-0016 (coach reconnu par l'e-mail, édité en Back Office) ; Coach Access en lecture seule ; prénom + initiale sans Coach Access. |
| Revenus et remboursement | Aucune vue des montants ; coach payé hors plateforme ; remboursement hors Withdrawal (#255) impossible dans Jobbbox, la séance annulée reste payée et « À planifier ». | Jobbbox vendeur, prix unique (Coaching Session Price), ADR-0016. |
| Agenda | Disponibilités, créneaux, réservation liée au paiement, synchronisation, rappel du coach, autre fuseau que Paris. | ADR-0027 (saisie à la main, Cal.com non relié), ADR-0029 (pas de flux ni de synchronisation), `INTERVIEW_TIME_ZONE` partout. |
| Conversation | Visio ou appel dans Jobbbox ; création du lien chez Zoom, Meet ou Teams ; salle d'attente. | `video_link` libre (http/https), aucun fournisseur au catalogue des Tools. |
| Prise de notes | Notes du coach (aucune), enregistrement, transcription, résumé ; lien avec la Coach Conversation du Candidate. | La note de séance est au Candidate seul, jamais lue par le coach ; voies IA d'ADR-0007. |
| Partage de présentation | Partage d'écran ou d'un document Jobbbox pendant la séance ; slides du coach. | Coach Access en lecture seule ; PDF.js (ADR-0067), uploads (ADR-0068). |
| Masterclasses | Tout : aucun produit vendu par un coach, aucun contenu vidéo du coach. | Jobbbox seul vendeur ; Plan Features en code ; stores (#707). |
| UI et UX | Coach space en une page, sans navigation ni Mercury dédiés ; mobile = lien au pied du Sidebar. | Mercury (#460), mode sombre (#473), ADR-0009, ADR-0076. |

## Conclusions pour le cadrage (#851)

1. Le Human Coach est aujourd'hui un **prestataire géré par Jobbbox** : Jobbbox fixe le prix, vend, encaisse, et le coach ne touche à rien d'autre que les dates et les Coach Reviews. Les axes « profil public », « revenus » et surtout « masterclasses » changent ce rôle : c'est la première question du cadrage.
2. **Une Coaching Session est un paiement avant d'être un rendez-vous** (ADR-0016). Toute réservation par créneaux doit dire si l'on réserve avant ou après le paiement, et ce que devient l'Unscheduled Coaching Session.
3. **Rien n'existe pendant ni après la séance** : visio, notes, partage et résumé partent d'une page blanche, sans dette mais sans socle.
4. Le **remboursement hors Withdrawal** (#255) et l'**annulation par le coach** sont des trous déjà visibles aujourd'hui, à traiter quel que soit le reste.
5. Trois ADR seront au moins amendés si l'agenda change : 0016, 0027, 0029.
6. L'aide « Espace coach » (#554) et la motion `reserver-seance-coach` seront à reprendre (carte #494).
