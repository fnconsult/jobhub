# Recherche #848 : marketplace de masterclasses — benchmark, paiement des coachs, diffusion live et replay

Partie de la carte #841. Lu le 2026-11-06. « Masterclass » n'est pas encore un terme de `CONTEXT.md` (il sera posé par #860) : on l'emploie ici au sens courant, une séance de formation d'un Human Coach à plusieurs Candidates, en direct ou en replay.

## Question

Comment d'autres plateformes vendent-elles les cours de leurs experts, et avec quoi Jobbbox encaisserait, reverserait et diffuserait des masterclasses ?

## Méthode et sources

- Recherche web du 2026-11-06. **Les pages officielles n'ont pas pu être ouvertes** : le réseau de la session refuse `stripe.com`, `docs.stripe.com` et `mux.com` (et, par prudence, aucun autre site n'a été ouvert directement). Tous les chiffres viennent des extraits de pages renvoyés par le moteur de recherche, officiels quand c'était possible, sinon de blogs comparatifs. Chaque chiffre est marqué :
  - **[officiel]** : extrait d'une page de l'éditeur (aide, docs, tarifs) ;
  - **[tiers]** : blog, comparateur, avis ; plusieurs se contredisent ;
  - **[non vérifié]** : de mémoire ou déduit, à confirmer avant de s'en servir.
- Contraintes du dépôt relues : `CONTEXT.md` (Billing : Plan, Plan Feature, Coaching Session Price, Order, Withdrawal), ADR-0014 (Plans et Plan Features), ADR-0016 (Coaching Session payée au webhook, coachs payés hors plateforme), ADR-0071 (Withdrawal remboursé automatiquement par Stripe), ADR-0074 (Order, Immediate Performance Request, prorata), `docs/ops/hosting.md` et `docs/privacy/register.md` (vidéos d'aide sur Scaleway, #568, #735).
- Ce document ne tranche pas le droit : la qualification TVA, le statut de place de marché, le DSA et le médiateur vont à #849 et à un avocat ou un expert-comptable.

Sources principales (toutes lues le 2026-11-06) :

| Sujet | URL |
|---|---|
| Maven, frais | https://cartmango.com/maven-alternatives/ , https://skillscouter.com/maven-review/ [tiers] |
| Maven, garantie | https://help.maven.com/en/articles/8705540-maven-s-satisfaction-guarantee [officiel] |
| Udemy, partage des revenus | https://support.udemy.com/hc/articles/229605008-Instructor-revenue-share [officiel], https://teach.udemy.com/enabling-investment-subscription-terms-update/ [officiel] |
| Udemy, remboursement | https://support.udemy.com/hc/articles/229604248-Refund-a-Course [officiel] |
| Teachable | https://schoolmaker.com/blog/teachable-pricing , https://www.learningrevolution.net/teachable-pricing/ [tiers] |
| Podia | https://sellfy.com/blog/podia-pricing/ , https://schoolmaker.com/blog/podia-pricing [tiers] |
| Kajabi | https://www.uscreen.tv/blog/kajabi-pricing/ , https://checkoutpage.com/blog/kajabi-pricing [tiers] |
| Malt | https://help.malt.com/hc/en-150/articles/29539691425938-Fees-at-Malt , https://help.malt.com/hc/en-150/articles/29567589850002-What-are-Malt-service-fees-and-offers [officiel] |
| LinkedIn Learning | https://business.linkedin.com/learn/instructor-hub [officiel, sans chiffres], https://www.gamsgo.com/fr/blog/linkedin-premium-prix [tiers] |
| Livestorm | https://livestorm.co/on-demand , https://livestorm.co/features [officiel], https://costbench.com/software/webinar-software/livestorm/ , https://www.hackceleration.com/labs/livestorm-pricing [tiers] |
| Stripe Connect, types de comptes | https://docs.stripe.com/connect/accounts , https://docs.stripe.com/connect/migrate-to-controller-properties.md , https://docs.stripe.com/changelog/dahlia/2026-06-24/express-connected-accounts-v1-stripe-owned-pricing-negative-balance-liability [officiel] |
| Stripe Connect, tarifs | https://stripe.com/fr-us/connect/pricing [officiel, en USD] |
| Stripe, tarifs carte France | https://www.indy.fr/guide/comptabilite-en-ligne/commerce/stripe-comptabilite/frais-stripe/ , https://sellfy.com/fr/outils/calculateur-de-frais-stripe/ [tiers] |
| Stripe, remboursements et litiges en destination charges | https://stripe.com/docs/connect/destination-charges [officiel] |
| Stripe, factures pour le compte d'un compte connecté | https://docs.stripe.com/invoicing/connect , https://support.stripe.com/questions/sending-invoices-on-behalf-of-connected-accounts [officiel] |
| Stripe, place de marché en France | https://stripe.com/fr/resources/more/payment-solutions-marketplace-france [officiel], https://www.victorisavocat.com/blog/marketplace-encaissement-pour-compte-de-tiers [tiers] |
| DAC7 | https://stripe.com/fr/resources/more/dac7-ruling-france [officiel Stripe], https://blog.avocats.deloitte.fr/dac7-les-obligations-declaratives-des-operateurs-de-plateformes-precisees-par-decret-et-arrete-et-commentees-au-bofip/ [tiers] |
| TVA, plateformes et prestataire présumé | https://blog.avocats.deloitte.fr/affaire-fenix-international-limited-la-presomption-dopacite-de-certaines-plateformes-est-elle-conforme-a-la-directive-tva/ , https://sovos.com/fr/blog/tva/la-tva-a-lere-numerique-partie-iii-la-tva-et-leconomie-des-plateformes/ [tiers] |
| TVA, événements virtuels (2025) | https://www.deloitte.com/be/en/services/tax/blogs/change-in-place-of-supply-rules-for-live-virtual-events.html , https://www.vatupdate.com/2025/01/11/understanding-the-new-eu-vat-rules-for-virtual-events-compliance-challenges-and-implications [tiers] |
| TVA, franchise en base 2026 | https://www.portail-autoentrepreneur.fr/academie/statut-auto-entrepreneur/tva , https://www.legifiscal.fr/actualites-fiscales/4436-nouveaux-seuils-micro-entreprises-annee-2026.html [tiers] |
| Mux | https://www.mux.com/pricing/video , https://www.mux.com/docs/pricing/overview , https://docs.mux.com/guides/ensure-data-privacy-compliance [officiel], https://apiscout.dev/blog/mux-vs-cloudflare-stream-api-2026 [tiers] |
| Bunny Stream | https://docs.bunny.net/stream/pricing , https://docs.bunny.net/stream/drm.md , https://bunny.net/gdpr/ [officiel], https://www.bitdoze.com/bunny-net-review/ [tiers] |
| Scaleway | https://www.scaleway.com/en/docs/edge-services/reference-content/understanding-pricing/ , https://www.scaleway.com/en/docs/tutorials/encode-videos-using-serverless-jobs/ [officiel] |

## 1. Benchmark des plateformes

Deux familles très différentes : les **places de marché** (Maven, Udemy, Malt, LinkedIn Learning dans une moindre mesure), où la plateforme apporte l'audience, encaisse et reverse ; et les **logiciels en marque blanche** (Teachable, Podia, Kajabi, Livestorm), où l'expert est le vendeur et paie un abonnement. Jobbbox ressemble à la première famille : l'audience (les Candidates) est la sienne.

| Plateforme | Modèle | Catalogue et page de cours | Live / replay / cohorte | Prix public typique | Commission ou coût pour l'expert | Avis | Modération, remboursement |
|---|---|---|---|---|---|---|---|
| **Maven** | Place de marché de cours en cohorte | Catalogue public ; inscription au catalogue après 100 inscrits en liste d'attente ou 2 ventes [tiers] | Cohortes live (2 à 6 semaines, 1 à 3 séances par semaine), séances enregistrées pour les absents [tiers] | Cohorte 800 à 2 450 $, atelier 200 à 1 000 $, minimum 200 $ [tiers] | **10 %** par inscription payante, frais Stripe en sus ; 25 % avec services additionnels (une seule source) [tiers] | Oui, sur la page de cours [tiers] | « Satisfaction Guarantee » de Maven sur la page, remboursement dans une fenêtre propre au cours, refus possible en cas d'abus [officiel] |
| **Udemy** | Place de marché de cours enregistrés + abonnement | Catalogue massif, contrôle qualité jugé léger [tiers] | Replay seulement (vidéo à la demande) | Prix bas, promotions permanentes [tiers] | L'instructeur garde **37 %** d'une vente organique, **97 %** d'une vente par son coupon ou son lien ; abonnement : pool de **15 %** du revenu en 2026, réparti aux minutes vues [officiel] | Notes et avis des étudiants | Remboursement **30 jours** ; l'instructeur est payé après ces 30 jours [officiel] |
| **Teachable** | Marque blanche (l'expert vend) | Pas de catalogue commun | Replay ; live par outil tiers | Fixé par l'expert | Abonnement 39 $ (Starter, **7,5 %** par vente), 89 $ (Builder), 189 $ (Growth), 0 % au-delà de Starter ; frais de paiement en sus [tiers] | Au choix de l'expert | Politique de l'expert |
| **Podia** | Marque blanche | Pas de catalogue commun | Cours, téléchargements, webinaires (non confirmé) | Fixé par l'expert | Mover (**5 %** par vente), Shaker et Earthquaker (0 %) ; prix mensuels contradictoires (33 à 49 $ pour Mover, 75 à 99 $ pour Shaker) [tiers] | Au choix | Politique de l'expert |
| **Kajabi** | Marque blanche | Pas de catalogue commun | Cours, communauté, live par outil tiers | Fixé par l'expert | 179 $ (Basic), 249 $ (Growth), 499 $ (Pro) par mois, sans commission ; +0,5 à 2 % si paiement hors Kajabi Payments ; Kickstarter (89 $) retiré en 2026 [tiers] | Au choix | Politique de l'expert |
| **Malt** | Place de marché de freelances (missions, pas de cours) | Profils publics, recherche | Sans objet | TJM du freelance | Freelance : **10 % HT**, 5 % après 6 mois de relation, 2 % pour un client qu'il amène ; client : 10 % (Starter) ou 15 % (Advanced) de frais de service, TVA 20 % sur ces frais [officiel] | Recommandations et avis clients | Malt facture et encaisse ; facturation pour le compte du freelance par mandat [non vérifié] |
| **LinkedIn Learning** | Catalogue produit et choisi par LinkedIn, inclus dans l'abonnement | Catalogue éditorialisé | Replay seulement | Inclus dans Premium Career (environ 30 € HT par mois, chiffres contradictoires) [tiers] | Instructeurs sous contrat : forfait et/ou redevances, rien de public [tiers] | Avis | Contenu produit et validé par LinkedIn |
| **Livestorm** | Outil de webinaire (pas une place de marché) | Page d'inscription par événement | Live, replay publié sur une page « on demand » derrière inscription, vidéo préenregistrée possible [officiel] | Sans objet | Gratuit (30 participants, 20 min) ; Pro autour de 99 à 105 € ou $ par mois, facturé aux « contacts actifs » sur 12 mois ; Business sur devis ou ~149 $ [tiers, contradictoires] | Sans objet | Paiement des inscriptions : aucune intégration Stripe trouvée [non vérifié] |

Ce qu'on en retient pour Jobbbox :

- **Les places de marché prennent de 10 % (Maven, Malt) à 63 % (Udemy en vente organique)** ; plus la plateforme apporte l'audience et porte le risque (remboursements, TVA), plus elle prend.
- **Le replay seul se vend mal cher** (Udemy) ; le live en cohorte se vend cher (Maven) mais demande l'agenda du coach.
- **Tous remboursent dans une fenêtre** et ne paient l'expert qu'après (Udemy : 30 jours). Jobbbox a déjà la Withdrawal de 14 jours (ADR-0071) : payer le Human Coach après la Withdrawal period évite de lui reprendre de l'argent.
- **Les avis sont partout**, mais pour Jobbbox ils relèvent de L111-7-2 du Code de la consommation et de la modération (fog de #841, à traiter par #849).
- **L'inclusion dans l'abonnement** (LinkedIn Learning, l'abonnement Udemy) se paie par un pool réparti aux minutes vues : lourd à calculer et peu lisible pour l'expert.

## 2. Paiement et reversement

### 2.1 Qui vend : la plateforme ou le coach ?

| Option | Qui est le vendeur pour le Candidate | Ce que Jobbbox encaisse | Paiement du coach | Conséquences |
|---|---|---|---|---|
| **A. Jobbbox revendeur** (« compte de la plateforme vendeur ») | Jobbbox, en son nom | Le prix entier, sur son compte Stripe actuel (comme la Coaching Session, ADR-0016) | Une redevance que Jobbbox doit au coach, son fournisseur | Pas d'encaissement pour compte de tiers (pas de question de statut de paiement) ; Order, CGV, Withdrawal et Order Confirmation réutilisés tels quels ; Jobbbox porte la TVA et le risque du remboursement |
| **B. Place de marché, coach vendeur** | Le Human Coach, Jobbbox intermédiaire | Une commission | Le coach reçoit le prix moins la commission | Encaissement pour le compte du coach : il faut un prestataire de paiement agréé (Stripe Connect) [officiel] ; CGV du coach, obligations de place de marché (L111-7, DSA), DAC7 ; mais voir la TVA en 2.4 : pour un replay, Jobbbox est de toute façon réputé vendeur |

Stripe rappelle qu'en France une place de marché qui encaisse sur son propre compte l'argent dû à des tiers fait de l'encaissement pour compte de tiers, réservé aux prestataires agréés, sauf exemption ou statut d'agent ; d'où le recours à un prestataire déjà agréé comme Stripe Connect (stripe.com/fr/resources/more/payment-solutions-marketplace-france [officiel], victorisavocat.com [tiers]).

### 2.2 Stripe Connect : Express ou Custom

Stripe ne recommande plus de choisir un « type » (Standard, Express, Custom) pour une nouvelle intégration, mais de décrire le compte connecté par ses **propriétés de contrôle** (`controller`) : qui fixe les frais, qui porte les pertes, qui collecte le KYC, quel tableau de bord a le coach [officiel, docs.stripe.com/connect/accounts].

| | Express (ou équivalent : tableau de bord Express, onboarding hébergé par Stripe) | Custom (ou équivalent : aucun tableau de bord Stripe) |
|---|---|---|
| Onboarding et KYC du coach | Hébergé par Stripe ; Stripe collecte et vérifie l'identité [officiel] | Écrans à construire (ou composants intégrés), la plateforme collecte, Stripe vérifie [officiel] |
| Tableau de bord du coach | Express Dashboard Stripe (virements, solde, informations fiscales) | Rien : tout à construire dans l'Espace coach |
| Soldes négatifs (remboursement ou litige après virement) | Depuis le 24 juin 2026, un compte Express peut avoir `losses.payments = stripe` : Stripe absorbe la perte [officiel, changelog 2026-06-24] ; sinon la plateforme | La plateforme en est responsable [officiel] |
| Coût de développement | Faible | Élevé |
| Adapté à 10 coachs | **Oui** | Non |

Tarifs Connect (page USD, faute d'avoir pu ouvrir la page FR) : quand la plateforme fixe les frais, **2 $ par compte actif et par mois, et 0,25 % + 0,25 $ par virement** ; quand Stripe les fixe, rien pour la plateforme [officiel, stripe.com/fr-us/connect/pricing]. En euros : environ **2 € par compte actif et 0,25 % + 0,10 € par virement** [non vérifié, de mémoire]. Un compte est « actif » le mois où il reçoit un virement [tiers, sharetribe].

Frais de carte en France : **1,5 % + 0,25 €** pour une carte standard de l'EEE ; cartes premium 1,9 % ou 2,8 % + 0,25 € et internationales 3,15 % ou 3,25 % + 0,25 € (sources contradictoires) ; **litige : 20 €** [tiers, Indy, Sellfy]. Un remboursement ne rend pas les frais de la carte [non vérifié].

Mécanismes de charge utiles :

- **Charges et virements séparés** (*separate charges and transfers*) : Jobbbox encaisse sur son compte, puis vire la part du coach quand il le décide (par exemple après la Withdrawal period). Va avec l'option A. Jobbbox est le marchand et porte litiges et remboursements [non vérifié pour ce mécanisme précis ; principe officiel pour les destination charges].
- **Destination charges** : la part du coach part avec le paiement. Un remboursement laisse par défaut l'argent au coach et le solde négatif à la plateforme ; `reverse_transfer` le reprend au coach, en proportion si le remboursement est partiel ; les litiges sont débités de la plateforme, avec ou sans `on_behalf_of` [officiel, stripe.com/docs/connect/destination-charges].
- **Direct charges** : le coach est le marchand (option B pure). Contraire à la présomption de TVA du replay (2.4).

### 2.3 Factures émises pour le compte du coach

- **Stripe Invoicing pour un compte connecté** : `on_behalf_of` (ou `issuer`) met le nom, les coordonnées et le numéro de TVA du compte connecté sur la facture, le PDF, la page hébergée et le reçu ; seulement par l'API, avant finalisation ; pas d'écran dans le Dashboard [officiel]. Cela vise une facture **au Candidate** au nom du coach (option B).
- **Ce dont l'option A a besoin est autre chose** : la facture du coach **à Jobbbox** pour sa redevance. Pour 10 coachs souvent micro-entrepreneurs, le plus simple est l'**autofacturation** (mandat de facturation, CGI art. 289 I-2) : Jobbbox émet chaque mois, au nom et pour le compte du coach, le relevé de ses ventes valant facture (« TVA non applicable, art. 293 B du CGI » pour un coach en franchise). Stripe ne le fait pas : c'est un document à générer par Jobbbox [non vérifié, à valider par un expert-comptable].
- **Facturation électronique** : réception obligatoire pour toutes les entreprises depuis le 1er septembre 2026, émission pour les PME et micro-entreprises au 1er septembre 2027 ; une facture d'autofacturation devra alors passer par une plateforme agréée [non vérifié dans cette recherche ; à confirmer].

### 2.4 TVA

Constats (à faire valider par un expert-comptable, #849) :

| Cas | Qualification probable | Qui doit la TVA au Candidate | Lieu |
|---|---|---|---|
| **Replay** (vidéo enregistrée, sans intervention humaine) | Service fourni par voie électronique (enseignement à distance automatisé : règl. 282/2011 art. 7 et annexe II) [non vérifié dans le texte] | **Jobbbox**, réputé agir en son nom propre : présomption de l'art. 9 bis du règl. 282/2011, irréfragable quand la plateforme autorise le paiement ou fixe les conditions générales [tiers, Deloitte ; détail non vérifié] | Résidence du Candidate (France 20 % ; autre pays de l'UE via le guichet OSS) |
| **Live** (masterclass en direct avec échanges) | Pas un service électronique ; « événement virtuel » : depuis le 1er janvier 2025, en B2C, imposé là où réside le participant (directive 2022/542, art. 54 modifié) [tiers] | Le vendeur ; si Jobbbox vend en son nom (option A), Jobbbox (commissionnaire, CGI art. 256 V) [non vérifié] | Résidence du Candidate |
| **Exonération formation** | Possible pour la formation professionnelle continue (CGI art. 261-4-4° a) sous conditions (déclaration d'activité) [tiers, non vérifié] | Ni Jobbbox ni la plupart des coachs n'y sont aujourd'hui | — |

Conséquences :

- **Le coach en franchise en base ne change pas la TVA payée par le Candidate** : Jobbbox, réputé vendeur, facture 20 % sur le prix entier ; le coach facture Jobbbox sans TVA. Sur 49 € TTC, Jobbbox a 40,83 € HT à partager.
- Seuils de franchise en base 2026 pour les services : **37 500 €**, seuil majoré **41 250 €** ; le seuil unique de 25 000 € envisagé n'est pas entré en vigueur selon les sources trouvées [tiers]. Un coach qui les dépasse facture à Jobbbox avec TVA, que Jobbbox récupère.
- L'option B ne déplace donc pas la TVA d'un replay vers le coach. C'est un argument fort pour l'option A.
- **DAC7** : un opérateur de plateforme déclare chaque année (avant le 31 janvier) les vendeurs de « services personnels » qu'il met en relation, dès la première opération [tiers]. Un replay n'est probablement pas un service personnel ; un live ou une Coaching Session pourrait l'être. À qualifier (#849).

### 2.5 Remboursements, Withdrawal et litiges

- **Withdrawal** : ADR-0071 rembourse automatiquement par Stripe. Une masterclass vendue par Jobbbox (option A) réutilise ce mécanisme sans Connect. En option B, chaque remboursement doit aussi reprendre la part du coach (`reverse_transfer`), ce qui peut échouer si son solde est vide [tiers].
- **Exceptions au droit de rétractation à vérifier par l'avocat** : un replay est un contenu numérique sans support matériel (L221-28 13°) : la Withdrawal se perd une fois l'accès commencé avec l'accord exprès du Candidate, ce qui correspond à l'Immediate Performance Request (ADR-0074) ; un live à date fixe n'entre pas évidemment dans l'exception des « activités de loisirs à date déterminée » (L221-28 12°) [non vérifié].
- **Payer le coach après la Withdrawal period** (14 jours, plus le report L221-19) : comme Udemy après ses 30 jours, Jobbbox ne vire rien qu'il pourrait devoir reprendre. Les litiges arrivent plus tard (jusqu'à 120 jours [non vérifié]) : Jobbbox les porte (20 € l'unité) et peut les retenir sur un relevé suivant, à écrire dans le contrat du coach.

## 3. Accès selon le Plan

| Option | Comment | Ce que ça change aux Plans (ADR-0014) | Partage avec le coach |
|---|---|---|---|
| **Achat à l'unité** | Une Order par masterclass, comme la Coaching Session | Rien | Simple : part du prix HT de chaque vente |
| **Remise par Plan Feature** | Un deuxième Plan Feature « remise masterclass », sur le modèle de la remise sur la Coaching Session Price (prix normal et prix remisé) | Un Plan Feature de plus, dans le jeu fixe en code ; l'enlever d'un Plan payé est une Quota Reduction (préavis de 30 jours, résiliation sans frais) | Simple : part du prix remisé payé, ou du prix normal si Jobbbox absorbe la remise |
| **Inclus dans un Plan** | Un Plan Feature « masterclasses incluses » (ou un Plan Quota « masterclasses par semaine » si c'est un nombre) | Le Plan change de valeur et de prix ; enlever l'inclusion plus tard est une Quota Reduction ; à décider avant de vendre un Plan qui l'inclut | Difficile : un pool réparti aux minutes vues (comme l'abonnement Udemy, 15 %) ou un forfait par coach |
| **Mixte** | Replays inclus dans un Plan, lives à l'unité avec remise | Les deux | Les deux |

Points d'attention :

- Les **Coupons** ne s'appliquent pas aux Coaching Sessions (CONTEXT, Coupon) ; il faudra dire s'ils s'appliquent aux masterclasses.
- Une masterclass payée ne compte pas dans la Paid Plan History, comme une Coaching Session (CONTEXT).
- Inclure tôt les masterclasses dans un Plan engage : on ne peut plus les retirer sans Quota Reduction. Mieux vaut commencer à l'unité et décider de l'inclusion avec des chiffres de vente.

## 4. Diffusion

### 4.1 Live

| Option | Ce que c'est | Coût | Remarques |
|---|---|---|---|
| **Fournisseur visio de #845 en mode webinaire** | Le même fournisseur que la Coaching Session, en salle à plusieurs | Selon #845 | Un seul fournisseur, une seule intégration, un seul sous-traitant au registre ; à condition qu'il gère 30 à 100 participants, la modération des micros et l'enregistrement |
| **Livestorm** | Outil de webinaire français : inscription, live, replay « on demand » derrière inscription, vidéo préenregistrée [officiel] | Pro ~99 à 105 par mois, facturé aux contacts actifs sur 12 mois [tiers] | Pas d'intégration de paiement trouvée : l'accès devrait venir de Jobbbox (lien par participant) ; un sous-traitant de plus |
| **Mux Live** | Diffusion d'un flux à sens unique (le coach émet en RTMP, le player diffuse) | Entrée ~0,025 $/min, diffusion ~0,0008 $/min [tiers, non vérifié] | Pas d'interaction : chat et questions à construire ; plutôt pour un grand public |

### 4.2 Replay

| | **Mux** | **Bunny Stream** | **Scaleway** (déjà hôte des vidéos d'aide, #568/#735) |
|---|---|---|---|
| Société, hébergement | États-Unis ; Mux Data a un point de collecte UE, lieu de stockage des vidéos non trouvé ; DPA sur demande [officiel] | Slovénie (UE), stockage par région (Francfort par défaut) [officiel] | France, Object Storage `fr-par` [dépôt] |
| Encodage | Qualité « basic » gratuite [officiel] | Inclus ; encodage premium ~0,05 $/min [tiers] | À construire : FFmpeg en Serverless Jobs (tutoriel officiel) [officiel] |
| Stockage | À partir de **0,0024 $/min/mois** (720p) [officiel] | **0,01 $/Go** par région, 0,005 $ à partir de la 3e [officiel] | Object Storage, prix non trouvé [non vérifié] |
| Diffusion | **100 000 min/mois gratuites**, puis à partir de **0,0008 $/min** [officiel] | **0,01 $/Go** en Europe et Amérique du Nord [officiel] | Edge Services par abonnement (Starter, Professional, Advanced), Go au-delà facturés ; prix non trouvés [officiel, sans chiffres] |
| Sous-titres | Automatiques **gratuits** à la demande, 22 langues [officiel] | Transcription ~0,10 $/min [officiel, exemple] | À faire nous-mêmes (comme les VTT des motions) |
| Accès protégé, DRM | URLs signées ; DRM « media-grade » **100 $/mois + 0,003 $/lecture** [officiel] | MediaCage Basic inclus [tiers] ; Enterprise **99 $/mois** + 0,005 $/licence [officiel] | Fichiers publics aujourd'hui (`public-read`) ; URLs présignées S3 possibles, pas de DRM [non vérifié] |
| Player | Mux Player | Player Bunny | À intégrer (HLS) |
| Travail pour Jobbbox | Faible | Faible | Élevé (encodage, HLS, player, protection) |

Sous-titres : des sous-titres générés automatiquement par l'hébergeur traitent la voix du coach chez un tiers : à inscrire au registre (`docs/privacy/register.md`) et à vérifier contre les voies d'IA d'ADR-0007. Les sous-titres sont aussi attendus par le plancher d'accessibilité (ADR-0009).

« DRM léger, téléchargement interdit » : aucune solution n'empêche une capture d'écran. Des URLs signées à courte durée, un player sans bouton de téléchargement et un filigrane avec l'adresse du Candidate suffisent probablement ; le DRM complet coûte ~100 $/mois chez Mux comme chez Bunny, disproportionné à cette taille.

## 5. Volumes et coûts : 10 coachs, 50 masterclasses

Hypothèses [non vérifiées, à remplacer par celles du product owner] : 50 masterclasses d'une heure en 1080p (3 000 minutes, ~2 Go par heure avec les rendus, soit ~100 Go) ; 30 acheteurs par masterclass et par an, 1,5 visionnage complet chacun, soit ~135 000 minutes vues par an, **~11 250 minutes par mois** (~190 Go) ; un live par coach et par mois (10 lives de 60 minutes, 30 participants) ; prix **49 € TTC**.

| Poste | Mux | Bunny Stream | Scaleway |
|---|---|---|---|
| Stockage | 3 000 min × 0,0024 à 0,003 $ ≈ **7 à 9 $/mois** | 100 Go × 0,02 $ (2 régions) ≈ **2 $/mois** | Non chiffré |
| Diffusion | 11 250 min < 100 000 gratuites ≈ **0 $** | 190 Go × 0,01 $ ≈ **2 $/mois** | Abonnement Edge Services, non chiffré |
| Sous-titres | **0 $** | 3 000 min × 0,10 $ ≈ **300 $ une fois** | Notre pipeline |
| DRM complet (si voulu) | +100 $/mois | +99 $/mois | — |
| **Total sans DRM** | **~10 $/mois** | **~4 $/mois + 300 $ une fois** | inconnu + développement |

| Poste | Montant |
|---|---|
| Ventes par an | 50 × 30 × 49 € = **73 500 € TTC**, soit 61 250 € HT |
| Frais de carte (1,5 % + 0,25 €) | ~1 100 € + 375 € ≈ **1 480 €/an** |
| Connect (si la plateforme fixe les frais) | 10 coachs × 2 € × 12 = **240 €/an**, plus 0,25 % + 0,10 € par virement mensuel (~170 €/an) [non vérifié en euros] |
| Live par Livestorm (si retenu) | ~1 200 à 1 300 €/an [tiers] |
| Hébergement replay (Mux) | ~120 $/an |

Ordres de grandeur : à cette taille, **la vidéo coûte moins que les frais de carte**, et ni le stockage ni la diffusion ne pèsent dans la décision. Ce qui pèse : le développement, le nombre de sous-traitants au registre et la TVA (8,17 € sur 49 €).

Exemple de partage sur 49 € TTC à 30 % pour Jobbbox : 40,83 € HT ; coach 28,58 € ; Jobbbox 12,25 € moins ~1 € de frais de carte. À 10 % (Maven, Malt) : coach 36,75 €.

## 6. Recommandation

1. **Jobbbox vend la masterclass en son nom (option A)**, sur son compte Stripe actuel, avec l'Order, les CGV, l'Immediate Performance Request, l'Order Confirmation et la Withdrawal existantes. Pour un replay, la TVA désigne de toute façon Jobbbox comme vendeur ; vendre en son nom évite l'encaissement pour compte de tiers et garde un seul parcours d'achat.
2. **Reverser aux coachs par Stripe Connect, compte de type Express** (onboarding et KYC par Stripe, Express Dashboard, `losses.payments = stripe` si disponible pour un compte français), en **charges et virements séparés** : un virement mensuel des ventes dont la Withdrawal period est close. Ce serait le premier paiement de coach par la plateforme : il remplace « coaches are paid outside the platform » d'ADR-0016, à poser dans un nouvel ADR. Custom est disproportionné pour 10 coachs.
3. **Autofacturation** : Jobbbox émet chaque mois le relevé valant facture du coach, sous mandat, avec la mention de franchise quand elle s'applique ; à valider par un expert-comptable, avec la facturation électronique de 2027.
4. **Commencer à l'unité, avec une remise par Plan Feature** sur le modèle de la Coaching Session Price ; ne pas inclure les masterclasses dans un Plan avant d'avoir des ventes (une inclusion retirée devient une Quota Reduction).
5. **Live par le fournisseur choisi à #845** s'il tient un webinaire à 30 à 100 participants avec enregistrement ; sinon Livestorm.
6. **Replay sur Mux** pour démarrer (encodage, player, URLs signées et sous-titres gratuits, coût ~10 $/mois), **Bunny Stream** si l'hébergement dans l'UE est exigé (société et stockage européens, ~4 $/mois). Garder Scaleway pour les vidéos d'aide publiques : y héberger des vidéos payantes demande de construire encodage, player et protection. Pas de DRM complet : URLs signées, pas de téléchargement, filigrane.
7. **Commission à décider** entre 10 % (Maven, Malt : le coach apporte son audience) et 30 % ou plus (Jobbbox apporte les Candidates, porte TVA, remboursements et litiges) ; Udemy prend 63 % en vente organique.

## 7. Questions ouvertes pour le product owner

1. Commission de Jobbbox : un taux unique, ou réduit quand le coach amène ses acheteurs (lien ou code, comme Udemy 97 % ou Malt 2 %) ?
2. Replays seulement, lives seulement, ou les deux ? Le live est-il toujours enregistré et vendu en replay ensuite ?
3. Prix fixé par le coach (dans une fourchette) ou par Jobbbox, comme la Coaching Session Price ?
4. Inclure un jour des masterclasses dans un Plan ? Si oui, comment payer le coach (pool aux minutes vues ou forfait) ?
5. Hébergement des vidéos dans l'UE exigé (Bunny Stream) ou un sous-traitant américain sous DPA acceptable (Mux) ?
6. Les Coupons s'appliquent-ils aux masterclasses ?
7. Qui modère le contenu avant publication (relecture par l'équipe, comme LinkedIn Learning, ou publication libre, comme Udemy) ? Et les avis des Candidates (fog de #841) ?
8. Statut attendu des coachs : micro-entrepreneurs en franchise, sociétés, ou les deux ? Acceptent-ils un mandat d'autofacturation ?
9. À confirmer par l'expert-comptable ou l'avocat (#849) : la présomption de l'art. 9 bis pour le replay, la qualification du live (événement virtuel, commission), l'exonération formation, DAC7, les exceptions L221-28 12° et 13°.
10. À confirmer sur les pages officielles une fois `stripe.com` et `mux.com` ouverts au réseau de la session : tarifs Connect en euros, délai et rythme des virements Express en France, prix Mux du live, prix Livestorm, prix Scaleway Object Storage et Edge Services.
