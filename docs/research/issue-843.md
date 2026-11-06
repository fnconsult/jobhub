# Recherche UX : parcours et interfaces des plateformes de coaching et de séances à distance (#843)

Carte : #841. Suite de #842 (l'existant). Lu le 2026-11-06.

## Question

À quoi ressemblent de bons parcours pour un Human Coach et pour son Candidate, avant, pendant et après une Coaching Session à distance, et quelles contraintes d'UI s'imposent à Jobbbox pour les prototypes ?

## Méthode et limites

- Benchmark fait sur les **centres d'aide et pages publiques** des produits, lus par recherche web le 2026-11-06. L'ouverture directe des pages a été refusée par le réseau de la session pour plusieurs hôtes (`cal.com`, `support.google.com`, `support.betterup.com`, `doctolibpatient.zendesk.com`) : pour eux, seuls les extraits des pages renvoyés par la recherche ont été lus. Chaque affirmation ci-dessous renvoie à sa page.
- **Pas de captures d'écran** : aucune session navigateur ni compte de test. Les **nombres de clics sont estimés** d'après les étapes décrites par les aides (marqués « ≈ »), à vérifier sur les produits quand on prototypera.
- Les aides datent parfois de 2020–2021 (Doctolib) : les libellés ont pu changer, les principes restent.

## Sources

Toutes lues le 2026-11-06.

| # | Produit | Page |
|---|---|---|
| S1 | Calendly | https://calendly.com/help/how-to-include-cancel-and-reschedule-links-for-invitees |
| S2 | Calendly | https://help.calendly.com/hc/en-us/articles/14079031268375-How-to-manage-your-meetings |
| S3 | Calendly | https://help.calendly.com/hc/en-us/articles/14077985848215 (Calendly + Stripe), https://calendly.com/help/payments-faq |
| S4 | Calendly | https://calendly.com/blog/new-scheduling-page-ui , https://help.calendly.com/hc/en-us/articles/14078682754071 (questions du formulaire) |
| S5 | Cal.com | https://cal.com/help/event-types/cal-video-meetings |
| S6 | Cal.com | https://cal.com/help/enterprise/guest-notification-settings , https://cal.com/help/workflows/workflowsoverview , https://cal.com/help/webhooks |
| S7 | Cal.com | https://cal.com/blog/cal-com-v5-4 (réglages avancés de Cal Video) |
| S8 | Doctolib (patient) | https://doctolibpatient.zendesk.com/hc/fr/articles/360013328460-D%C3%A9marrer-ma-consultation-vid%C3%A9o |
| S9 | Doctolib (patient) | https://doctolibpatient.zendesk.com/hc/fr/articles/360013476439 (problème de micro, son, caméra), https://doctolibpatient.zendesk.com/hc/fr/articles/360025304654 (documents) |
| S10 | Doctolib (praticien) | https://doctolib.zendesk.com/hc/fr/articles/360018866332-Comprendre-la-fen%C3%AAtre-de-t%C3%A9l%C3%A9consultation , https://doctolib.zendesk.com/hc/fr/articles/360040590672 (tester mon matériel), https://doctolib.zendesk.com/hc/fr/articles/360034163032 (documents des patients) |
| S11 | Doctolib | https://res.cloudinary.com/doctolib/image/upload/v1608054231/walkme/Email%20assets/pdf/Patients_Teleconsultation_Mode_demploi.pdf (mode d'emploi patient) |
| S12 | Malt | https://help.malt.com/hc/fr/articles/29792237913618-Comment-fonctionnent-les-avis-et-recommandations |
| S13 | Malt | https://www.keobiz.fr/fiches-pratiques/plateformes-pour-freelances-malt/ (séquestre, validation de fin de mission ; source tierce) |
| S14 | Superprof | https://www.superprof.fr/online.html , https://apps.apple.com/fr/app/superprof/id1523819447 , https://enseigna.fr/avis-superprof-soutien-scolaire/ (tierce) |
| S15 | Superprof | https://www.student.be/fr/student-life/decouvrez-superprof-le-site-de-mise-en-relation-profs-eleves/ (premier cours offert ; tierce), https://www.avis-verifies.com/avis-clients/superprof.fr?p=1 (avis clients) |
| S16 | Maven | https://help.maven.com/en/articles/9081204-student-home , https://help.maven.com/en/articles/5597433-your-course-events , https://help.maven.com/en/articles/9145615-zoom-logistics |
| S17 | CoachHub | https://resources.coachhub.io/start-your-coaching-adventure , https://www.coachhub.com/coaching-experience |
| S18 | BetterUp | https://support.betterup.com/hc/en-us/articles/360047093692-How-to-Join-and-Schedule-Sessions |
| S19 | BetterUp | https://support.betterup.com/hc/en-us/articles/360047532451-Coach-Matching-Guide-For-Members |
| S20 | BetterUp | https://support.betterup.com/hc/en-us/articles/46316887717915-Session-Insights-Member-Guide |
| S21 | Google Meet | https://support.google.com/meet/answer/10409699 (avant une réunion, « green room ») |
| S22 | Zoom | https://it.tufts.edu/guides/zoom-audio-and-virtual-conferencing/waiting-rooms (guide universitaire), https://devforum.zoom.us/t/reconnecting-to-existing-zoom-meeting/50357 (reconnexion) |
| S23 | Permissions web | https://web.dev/articles/permissions-best-practices , https://developer.chrome.com/blog/rethinking-web-permissions , https://www.nngroup.com/articles/permission-requests/ |
| S24 | WCAG 2.2 | https://www.w3.org/TR/WCAG22/ (1.2.4, 1.4.10, 2.2.1, 2.4.11, 2.5.8, 3.2.6, 3.3.7, 4.1.3) |

## Constats : les parcours, produit par produit

Légende : **C** = côté client (chez nous le Candidate), **P** = côté professionnel (chez nous le Human Coach).

### Calendly (S1–S4) : la réservation comme référence

- **C, avant** : (1) ouvrir le lien du professionnel ; (2) mois et créneaux du jour sur le même écran (S4) ; (3) formulaire court (nom, e-mail, questions ajoutées par l'hôte), sans compte (S4) ; (4) si l'événement est payant, paiement Stripe **dans** le parcours : la réservation n'est confirmée qu'une fois le paiement réussi, sinon on réessaie (S3) ; (5) page de confirmation, e-mail et invitation de calendrier. ≈ 4–5 clics.
- **C, modifier** : liens « Annuler » et « Replanifier » dans l'e-mail de confirmation et l'invitation, si l'hôte les active ; Calendly affiche la politique d'annulation mais ne l'applique pas (S1). Une réservation annulée ne se replanifie plus (S1).
- **P** : page « Calendar/Meetings » qui réunit à venir et passés sur une même frise (S2) ; notes de rendez-vous **visibles du seul hôte** (S2) ; « No-show » marquable après l'heure de début, et annulable (S2). Les remboursements se font dans Stripe, pas dans Calendly (S3).
- **Pendant / après** : rien de propre, la visio est celle du lien.

### Cal.com (S5–S7) : la même réservation, plus une visio intégrée

- **C, avant** : même parcours que Calendly ; e-mails de confirmation, d'annulation, de replanification et de demande de replanification, liens d'annulation et de replanification dans les rappels (S6). C'est déjà l'outil des Human Coaches (`booking_url`, ADR-0016).
- **Pendant (Cal Video)** : le lien s'ouvre **60 minutes avant** le début et reste valable jusqu'à 4 heures après la fin prévue (S5). Enregistrement et transcription réglés par type d'événement ; l'hôte confirme avant de lancer l'enregistrement ; enregistrements visibles de l'hôte seul (S5, S7).
- **Après** : e-mail avec les liens de l'enregistrement ; événements « no-show » de l'hôte ou de l'invité, détectés quand quelqu'un n'est pas venu dans les n premières minutes (S6).

### Doctolib téléconsultation (S8–S11) : le meilleur modèle « salle d'attente » pour un public large

- **C, avant** : rendez-vous pris dans l'app ou le site ; un lien par SMS ou e-mail **environ 10 minutes avant** ; à défaut, « Mes rendez-vous » → rendez-vous du jour → « Rejoindre la consultation vidéo » (S11). Un bouton **« Tester l'équipement »** vérifie micro, caméra et connexion avant d'entrer (S8). Documents à partager avec le soignant avant la séance (S9, S10). ≈ 2 clics depuis le lien, 3–4 depuis le compte.
- **C, salle d'attente** : le patient attend dans une salle virtuelle ; l'aide lui dit de vérifier que les icônes micro et caméra ne sont pas barrées, et comment autoriser Doctolib dans les réglages du navigateur (S8, S9). Navigateurs recommandés nommés : Chrome sur ordinateur et Android, Safari sur iPhone (S9).
- **P** : quand le patient arrive dans la salle d'attente, une notification apparaît sur l'agenda et une sonnerie se déclenche, ou après la consultation en cours (S10). La fenêtre de téléconsultation réunit la vidéo, les documents du patient et le partage de documents (S10).
- **Après** : le praticien partage ordonnance ou compte rendu ; le patient les retrouve dans « Mes documents » ; le patient ne peut plus envoyer de documents après la facturation (S9, S10).

### Malt (S12–S13) : confiance et paiement

- **C, avant** : profil public (compétences, portfolio, tarif), note moyenne affichée sur le profil, dans les résultats **et dans les conversations** (S12) ; proposition de mission, devis, puis **provision des fonds** sur la plateforme, gardés en séquestre (S13).
- **Après** : les deux parties valident la fin de mission, ce qui libère le paiement (S13) ; avis du client (1 à 5, commentaire) ; un avis masqué laisse une mention visible « avis masqué » (S12) ; badge « Sur Malt » pour les missions passées par la plateforme (S12).
- Pas de visio : Malt est l'exemple « place de marché + messagerie + paiement », pas celui de la séance.

### Superprof (S14–S15) : place de marché grand public, avec ses travers

- **C, avant** : recherche, profils avec avis et tarif, mention « premier cours offert » tant que le professeur n'a pas d'avis positif (S15) ; messagerie, objectifs, réservation et paiement dans l'app (S14).
- **Pendant** : salle de classe virtuelle intégrée depuis 2025 (visio, tableau blanc, documents) (S14).
- **Contre-exemple** : de nombreux avis clients dénoncent un « Pass Élève » mensuel pour écrire aux professeurs, peu clairement présenté, et un « premier cours offert » pas toujours tenu (S15).

### Maven (S16) : le « Student Home » et les séances en direct

- **C, avant** : chaque séance en direct est envoyée en fichier .ics, et le calendrier du cours est abonnable par URL (S16).
- **C, pendant** : le « Student Home » montre les séances de la semaine avec un bouton **« Join » qui apparaît près de l'heure** de début (S16).
- **C, après** : le même emplacement montre le bouton de l'enregistrement une fois l'événement fini ; l'enregistrement peut mettre quelques heures à arriver (S16).
- **P** : la visio est Zoom, reliée à Maven ; sans le compte Zoom adéquat, pas d'enregistrement automatique et une limite de 40 minutes (S16).

### CoachHub et BetterUp (S17–S20) : le coaching professionnel de bout en bout

- **C, choisir son coach** : un questionnaire (objectifs, style, langue, fuseau), puis une **courte liste de coachs recommandés** : six chez CoachHub (S17), des recommandations personnalisées chez BetterUp, avec « Schedule with [nom] » sur la fiche (S19). Changer de coach plus tard : « Switch your coach » puis parcourir les profils (S19).
- **C, avant** : préparer la première séance (objectifs, retours du manager) (S17) ; rappels par e-mail et SMS environ 10 minutes avant (S18).
- **C, pendant** : la séance se lance depuis le compte et s'ouvre **5 minutes avant** ; l'aide prévient « vous serez peut-être le premier, laissez au coach jusqu'à 10 minutes » (S18).
- **C, après** : « Session Insights » chez BetterUp : transcription facultative, **refusable dans les réglages ou pour une seule séance avant son début** ; les points clés apparaissent sous « Past sessions », où l'on peut aussi supprimer les données de la séance (S20). Objectifs suivis entre les séances et micro-contenus (S17).
- **P** : peu documenté publiquement (notes de séance, suivi des objectifs du coaché) ; non vérifié.

### Zoom et Google Meet (S21–S22) : la salle d'attente et le test du matériel

- **Meet, avant d'entrer** : aperçu de sa vidéo, contrôles micro, haut-parleur et caméra sous l'aperçu, choix des périphériques, barre du micro qui bouge quand on parle, son de test pour le haut-parleur, conseils quand une permission du navigateur manque, puis « Participer » (S21).
- **Zoom, salle d'attente** : titre, logo, description (voire une vidéo) personnalisables ; l'hôte admet une personne ou tout le monde ; il peut écrire aux personnes en attente, qui ne peuvent pas répondre (S22). « En attente de l'hôte » est un écran distinct de la salle d'attente (S22).
- **Reconnexion** : Zoom tente de rattacher la connexion pendant environ 5 minutes avant de retirer le participant (réponse d'un employé sur le forum, non officielle) (S22).

### Permissions caméra et micro dans un navigateur (S23)

- Demander **dans le contexte**, après un écran qui dit à quoi elles servent ; proposer un chemin **sans permission** (rejoindre sans caméra) qui sert aussi d'explication (S23).
- Ne pas redemander après un refus : expliquer la cause réelle (navigateur, système, autre application qui tient la caméra) et les étapes pour rétablir l'accès (S23). L'API Permissions n'existe pas sur Safari : il faut passer par `getUserMedia()` pour connaître l'état (S23).
- L'élément `<permission>` proposé par Chrome a réduit de 46,9 % les échecs chez Zoom (S23) : piste, pas encore un standard.

## Synthèse : un parcours de bout en bout, par rôle

| Moment | Candidate | Human Coach |
|---|---|---|
| Choisir | Courte liste de coachs avec photo, spécialités, langues, avis (CoachHub, BetterUp, Malt) | Profil public éditable (manque aujourd'hui, #842) |
| Réserver et payer | Créneau puis paiement dans le même parcours, confirmation, .ics (Calendly, Cal.com) | Disponibilités ; voir la séance payée apparaître |
| Préparer | Objectifs et documents à partager (CoachHub, Doctolib) | Fiche du Candidate : Profile, Applications, Tailored Documents, objectifs de la séance |
| Le jour J | Rappel, bouton « Rejoindre » qui apparaît près de l'heure (Maven, BetterUp) | Tableau du jour, alerte « le Candidate est arrivé » (Doctolib) |
| Entrer | Test du matériel, aperçu, permissions expliquées (Meet, Doctolib) | Même test ; admettre le Candidate (Zoom) |
| Pendant | Vidéo, partage d'un document, reconnexion | Idem, notes privées (Calendly) |
| Après | Récapitulatif et documents au même endroit que la séance (Maven, Doctolib, BetterUp) | Clôturer : tenue / non tenue (Cal.com, Calendly), notes, Coach Review, revenus |

## Motifs à reprendre (7)

1. **Réserver et payer dans un seul parcours, le créneau d'abord.** Calendly et Cal.com confirment la réservation au paiement réussi, sinon on réessaie, sans rendez-vous orphelin (S3). Chez nous la Coaching Session naît du paiement et la date arrive après, à la main (ADR-0016, ADR-0027) : c'est l'Unscheduled Coaching Session. Le motif réduit « À planifier » à l'exception. Il amende ADR-0016, 0027 et 0029 (#842).
2. **Un bouton « Rejoindre » qui apparaît au bon moment, au même endroit avant, pendant et après.** Maven montre « Join » près de l'heure, puis l'enregistrement au même endroit (S16) ; BetterUp ouvre 5 minutes avant (S18), Cal Video 60 minutes avant (S5). Chez nous : la carte de la Coaching Session dans la conversation de l'Agenda ou de « Mes coachs humains », et l'Agenda Item.
3. **Tester son matériel avant d'entrer, sans pression.** Aperçu vidéo, barre de niveau du micro, son de test, choix des périphériques, puis « Rejoindre » (S21) ; « Tester l'équipement » dès la veille chez Doctolib (S8). Pour un public de 40 ans et plus, ce test est rassurant : on doit pouvoir le faire **la veille**, depuis l'Appointment Reminder.
4. **Une salle d'attente qui dit ce qui se passe, et une alerte au coach.** Côté Candidate : « Votre coach a été prévenu », l'heure, ce qu'on peut faire en attendant, un délai annoncé (« jusqu'à 10 minutes », S18). Côté Human Coach : une notification et une sonnerie à l'arrivée du Candidate (S10).
5. **Des permissions demandées en contexte, avec un écran d'explication et un chemin de secours.** Expliquer avant la boîte du navigateur, proposer « Rejoindre sans caméra », donner des étapes de rétablissement selon le navigateur et le système, ne jamais redemander à l'aveugle (S23, S9). ADR-0076 applique déjà ce principe aux Push notifications.
6. **Courte liste de coachs plutôt qu'un catalogue.** Un questionnaire court (objectif, langue, disponibilités) puis 3 à 6 profils avec un appel à l'action par profil (S17, S19), et la possibilité de changer de coach plus tard. Cela convient à un petit nombre de Human Coaches choisis par Jobbbox, sans en faire une place de marché.
7. **Après la séance, une trace au même endroit, avec consentement et suppression.** Récapitulatif, documents et prochaines étapes rangés avec la séance (Doctolib « Mes documents », S9 ; BetterUp « Past sessions », S20) ; transcription facultative, refusable pour une séance avant son début, supprimable (S20). Notes privées du coach séparées de ce qui est partagé (S2). Chez nous, ce qui est partagé avec le Candidate peut être une carte de la conversation ; les notes privées du coach restent dans le Coach space.

## Motifs à éviter (3)

1. **Le paiement par abonnement ou à l'essai mal annoncé.** Le « Pass Élève » mensuel de Superprof et le « premier cours offert » non tenu sont la première plainte de ses avis clients (S15). Pour Jobbbox : un prix TTC unique, dit avant l'Order (ADR-0074), sans essai promis par le coach ni prélèvement récurrent caché.
2. **Laisser la politique d'annulation au texte sans l'appliquer.** Calendly affiche la politique mais ne l'applique pas, et les remboursements se font hors outil (S1, S3). C'est déjà le trou de Jobbbox : une Coaching Session annulée reste payée et « À planifier », sans remboursement hors Withdrawal (#255). Une règle d'annulation doit être tenue par le produit, avec son effet sur le paiement.
3. **Une salle d'attente muette, ou des contrôles en icônes seules.** Le Candidate attend dans Zoom sans pouvoir répondre à l'hôte, et l'écran « En attente de l'hôte » est autre chose que la salle d'attente (S22) ; les barres de visio sont faites d'icônes sans libellé. ADR-0009 l'interdit : chaque contrôle garde son libellé visible (« Micro coupé », « Caméra », « Quitter la séance »), et l'attente dit qui est prévenu et quoi faire.

## Contraintes d'UI de Jobbbox pour les prototypes

### Accessibilité (ADR-0009, WCAG 2.2 AA, public de 40 ans et plus)

- Texte courant d'au moins 16 px en `rem`, Text Size respectée ; métadonnées d'au moins 0,8125rem à 4,5:1 ; jamais de gris clair pour le texte ; contrastes dans **les deux thèmes**.
- **Chaque fonction a un libellé visible**, barre de visio comprise : micro, caméra, partage, « Quitter », « Fermer ». Les seules icônes seules permises sont les exceptions d'ADR-0009 ; une nouvelle exception devrait être décidée à part.
- Cibles de 44 px sur les pages du Candidate (et du Human Coach, en Confort) ; 24 px minimum partout (2.5.8).
- **2.4.11** : une barre de contrôles collante ou une vignette vidéo ne cache jamais le contrôle qui a le focus.
- **3.2.6** : l'aide reste au même endroit ; pas de seconde porte d'aide propre à la visio.
- **4.1.3** : « Reconnexion… », « Votre coach a rejoint », « Micro coupé » annoncés aux lecteurs d'écran sans prendre le focus.
- **1.2.4 Sous-titres (en direct)** : si Jobbbox héberge la vidéo, les sous-titres en direct deviennent une exigence AA. Ils ne le sont pas si la séance se tient sur un outil tiers par un lien.
- **2.2.1** : pas de délai qui expire sans prévenir (salle d'attente, lien qui se ferme) ; l'annoncer et le prolonger.
- **3.3.7** : ne pas redemander au moment de réserver ce que Jobbbox sait déjà (nom, e-mail, Profile).
- **1.4.10** : tout se lit à 320 px CSS de large, la vidéo comprise, sans défilement horizontal.
- `prefers-reduced-motion` : pas d'animation de « sonnerie » ou de pulsation ; la sonnerie du coach doit avoir un équivalent visuel et textuel.

### Design System Mercury (ADR-0053, #460) et mode sombre (#473)

- Gris froids, accent indigo, contrôles en pilule, Inter, icônes Lucide à 1,7 ; état = point + mots, jamais la couleur seule.
- Mouvements de 150 à 220 ms, rien ne bouge sous `prefers-reduced-motion`, les données ne s'animent pas.
- Tout est en `rem`. Composants existants à réutiliser : Button, Field, Dialog, Toast, EmptyState, Card, Badge/Pill.
- **Mode sombre** : chaque jeton a ses deux valeurs, choix dans Préférences ou `prefers-color-scheme`. Une vue vidéo est souvent sombre de toute façon : la prévoir sur les jetons, pas en couleurs fixes, et vérifier le contraste des libellés posés sur la vidéo.

### Deux Densités

- **Confort** pour le Candidate (et, a priori, pour le Human Coach : il n'est pas Administrator) ; **Compact** pour le Back Office seulement. La Densité n'est jamais choisie par la personne.
- Un tableau du jour ou une liste de clients dense pour le coach ne justifie pas le Compact sans décision (question ouverte n° 6).

### La conversation au centre (ADR-0070) et le Coach space

- Sur les pages du Candidate, **la page est une Coach Conversation** : la Coaching Session apparaît comme une carte du fil dans « Mes coachs humains » et dans l'Agenda ; un formulaire (réservation, date, test du matériel) s'ouvre dans le **Work Pane**, pas dans un tiroir ; la Fiche et le Work Pane sont des colonnes à partir de 64rem, plein écran avec « Fermer » en dessous.
- ADR-0070 a **exclu le Coach space** de ce modèle (#585) : il garde `CoachSpaceShell`, sans Sidebar ni Top Bar propres, sans conversation avec l'AI Coach (ADR-0076 : pas de conversation IA pour les coachs). Les prototypes du coach peuvent donc suivre un autre gabarit (tableau du jour, liste), à condition de rester sur Mercury.
- Une **vue vidéo** ne rentre dans aucune de ces formes aujourd'hui : plein écran, ou Work Pane, ou fenêtre à part. À décider (question ouverte n° 3).
- **Les Human Coaches ne voient jamais une Coach Conversation** : un récapitulatif partagé doit être un objet à part.

### Jobbbox app (ADR-0076, #682) : téléphone et iPad

- Même logique de largeur en rem que le web (64rem, 28rem) ; téléphones en portrait seul ; iPad dans toutes les orientations, Split View, Stage Manager, clavier physique.
- Dynamic Type et échelle de police du système jusqu'aux plus grandes tailles : la vue vidéo et ses contrôles doivent tenir à ces tailles.
- v1 : le Coach space est dans une **WebView** ; v1.1 le rend natif. La caméra et le micro dans une WebView demandent les autorisations de l'app (chaînes d'usage iOS, permissions Android) en plus de celles de la page : à prévoir dès que la visio est dans Jobbbox.
- Notifications sans nom de personne ni d'entreprise sur l'écran verrouillé (« Votre séance commence dans 10 minutes ») ; permission demandée en contexte, jamais au premier lancement.
- Hors ligne : aucune écriture mise en attente ; « Rejoindre » sans réseau échoue tout de suite avec une raison.
- Lancement en France, Belgique, Suisse, Luxembourg et Canada : l'heure de Paris partout (`INTERVIEW_TIME_ZONE`) ne tient plus pour un Candidate au Canada.

### FR et EN

- Tout libellé dans les deux langues (`@jobhub/shared/i18n`), y compris les messages des permissions et les étapes de rétablissement par navigateur ; formats de date et d'heure de la langue d'interface.
- Les libellés français sont plus longs : prévoir la barre de visio et les pilules avec du texte qui passe à la ligne.

### Visio dans un navigateur

- **Permissions** : écran d'explication avant la demande, chemin « sans caméra », état lu par `getUserMedia()` (Safari n'a pas l'API Permissions), étapes de rétablissement selon Chrome, Safari, Firefox, Edge et le système (macOS, Windows) (S23).
- **Test du matériel** : aperçu, niveau du micro, son de test, choix des périphériques, test de la connexion ; disponible la veille et juste avant (S8, S21).
- **Reconnexion** : état « Reconnexion… » annoncé, tentative automatique pendant quelques minutes, puis « Rejoindre à nouveau » ; la séance ne se termine pas pour l'autre côté pendant ce temps (S22).
- **Petit écran** : la vidéo de l'autre en grand, la sienne en vignette déplaçable qui ne cache aucun contrôle ; contrôles en bas, libellés visibles, à 44 px ; portrait seul sur téléphone.
- **Navigateurs** : dire lesquels sont pris en charge, comme Doctolib (S9), et le détecter avant la séance plutôt qu'à l'entrée.

## Questions ouvertes pour le product owner

1. **Réserver avant ou après le paiement ?** Le motif 1 (créneau puis paiement) suppose des disponibilités tenues dans Jobbbox ou lues chez Cal.com : garde-t-on l'Unscheduled Coaching Session comme cas normal, ou comme exception (achat sans créneau, annulation) ?
2. **Visio dans Jobbbox ou chez un tiers ?** Héberger la vidéo apporte le test du matériel, la salle d'attente et la trace, mais aussi les sous-titres en direct (WCAG 1.2.4), un sous-traitant de plus au registre de confidentialité et les autorisations de l'app. Un lien Cal Video, Zoom ou Meet garde la séance hors de Jobbbox.
3. **Où vit la vue vidéo** côté Candidate, puisque la page est une conversation (ADR-0070) : plein écran par-dessus, Work Pane, ou fenêtre à part ? Et la conversation de l'AI Coach reste-t-elle accessible pendant la séance ?
4. **Choix du coach** : liste courte recommandée (CoachHub, BetterUp) ou liste complète comme aujourd'hui ? Avis publics sur les Human Coaches (Malt) ou non, alors que le Human Coach est choisi par Jobbbox ?
5. **Trace de la séance** : récapitulatif écrit par le coach, transcription, résumé par l'IA ? Avec quel consentement (refus par séance, comme BetterUp), quelle conservation, et où le Candidate le retrouve-t-il : une carte de la conversation, l'Agenda Item, « Mes coachs humains » ?
6. **Densité du Coach space** : Confort comme le Candidate (lecture par défaut d'après ADR-0053), ou Compact pour un tableau du jour et une liste de clients, ce qui demanderait un amendement d'ADR-0009 ?
7. **Annulation et no-show** : quelle règle (délai, qui annule, remboursement, séance « non tenue ») le produit applique-t-il, au lieu d'un texte (motif à éviter n° 2, #255) ?
8. **Fuseau horaire** : garde-t-on l'heure de Paris pour tous, alors que l'app est lancée au Canada, ou affiche-t-on l'heure de l'appareil avec l'heure de Paris en rappel ?
9. **Appointment Reminder du Human Coach** : il n'en reçoit aucun aujourd'hui. Un rappel au coach (e-mail, push) et une alerte « le Candidate est arrivé » font-ils partie de la v1 ?
