# Recherche #850 : stores — visio, masterclasses et achats intégrés dans la Jobbbox app

Partie de la carte #841, prolonge #707. Lu le 2026-11-06. « Masterclass » n'est pas encore un terme de `CONTEXT.md` (il sera posé par #860) : on l'emploie au sens de #848, une séance de formation d'un Human Coach pour plusieurs Candidates, en direct (live) ou en replay.

## Question

Que permettent l'App Store et Google Play pour la visio, les masterclasses live et replay, et leur paiement dans la Jobbbox app ? Quelle position reporter dans #707 ?

## Point de départ dans le dépôt

- **ADR-0076** : pas d'achat intégré en v1 ; l'app montre le Plan et dit « Gérez votre abonnement sur jobbbox.ai », sans prix ; la Coaching Session est payée par Stripe Checkout dans le navigateur intégré au titre de la règle 3.1.3(d) ; lancement en France, Belgique, Suisse, Luxembourg et Canada.
- **ADR-0088** (#694) : l'**App Order screen** (`/coachs/commande`) recueille les CGV et l'Immediate Performance Request, puis Stripe Checkout s'ouvre avec `openBrowserAsync` ; le **Checkout return** (`/coachs/paiement`) est revendiqué par l'app mais ne prouve rien, seul le webhook enregistre la Coaching Session ; l'app ne montre ni nom de Plan, ni prix barré, ni remise.
- **#707** : trois positions à valider avant la première soumission (Coaching Session par Stripe ; aucun achat de Plan dans l'app ; Withdrawal sur sa page web).
- **#848** recommande de vendre les masterclasses à l'unité au nom de Jobbbox, avec une remise par Plan Feature, live par le fournisseur de #845 et replay sur Mux ou Bunny Stream.

## Méthode et limites

- Recherche web du 2026-11-06. Marquage :
  - **[lu]** : page officielle ouverte et lue directement ;
  - **[extrait]** : page officielle connue seulement par l'extrait renvoyé par le moteur de recherche ;
  - **[tiers]** : blog ou presse, parfois contradictoires ;
  - **[non vérifié]** : de mémoire ou déduit, à confirmer.
- **Réseau de la session** : `support.google.com` et `android-developers.googleblog.com` sont refusés (échec DNS). **Toute la partie Google Play repose sur des extraits de recherche**, pas sur la lecture des pages. Il faudra autoriser ces hôtes, ou qu'un humain relise les pages, avant la soumission.
- Côté Apple, `developer.apple.com/app-store/review/guidelines/` et `developer.apple.com/support/dma-and-apps-in-the-eu/` ont été lus directement ; la page des Guidelines n'affiche pas de date de mise à jour dans le texte récupéré.
- Ce document n'est pas un avis juridique : il prépare la note de revue et le « Légal : » de #707.

## Sources

Toutes lues le 2026-11-06.

| # | Source | URL | Statut |
|---|---|---|---|
| A1 | App Store Review Guidelines : 2.5.4, 3.1.1, 3.1.1(a), 3.1.3 (intro, a, b, d, e, f, g), 5.1.1(ii) | https://developer.apple.com/app-store/review/guidelines/ | [lu] |
| A2 | Apple, « Update on apps distributed in the European Union » (DMA) : offres hors de l'app, Core Technology Commission, commissions au 1er octobre 2026 | https://developer.apple.com/support/dma-and-apps-in-the-eu/ | [lu] |
| A3 | StoreKit External Purchase Link (EU) Entitlement Addendum (2 % + 13 % + 5 %, ancien régime, « phased out » selon A2) | https://developer.apple.com/contact/request/download/external/StoreKit-External-Purchase-Link-(EU)-Entitlement-Addendum.pdf | [extrait] |
| A4 | External Link Account Entitlement (reader apps) | https://developer.apple.com/support/reader-apps/ | cité par A1, non ouvert |
| A5 | PushKit, `PKPushType.voip` : un push VoIP doit être signalé à CallKit, sinon l'app est terminée (SDK iOS 13+) | https://developer.apple.com/documentation/pushkit/pkpushtype/voip | [extrait] |
| A6 | États-Unis, Epic c. Apple : liens externes autorisés sur le storefront US, commission en litige (Ninth Circuit déc. 2025, avril 2026) | https://appleinsider.com/articles/26/04/29/app-store-policy-must-change-as-epic-convinces-us-circuit-court-to-reverse-stay , https://www.fenwick.com/insights/publications/ninth-circuit-largely-upholds-ruling-in-epic-v-apple | [tiers] ; hors marchés de lancement |
| A7 | Lecture de 3.1.3(d) pour les cours en groupe (« one-to-few » non défini) | https://newly.app/guides/when-a-guideline-is-a-ban-not-an-option , https://newly.app/how-to/app-store-external-purchase-link | [tiers] |
| G1 | Google Play, politique Paiements (règle générale, sections 3, 8, 9, cas où Play Billing ne doit pas être utilisé) | https://support.google.com/googleplay/android-developer/answer/9858738 | [extrait] (hôte bloqué) |
| G2 | Google Play, « Understanding Google Play's Payments policy » (contenu consommé hors de l'app, service en ligne 1:1, SKU mixtes) | https://support.google.com/googleplay/android-developer/answer/10281818 | [extrait] (hôte bloqué) |
| G3 | Google Play, conditions d'accès dans l'EEE (programme EEE, facturation alternative, liens externes) | https://support.google.com/googleplay/android-developer/answer/14659200 | [extrait] (hôte bloqué) |
| G4 | Google Play, frais de service et transition du 30 juin 2026 | https://support.google.com/googleplay/android-developer/answer/17161464 | [extrait] (hôte bloqué) |
| G5 | Android Developers Blog, « Expanded billing choice and lower fees on Google Play » (juin 2026) | https://android-developers.googleblog.com/2026/06/play-expanded-billing.html | [extrait] (hôte bloqué) |
| G6 | Google Play, types de foreground service et `USE_FULL_SCREEN_INTENT` | https://support.google.com/googleplay/android-developer/answer/13392821 | [extrait] (hôte bloqué) |
| G7 | Frais Google EEE, chiffres contradictoires | https://www.strataigize.com/insights/google-play-external-payments-fee-changes-2026/ , https://www.appcharge.com/blog/making-sense-of-google-payment-programs-ecl-billing-choice-level-up-and-the-global-model , https://www.revenuecat.com/app-to-web-purchase-guidelines | [tiers] |
| G8 | Lecture « 1:1 non enregistré » et cours en groupe sur Google Play | https://epicora.com.br/en/blog/comissao-app-store-google-play | [tiers] |

## 1. Ce que disent les règles

### App Store (A1, [lu])

- **3.1.1** : débloquer des fonctionnalités ou du contenu dans l'app (abonnements, « access to premium content ») impose l'achat intégré (IAP).
- **3.1.1(a)** : lien vers d'autres moyens d'achat seulement avec un entitlement StoreKit, « limited to use only in specific storefronts » ; ailleurs (sauf storefront US), pas de bouton, lien externe ni « call to action » vers un autre moyen d'achat.
- **3.1.3 (intro)** : les apps des cas 3.1.3 peuvent encaisser sans IAP, mais ne peuvent pas, dans l'app, inciter à un autre moyen d'achat (sauf US, 3.1.1(a), 3.1.3(a)). La communication hors de l'app (e-mail) reste libre.
- **3.1.3(a) Reader apps** : accès à du contenu déjà acheté, limité à « magazines, newspapers, books, audio, music, and video » ; création de compte gratuit et gestion de compte ; lien informatif possible avec l'External Link Account Entitlement (A4).
- **3.1.3(b) Multiplatform Services** : accès dans l'app à ce qui a été acquis ailleurs « provided those items are also available as in-app purchases within the app ».
- **3.1.3(d) Person-to-Person Services** : « real-time person-to-person services between two individuals (for example tutoring students, medical consultations, real estate tours, or fitness training) » peuvent être payés hors IAP. **« One-to-few and one-to-many real-time services must use in-app purchase. »**
- **3.1.3(e)** : biens physiques ou services consommés hors de l'app : IAP interdit, autre moyen obligatoire.
- **3.1.3(f)** : apps compagnons gratuites d'un outil web payant, limitées à VoIP, stockage, e-mail, hébergement, sans achat ni incitation : **Jobbbox n'entre pas dans cette liste**.
- **2.5.4** : les modes arrière-plan seulement pour leur usage prévu (« VoIP, audio playback, location… »).
- **5.1.1(ii)** : consentement, textes d'autorisation (« purpose strings ») clairs et complets, une fonction payante ne doit pas dépendre d'un accès aux données.

### Apple dans l'UE, DMA (A2, [lu])

- Depuis l'accord de licence mis à jour le 18 août 2026, **en vigueur au 1er octobre 2026** : dans l'UE, une app peut proposer un **processeur de paiement alternatif dans l'app** ou des **« out-of-app offers »** vers le site de son choix, avec ou sans lien actionnable ; ces options sont à maintenir 12 mois.
- L'ancien « StoreKit External Purchase Link Entitlement (EU) Addendum » (A3 : 2 % de frais d'acquisition initiale, 13 % de frais de services, 5 % de Core Technology Commission) est **« phased out »** ; la Core Technology Fee par installation est remplacée par la **Core Technology Commission de 5 %**, visée par la page pour les ventes d'apps distribuées hors App Store (marketplaces alternatives, Web Distribution).
- Commissions affichées : **offre hors de l'app avec lien actionnable : 15 %** (10 % pour le Small Business Program et les abonnements après un an), **sur les seules ventes faites dans les 7 jours suivant le tap** ; paiement alternatif dans l'app : 20 % (10 %) ; IAP : 26 % (15 %).
- **Incohérence de la page** : elle dit aussi que les nouvelles conditions « eliminate the Initial Acquisition Fee and Store Services Fee », tout en listant une « store services commission » de 15 %. À confirmer dans l'Attachment 14 de l'accord.
- **Portée géographique** : l'UE seulement. Sur les marchés de lancement, **France, Belgique et Luxembourg** en profitent ; **Suisse et Canada non** [non vérifié pour la Suisse : aucun régime équivalent trouvé]. Les États-Unis (A6) ne sont pas un marché de lancement.

### Google Play (G1 à G5, [extrait])

- **Règle générale (G1)** : les apps qui font payer l'accès à des fonctionnalités, du contenu ou des services numériques dans l'app doivent utiliser Google Play Billing, sauf sections 3, 8 ou 9 ; dans l'app, pas d'orientation vers un autre moyen de paiement hors de ces cas.
- **Play Billing ne doit pas être utilisé (G1)** pour les biens physiques, les services physiques (« tickets for live events », salles de sport…), les paiements entre pairs, enchères, dons.
- **Contenu consommé hors de l'app (G2)** : pas de Play Billing pour un bien ou service numérique « only consumed outside of a Play-distributed app and cannot be accessed in a Play-distributed app » (exemple : « web-only content never consumed in the app »).
- **Service en ligne payant 1:1 (G2)** : pas de Play Billing si (1) le service a lieu **entre deux personnes** et (2) **il n'est pas disponible en replay** : « the session is not recorded and cannot be accessed or used again » dans une app distribuée par Play. Exemples : cours éducatifs ou de loisir.
- **SKU mixtes (G2)** : Play Billing obligatoire pour un SKU qui contient plus de numérique que de physique, ou présenté comme numérique.
- **EEE (G3, G4, G5)** : le programme EEE permet la **facturation alternative** (avec ou sans choix de l'utilisateur, « user choice billing ») et les **liens externes** (External Offers). Depuis le **30 juin 2026** (EEE, Royaume-Uni, États-Unis), frais de service séparés des frais de facturation : **10 % sur le premier million de dollars annuel**, quel que soit le moyen (Play Billing, facturation alternative, lien externe), **plus 5 % de frais de facturation seulement si Play Billing est utilisé**. Les chiffres des liens externes se contredisent (G3 cite 20 % au palier standard, G7 cite 10 % / 20 % et 1,20 € par installation) ; les installations antérieures au 30 juin 2026 suivent une autre grille. **À relire sur les pages officielles.**
- **Suisse et Canada** : aucun programme équivalent trouvé dans les extraits [non vérifié].

## 2. Cas par cas

« Achat dans l'app » veut dire : le Candidate paie depuis un écran de l'app (App Order screen puis Stripe Checkout dans le navigateur intégré). « Accès dans l'app » veut dire : regarder ou rejoindre dans l'app ce qui a été payé ailleurs.

| Cas | App Store hors UE (Suisse, Canada) | App Store UE (France, Belgique, Luxembourg) | Google Play (tous marchés) | Google Play EEE |
|---|---|---|---|---|
| **Coaching Session** (un Candidate, un Human Coach, en direct, en visio) | **Stripe autorisé** dans l'app : 3.1.3(d), cas « tutoring », « consultations ». Sans commission Apple. Risque : la réservation sans tenue (#707) ; une séance à deux Candidates serait « one-to-few », donc IAP. | Même chose que hors UE (3.1.3(d) s'applique partout, rien à payer au titre du DMA). | **Stripe autorisé** si la séance est entre deux personnes et **n'est pas rejouable** dans l'app (G2). Un enregistrement ou une vidéo de la séance relisible dans l'app ferait perdre l'exception ; des notes ou un résumé écrit ne sont pas, à la lettre, un replay [non vérifié, à poser à #855]. | Même chose. |
| **Masterclass live** (un Human Coach, plusieurs Candidates, en direct) | **IAP obligatoire** si vendue dans l'app (3.1.3(d), 2e phrase). Pas de lien ni de bouton vers le web (3.1.1(a), 3.1.3 intro). Rejointe dans l'app alors qu'achetée sur le web : 3.1.3(b) suppose qu'elle soit aussi en IAP. 3.1.3(e) ne s'applique pas à une visio suivie sur un écran, même hors de l'app [non vérifié : précédents de 2020 sur les « online experiences » rapportés par la presse, non relus]. | IAP (26 % / 15 % petite entreprise), **ou** paiement alternatif dans l'app (20 % / 10 %), **ou** offre hors de l'app avec lien (15 % / 10 % sur les ventes à 7 jours du tap) (A2). | **Play Billing obligatoire** si vendue ou suivie dans l'app : pas 1:1, numérique (G1, G2). Exception seulement si elle n'est jamais accessible dans l'app (« web-only », G2). | Play Billing, facturation alternative ou lien externe (programme EEE) ; 10 % de frais de service + 5 % si Play Billing (G5), chiffres à confirmer. |
| **Masterclass en replay** (vidéo enregistrée) | Contenu numérique : **IAP obligatoire** pour la vendre (3.1.1). La regarder dans l'app après achat web : 3.1.3(b) (suppose l'IAP) ; 3.1.3(a) ne couvre que les « reader apps » dont la vidéo est l'objet, ce que Jobbbox n'est pas [interprétation]. | Comme le live : IAP, paiement alternatif ou offre hors de l'app (A2). | **Play Billing obligatoire** si vendue ou visible dans l'app ; pas de Play Billing si elle ne se regarde que sur le web (G2). | Comme le live. |
| **Plan qui inclut des masterclasses** (abonnement Standard ou Premium) | Un abonnement qui débloque du contenu : 3.1.1, **IAP**. La position actuelle d'ADR-0076 (« Gérez votre abonnement sur jobbbox.ai », sans prix) s'appuie sur 3.1.3(b), dont le texte suppose aussi l'IAP : **le risque existe déjà pour le Plan d'aujourd'hui** et grandit si le Plan ouvre des masterclasses dans l'app. Atténuation : l'app reste pleinement utilisable avec Free, aucune mention d'achat, aucun lien [interprétation]. | IAP, paiement alternatif, ou offre hors de l'app avec lien ; pour un abonnement, 10 % après la première année (A2). | Abonnement numérique : **Play Billing** pour le vendre dans l'app ; vente web seule et silence dans l'app : pratique courante, pas d'exception écrite trouvée dans les extraits [non vérifié]. | Facturation alternative ou lien externe ; 10 % de frais de service, abonnements compris (G5). |

### Prix différents

- Aucune des deux politiques lues n'impose le même prix sur le web et dans l'app. Apple, hors UE et hors US, interdit seulement de **dire** dans l'app qu'un autre moyen existe ou est moins cher (3.1.1(a), 3.1.3 intro) ; dans l'UE, le lien peut dire que l'achat est « comparatively lower price » (3.1.1(a)).
- Pour la Coaching Session (3.1.3(d)), aucune commission : le même prix partout reste le plus simple et c'est ce que fait ADR-0088.
- Pour une masterclass vendue en IAP, un prix app majoré de la commission est permis, mais il donnerait deux prix pour un même produit, alors que l'Order et les CGV supposent un prix unique (ADR-0074) [à arbitrer].

## 3. Visio dans l'app

Ce qui suit vaut si #845 et #854 choisissent une visio **intégrée** (SDK WebRTC d'un fournisseur). Avec un **lien** vers Zoom, Meet ou Teams, l'app ouvre l'app ou la page du fournisseur et rien de ceci ne s'applique, sauf la note de revue.

### iOS

- **Autorisations** : `NSCameraUsageDescription` et `NSMicrophoneUsageDescription` dans `app.json` (plugin Expo), avec un texte qui dit à quoi elles servent (5.1.1(ii)) ; demandées au moment de rejoindre la séance, jamais au premier lancement (même règle que les notifications dans ADR-0076). Une Coaching Session payée doit rester utilisable sans caméra (5.1.1(ii) : « Paid functionality must not be dependent on… ») : prévoir audio seul. Partage d'écran depuis l'iPhone ou l'iPad : extension ReplayKit (Broadcast Upload) [non vérifié pour Expo].
- **Arrière-plan** : `UIBackgroundModes` `audio` pour garder le son quand le Candidate quitte l'app un instant ; `voip` seulement avec de vrais appels entrants. 2.5.4 : chaque mode à son usage, sinon rejet.
- **CallKit et PushKit** : un push VoIP (PushKit) **doit** être signalé tout de suite à CallKit, sinon l'app est terminée (A5, SDK iOS 13+). Une Coaching Session est **planifiée**, pas un appel entrant : un push ordinaire (« Votre séance commence dans 5 minutes ») suffit, sans PushKit ni CallKit. CallKit ne servirait que pour un coach qui « appelle » le Candidate ; à éviter en v1 (texte de push neutre, ADR-0076).
- **Revue** : compte de démonstration avec une Coaching Session payée et datée, Human Coach de test joignable, ou une vidéo de la séance ; dans les notes de revue, la référence à 3.1.3(d) (« one-to-one live coaching between a candidate and a human HR professional, booked and paid per session »).

### Android

- **Autorisations** : `CAMERA` et `RECORD_AUDIO` à l'exécution ; `POST_NOTIFICATIONS` (déjà là pour les notifications).
- **Foreground service** (G6) : pour garder la visio en multitâche, type `camera` et `microphone` (ou `phoneCall` pour un vrai appel), avec les permissions `FOREGROUND_SERVICE_CAMERA` / `FOREGROUND_SERVICE_MICROPHONE` ; pour le partage d'écran, `mediaProjection`. Ciblant Android 14+, **chaque type est déclaré dans la Play Console** (Contenu de l'app) avec une description, l'impact pour l'utilisateur et **une vidéo de démonstration**.
- **`USE_FULL_SCREEN_INTENT`** : réservé par défaut aux apps d'appel ou d'alarme depuis le 22 janvier 2025 (G6) ; inutile pour une séance planifiée, à ne pas déclarer.
- **Data safety et labels Apple** : si la visio passe par un fournisseur, l'audio et la vidéo sont des données traitées par un tiers ; à ajouter à l'issue « Légal : politique de confidentialité, Jobbbox app » et au registre, avec #847 pour l'enregistrement.

## 4. Recommandation : position à reporter dans #707

1. **Coaching Session : garder Stripe dans l'app** (ADR-0088), au titre de 3.1.3(d) chez Apple et de l'exception « service en ligne 1:1 » chez Google. Deux conditions à écrire dans #707 et à faire tenir par #854 et #855 :
   - une Coaching Session reste **entre un Candidate et un Human Coach**, jamais à plusieurs ;
   - **aucun enregistrement rejouable dans l'app** (Google) ; des notes ou un résumé écrit restent possibles, à confirmer à la relecture de G2.
   Note de revue prête : séance en direct, un à un, avec un professionnel RH ; compte de démonstration avec une séance payée et datée.
2. **Masterclasses (live et replay) : vendues sur le web seulement en v1, et absentes de l'app** : ni catalogue, ni prix, ni bouton, ni lien d'achat, ni lecture. C'est le seul cas qui ne demande ni IAP, ni Play Billing, ni commission, sur les deux stores et les cinq pays (Google G2 « web-only content » ; Apple, rien n'est acheté ni débloqué dans l'app). Une masterclass live achetée peut apparaître comme Agenda Item (date, titre) sans lien ; elle se suit sur jobbbox.ai. Les e-mails peuvent parler des masterclasses (3.1.3 intro).
3. **Plan qui inclut des masterclasses : ne rien en montrer dans l'app.** La Plan Feature « masterclasses » n'est ni affichée ni ouverte dans l'app ; la remise de #848 s'applique sur le web. Cela n'aggrave pas le risque 3.1.3(b) déjà présent pour le Plan (position 2 de #707), que #707 doit nommer : l'app doit rester pleinement utilisable en Free, sans prix ni lien.
4. **Pas de lien externe DMA en v1** (confirme #707) : il ne couvrirait que France, Belgique et Luxembourg, coûterait 15 % (10 %) chez Apple sur les ventes à 7 jours et des frais encore incertains chez Google, et obligerait à maintenir l'option 12 mois (A2).
5. **Plus tard (v1.x), si les masterclasses doivent entrer dans l'app**, choisir entre : (a) IAP et Play Billing pour les masterclasses (Small Business Program Apple, 10 % + 5 % Google), avec la question du prix unique ; (b) dans l'UE seulement, l'offre hors de l'app avec lien ; (c) un mode « mes masterclasses » sans achat, dont le risque 3.1.3(b) serait à accepter par écrit. À décider par un ADR après #858.
6. **Visio** : si elle est intégrée, autorisations caméra et micro en contexte, mode `audio` seulement, pas de PushKit ni de CallKit en v1, foreground services `camera` / `microphone` déclarés avec vidéo dans la Play Console, pas de `USE_FULL_SCREEN_INTENT`.

## 5. Questions ouvertes pour le product owner

1. Une Coaching Session pourra-t-elle un jour réunir **deux Candidates ou deux coachs** ? Si oui, elle sort de 3.1.3(d) et de l'exception 1:1 de Google.
2. La Coaching Session sera-t-elle **enregistrée** et **rejouable** par le Candidate (#855) ? Sur Google Play, un replay dans l'app ferait perdre l'exception.
3. Acceptez-vous que les **masterclasses n'existent pas dans l'app** en v1, même pour un Candidate qui les a achetées ou dont le Plan les inclut ?
4. Si elles entrent un jour dans l'app : **IAP avec un prix app différent du prix web**, ou même prix et marge réduite ?
5. Acceptez-vous par écrit le **risque 3.1.3(b)** sur le Plan (abonnement vendu seulement sur le web, débloquant des fonctions dans l'app), en sachant qu'un rejet imposerait l'IAP du Plan ?
6. Jobbbox sera-t-il inscrit au **Small Business Program** d'Apple (moins d'un million de dollars de revenus) ? Le taux de toute option payante en dépend.
7. Autoriser `support.google.com` et `android-developers.googleblog.com` dans le réseau de la session, ou faire relire G1 à G6 par un humain, avant la soumission : la partie Google repose sur des extraits.
8. Confirmer qu'aucun régime de lien externe ne s'applique en **Suisse** et au **Canada** sur les deux stores.
