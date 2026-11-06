# Recherche : tenir une Coaching Session en visio ou en audio, avec le partage d'écran et de documents (#845)

Carte : #841. Prolonge #842 (l'existant). Recherche menée le 2026-11-06.

## Question

Construire, intégrer un fournisseur ou se contenter d'un lien : comment tenir une Coaching Session en visio ou en audio seul, avec le partage d'écran et de documents, sur le web et sur la Jobbbox app (Expo, ADR-0076) ?

## Méthode et limites

- **Accès réseau** : depuis cette session, les pages des fournisseurs (livekit.io, livekit.com, docs.livekit.io, daily.co, whereby.com, 100ms.live, jaas.8x8.vc, vonage.com) **n'ont pas pu être ouvertes** (hôtes hors de la liste autorisée). Les chiffres viennent des **extraits de pages renvoyés par un moteur de recherche** le 2026-11-06 : pages officielles quand l'extrait les cite, sinon agrégateurs tiers. Chaque chiffre porte sa source et un niveau de confiance :
  - **[officiel]** : extrait d'une page du fournisseur ;
  - **[tiers]** : agrégateur, blog, forum ;
  - **[à vérifier]** : sources en conflit ou non trouvées.
- Prix en USD hors taxes sauf mention ; aucune conversion en euros (taux du jour à appliquer).
- Hypothèse de calcul : une Coaching Session = **2 participants × 60 min = 120 minutes-participant**. 100 séances/mois = **12 000** min-participant ; 1 000 séances/mois = **120 000** min-participant. Débit vidéo 720p ≈ 1 à 2 Mbit/s par flux, audio Opus 16–32 kbit/s (bloggeek.me) ; soit ≈ 0,7 Go par participant et par heure reçus à 1,5 Mbit/s, ≈ 1,35 Go par séance via un SFU (calcul de cette note).

## Sources (consultées le 2026-11-06)

Dépôt : `docs/research/issue-842.md` (branche `research/issue-842`), ADR-0007, 0064, 0067, 0068, 0076, `docs/ops/hosting.md`, `CONTEXT.md` (Coaching Session, Coach Access, Coach space, Coach Review, Tool, Recipient list, Recipient outside the EU).

Lien seulement :
- Zoom, région des centres de données UE pour les comptes payants : https://www.zoom.com/en/trust/gdpr/ [officiel] ; https://techcrunch.com/2023/06/06/zoom-brings-local-data-storage-to-paying-european-customers/ [tiers] ; forum « compte gratuit routé vers les US » : https://community.zoom.com/meetings-2/zoom-always-connects-to-us-data-center-dca-instead-of-eu-need-help-16718 [tiers]
- Zoom, création par API (Server-to-Server OAuth, portée d'écriture des réunions) : https://devforum.zoom.us/t/directions-regarding-handing-zoom-server-to-server-app/76640 , https://www.activepieces.com/blog/zoom-api-authentication-and-rate-limits-for-developers.md [tiers]
- Prix Zoom Workplace Pro (13,33 €/utilisateur/mois en annuel, relevé 2026-10-27) : https://www.eesel.ai/fr/blog/zoom-pricing [tiers]
- Google Calendar, `conferenceData.createRequest` (`hangoutsMeet`, `conferenceDataVersion=1`, génération asynchrone) : https://developers.google.com/calendar/v3/reference/events [officiel]
- Google Meet REST API `spaces.create`, portée `meetings.space.created` (sensible) : https://developers.google.com/workspace/meet/api/reference/rest/v2/spaces/create , https://developers.google.com/workspace/meet/api/guides/meeting-spaces-overview [officiel] ; niveaux de portée et absence d'audit CASA : https://developers.google.com/workspace/events/guides/auth [officiel], https://docs.unified.to/skills/google-meet-oauth-app/SKILL.md [tiers]
- Microsoft Graph `POST /me/onlineMeetings` : compte personnel Microsoft **non pris en charge**, comptes professionnels ou scolaires seulement : https://learn.microsoft.com/en-us/graph/api/application-post-onlinemeetings?view=graph-rest-1.0 [officiel]

Fournisseurs intégrés :
- LiveKit, offres (Build 0 $, Ship 50 $/mois 150 000 min puis 0,0005 $/min, Scale 500 $/mois 1,5 M min puis 0,0004 $/min) : https://livekit.com/pricing , https://livekit.com/pricing.md [officiel, via extrait] ; bande passante incluse et dépassement 0,10–0,12 $/Go : https://trtc.io/blog/details/livekit-pricing-2026 , https://www.forasoft.com/blog/article/livekit-vs-agora-cost-analysis [tiers] ; enregistrement 0,015 $/min vidéo, 0,004 $/min audio : https://kb.livekit.io/articles/3947254704-understanding-livekit-cloud-pricing [officiel, via extrait]
- LiveKit, résidence UE, DPA, épinglage de région : https://docs.livekit.io/deploy/admin/regions/data-residency , https://docs.livekit.io/home/cloud/region-pinning [officiel] ; « l'épinglage du SFU demande l'offre Scale » : https://community.livekit.io/t/how-can-i-find-and-confirm-which-region-my-livekit-cloud-project-is-hosted-in-for-eu-gdpr-data-residency/1580 [tiers, à vérifier]
- LiveKit, Expo : `@livekit/react-native-expo-plugin` (Apache-2.0, pas d'Expo Go, option `enableScreenShareService` Android) : https://github.com/livekit/client-sdk-react-native-expo-plugin , https://docs.livekit.io/home/quickstarts/expo/ [officiel] ; extension de diffusion iOS par un plugin tiers `expo-livekit-screen-share` : https://www.pkgstats.com/pkg:expo-livekit-screen-share [tiers]
- LiveKit auto-hébergé : ports UDP 50000–60000, TURN embarqué 3478/UDP et TLS 443, Egress séparé, Redis : https://docs.livekit.io/transport/self-hosting/deployment/ , https://docs.livekit.io/transport/self-hosting/ports-firewall.md [officiel] ; sous-titres par un agent : https://docs.livekit.io/agents/multimodality/text/ [officiel] ; LiveKit Inference indisponible en auto-hébergé : https://docs.livekit.io/agents/v0/voice-agent/transcriptions/ [officiel, via extrait]
- La Suite Meet (Visio de la DINUM, MIT, sur LiveKit) : https://documentation-meet.beta.numerique.gouv.fr/overview/what-is-meet/ , https://documentation-meet.beta.numerique.gouv.fr/self-hosting/ [officiel]
- Daily, prix (10 000 min gratuites, 0,004 $/min, audio seul 0,00099 $/min automatique sans vidéo) : https://trtc.io/blog/details/daily-co-pricing-2026 , https://frontdeskreview.com/software/video-api/daily/ [tiers] ; page officielle (transcription 0,0059 $/min-participant non muet, transcription post-appel 0,0043 $/min, enregistrement audio 0,005 $/min) : https://www.daily.co/pricing/video-sdk/ [officiel, via extrait, conflit sur le prix de base]
- Daily, RGPD et DPA sur demande : https://www.daily.co/security/gdpr/ [officiel] ; région `eu-central-1` : https://www.plushcap.com/content/daily/blog/how-our-new-european-call-server-region-can-benefit-call-performance [tiers, miroir d'un billet Daily]
- Daily, Expo : `@daily-co/config-plugin-rn-daily-js` (option `enableScreenShare` iOS, minSdk 24) : https://www.npmjs.com/package/@daily-co/config-plugin-rn-daily-js [officiel]
- Whereby Embedded (Build 9,99 $/mois, 2 000 min incluses, 0,004 $/min ; transcription dès 0,0065 $/min ; « construit en Europe, RGPD, ISO 27001 ») : https://whereby.com/information/embedded/pricing [officiel, via extrait] ; hausse du 2026-10-12 à 10,99 $ et 0,0042 $/min : https://pricingsaas.com/companies/whereby.page1/diffs/2026W42 [tiers, à vérifier] ; siège à Oslo, données dans l'UE : https://europeanstack.pages.dev/software/whereby [tiers]
- Whereby, React Native : `@whereby.com/react-native-sdk`, enveloppe d'une WebView, compatible Expo : https://docs.whereby.com/whereby-for-mobile-development/in-react-native/quick-start , https://github.com/whereby/sdk [officiel]
- 100ms (0,004 $/min, 10 000 min gratuites, enregistrement 0,0135 à 0,04 $/min selon la source) : https://toolradar.com/tools/100ms/calculator , https://apis.io/plans/100ms-live/100ms-live-plans-pricing/ [tiers, en conflit] ; région UE et DPA : **non trouvés**.
- Jitsi as a Service (8x8) : Developer 25 MAU gratuit, Basic 99 $/mois 300 MAU, Standard 499 $/mois 1 500 MAU, Business 999 $/mois, dépassement 0,99 $/MAU, enregistrement 0,01 $/min, transcription 0,06 $/min : https://cpaas.8x8.com/en/pricing/jitsi-as-a-service-pricing/ , https://cpaas.8x8.com/au/pricing/jitsi-as-a-service-pricing [officiel, via extrait] ; résidence UE de JaaS : **non trouvée** (8x8 société américaine) : https://www.8x8.com/s/data-sovereignty [officiel, marketing]
- Jitsi, React Native : `@jitsi/react-native-sdk` (build de développement, pas de plugin Expo officiel) : https://www.npmjs.com/package/@jitsi/react-native-sdk [officiel] ; plugin tiers : https://npmjs.com/package/@inkandsteel/expo-config-plugin-jitsi [tiers]
- Vonage Video (0,0041 $ / 0,00350 € par minute-participant ; zone média régionale UE 550 $ / 500 € par mois) : https://api.support.vonage.com/hc/en-us/articles/6646227378204 , https://www.vonage.com/communications-apis/video/pricing/ [officiel, via extrait, libellé de la zone ambigu] ; zones média et proxy UE : https://developer.vonage.com/en/video/guides/regional-media-zones [officiel] ; sous-titres en direct (transcription par AWS Transcribe) : https://developer.vonage.com/en/video/guides/live-caption [officiel] ; plugin Expo depuis la 2.31.1 (janvier 2026) : https://developer.vonage.com/en/blog/celebrating-the-anniversary-of-vonage-video-react-native-sdk-official-support [officiel]

Construire et héberger :
- Hostinger KVM : plafond de trafic mensuel (KVM 2 : 8 To, KVM 4 : 16 To), bridage au-delà : https://www.hostinger.com/support/?p=576 [officiel], https://valebyte.com/blog/hostinger-vs-contabo-vs-hetzner-budget-vps-in-2026/ [tiers]
- Serveurs dédiés UE à 1 Gbit/s non mesuré (Hetzner ≈ 40 €/mois) : https://www.cherryservers.com/blog/10gbps-dedicated-server-providers , https://lowendtalk.com/discussion/comment/3848519 [tiers, à vérifier]
- Débits WebRTC : https://bloggeek.me/webrtcglossary/bitrate/ [tiers], https://aws.github.io/amazon-chime-sdk-js/modules/qualitybandwidth_connectivity.html [officiel Chime]

Partage d'écran dans le navigateur :
- `getDisplayMedia` absent de Safari iOS (test 2020) et des navigateurs mobiles selon Twilio : https://webrtc.ventures/2020/01/safari-a-webrtc-screen-sharing-story/ , https://www.twilio.com/docs/video/screen-share-chrome [tiers / officiel Twilio, **ancien, à revérifier sur la table de compatibilité MDN**]

## Constats

### 1. Lien seulement (l'existant : `video_link`)

Aujourd'hui le Candidate ou le Human Coach colle un lien http(s) quelconque dans la Coaching Session (#842). Trois améliorations possibles, du plus simple au plus lourd :

- **Coller un lien, mieux** : reconnaître Zoom, Meet, Teams, Whereby, Jitsi pour afficher le bon libellé (« Rejoindre sur Zoom ») et le bouton dans le Calendar file. Coût nul, aucun Tool.
- **Créer la réunion par API depuis le compte du coach** :
  - *Zoom* : application OAuth par utilisateur (une app Server-to-Server ne vaut que pour le compte de son propriétaire) ; portée d'écriture des réunions ; publication sur le Marketplace (revue) dès qu'elle sert plusieurs comptes [processus 2026 **non trouvé**]. La résidence UE ne vaut que pour un **compte payant** (Pro et plus) où l'administrateur a choisi l'Europe ; un compte gratuit est routé aux US.
  - *Google Meet* : soit un événement Calendar avec `conferenceData.createRequest` (portée `calendar.events`), soit `spaces.create` de l'API Meet (portée `meetings.space.created`, **sensible**). Portées sensibles : vérification de la marque et des portées, vidéo de démonstration, **pas d'audit CASA** (sauf API Meet Media ou fichiers Drive) [tiers pour Calendar].
  - *Microsoft Teams* : `POST /me/onlineMeetings` exige un **compte professionnel ou scolaire** ; un compte personnel Microsoft n'est pas pris en charge. Un coach indépendant sans tenant Microsoft 365 est exclu.
  - Dans les trois cas : un jeton OAuth **par Human Coach** à garder et révoquer (une nouvelle sorte de secret, qui n'est ni un Provider Secret ni un Sign-in Provider), un nouveau Tool par fournisseur au catalogue, et le fournisseur sur la Recipient list (il reçoit au moins le titre et la date ; le contenu de la séance passe chez lui de toute façon).
  - **[à vérifier]** Cal.com, où le Candidate réserve déjà (ADR-0016, ADR-0027), sait joindre un lien Zoom, Meet ou sa propre visio à la réservation : cela couvrirait la création du lien sans code Jobbbox, mais le lien ne remonte pas dans Jobbbox (Cal.com n'est pas relié, ADR-0027).
- **Données** : la séance se tient hors de Jobbbox, chez l'outil du coach, sous sa responsabilité ; Jobbbox ne traite que le lien. Rien à ajouter au registre si l'on se contente de coller.
- **Expérience** : le Candidate change d'application ; sur téléphone, l'app Zoom ou Teams est à installer ; aucune cohérence avec Mercury ; mais les coachs gardent l'outil qu'ils connaissent.

### 2. Fournisseur intégré

| Fournisseur | Média dans l'UE | DPA | Web | React Native / Expo | Audio seul | Enregistrement serveur | Sous-titres |
|---|---|---|---|---|---|---|---|
| **LiveKit Cloud** | Région de données UE choisie à la création du projet ; le média **peut transiter hors UE** sauf épinglage de région (`*.eu.rtc.livekit.cloud`), activé par le support ; offre requise **[à vérifier]** (Scale selon un fil communautaire) | DPA par les CGU (CCT) en libre-service, signé à part en Enterprise [officiel] | SDK JS, composants React | Officiel : `@livekit/react-native` + `@livekit/react-native-expo-plugin` (build de développement) ; extension de diffusion iOS par plugin tiers | Oui (pistes audio seules) ; même prix à la minute | Egress : 0,015 $/min vidéo composite, 0,004 $/min audio [officiel, via extrait] | Par un agent et un fournisseur de reconnaissance vocale au choix (texte sur `lk.transcription`) |
| **LiveKit auto-hébergé** | Oui, là où on l'héberge | Sans objet (pas de sous-traitant média) | Idem | Idem | Oui | Egress auto-hébergé (Chrome, 2–4 vCPU par enregistrement) | Agent + fournisseur de reconnaissance vocale avec nos propres clés |
| **Daily** | Région `eu-central-1` (Francfort) **[tiers]** ; défaut et routage de signalisation non établis | Sur demande (help@daily.co) [officiel] | `daily-js`, Prebuilt | Officiel : `react-native-daily-js` + `@daily-co/config-plugin-rn-daily-js` (`enableScreenShare`) ; dernière paire testée affichée : Expo 52 **[à vérifier pour SDK 56]** | Oui, **0,00099 $/min** appliqué d'office sans vidéo [tiers] | ≈ 0,0135 $/min vidéo [tiers] ; 0,005 $/min audio [officiel] | Temps réel 0,0059 $/min-participant non muet ; post-appel 0,0043 $/min [officiel] |
| **Whereby Embedded** | Société norvégienne (EEE), données dans l'UE **[tiers]** ; pas de déclaration officielle trouvée pour tout Embedded | « DPA pour les clients Enterprise » **[tiers, à vérifier]** | Browser SDK (hooks React) ou salle en iframe | `@whereby.com/react-native-sdk` = **WebView** ; compatible Expo | Oui (caméra coupée) | Oui (cloud ou vers son propre stockage) [prix non trouvé] | Transcription dès 0,0065 $/min [officiel] |
| **Jitsi auto-hébergé** | Oui | Sans objet | Jitsi Meet (iframe API) ou lib-jitsi-meet | `@jitsi/react-native-sdk` (build de développement) ; plugin Expo **tiers** seulement | Oui | Jibri (une instance Chrome par enregistrement) | Jigasi + fournisseur de reconnaissance vocale |
| **JaaS (8x8)** | **Non établi** (8x8 société US ; région UE documentée pour son CPaaS, pas pour JaaS) | DPA évoqué en marketing | Idem Jitsi | Idem Jitsi | Oui | 0,01 $/min [officiel, via extrait] | Transcription 0,06 $/min [officiel, via extrait] |
| **100ms** | **Non trouvé** | **Non trouvé** | SDK web | SDK React Native (plugin Expo **non vérifié**) | Oui | 0,0135 à 0,04 $/min selon la source [tiers, conflit] | Non vérifié |
| **Vonage Video** | Zone média régionale UE en option payante (550 $ / 500 € par mois ; Allemagne seule 1 100 $ / 1 000 €) + proxy UE pour la signalisation [officiel] | Oui (Vonage, groupe Ericsson) **[non vérifié en détail]** | SDK JS | `@vonage/client-sdk-video-react-native` avec plugin Expo depuis la 2.31.1 [officiel] | Oui | Archivage (prix non relevé) | Live Captions par **AWS Transcribe** (sous-traitant US) ; l'interface est à construire |

Remarques communes :

- **Un fournisseur intégré est un Tool** : il reçoit la voix et l'image du Candidate et du Human Coach (données personnelles, impossibles à rédiger par Redaction), entre au catalogue avec sa résidence, et sur la Recipient list. Un siège américain (LiveKit, Daily, 100ms, Vonage, 8x8) laisse la question du transfert (CLOUD Act) même avec un média dans l'UE : à trancher par le juridique ; si sa résidence reste « non établie », c'est un **Recipient outside the EU** et une nouvelle version de la politique de confidentialité avant de l'allumer (ADR-0064).
- **Sous-titres** : toute transcription envoie la voix à un service de reconnaissance vocale, une **voie IA nouvelle** au sens d'ADR-0007, sans Redaction possible : elle devrait être réservée à l'UE (comme la voie d'identité). Seul LiveKit (agent) laisse choisir librement ce fournisseur.
- **Enregistrement** : il demande le consentement des deux personnes, une durée de conservation, une entrée au registre `docs/privacy/register.md` et sa place dans le Data export. À écarter en v1 sauf demande expresse.
- **Qualité à deux, bande passante faible** : tous font de l'adaptation de débit ; un mode « audio seul » à la demande et automatique sous un seuil est à prévoir côté interface. Pour 2 participants, Jitsi passe en pair-à-pair par défaut, ce qui soulage le serveur.

### 3. Construire sur WebRTC

- **Construire « de zéro »** (signalisation maison, SFU type mediasoup ou Pion, coturn) n'a pas de sens face à un SFU libre et mûr : « construire » revient en pratique à **auto-héberger LiveKit ou Jitsi**, en écrivant l'interface dans Mercury.
- **Sur l'hébergement actuel** (`docs/ops/hosting.md`) : le VPS Hostinger de Paris est partagé avec d'autres applications derrière Traefik ; un SFU veut la plage UDP 50000–60000, TURN sur 3478/UDP et 443/TLS (un domaine et un certificat à part), du CPU dédié et 10 Gbit/s recommandés en production. **À déconseiller sur ce VPS** : le 443 est déjà pris par Traefik, une séance chargerait l'app des Candidates, et le plafond de trafic Hostinger (8 To sur KVM 2) bride au-delà. 1 000 séances ≈ 1,35 To/mois via SFU : sous le plafond, mais sans marge pour Jobbbox lui-même.
- **Sur un serveur dédié UE à part** (Hetzner, Scaleway, OVHcloud) : ≈ 40–80 €/mois pour une machine à 1 Gbit/s non mesuré **[tiers, à vérifier]**, plus une seconde pour la redondance et l'enregistrement le cas échéant. Coût humain : mise en place ≈ 3–5 j (SFU, TURN, supervision, mises à jour, tests de pare-feu d'entreprise), puis ≈ 0,5–1 j/mois d'exploitation et une astreinte implicite : une panne pendant une séance payée se voit tout de suite.
- **Référence française** : La Suite Meet de la DINUM (MIT) tourne sur LiveKit auto-hébergé ; sa documentation d'auto-hébergement est réutilisable.

## Comparaison des coûts (100 et 1 000 Coaching Sessions de 60 min par mois)

12 000 et 120 000 minutes-participant. Prix de liste, hors taxes, sans remise de volume, sans enregistrement ni sous-titres. Montants arrondis, calculés par cette note.

| Voie | 100 séances/mois | 1 000 séances/mois | Calcul et réserves | Effort | Données | Expérience |
|---|---|---|---|---|---|---|
| **Lien collé** (existant) | 0 $ pour Jobbbox | 0 $ | Le coach paie son outil (Zoom Pro ≈ 13,33 €/mois [tiers]) | XS (libellé, détection) | Hors Jobbbox | Changement d'application |
| **Lien créé par API** (Zoom, Meet, Teams) | 0 $ + licences des coachs | idem | Teams exclu pour un compte personnel | M par fournisseur (OAuth par coach, revue Google/Zoom) | Nouveau Tool par fournisseur, jetons par coach | Lien prêt, toujours hors Jobbbox |
| **LiveKit Cloud, Ship** | **50 $** | **≈ 180 $** | 150 000 min incluses ; ≈ 1 350 Go de trafic au-delà de 250 Go à 0,12 $/Go [tiers] | L | Tool, média UE seulement si épinglé | Intégré, Mercury |
| **LiveKit Cloud, Scale** (si l'épinglage UE l'exige) | **500 $** | **500 $** | 1,5 M min et 3 To inclus [tiers pour le trafic] | L | Média épinglé UE | Intégré |
| **LiveKit auto-hébergé** (dédié UE) | ≈ 40–80 € + exploitation | ≈ 80–160 € + exploitation | 1 à 2 machines ; + 0,5–1 j/mois | L à XL | Tout dans l'UE, aucun sous-traitant média | Intégré |
| **Daily** | **≈ 8 $** | **≈ 440 $** | (12 000 − 10 000) × 0,004 $ ; (120 000 − 10 000) × 0,004 $ ; audio seul ≈ 109 $ pour 1 000 ; **0,0059 $/min** sur un extrait officiel donnerait ≈ 650 $ [conflit] | M à L | Tool, région UE à confirmer | Intégré (ou Prebuilt) |
| **Whereby Embedded, Build** | **≈ 50 $** (53 $ au tarif d'octobre 2026) | **≈ 482 $** (507 $) | 9,99 $ + (12 000 − 2 000) × 0,004 $ ; 9,99 $ + 118 000 × 0,004 $ | S à M (salle prête) | Tool, société EEE | Salle prête, peu adaptable ; WebView sur l'app |
| **JaaS (8x8)** | **99 $** (Basic, 300 MAU) | **499 $** (Standard, 1 500 MAU) | MAU = personnes ayant tenu au moins une réunion : ≈ 1 Candidate par séance + les coachs [hypothèse] | M | Résidence non établie : hors UE | Jitsi, interface marquée |
| **Jitsi auto-hébergé** | ≈ 40–80 € + exploitation | ≈ 80–160 € + exploitation | Pair-à-pair à deux, TURN en secours | L | Tout dans l'UE | Jitsi ou interface maison |
| **100ms** | **≈ 8 $** | **≈ 440 $** | Comme Daily [tiers] | M à L | Résidence et DPA non trouvés : hors UE | Intégré |
| **Vonage Video** | **≈ 49 $** ; **≈ 600 $** avec la zone UE | **≈ 492 $** ; **≈ 1 040 $** avec la zone UE | 0,0041 $ × min-participant + 550 $/mois de zone média | M à L | Zone UE payante ; sous-titres via AWS | Intégré |

Ordre de grandeur des options : enregistrement vidéo ≈ 0,01–0,015 $/min (60–90 $ pour 100 séances, 600–900 $ pour 1 000) ; sous-titres ≈ 0,006 $/min-participant (≈ 70 $ et 700 $).

## Partage de présentation, par voie

| Besoin | Lien seulement | Fournisseur intégré | Construire (LiveKit/Jitsi auto-hébergé) |
|---|---|---|---|
| **Partage d'écran, navigateur d'ordinateur** | Selon l'outil (Zoom, Meet, Teams : oui) | Oui partout (`getDisplayMedia`) | Oui |
| **Partage d'écran, iPad et Android dans le navigateur** | Par l'app native de l'outil | **Non** : `getDisplayMedia` absent de Safari iOS/iPadOS et des navigateurs mobiles **[sources anciennes, à revérifier]** | Non |
| **Partage d'écran, Jobbbox app** | Sans objet (l'app de l'outil) | iOS : extension de diffusion (Broadcast Upload Extension, App Group) ; Android : service de premier plan MediaProjection. Daily et LiveKit (Android) le configurent par plugin Expo ; LiveKit iOS par plugin tiers ; Whereby (WebView) : **non vérifié, peu probable** | Comme LiveKit |
| **Document Jobbbox en lecture synchronisée** (CV, Tailored Document) | Possible **à côté** de l'appel : les deux ouvrent la même page Jobbbox, la page et le zoom suivent par notre propre canal (SSE ou WebSocket) | Même visionneuse, synchronisée par le canal de données du fournisseur (LiveKit, Daily, Vonage) ou le nôtre ; avec Whereby ou Jitsi en iframe, à côté de la salle | Même chose, canal de données LiveKit |
| **Slides du coach (PDF)** | Partagées dans l'outil du coach | Upload (ADR-0068, limite de 10 Mo de `cv/limits.ts`, contrôle serveur) puis la même visionneuse PDF.js (ADR-0067) synchronisée | Idem |
| **Annotation** | Selon l'outil (Zoom : oui) | Calque de traits éphémères au-dessus du canvas PDF.js, diffusé par le canal de données ; tableau blanc Jitsi (Excalidraw) en auto-hébergé | Idem |

La **lecture synchronisée** est la vraie différence pour Jobbbox, et elle ne dépend d'aucun fournisseur vidéo :

- **Netteté et bande passante** : le texte est dessiné par PDF.js chez chacun, net à toute taille, quelques Ko par changement de page au lieu d'un flux vidéo de 1 à 2 Mbit/s ; elle marche sur iPad et téléphone, là où le partage d'écran ne marche pas dans le navigateur.
- **Accessibilité** : la couche de texte de PDF.js se lit au lecteur d'écran et suit le zoom du système, ce qu'un écran partagé en pixels ne permet pas.
- **Données** : le document ne quitte pas Jobbbox (servi depuis notre origine, ADR-0067). Mais il faut une règle : le Human Coach ne voit un Tailored Document que sous Coach Access, alors qu'une Coaching Session se tient sans Coach Access (prénom et initiale seulement). **Le Candidate doit montrer un document précis, le temps de la séance** : une forme de partage à nommer (« Montrer au coach » ?), distincte de Coach Access.
- **Vocabulaire** : une annotation **conservée** sur un Tailored Document entrerait en collision avec la Coach Review (`CONTEXT.md` évite « annotation » pour elle). Garder les traits **éphémères** pendant la séance, et la Coach Review comme seul avis durable.

## Accessibilité

- **Clavier et lecteur d'écran** : une salle prête (Whereby, Jitsi, Daily Prebuilt) apporte son accessibilité, que Jobbbox ne contrôle pas ; une interface maison sur SDK (LiveKit, Daily, Vonage) est à notre charge, mais suit Mercury, la Text Size (ADR-0009), Dynamic Type sur l'app et le mode sombre.
- **Sous-titres** : voir plus haut ; nouvelle voie IA, réservée à l'UE, et coût par minute.
- **Audio seul** : un bouton visible et un passage automatique en cas de réseau faible ; pour une personne qui ne veut pas se montrer, il doit être proposé avant d'entrer.

## Recommandation

1. **Maintenant (S)** : garder le **lien seulement**, en mieux : reconnaître l'outil du lien, un libellé « Rejoindre sur … », le lien dans le Calendar file et le rappel. Ne pas coder la création par API (Zoom, Meet, Teams) : effort M par fournisseur, jetons par coach, revues Google et Zoom, Teams inaccessible aux coachs sans Microsoft 365, pour un gain que Cal.com apporte peut-être déjà **[à vérifier]**.
2. **Ensuite, indépendamment de la vidéo (M)** : la **lecture synchronisée d'un document Jobbbox** pendant une Coaching Session (Tailored Document, Master CV, PDF du coach téléversé), sur la visionneuse PDF.js existante, avec un pointeur et des traits éphémères. C'est la valeur propre à Jobbbox, utile avec un lien Zoom comme avec une visio intégrée, accessible et légère, et elle contourne l'absence de partage d'écran sur iPad et Android.
3. **Si la visio dans Jobbbox est voulue (L)** : **LiveKit**, pour quatre raisons : le plugin Expo officiel (ADR-0076), le serveur libre qui laisse passer du Cloud à l'**auto-hébergement dans l'UE** sans changer le code client (sortie possible si la question du transfert hors UE bloque), le libre choix du fournisseur de reconnaissance vocale pour des sous-titres dans l'UE, et le précédent de La Suite Meet. Commencer sur LiveKit Cloud **avec média épinglé dans l'UE** (50 à 500 $/mois selon l'offre exigée), basculer en auto-hébergé sur un serveur dédié UE (et non sur le VPS Hostinger) si le juridique écarte un sous-traitant américain ou au-delà de quelques centaines de séances. Pas d'enregistrement en v1.
   - *Seconde option* : **Whereby Embedded** si l'on veut une salle prête vite et un sous-traitant de l'EEE ; mais une WebView sur l'app, peu de contrôle de l'interface, et le coût le plus haut à 1 000 séances avec Vonage zone UE.
   - *Écartés* : 100ms et JaaS (résidence UE non établie), Vonage (zone UE à 500 €/mois, sous-titres via AWS), construire un SFU maison (aucun gain face à LiveKit ou Jitsi auto-hébergés).

## Questions ouvertes pour le product owner

1. **Visio dans Jobbbox, oui ou non ?** Ou bien les Human Coaches gardent-ils leur outil (Zoom, Meet, Teams) et Jobbbox ne fait que le partage de documents ?
2. **Sous-traitant américain** pour la voix et l'image (LiveKit Cloud, Daily, Vonage), même avec un média dans l'UE : acceptable après avis juridique, ou seulement l'EEE / l'auto-hébergement ?
3. **Montrer un document au coach** pendant une Coaching Session sans Coach Access : un partage d'un document précis, le temps de la séance, est-il acceptable ? Sous quel nom (à ajouter à `CONTEXT.md`) ?
4. **Audio seul** : à proposer comme mode de séance à part entière, au choix du Candidate ? Le terme Coaching Session dit « video meeting » et évite « call » : faut-il amender sa définition ?
5. **Enregistrement et sous-titres** : hors v1 ? Les sous-titres sont-ils une exigence d'accessibilité dès la première version (coût ≈ 0,006 $/min-participant et une voie IA UE à ouvrir) ?
6. **Annotation** : traits éphémères seulement, la Coach Review restant le seul avis durable ?
7. **Volume visé** à 12 mois (100 ou 1 000 séances/mois) : il décide entre LiveKit Cloud et l'auto-hébergement, et du budget d'exploitation.
8. **Vérifications à faire** (réseau de cette session fermé aux sites des fournisseurs) : épinglage UE de LiveKit et offre requise, prix de base de Daily (0,004 $ ou 0,0059 $), hausse Whereby d'octobre 2026, compatibilité du plugin Daily avec Expo SDK 56, partage d'écran dans Safari iPadOS et Chrome Android (MDN), lien visio créé par Cal.com et sa remontée possible.


## Errata du 2026-11-06 (vérification sur les pages officielles)

Titre d'origine de la section : #845 : visio (LiveKit)

| Affirmation | Statut | Ce que dit la source | URL, lu le 2026-11-06 |
|---|---|---|---|
| Build 0 $, Ship 50 $/mois (150 000 min puis 0,0005 $/min), Scale 500 $/mois (1,5 M min puis 0,0004 $/min), bande passante au-delà à 0,10–0,12 $/Go | **Toujours non vérifiable** | livekit.com/pricing est bloqué. La documentation donne seulement l'allocation **Build (gratuit)** : 5 000 minutes-participant WebRTC et 50 Go de transfert descendant par mois, avec un plafond dur (« new requests fail rather than incurring overage charges »). Elle renvoie pour le reste à « the latest pricing page ». | https://docs.livekit.io/deploy/admin/quotas-and-limits.md |
| Épinglage UE du média : offre requise **[à vérifier]**, « Scale selon un fil communautaire » | **Confirmé** | « Region pinning is available for customers on the **Scale plan or higher**. » Il est activé par LiveKit sur demande au support. Pas de bascule automatique vers une autre région. | https://docs.livekit.io/home/cloud/region-pinning.md (redirige vers /deploy/admin/regions/region-pinning.md) |
| Épinglage par les points d'accès `*.eu.rtc.livekit.cloud` | **Corrigé** | Pour les SDK temps réel, l'épinglage est **« protocol-based »** : la région est inscrite dans les messages de signalisation, et une connexion hors région est refusée puis retentée. Les points d'accès régionaux sont réservés à la **téléphonie** (`<sub>.eu.sip.livekit.cloud`). Groupe `eu` : France et Allemagne (liste mise à jour le 2026-10-25). | idem ; https://docs.livekit.io/deploy/admin/regions/data-residency.md |
| « Le média peut transiter hors UE sauf épinglage » ; région de données UE choisie à la création | **Confirmé, et LiveKit le juge non nécessaire au RGPD** | « LiveKit Cloud routes media over the shortest available path and doesn't retain it, so media can transit servers outside the EU without being stored there. Restricting that routing is an optional hardening step rather than a requirement. » La région de données (« European Union (Frankfurt) ») se choisit à la création du projet et ne peut plus changer. Ce que la page appelle « non requis » reste l'avis de LiveKit : la page dit elle-même qu'elle « doesn't determine whether your app meets GDPR ». | https://docs.livekit.io/deploy/admin/regions/data-residency.md |
| DPA accepté par les CGU (CCT) en libre-service, signé à part en Enterprise | **Confirmé** | « Self-serve customers accept the DPA through the click-through Terms of Service… Enterprise customers sign a separate DPA. » Le DPA couvre les CCT. | idem |
| Plugin Expo officiel `@livekit/react-native-expo-plugin`, pas d'Expo Go, option Android `enableScreenShareService` | **Confirmé** | Le quickstart Expo installe `@livekit/react-native-expo-plugin` et `@config-plugins/react-native-webrtc` : « not compatible with the Expo Go app », il faut un `expo-dev-client`. Le README liste `enableScreenShareService` (Android, service de premier plan MediaProjection). Côté iOS, aucune option de partage d'écran n'est listée, seulement `enableMultitaskingCameraAccess`. | https://docs.livekit.io/home/quickstarts/expo.md ; https://raw.githubusercontent.com/livekit/client-sdk-react-native-expo-plugin/main/README.md |

