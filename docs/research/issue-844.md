# Recherche : disponibilités des Human Coaches et réservation d'une Coaching Session payée (#844)

Carte : #841. Suite de `docs/research/issue-842.md`. Recherche faite le 2026-11-06 sur `origin/main`.

## Question

Comment un Human Coach publie-t-il ses disponibilités, et comment un Candidate réserve-t-il un créneau payé, synchronisé avec l'agenda que le coach tient déjà, sans revenir sur ce qui a fait choisir la saisie à la main (ADR-0027, ADR-0029) ?

## Sources

### Lues dans le dépôt

- ADR : 0016 (Human Coach reconnu par l'e-mail, Coaching Session enregistrée au seul webhook Stripe), 0027 (date saisie à la main, Cal.com non relié), 0028 (Agenda sans bibliothèque de calendrier, tout en heure de Paris), 0029 (un Calendar file par Agenda Item, ni flux ni synchronisation), 0064 (Recipient list), 0071 et 0074 (Withdrawal, Order), 0088 (commande depuis l'app), 0089 (Push notification une fois par clé d'événement ; le Human Coach joint par le compte de son e-mail vérifié).
- Glossaire (`CONTEXT.md`) : Human Coach, Coaching Session, Unscheduled Coaching Session, Coach space, Agenda, Agenda Item, Reschedule, Cancelled Agenda Item, Appointment Reminder, Calendar file, Push notification, Withdrawal, Withdrawal period, Order, Immediate Performance Request.
- Code : `apps/web/src/human-coaches/index.ts` (`booking_url` limité à `cal.com` / `cal.eu` par `CAL_COM_HOSTS`, table `coaching_session` : `scheduled_at`, `duration_minutes`, `video_link`, `changed_by`, `withdrawn_at`), `apps/web/src/agenda/index.ts`, `apps/web/src/appointment-reminders/index.ts` (`REMINDER_HOUR = 18`, `REMINDER_TIME_ZONE = INTERVIEW_TIME_ZONE`, un e-mail et une Push notification par Candidate pour le lendemain, rien au coach).
- `docs/ops/hosting.md` (VPS Hostinger à Paris), `docs/privacy/register.md` (Stripe et Sign-in Providers déjà hors UE).

### Sources externes (consultées le 2026-11-06)

Dans cette session, `cal.com` ne se résolvait pas (réseau restreint) : les pages officielles de Cal.com n'ont pu être lues qu'à travers les extraits d'un moteur de recherche, pas ouvertes. Les chiffres de prix venant de tiers sont signalés comme tels.

| # | Source | Ce qu'on en tire |
|---|---|---|
| S1 | https://cal.com/blog/cal.eu-to-cal.com-migration (Cal.com, 2026) | cal.eu ferme le 2026-11-01 ; ses utilisateurs passent sur cal.com ; les clients Enterprise gardent cal.eu le temps de leur contrat. |
| S2 | https://cal.com/blog/cal-diy-open-source-to-closed-source et https://alternativeto.net/news/2026/4/cal-com-is-going-closed-source-with-a-major-shift-in-its-license-strategy/ (avril 2026) | Cal.com v6.4 devient propriétaire ; le dépôt public devient Cal.diy (MIT) **sans** équipes, organisations, workflows, API v1 ; l'auto-hébergement complet passe par un dépôt privé réservé aux clients Enterprise. |
| S3 | https://cal.com/blog/calcom-v6-1 (2026-01-15) | Abandon du « Cal.com Platform » en marque blanche au profit de « Continue with Cal.com » (OAuth) ; managed users conservés pour les clients existants seulement. |
| S4 | https://cal.com/docs/platform/faq.md | Le plan Platform est déprécié, plus de nouveaux clients (extrait de recherche, non relu en entier). |
| S5 | https://cal.com/docs/api-reference/v2/deprecated:-platform-webhooks/create-a-webhook | Les webhooks « Platform » sont classés dépréciés dans l'API v2. |
| S6 | https://cal.com/docs/developing/guides/automation/webhooks et https://cal.com/help/webhooks | Webhooks par utilisateur, équipe ou organisation ; un webhook d'organisation couvre les types d'événement **d'équipe** ; `X-Cal-Signature-256` (HMAC-SHA256 du corps brut) ; en-tête `x-cal-webhook-version` ; les managed event types ne déclenchent pas toujours le webhook d'équipe. |
| S7 | https://cal.com/help/embedding/prefill-booking-form-embed | `metadata[maCle]` passé à l'embed arrive dans `payload.metadata["maCle"]` du webhook et est gardé sur la réservation (invisible du participant). |
| S8 | https://developer.cal.com/webhook/setup-your-webhook, https://hookdeck.com/webhooks/skills/cal-com-webhooks | `uid`, `rescheduleUid` (= uid de l'ancienne réservation dans `BOOKING_RESCHEDULED`), `cancellationReason`. |
| S9 | https://cal.com/dpa, https://cal.com/dpa-scc (DPA v2.3, CCT en vigueur le 2026-11-01) | Importateur : Cal.com, Inc. (San Francisco) ; sous-traitants sur trust.cal.com ; transfert par clauses contractuelles types. |
| S10 | https://cal.com/docs/enterprise-features/workflows, https://cal.com/help/workflows/workflowsoverview | Workflows : e-mail à l'hôte X minutes/heures avant ; SMS selon le plan (pages contradictoires). |
| S11 | https://cal.com/help/event-types/how-to-receive-payments | Événements payants par l'app Stripe de Cal.com (prix porté par le type d'événement). |
| S12 | Prix Cal.com, tiers : https://dev.to/beton/calcom-pricing-teardown-2026-4j40, https://koalendar.com/blog/cal-com-pricing, https://omidsaffari.com/blog/cal-com-pricing (mi-2026) | Teams ≈ 12 $/siège/mois (annuel), 15–16 $ mensuel ; Organizations ≈ 28 $ (annuel), ≈ 37 $ mensuel. Non vérifié sur cal.com/pricing. |
| S13 | https://developers.google.com/calendar/api/auth | Scopes `calendar.freebusy` (voir ses disponibilités), `calendar.events.owned` (événements des agendas possédés), etc. |
| S14 | https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification | Les scopes « restricted » exigent une évaluation de sécurité annuelle ; les scopes Calendar sont « sensitive » d'après des tiers (vérification de l'app, sans évaluation CASA). |
| S15 | https://learn.microsoft.com/graph/outlook-get-free-busy-schedule et la référence `calendar: getSchedule` | `getSchedule` (free/busy, 20 personnes par appel) : **pas pour les comptes Microsoft personnels** (Outlook.com) ; création d'événement possible avec `Calendars.ReadWrite` délégué, y compris compte personnel ; pas de réunion Teams en ligne pour un compte personnel. |
| S16 | https://www.onecal.io/blog/how-to-integrate-icloud-calendar-api-into-your-app, https://developer.nylas.com/docs/cookbook/calendar/apple-calendar-api.md | iCloud : CalDAV sur `caldav.icloud.com` (RFC 4791), mot de passe d'application obligatoire (2FA), révoqué dès que le mot de passe Apple change. Sources non Apple. |
| S17 | https://nylas.com/pricing/ + https://zeeg.me/en/blog/post/nylas-api-pricing (2026) | Nylas Calendar ≈ 10 $/mois avec 5 comptes connectés, puis 1–1,50 $ par compte ; Full Platform ≈ 15 $ + 1,50–2 $. Chiffres tiers divergents. |
| S18 | https://v2-5-0.developer.nylas.com/docs/dev-guide/platform/data-residency/, https://support.nylas.com/hc/en-us/articles/8519758287773 | Région UE en Irlande (`api.eu.nylas.com` en v3), isolée de la région US, sans surcoût ; DPA inclus dans le MSA, DPA séparé sur demande. Nylas reste une société américaine. |
| S19 | https://cronofy.com/api-pricing, https://www.cronofy.com/api/markdown/pricing | API « Emerging » 819 $/mois (page officielle) ; « Starter » ≈ 139 $/mois selon des agrégateurs (non vérifié) ; Scheduler ≈ 15 $/siège. |
| S20 | https://docs.cronofy.com/developers/data-centers, https://docs.cronofy.com/policies/cronofy-and-brexit/, https://www-webflow.cronofy.com/privacy/gdpr | Centre de données en Allemagne (`api-de.cronofy.com`), isolé ; DPA sur demande ; contrat possible avec Cronofy BV (droit néerlandais). |
| S21 | https://www.w3schools.com/Jsref/jsref_obj_temporal_duration.asp, https://mspk.substack.com/p/javascript-finally-fixed-dates-and | `Temporal` : Chrome 144, Firefox 139 ; Safari sans date en mars 2026 ; Node derrière un drapeau. |

## Constats

### 1. Cal.com a changé depuis ADR-0016 et ADR-0027

- **cal.eu n'existe plus** pour les comptes ordinaires depuis le 2026-11-01 (S1). Les coachs qui avaient un lien `cal.eu` sont passés sur `cal.com`, hébergé et contracté aux États-Unis (Cal.com, Inc., CCT : S9). `CAL_COM_HOSTS` accepte encore `cal.eu` : un lien `cal.eu` saisi au Back Office ne mènera plus nulle part (à vérifier sur la base de production).
- **Le plan Platform (API v2 en marque blanche, managed users, atoms pour nos propres comptes) est fermé aux nouveaux clients** (S3, S4, S5). Les atoms restent mais supposent soit des managed users (fermé), soit l'OAuth « Continue with Cal.com » où chaque coach garde son compte Cal.com. On ne peut donc plus bâtir un « Cal.com invisible » dans Jobbbox.
- **L'auto-hébergement ne donne plus les équipes** : Cal.diy (MIT) est livré sans équipes, organisations ni workflows ; la version complète auto-hébergée suppose un contrat Enterprise (S2). L'auto-hébergement sur notre VPS de Paris, qui aurait gardé les données dans l'UE, n'est plus une voie réaliste pour quelques coachs.
- **Ce qu'ADR-0016 n'avait pas pu confirmer existe** : une réservation peut porter des métadonnées, passées par l'embed ou le lien, rendues dans `payload.metadata` du webhook et gardées sur la réservation (S7). Une réservation peut donc être reliée à une Coaching Session payée **sans passer par l'e-mail du participant**. La syntaxe `?metadata[cle]=valeur` sur un simple lien de réservation n'est documentée que par un miroir ancien ; seule la voie embed est confirmée.
- **Les webhooks d'équipe ou d'organisation** donnent un seul point d'entrée pour tous les coachs, à condition que leurs types d'événement soient des types **d'équipe** (S6). Les types personnels d'un membre n'y remontent pas (non confirmé dans un sens ni dans l'autre) et les managed event types ont des exceptions.
- **Les événements payants de Cal.com** (app Stripe, S11) encaissent hors de notre Order : ni CGV acceptées, ni Immediate Performance Request, ni Order Confirmation, ni Withdrawal automatique (ADR-0071, ADR-0074). Ils sont à écarter : le paiement reste chez nous.

### 2. Construire : ce que demande chaque agenda

| Agenda du coach | Lire ses occupations | Écrire la séance | Contraintes |
|---|---|---|---|
| Google Calendar | `freeBusy.query` avec `calendar.freebusy` (S13) | `events.insert` avec `calendar.events.owned` | Écran de consentement « sensitive » : vérification de l'app par Google (vidéo de démonstration, délais de plusieurs semaines rapportés), sans évaluation de sécurité tant qu'aucun scope « restricted » n'est demandé (S14). Jetons de rafraîchissement à chiffrer. |
| Microsoft 365 (pro) | `getSchedule` (`Calendars.ReadBasic`) | `POST /me/events` (`Calendars.ReadWrite`) | Consentement de l'administrateur du tenant parfois exigé par l'entreprise du coach. |
| Outlook.com (personnel) | **pas de `getSchedule`** (S15) : lire `calendarView` (`Calendars.Read`, qui expose le contenu des événements) | `POST /me/events` | Pas de lien Teams créé pour un compte personnel. |
| iCloud | CalDAV `REPORT` free-busy ou lecture des événements (S16) | CalDAV `PUT` d'un VEVENT | Mot de passe d'application saisi par le coach, stocké chiffré, révoqué au changement de mot de passe Apple ; aucune OAuth. |

Une voie plus légère, sans OAuth, existe pour quelques coachs :
- **lire** l'adresse iCal privée de l'agenda du coach (Google « adresse secrète au format iCal », publication Outlook, partage iCloud), relue par le worker toutes les 10 à 15 minutes, pour n'en garder que les plages occupées ;
- **écrire** par une invitation e-mail iTIP (`METHOD:REQUEST`, puis `CANCEL` à l'annulation, même `UID` et `SEQUENCE` croissante), que Google, Outlook et Apple acceptent dans l'agenda du coach.
Le refus d'ADR-0029 visait un flux **exposé par Jobbbox** (les données du Candidate lisibles sans connexion) ; ici le coach confie à Jobbbox une adresse de **son** agenda, en lecture. L'adresse est un secret à chiffrer et à faire figurer au registre. Limite : jusqu'à 15 minutes de retard sur un créneau pris ailleurs (risque de double réservation, à couvrir par une confirmation du coach ou une marge).

Le moteur de créneaux à écrire : règles hebdomadaires du coach dans **son** fuseau, exceptions (congés), durée de séance, tampon entre séances, délai de prévenance minimal (ex. 24 h), horizon maximal (ex. 30 jours), occupations soustraites, verrou court sur un créneau pendant la réservation (contrainte d'exclusion Postgres sur `tstzrange` par coach), règles d'annulation et de Reschedule.

### 3. Agrégateurs

- **Nylas** (S17, S18) : Google, Microsoft (pro et personnel) et iCloud derrière une seule API, free/busy, création d'événements, webhooks ; région UE en Irlande isolée, DPA dans le MSA. Peu cher au volume de Jobbbox (~10–15 $/mois pour 5 coachs). Mais **Nylas, Inc. est américaine** : la donnée reste en Irlande, le contractant est hors UE (même cas que Stripe ou Sentry dans le registre). Il reste à construire le moteur de créneaux, la page de réservation et les règles.
- **Cronofy** (S19, S20) : même couverture, plus une API de disponibilité qui calcule les créneaux (règles, tampons, séquences) ; centre de données en Allemagne et contrat possible avec Cronofy BV (Pays-Bas) : **la seule option entièrement dans l'UE**. Prix public de l'API : 819 $/mois (palier « Emerging ») ; un palier ~139 $ n'est attesté que par des agrégateurs. Cher pour une poignée de coachs.

### 4. Fuseaux et heure d'été

- Tout est aujourd'hui calculé et affiché en Europe/Paris (`INTERVIEW_TIME_ZONE`, ADR-0028). Les instants sont déjà stockés en `timestamptz` : la base n'a pas à changer.
- Il faudrait **un fuseau IANA par Human Coach** (`human_coach.time_zone`, défaut Europe/Paris) : ses disponibilités sont des heures murales de **son** fuseau, converties en instants jour par jour (pas une fois pour toutes, sinon chaque changement d'heure décale les créneaux d'une heure).
- Heure d'été : le dernier dimanche de mars, 02:00–03:00 n'existe pas à Paris (un créneau qui y tombe est sauté) ; le dernier dimanche d'octobre, 02:00–03:00 existe deux fois (garder la première occurrence). Un coach à Montréal ou à Dakar change d'heure à d'autres dates ou jamais : l'écart avec Paris varie dans l'année.
- Le Candidate hors de France doit voir les créneaux **dans son fuseau** (celui du navigateur, `Intl.DateTimeFormat().resolvedOptions().timeZone`), avec la mention de l'heure de Paris ; l'Agenda, l'Appointment Reminder et le Calendar file peuvent rester en heure de Paris (ADR-0028) tant que la page de réservation dit les deux.
- `Temporal` n'est pas encore utilisable partout (Safari, Node, S21) ; les conversions `Intl` existantes (`interviewWallClock`, `frenchDateTime.parse`) se généralisent à un fuseau passé en paramètre, ce qui reste dans l'esprit d'ADR-0028 (pas de bibliothèque de dates) mais l'amende (« un seul fuseau »).
- Avec Cal.com ou un agrégateur, le calcul des créneaux et l'heure d'été sont faits par le fournisseur ; il reste à afficher correctement l'instant reçu.

### 5. Rappels

- Aujourd'hui : un Appointment Reminder (e-mail + Push notification) au Candidate à 18:00 la veille, **rien au Human Coach** ; ADR-0089 permet déjà de joindre le coach par le compte de son e-mail vérifié, et les Push notifications du coach existent pour « séance payée, changée, annulée ».
- À ajouter, quelle que soit l'option : un rappel au coach (e-mail la veille, Push notification une heure avant), un rappel une heure avant au Candidate, chacun avec « Rejoindre » (`video_link`). Clé d'événement à la façon d'ADR-0089 : `coaching_session:<id>:<scheduled_at ISO>:1h`, pour qu'un Reschedule donne un nouveau rappel et qu'une relance n'en envoie pas deux. Le worker devra tourner au moins toutes les 5 à 15 minutes pour le rappel d'une heure (aujourd'hui une fois par jour).
- Cal.com sait envoyer des rappels à l'hôte (Workflows, S10), mais le coach et le Candidate en recevraient alors de deux systèmes, dans deux langues et deux mises en page (ADR-0058). Mieux vaut couper les rappels Cal.com et garder les nôtres.
- Lien pour rejoindre : Cal.com peut créer la visio (Cal Video, Google Meet) et la rend dans `payload.metadata.videoCallUrl` (S8), ce qui remplirait `video_link` sans saisie. En construisant, le lien reste saisi par le coach (aucun fournisseur visio au catalogue des Tools ; un compte Outlook.com personnel ne crée pas de Teams, S15).

### 6. Effet sur le paiement, la Withdrawal et le Reschedule

**Payer d'abord, réserver ensuite (garde ADR-0016 tel quel)** : la Coaching Session naît au webhook Stripe, Unscheduled ; le Candidate choisit ensuite un créneau. Rien ne change au paiement, à l'Order ni à l'app (ADR-0088). Inconvénient : on paie sans avoir vu de créneau ; une vue « prochaines disponibilités » sur la page du coach suffit à rassurer, sans réservation.

**Réserver d'abord, payer ensuite** : il faut tenir le créneau pendant le Checkout (15 à 30 minutes) et accepter un webhook tardif sur un créneau déjà relâché. La séance continuerait de naître au webhook, mais avec un créneau « en attente » qui n'est pas une Coaching Session. Plus de cas limites pour un gain d'ergonomie ; à garder pour plus tard.

| | Cal.com d'équipe | Agrégateur ou construire |
|---|---|---|
| Naissance de la séance | Inchangée (webhook Stripe). La réservation Cal.com arrive ensuite et date la séance trouvée par sa métadonnée. | Inchangée ; la réservation se fait dans Jobbbox. |
| Réservation sans paiement | Possible si le Candidate trouve le type d'événement public : réservation sans métadonnée valable, ignorée par Jobbbox (et à annuler par le coach). Masquer les types d'événement, ou refuser les réservations sans jeton. | Impossible : la page de réservation n'est offerte qu'à une séance payée. |
| Withdrawal | Jobbbox doit annuler la réservation Cal.com par l'API v2 (clé de l'équipe), sinon le créneau reste dans l'agenda du coach. Un échec d'annulation ne doit pas bloquer le remboursement (ADR-0071) : le coach est déjà prévenu. | Jobbbox supprime l'événement (API) ou envoie un iTIP `CANCEL`. |
| Reschedule | `BOOKING_RESCHEDULED` donne la nouvelle date et l'ancien `uid` (S8) : on garde un Reschedule. **Qui** a déplacé (Candidate ou coach) n'est pas sûr dans la charge utile : à vérifier, sinon « via Cal.com ». Une date changée à la main dans Jobbbox désynchroniserait Cal.com : la saisie devient un secours pour les séances non reliées. | Reschedule fait dans Jobbbox, avec délai de prévenance ; l'historique et « modifié par le coach » marchent comme aujourd'hui. |
| Annulation | `BOOKING_CANCELLED` : la séance redevient Unscheduled (Cancelled Agenda Item) ; remboursement hors Withdrawal toujours absent (#255). | Idem, dans Jobbbox. |

## Les trois options

**A. Cal.com d'équipe (plan Teams).** Jobbbox ouvre une équipe Cal.com et y invite les coachs ; chacun garde son compte et son agenda connecté (Google, Outlook, iCloud, gérés par Cal.com) ; un type d'événement d'équipe par coach, masqué. Après paiement, Jobbbox ouvre la page de réservation (embed ou lien) avec `metadata[seance]=<jeton signé>` (HMAC de l'id de la Coaching Session, pour qu'un Candidate ne puisse pas viser une autre séance) et l'e-mail prérempli. Un webhook d'équipe signé (`X-Cal-Signature-256`) date la séance, remplit `video_link`, garde les Reschedules et les annulations. La saisie à la main reste pour les séances non reliées. Organizations (~28–37 $/siège) n'apporte rien d'utile ici ; Platform est fermé ; l'auto-hébergement ne donne pas les équipes.

**B. Agrégateur (Nylas UE ou Cronofy Allemagne).** Le coach connecte son agenda depuis le Coach space (OAuth ou mot de passe d'application iCloud via l'agrégateur) ; Jobbbox écrit les disponibilités, la page de réservation, les règles ; l'agrégateur lit les occupations et écrit les séances. Cronofy peut aussi calculer les créneaux.

**C. Construire.** Disponibilités et créneaux dans Jobbbox ; synchronisation directe Google / Microsoft / CalDAV, ou la voie légère (adresse iCal privée en lecture + invitation iTIP en écriture). Aucun tiers nouveau.

## Comparaison

Hypothèse de volume : 5 Human Coaches (« une poignée », ADR-0027), 20 dans un an. Les prix sont hors taxes, en dollars, sur des sources de 2026, pour la plupart tierces.

| Critère | A. Cal.com d'équipe | B. Agrégateur | C. Construire |
|---|---|---|---|
| Coût fixe | ~60–80 $/mois à 5 coachs, ~240–320 $ à 20 (Teams, S12, non vérifié) | Nylas ~10–15 $/mois à 5 coachs, ~30–45 $ à 20 (S17) ; Cronofy 819 $/mois (palier API public, S19) | 0 $ de licence ; vérification Google gratuite mais longue |
| Effort (estimation) | **S–M, 4–6 j** : webhook signé, jeton, annulation à la Withdrawal, rappels coach, Back Office (lien d'équipe), aide | **L, 15–20 j** : règles de disponibilité, moteur de créneaux (moins avec Cronofy), page de réservation web et app, connexion d'agenda, rappels | **L, 12–15 j** en voie légère (iCal + iTIP) ; **XL, 25–35 j** avec OAuth Google et Microsoft et CalDAV, plus des semaines de vérification Google |
| Entretien | Faible côté code ; dépendance à un fournisseur qui a changé trois fois de modèle en 2026 (S1–S3) | Moyen ; API stable, notre moteur à tenir | Le plus lourd : jetons, quotas, erreurs propres à chaque agenda, heure d'été |
| Données hors UE | **Oui** : Cal.com, Inc. (États-Unis, CCT, S9) reçoit nom et e-mail du Candidate, le jeton de séance, l'agenda du coach. Nouveau destinataire hors UE pour Jobbbox (aujourd'hui c'est le Candidate qui va chez Cal.com) : version substantielle de la politique de confidentialité, annoncée 30 jours avant (ADR-0064, ADR-0072) | Nylas : données en Irlande, société américaine (hors UE au sens du registre) ; **Cronofy : Allemagne et Cronofy BV, entièrement UE** | Aucun nouveau destinataire, hors Google et Microsoft qui hébergent déjà l'agenda du coach ; l'adresse iCal ou le mot de passe d'application sont des secrets à garder chez nous |
| Expérience du coach | Bonne : il connaît Cal.com, son agenda reste branché, sa visio est créée ; il doit rejoindre l'équipe de Jobbbox et y déplacer ses créneaux Jobbbox | Bonne une fois l'agenda connecté ; nouvelles pages dans le Coach space | Voie légère : coller une adresse iCal, peu familier ; voie complète : comme B |
| Expérience du Candidate | Une page Cal.com (marque Cal.com, autre style, autre langue possible) après le paiement ; date dans l'Agenda sans saisie | Tout dans Jobbbox, aux normes d'ADR-0009 et de Mercury, web et app | Comme B |
| ADR-0016 (la séance n'existe qu'au webhook) | Gardé ; ADR-0016 et 0027 amendés (réservation reliée par métadonnée, pas par e-mail) | Gardé si l'on paie d'abord | Gardé si l'on paie d'abord |
| ADR-0027 / 0029 | 0027 révisé comme il le prévoyait (« team account … webhook ») ; 0029 inchangé (rien chez le Candidate) | 0027 remplacé ; 0029 inchangé (la synchronisation est celle du **coach**) ; 0028 amendé (fuseau du coach) | Idem B |
| Withdrawal | Une annulation Cal.com de plus, qui peut échouer | Suppression d'événement ou iTIP `CANCEL` | Idem |
| Reschedule | Reçu de Cal.com, auteur incertain ; saisie à la main à brider pour les séances reliées | Entièrement à nous | Entièrement à nous |
| Réversibilité | Bonne : les dates restent dans `coaching_session` ; retour à la saisie possible | Moyenne | Totale |

## Recommandation

**Option A, Cal.com d'équipe, en paiement d'abord**, à deux conditions :

1. que le product owner accepte Cal.com, Inc. comme destinataire hors UE de Jobbbox, avec la version de la politique de confidentialité et son préavis (ADR-0064, ADR-0072), sa fiche au catalogue des Tools et au registre ;
2. que les coachs acceptent de rejoindre une équipe Cal.com de Jobbbox (sièges payés par Jobbbox).

Pourquoi : c'est la seule option qui répond à la question en quelques jours ; elle lève les deux objections d'ADR-0027 (un webhook par coach, l'appariement par e-mail) grâce au webhook d'équipe et à la métadonnée signée ; elle ne touche ni au paiement, ni à l'Order, ni à l'app ; elle laisse l'agenda du coach chez Cal.com, qui le synchronise déjà ; elle garde la saisie à la main comme secours. L'agrégateur coûte un projet de réservation entier pour gagner surtout l'intégration à Jobbbox ; Cronofy, seul vraiment dans l'UE, coûte plus de dix fois Cal.com au volume actuel. Construire en voie complète est hors de proportion pour une poignée de coachs (vérification Google, quatre intégrations).

À faire avec A, quelle que soit la suite : un fuseau par Human Coach (affichage dans le Coach space), le rappel du coach (e-mail la veille, Push notification une heure avant) et le rappel d'une heure au Candidate, avec « Rejoindre » ; les rappels de Cal.com coupés ; retirer `cal.eu` de `CAL_COM_HOSTS` ou le signaler au Back Office.

À revoir (nouvel ADR) si Cal.com change encore de modèle, si la politique de confidentialité ne peut pas accueillir un destinataire hors UE de plus, ou au-delà d'environ 15–20 coachs : passer alors à **C en voie légère** (disponibilités dans Jobbbox, adresse iCal privée en lecture, invitation iTIP), puis à un agrégateur UE si les doubles réservations dues au retard de lecture deviennent un problème.

## Non vérifié

- Les prix Cal.com (S12), Nylas (S17) et le palier Cronofy à ~139 $ : tous de tiers ou d'extraits ; `cal.com/pricing` n'a pas pu être ouvert dans cette session.
- La syntaxe `?metadata[cle]=` sur un lien de réservation simple (hors embed) ; si elle n'existe plus, il faut l'embed (script Cal.com sur une page Jobbbox, à ajouter à la Content-Security-Policy) ou l'atom Booker via OAuth.
- Qu'un webhook d'équipe reçoive `BOOKING_CREATED` pour un type d'événement d'équipe attribué à un seul membre (oui d'après S6, non testé) ; le comportement avec les managed event types.
- L'auteur d'un Reschedule ou d'une annulation dans la charge utile Cal.com ; l'endpoint exact d'annulation de l'API v2 et sa version (`cal-api-version`).
- Le classement exact (« sensitive » ou non) de `calendar.freebusy` et `calendar.events.owned` chez Google, et le délai actuel de vérification.
- Le statut réel de cal.eu après le 2026-11-01 (annonce officielle S1, aucune confirmation postérieure lue) et la liste des sous-traitants de Cal.com sur trust.cal.com (pays).
- La prise en charge de `Temporal` dans Safari et Node au 2026-11-06.
- Les pages Apple sur les mots de passe d'application (S16 est une source tierce).

## Questions pour le product owner

1. Combien de Human Coaches dans 12 mois, et dans quels pays ? (Fuseau, coût par siège, seuil pour basculer vers C.)
2. Accepte-t-on un nouveau destinataire hors UE (Cal.com, Inc.), avec une version substantielle de la politique de confidentialité annoncée 30 jours avant ? Sinon, seule Cronofy (UE) ou C restent.
3. Les coachs acceptent-ils de rejoindre une équipe Cal.com de Jobbbox, et d'y réserver leurs séances Jobbbox à part de leurs autres clients ?
4. Paiement d'abord (recommandé) ou créneau d'abord ? Faut-il montrer des disponibilités avant le paiement ?
5. Quel délai de prévenance minimal pour réserver, annuler ou faire un Reschedule ? Une annulation par le coach rembourse-t-elle (lien avec #255) ?
6. Faut-il générer la visio (Cal Video, Google Meet) ou laisser le coach donner son lien ?
7. La saisie à la main reste-t-elle permise pour une séance reliée à une réservation Cal.com, ou seulement pour les séances non reliées ?
8. Quels rappels pour le coach (e-mail la veille, Push notification une heure avant, les deux) et faut-il un interrupteur dans son Coach space ?
9. Le Candidate hors de France voit-il l'Agenda dans son fuseau, ou garde-t-on l'heure de Paris partout sauf sur la page de réservation ?


## Errata du 2026-11-06 (vérification sur les pages officielles)

Titre d'origine de la section : #844 : disponibilités et réservation (Cal.com, Google Calendar)

| Affirmation | Statut | Ce que dit la source | URL, lu le 2026-11-06 |
|---|---|---|---|
| Teams ≈ 12 $/siège/mois en annuel, 15–16 $ en mensuel ; Organizations ≈ 28 $ (S12, tiers) | **Confirmé pour l'annuel ; mensuel toujours non vérifiable** | « Teams Yearly $12 per user/month Save 25% » ; « Organizations Yearly $28 per user/month Save 25% ». Le prix mensuel n'est pas affiché dans le texte servi (on en déduit ≈ 16 $, ce n'est pas écrit). Essai gratuit de 14 jours. | https://cal.com/pricing |
| (Fait nouveau) Cal.com oriente les places de marché vers un autre produit | **Nouveau** | « Building scheduling into your own product? Marketplaces and platforms should use coss.com Scheduling […] The plans above are for using Cal.com itself, which you can build on with API v2. » | https://cal.com/pricing |
| cal.eu ferme le 2026-11-01 ; les clients Enterprise gardent cal.eu le temps de leur contrat | **Confirmé** (annonce du 30 juillet 2026, Peer Richelsen) | « We plan to migrate Cal.eu users to Cal.com before shutting down Cal.eu on November 1, 2026 (Enterprise customers have extensions according to their contract.) » | https://cal.com/blog/cal.eu-to-cal.com-migration |
| « Les coachs qui avaient un lien cal.eu sont passés sur cal.com » | **Corrigé** | La migration est **au choix de l'utilisateur** : « Moving to Cal.com is your choice. We will never transfer your data without your consent. » Sans migration, l'utilisateur peut seulement exporter ses données. Un coach a donc pu partir chez un autre fournisseur. L'état réel de cal.eu après le 1er novembre reste **non vérifiable** (cal.eu est bloqué par le proxy). | idem |
| `metadata[maCle]` passé à l'**embed** arrive dans `payload.metadata["maCle"]` du webhook et est gardé sur la réservation, invisible du participant (S7) | **Confirmé** | « You will receive the value in payload.metadata["myKey"] in webhook. Also, it would be stored in booking table under metadata column. It won't be shown on the booking details page. » L'exemple vaut pour l'embed inline (React, Vanilla JS) et le bouton flottant. | https://cal.com/help/embedding/prefill-booking-form-embed |
| `?metadata[cle]=valeur` sur un **simple lien** de réservation | **Toujours non vérifiable** (aucune page ne le dit) | La page « Pre-fill fields/questions » ne documente que le pré-remplissage des **champs du formulaire** par paramètre d'URL (identifiant de la question, ex. `?email=…&notes=…`), pas `metadata[...]`. La documentation des webhooks ne contient aucune occurrence de `metadata[`. Seule voie documentée hors embed : une question **cachée** pré-remplie par l'URL (exemple UTM). Elle remonte comme réponse au formulaire, pas dans `metadata`. | https://cal.com/help/bookings/prefill-fields.md ; https://cal.com/help/bookings/utm-tracking.md ; https://cal.com/docs/developing/guides/automation/webhooks.md |
| Webhook d'équipe : un seul point d'entrée pour tous les coachs si leurs types d'événement sont des types d'équipe ; exceptions pour les managed event types (S6) | **Confirmé, avec une précision qui compte** | « Team-level: Applies to team booking links (i.e., **Collective and Round Robin**) within the specified team. » Pour les **Templates** (ex-managed events), les réservations se font sur les liens enfants et « team-level webhooks will **not** trigger for templates » sauf webhook posé sur le lien parent ou sur chaque lien enfant. Un webhook utilisateur exclut les types gérés par l'équipe. Conséquence : le « type d'équipe par coach » de l'option A doit être un type **Collective ou Round Robin à un seul hôte**, pas un Template. | https://cal.com/help/webhooks.md |
| Signature `X-Cal-Signature-256` (HMAC-SHA256 du corps brut), en-tête `x-cal-webhook-version` | **Confirmé** | « Webhook payloads are versioned… x-cal-webhook-version » ; « `x-cal-signature-256` is still computed over the raw body ». | https://cal.com/docs/developing/guides/automation/webhooks.md |
| `BOOKING_RESCHEDULED` donne la nouvelle réservation et l'ancien `uid` ; l'auteur du déplacement n'est pas sûr | **Confirmé** | L'exemple de charge utile porte `"uid": "new-booking-unique-id"` et `"rescheduleUid": "previous-booking-unique-id"`, sans champ d'auteur. Des champs `cancelledBy` et `rescheduledBy` n'apparaissent que dans les exemples `MEETING_STARTED` et `MEETING_ENDED` (valeur `null`). | idem |
| Les scopes Calendar sont « sensitive » : vérification de l'app sans évaluation de sécurité (CASA) tant qu'aucun scope « restricted » n'est demandé | **Confirmé pour l'absence d'évaluation ; classement exact de chaque scope toujours non vérifiable** | La liste officielle des scopes « restricted » ne contient que Gmail, Drive, Fit et Chat, **aucun scope Calendar**. Seuls les scopes restreints exigent « an annual security assessment ». La page donne `auth/calendar` comme exemple de justification d'un scope sensible ou restreint. Le classement de `calendar.freebusy` et `calendar.events.owned` est sur developers.google.com, bloqué. | https://support.google.com/cloud/answer/13464325?hl=en ; https://support.google.com/cloud/answer/13464321?hl=en |

