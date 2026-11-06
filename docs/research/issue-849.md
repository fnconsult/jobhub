# Recherche pour l'issue #849 : CGV d'une marketplace à vendeurs tiers, DSA, place de marché en ligne et médiateur

Rédigé le 2026-11-06 sur `main` (`7563b35f`). Carte : #841. Liens : #518 (contrat B2B avec les Human Coaches), #515 (médiateur), #507 (circuit de relecture), `docs/research/issue-496.md` (branche `research/issue-496`), ADR-0071 et ADR-0074.

**Ceci n'est pas un avis juridique.** C'est une première passe de conformité, dans le format d'un `/legal:compliance-check`. Chaque position ci-dessous passe par la Legal Review (#507) avant d'entrer dans un Legal Text ou dans un contrat ; celles qui touchent un déclencheur de juriste sont marquées **Juriste**.

**Limite de vérification.** Pendant cette recherche, Légifrance, EUR-Lex, le BOFiP et le site du Centre Inffo n'étaient pas joignables en direct depuis la session (réseau limité). Les textes ont été lus par des extraits de recherche, des pages officielles relayées et la connaissance des textes ; les numéros d'alinéa et les seuils marqués « à vérifier » doivent être relus sur la version en vigueur avant la Legal Review. Les liens sont ceux des textes officiels.

## Question

Si des Human Coaches vendent leurs masterclasses sur Jobbbox, qu'impose le droit à Jobbbox, et que change-t-il au modèle actuel, où Jobbbox est le vendeur de la Coaching Session et le Human Coach son prestataire (#518) ?

## Réponse courte

1. **La qualification se décide par les faits, pas par l'étiquette.** Qui fixe le prix, au nom de qui la vente est conclue, qui encaisse, qui définit le contenu et qui répond de l'exécution : c'est ce faisceau que regarderont la DGCCRF, le juge et l'administration fiscale. Aujourd'hui, pour la Coaching Session, tous les indices désignent Jobbbox comme vendeur (prix unique, encaissement Stripe au nom de Jobbbox, CGV de Jobbbox, Withdrawal remboursé par Jobbbox). Une masterclass dont le Human Coach fixe le prix et le contenu, vendue à son nom, fait de Jobbbox un **opérateur de place de marché en ligne** (C. conso. L111-7 I 2°, article liminaire).
2. **Les deux modèles peuvent coexister**, à condition que le Candidate sache, à chaque Order, avec qui il contracte. Le mélange non signalé est le pire cas : le Candidate croit acheter à Jobbbox, et Jobbbox perd le bénéfice du régime d'hébergeur (DSA art. 6 § 3) tout en n'ayant pas les CGV d'un vendeur.
3. **Le DSA s'applique dans les deux cas dès que des Human Coaches publient eux-mêmes des contenus** (fiche, description, replay) : notice and action (art. 16) et motivation des décisions (art. 17) valent pour tout hébergeur, micro-entreprise comprise. L'exemption des micro et petites entreprises (art. 19 et 29) écarte en revanche la section 3 (sauf art. 24 § 3), donc l'art. 25 sur les interfaces, et la section 4, donc la traçabilité des professionnels de l'art. 30. Le droit de la consommation français (L111-7, pratiques commerciales trompeuses) et les obligations fiscales imposent à peu près la même chose de toute façon.
4. **En marketplace, le Human Coach devient le professionnel du contrat de consommation** : c'est lui qui doit le droit de rétractation, l'information précontractuelle et **son propre médiateur** (L612-1). Le médiateur de Jobbbox (#515) ne couvre que les contrats de Jobbbox, sauf convention élargie.
5. **Deux risques de fond dépassent les CGV** et doivent être tranchés avant le grilling #851 : la responsabilité sociale des plateformes (C. trav. L7341-1, L7342-1), qui vise précisément la plateforme qui « fixe le prix » d'un indépendant, et le droit de la formation professionnelle (C. trav. L6313-1, L6353-3 à L6353-7), si une masterclass est une « action de formation » vendue à un particulier.

## Sources

**Code de la consommation (Légifrance)** — sommaire du code : https://www.legifrance.gouv.fr/codes/texte_lc/LEGITEXT000006069565
- L111-7 (opérateur de plateforme, place de marché) : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000049571125
- L111-7-2 (avis en ligne) : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000049571119
- D111-7 et D111-8 (rubriques référencement, classement, qualité de l'offreur ; D111-8 modifié par le décret n° 2024-753, à vérifier) : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000049914996
- Décret n° 2017-1434 du 29 septembre 2017 (D111-6 à D111-11, obligations d'information des plateformes) : https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000035720908 (à vérifier)
- Décret n° 2017-1436 du 29 septembre 2017 (D111-16 à D111-19, avis en ligne) : https://www.legifrance.gouv.fr/jorf/id/JORFARTI000035720943
- L221-5 (information précontractuelle) : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000044563141
- L221-18 à L221-28 (section « Droit de rétractation ») : https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000006069565/LEGISCTA000032221365/
- L221-21 (« Renoncer au contrat ici ») : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000044563193 ; D221-5 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000053303365
- L221-28 (exceptions, dont 1°, 12° et 13°) : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000044563170
- L612-1 (droit à la médiation) et L611-1 à L616-3 : https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000006069565/LEGISCTA000031618632/ (section à vérifier) ; L616-1 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000032224762 ; R616-1 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000032808378
- Ordonnance n° 2021-1734 du 22 décembre 2021 (transposition de la directive « Omnibus » 2019/2161) : https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000044546235 (à vérifier)

**Droit de l'Union (EUR-Lex)**
- Règlement (UE) 2022/2065 (DSA), art. 3, 6, 11 à 19, 24, 25, 29 à 32 : https://eur-lex.europa.eu/eli/reg/2022/2065/oj
- Recommandation 2003/361/CE (définition des micro et petites entreprises) : https://eur-lex.europa.eu/eli/reco/2003/361/oj
- Règlement (UE) 2019/1150 (P2B, relations plateformes-entreprises utilisatrices) : https://eur-lex.europa.eu/eli/reg/2019/1150/oj
- Directive 2011/83/UE (droits des consommateurs), art. 6 bis et 16 : https://eur-lex.europa.eu/eli/dir/2011/83/oj
- Directive (UE) 2019/2161 (« Omnibus ») : https://eur-lex.europa.eu/eli/dir/2019/2161/oj
- Directive (UE) 2021/514 (DAC7) : https://eur-lex.europa.eu/eli/dir/2021/514/oj
- Règlement d'exécution (UE) 282/2011 (TVA), art. 7 et 9 bis : https://eur-lex.europa.eu/eli/reg_impl/2011/282/oj
- RGPD (UE) 2016/679 : https://eur-lex.europa.eu/eli/reg/2016/679/oj

**CJUE**
- C-96/21, *CTS Eventim*, 31 mars 2022 (activités de loisirs à date déterminée, vente par un intermédiaire) : https://curia.europa.eu/juris/liste.jsf?num=C-96/21
- C-324/09, *L'Oréal c. eBay*, 12 juillet 2011 (rôle actif de l'exploitant d'une place de marché) : https://curia.europa.eu/juris/liste.jsf?num=C-324/09
- C-695/20, *Fenix International* (validité de la présomption de l'art. 9 bis du règlement 282/2011) : https://curia.europa.eu/juris/liste.jsf?num=C-695/20
- C-492/23, *Russmedia Digital* (exploitant d'une place de marché et RGPD pour les annonces publiées par des tiers ; à relire) : https://curia.europa.eu/juris/liste.jsf?num=C-492/23

**Fiscal (impots.gouv, BOFiP, CGI)**
- CGI, sommaire : https://www.legifrance.gouv.fr/codes/texte_lc/LEGITEXT000006069577 (art. 242 bis, 1649 ter A à 1649 ter E)
- BOFiP BOI-INT-AEA-30 (DAC7, obligations déclaratives des opérateurs de plateformes) : https://bofip.impots.gouv.fr/bofip/13742-PGP.html/identifiant=BOI-INT-AEA-30-20230111
- BOFiP BOI-INT-AEA-30-30-10 (diligences, vendeurs à déclarer) : https://bofip.impots.gouv.fr/bofip/13764-PGP.html/identifiant=BOI-INT-AEA-30-30-10-20230111
- BOFiP BOI-BIC-DECLA-30-70-40-20 (art. 242 bis, information des utilisateurs) : https://bofip.impots.gouv.fr/bofip/11791-PGP.html

**Code du travail (code.travail.gouv.fr, ministère du Travail)**
- L7341-1 : https://code.travail.gouv.fr/code-du-travail/l7341-1 ; L7342-1 : https://code.travail.gouv.fr/code-du-travail/l7342-1 ; D7342-1 : https://code.travail.gouv.fr/code-du-travail/d7342-1
- L8221-6 (présomption de non-salariat) : https://code.travail.gouv.fr/code-du-travail/l8221-6
- L6313-1 (actions de formation) : https://code.travail.gouv.fr/code-du-travail/l6313-1 ; L6313-4 (bilan de compétences) : https://code.travail.gouv.fr/code-du-travail/l6313-4 ; L6351-1 (déclaration d'activité) : https://code.travail.gouv.fr/code-du-travail/l6351-1
- L6353-3 à L6353-7 (contrat de formation conclu avec une personne physique à ses frais) : https://code.travail.gouv.fr/code-du-travail/l6353-3 , https://code.travail.gouv.fr/code-du-travail/l6353-5 , https://code.travail.gouv.fr/code-du-travail/l6353-6 , https://code.travail.gouv.fr/code-du-travail/l6353-7

**Propriété intellectuelle et image**
- Code de la propriété intellectuelle, sommaire : https://www.legifrance.gouv.fr/codes/texte_lc/LEGITEXT000006069414 (L111-1, L112-2 2°, L121-1, L131-1, L131-3)
- Code civil, art. 9 (vie privée, droit à l'image) : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006419288
- Code monétaire et financier, L314-1 (services de paiement) : https://www.legifrance.gouv.fr/codes/texte_lc/LEGITEXT000006072026

**Autorités**
- DGCCRF, nouvelles compétences sur les plateformes (loi SREN) : https://www.economie.gouv.fr/dgccrf/la-loi-sren-donne-de-nouvelles-competences-la-dgccrf-pour-reguler-les-plateformes-numeriques
- Arcom, DGCCRF, CNIL : convention de coopération pour le DSA (27 juin 2024) : https://arcom.fr/sites/default/files/2024-06/Convention-de-cooperation-pour-la-mise-en-oeuvre-du-reglement-sur-les-services-numeriques-entre-Arcom-DGCCRF-CNIL.pdf
- DGCCRF, la médiation de la consommation : https://www.economie.gouv.fr/dgccrf/les-fiches-pratiques/la-mediation-de-la-consommation-ce-que-vous-devez-savoir
- Médiation, obligations du professionnel : https://www.economie.gouv.fr/mediation-conso/vous-etes-un-professionnel/vos-principales-obligations
- INC, avis en ligne : https://www.inc-conso.fr/content/avis-en-ligne-ce-qui-change-au-1er-janvier-2018 ; informations par les plateformes : https://www.inc-conso.fr/content/informations-par-les-plateformes-en-ligne-ce-qui-change-au-1er-janvier-2018
- INC, tableau de l'ordonnance « Omnibus » : https://inc-conso.fr/sites/default/files/pdf/tableau-omnibus-inc-2022.pdf

**Secondaires (lus pour orienter, non cités comme règle)** : Stripe, DAC7 en France : https://stripe.com/fr/resources/more/dac7-ruling-france ; Deloitte Avocats sur DAC7 : https://blog.avocats.deloitte.fr/dac7-les-obligations-declaratives-des-operateurs-de-plateformes-precisees-par-decret-et-arrete-et-commentees-au-bofip/ ; Centre Inffo, rétractation et contrat de formation : https://www.centre-inffo.fr/site-droit-formation/actualites-droit/le-droit-de-retractation-et-le-contrat-de-formation-professionnelle ; Centre Inffo, responsabilité sociale des plateformes : https://www.centre-inffo.fr/site-droit-formation/actualites-droit/responsabilite-sociale-des-plateformes-de-mise-en-relation-publication-d-une

## 1. Qualification : vendeur ou opérateur de place de marché

### 1.1 Les textes

- **Opérateur de plateforme en ligne** (L111-7 I) : toute personne qui propose, à titre professionnel, un service de communication au public en ligne reposant sur le classement ou le référencement de contenus, biens ou services proposés par des tiers (1°), ou sur la mise en relation de plusieurs parties en vue de la vente d'un bien ou de la fourniture d'un service (2°). La « place de marché en ligne » est le service du 2° qui permet aux consommateurs de conclure des contrats à distance avec d'autres professionnels ou consommateurs (article liminaire, issu de l'ordonnance n° 2021-1734).
- **DSA** : un « service d'hébergement » stocke des informations fournies par un destinataire du service, à sa demande ; une « plateforme en ligne » est un hébergeur qui, en plus, diffuse ces informations au public (art. 3 g) iii et i)). Un Human Coach qui rédige sa fiche, décrit sa masterclass ou téléverse son replay est un destinataire du service.
- **DSA art. 6 § 3** : l'exemption de responsabilité de l'hébergeur ne joue pas, au regard du droit de la consommation, quand une plateforme qui permet de conclure des contrats à distance présente l'offre de façon à faire croire au consommateur moyen qu'elle est fournie par la plateforme elle-même ou par quelqu'un qui agit sous son autorité ou son contrôle. Même logique en jurisprudence : l'exploitant qui joue un « rôle actif » (optimisation, promotion des offres) perd la protection de l'hébergeur (CJUE C-324/09).

### 1.2 Les indices qui font pencher

| Indice | Vers « Jobbbox vendeur » | Vers « Jobbbox place de marché » |
|---|---|---|
| Prix | Fixé par Jobbbox (Coaching Session Price unique, ADR-0016) | Fixé par le Human Coach |
| Nom de la vente | Order, CGV et Order Confirmation au nom de Jobbbox | Le Human Coach nommé vendeur sur la page et dans l'Order |
| Encaissement | Stripe au nom de Jobbbox, le coach payé hors plateforme | Paiement pour le compte du coach (Stripe Connect), commission prélevée |
| Contenu | Défini, validé ou cadré par Jobbbox (Coaching Playbook, format) | Conçu librement par le coach, sous une simple charte |
| Remboursement, réclamation | Jobbbox rembourse et répond | Le coach répond, Jobbbox relaie |
| Accès dans un Plan | Masterclass incluse dans un Plan : Jobbbox vend le Plan | Masterclass vendue à l'unité par le coach |

Aujourd'hui, la Coaching Session est sans ambiguïté une vente de Jobbbox (#518, recherche #496 §7). Une masterclass « incluse dans le Plan » le serait aussi : le Candidate paie Jobbbox, pour un service que Jobbbox fournit avec un contenu licencié par le Human Coach. Seule la masterclass vendue à l'unité, au prix du coach, en son nom, est une vente sur place de marché.

### 1.3 Une troisième voie, à éviter sans le dire

Le **commissionnaire** (Jobbbox vend en son nom, pour le compte du coach, C. com. L132-1) est un vendeur aux yeux du Candidate : il porte les CGV, la rétractation et le médiateur comme dans le modèle vendeur, tout en ayant les obligations fiscales d'une plateforme. En TVA, c'est d'ailleurs la présomption pour un service fourni par voie électronique via une interface (règlement 282/2011, art. 9 bis, validé par CJUE C-695/20) : un replay vendu sur Jobbbox est réputé vendu par Jobbbox, sauf si le coach est expressément désigné comme prestataire dans les contrats **et** sur la facture, et que Jobbbox n'autorise ni le paiement ni la fourniture, ni n'en fixe les conditions générales. Point pour l'expert-comptable, pas pour les CGV.

## 2. Code de la consommation : ce que doit un opérateur de place de marché

### 2.1 Information loyale, claire et transparente (L111-7 II, D111-7, D111-8)

Dans une rubrique directement et aisément accessible depuis toutes les pages, sans connexion (D111-7, D111-8) :
- les conditions générales d'utilisation du service d'intermédiation ;
- les **modalités de référencement, de déréférencement et de classement** des offres : critères d'admission d'un Human Coach et d'une masterclass, paramètres principaux du classement du catalogue et leur importance relative ;
- l'existence d'une **relation contractuelle, d'un lien capitalistique ou d'une rémunération** qui influe sur le classement (mise en avant payée, commission différente) ; un résultat payé non signalé est en soi une pratique commerciale trompeuse depuis l'Omnibus (liste noire de L121-4, numéro à vérifier) ;
- la **qualité de l'offreur** : professionnel ou non, telle qu'il l'a déclarée (L111-7 II 3°) ; s'il ne l'est pas, que le droit de la consommation ne s'applique pas au contrat ; **comment les obligations liées au contrat se répartissent** entre le Human Coach et Jobbbox (directive 2011/83 art. 6 bis, issu de l'Omnibus) ;
- les droits et obligations des parties en matière civile et fiscale.

Le seuil de 5 millions de visiteurs uniques par mois (L111-7-1, D111-15 : charte de bonnes pratiques) ne concerne pas Jobbbox.

Sanction : amende administrative (75 000 € personne physique, 375 000 € personne morale, selon l'INC), et pratique commerciale trompeuse par omission.

### 2.2 Avis en ligne (L111-7-2, D111-16 à D111-19), si Jobbbox publie des avis

Ouvert dans le « Fog » de #841 (avis des Candidates sur les coachs et les masterclasses). Si on en publie :
- à proximité des avis : s'ils font l'objet d'un **contrôle**, et lequel ; la date de l'avis, de ses mises à jour et de l'expérience ; le critère de classement des avis (chronologique par défaut) ; l'existence d'une **contrepartie** pour leur dépôt (D111-17) ;
- une rubrique spécifique sur la publication et le traitement des avis, la durée de conservation, la possibilité de contacter Jobbbox pour contester un avis (D111-17, D111-18) ;
- informer l'auteur d'un avis refusé du motif du refus (D111-19) ;
- ne jamais affirmer que les avis viennent de clients réels sans mesures raisonnables pour le vérifier, ni publier ou commander de faux avis (liste noire de L121-4 issue de l'Omnibus, numéros à vérifier).

Produit : ne permettre l'avis qu'au Candidate qui a eu la Coaching Session ou assisté à la masterclass (preuve par l'Order), et le dire. Les avis sont aussi des contenus de tiers soumis aux art. 16 et 17 du DSA (§3).

### 2.3 Information précontractuelle et Order

Le Human Coach professionnel doit au Candidate l'information de L221-5 (identité, adresse, prix, droit de rétractation, médiateur…). En pratique, c'est l'interface de Jobbbox qui l'affiche : la page de la masterclass et l'Order (`/coachs/commande` ou une page sœur) nomment le vendeur, son SIREN, son adresse, son médiateur, et le lien vers **ses** conditions de vente (ou vers les conditions types que Jobbbox impose aux coachs). L'Order reste la page de Jobbbox qui recueille l'acceptation (ADR-0074), mais l'Acceptance porte alors sur deux textes : les CGU de la place de marché (Jobbbox) et les conditions de vente du coach.

## 3. DSA (règlement 2022/2065)

### 3.1 Qui est concerné, et l'exemption des micro et petites entreprises

- **Autorités en France** : Arcom est le coordinateur pour les services numériques ; la DGCCRF est compétente pour les obligations de protection des consommateurs, dont les places de marché ; la CNIL pour les données personnelles (loi SREN n° 2024-449, convention du 27 juin 2024).
- **Micro ou petite entreprise** (recommandation 2003/361) : moins de 50 personnes et un chiffre d'affaires annuel ou un total de bilan d'au plus 10 M€, entreprises partenaires et liées comprises. Jobbbox y est très probablement (à confirmer, **Q1**).
- **Art. 19** : la section 3 (art. 20 à 28) ne s'applique pas aux plateformes micro ou petites, **sauf l'art. 24 § 3** (communiquer, sur demande de l'Arcom ou de la Commission, le nombre moyen de destinataires actifs). L'exemption dure encore 12 mois après la perte du statut.
- **Art. 29** : même exclusion pour la section 4 (art. 30 à 32, places de marché).
- **Ce qui reste dû par tout hébergeur, micro compris** : point de contact pour les autorités et pour les destinataires (art. 11, 12), conditions générales décrivant les restrictions et la modération (art. 14), mécanisme de notification (art. 16), exposé des motifs (art. 17), signalement des infractions menaçant la vie ou la sécurité (art. 18). Le rapport de transparence de l'art. 15 n'est pas dû par une micro ou petite entreprise (art. 15 § 2).

### 3.2 Article 16 : notice and action

- Un mécanisme électronique, facile d'accès et d'emploi, ouvert à **toute personne ou entité**, pas seulement aux comptes. Le Signalement de Jobbbox ne suffit pas : il n'est ouvert qu'au Candidate connecté et ne vise pas un contenu. Il faut un « Signaler ce contenu » sur chaque fiche de Human Coach, page de masterclass, replay et avis, joignable aussi par un Visitor.
- Éléments que le formulaire doit permettre : l'explication des raisons, l'adresse exacte du contenu, le nom et l'e-mail de l'auteur (sauf infractions visées par la directive 2011/93), une déclaration de bonne foi.
- Accusé de réception, décision diligente et objective, notification de la décision à l'auteur du signalement avec les voies de recours ; dire si la décision est automatisée.
- Une notification complète vaut connaissance effective : Jobbbox ne peut plus invoquer l'exemption de l'art. 6 s'il laisse en ligne un contenu manifestement illicite signalé.

### 3.3 Article 17 : exposé des motifs

Toute restriction (retrait, déréférencement, rétrogradation, suspension du compte vendeur ou des paiements) se motive auprès du Human Coach concerné : la mesure et sa portée, les faits, l'usage d'un outil automatisé, le fondement (illicéité ou clause des conditions générales), les voies de recours. La transmission à la base de données de transparence de la Commission (art. 24 § 5) est en section 3, donc pas due par une micro ou petite entreprise.

Le règlement P2B (2019/1150) impose une règle voisine en faveur des Human Coaches, s'ils sont des « entreprises utilisatrices » de la place de marché : motivation de la restriction ou de la suspension (art. 4), préavis de 30 jours avant une résiliation, préavis de 15 jours avant un changement des conditions (art. 3), transparence du classement (art. 5). Le système interne de plaintes (art. 11) et la désignation de médiateurs (art. 12) ne sont pas dus par une petite entreprise (à vérifier sur le texte).

### 3.4 Article 25 : conception des interfaces

Exempté pour une micro ou petite entreprise (section 3), et l'art. 25 § 2 l'écarte de toute façon pour les pratiques déjà couvertes par la directive 2005/29 (pratiques commerciales déloyales) et le RGPD. En France, ces pratiques restent visées par L121-1 et suivants du Code de la consommation : pas de compte à rebours fictif, de « plus que 2 places » faux, de case pré-cochée, de parcours de Withdrawal plus difficile que l'achat. Position : appliquer l'art. 25 comme bonne pratique, sans le revendiquer.

### 3.5 Article 30 : traçabilité des professionnels

Exempté (art. 29). Mais les mêmes données sont exigées par ailleurs :
- par DAC7 (§5) : nom, adresse, NIF, date de naissance, SIREN, IBAN, collectés et vérifiés avant le 31 décembre ;
- par Stripe Connect (vérification d'identité du compte connecté) ;
- par L111-7 II 3° (qualité de l'offreur).

Position : collecter dès l'inscription comme vendeur ce que l'art. 30 § 1 demande (nom, adresse, téléphone, e-mail, pièce d'identité, compte de paiement, immatriculation, auto-certification de conformité) et refuser la mise en vente d'un Human Coach incomplet. Une seule collecte sert trois textes.

### 3.6 Transparence

Pour une micro ou petite entreprise, la transparence due se réduit aux conditions générales de l'art. 14 (politique de modération, outils automatisés, traitement des réclamations), en langage clair, et à l'art. 24 § 3 sur demande. Le système de recommandation (art. 27) n'est pas dû, mais L111-7 et D111-7 imposent déjà de dire les paramètres du classement (§2.1).

## 4. CGV et Withdrawal d'une masterclass

### 4.1 Qui doit le droit de rétractation

- **Jobbbox vendeur** : Jobbbox, comme pour la Coaching Session (ADR-0071, ADR-0074).
- **Place de marché** : le Human Coach professionnel. Un coach qui se déclarerait non professionnel n'en devrait pas, mais une activité régulière et rémunérée de coaching est professionnelle ; position : n'admettre comme vendeurs que des professionnels (SIREN exigé), ce qui garde le droit de la consommation applicable et simplifie l'information.
- **Dans les deux cas**, le contrat est conclu par l'interface de Jobbbox : la fonction « Renoncer au contrat ici » (L221-21 al. 3, D221-5) doit y être, et c'est Jobbbox qui la construit. Avec Stripe Connect en *destination charges*, le remboursement automatique d'ADR-0071 reste possible (remboursement et reprise du virement au coach) ; avec des *direct charges* sur le compte du coach, il dépend du coach.

### 4.2 Les exceptions de L221-28 pour une masterclass

| Ce qui est vendu | Nature | Exception possible | Condition |
|---|---|---|---|
| Masterclass en direct, à une date | Prestation de services | **1°** : service pleinement exécuté avant la fin du délai | Accord préalable exprès **et** renoncement exprès du Candidate (l'Immediate Performance Request, ADR-0074, étendue à la masterclass). Avant la séance, la rétractation reste ouverte, remboursée en entier ou au prorata (L221-25). |
| Même masterclass | « Activité de loisirs » à une date déterminée | **12°** | Peu probable : une masterclass de recherche d'emploi relève de la formation ou du conseil, pas du loisir. La CJUE (C-96/21) admet l'exception même via un intermédiaire, mais pour une activité de loisirs. Position : ne pas s'en servir. |
| Replay, ou masterclass enregistrée | Contenu numérique non fourni sur un support matériel | **13°** | Exécution commencée après accord préalable exprès **et** renoncement exprès, confirmés sur support durable (L221-13). Sans eux, le Candidate peut se rétracter même après avoir vu le replay. |
| Live + replay vendus ensemble | Contrat mixte | 1° pour le live, 13° pour le replay | Recueillir les deux demandes, dire laquelle couvre quoi. |
| Masterclass incluse dans un Plan | Partie du Plan | Aucune propre | Withdrawal du Plan au prorata (ADR-0074). |

Conséquence pour l'Order : l'Immediate Performance Request actuelle (« Je demande que le service commence immédiatement… », et pour la Coaching Session « … je perds mon droit de rétractation une fois la séance réalisée ») se décline en une deuxième case pour le contenu numérique : « Je demande l'accès immédiat au replay et je renonce à mon droit de rétractation dès cet accès. » Jamais pré-cochée, gardée avec l'Order et l'Acceptance, reprise dans l'Order Confirmation. Le terme de `CONTEXT.md` reste Immediate Performance Request ; une variante « contenu numérique » sera posée au grilling de vocabulaire (#860).

### 4.3 Clauses à prévoir

- **CGU de la place de marché** (Jobbbox ↔ Candidate) : rôle d'intermédiaire, qui vend quoi, répartition des obligations, classement, avis, modération et signalement (DSA art. 14, 16, 17), médiateur de Jobbbox pour le service d'intermédiation.
- **Conditions de vente des Human Coaches** : soit chaque coach a les siennes (risque de disparité, de clauses abusives), soit Jobbbox impose des conditions types qu'il accepte et qui sont affichées à l'Order. Position : conditions types, une seule Legal Text Version par version, le coach nommé vendeur.
- **CGV de Jobbbox** (modèle vendeur) : ajouter la masterclass à côté de la Coaching Session, avec ses exceptions de L221-28 et l'identité du Human Coach qui l'anime (L221-5).

## 5. Fiscal et social

### 5.1 DAC7 (directive 2021/514, CGI 1649 ter A à 1649 ter E)

- Un **opérateur de plateforme** au sens de DAC7 permet à des vendeurs d'être mis en relation avec des utilisateurs pour une « activité concernée », dont les **services personnels** (travail en temps ou à la tâche fait par une ou plusieurs personnes physiques, en ligne ou non). Une Coaching Session et une masterclass en direct en sont ; un replay pur, contenu numérique sans travail à la demande, probablement pas (**Juriste** ou expert-comptable).
- Pour les services, **pas de seuil** : le seuil de 30 ventes et 2 000 € ne vaut que pour les ventes de biens. Un Human Coach est déclarable dès la première prestation.
- Obligations : diligences sur les vendeurs (identité, NIF, adresse, IBAN, SIREN) ; déclaration à la DGFiP au plus tard le **31 janvier** de l'année suivante (BOI-INT-AEA-30) ; communication à chaque vendeur des informations déclarées qui le concernent ; délégation possible à un tiers sans décharge de responsabilité.
- **Dans le modèle vendeur**, Jobbbox achète au coach une prestation qu'il revend : le coach n'est pas un « vendeur » qui contracte avec le Candidate. La qualification DAC7 reste douteuse, car le Candidate réserve sur le Cal.com du coach et reçoit de lui un service personnel. Position prudente : se déclarer opérateur et déclarer les Human Coaches dans les deux modèles, ou obtenir une position de l'administration (**Juriste**).

### 5.2 CGI art. 242 bis

Depuis DAC7, les 2° et 3° de 242 bis (récapitulatif annuel aux utilisateurs, certificat d'un tiers) sont remplacés par 1649 ter A et suivants (BOFiP). Reste le 1° : **à chaque transaction**, une information loyale, claire et transparente sur les obligations fiscales et sociales du vendeur, avec un lien vers les sites des administrations (impots.gouv.fr, urssaf.fr). Produit : un encart dans l'Espace coach, à chaque paiement reçu et sur la page « revenus », plus un e-mail. Sanction : amende de l'art. 1731 ter (jusqu'à 50 000 € selon une source secondaire, à vérifier).

### 5.3 Responsabilité sociale de la plateforme (C. trav. L7341-1, L7342-1, D7342-1)

Le titre s'applique aux travailleurs indépendants qui recourent à une plateforme de mise en relation par voie électronique au sens de 242 bis. **Quand la plateforme détermine les caractéristiques de la prestation et fixe son prix**, elle a une responsabilité sociale (L7342-1) : prise en charge de l'assurance accidents du travail, de la contribution à la formation professionnelle, accès à la VAE, au-delà d'un chiffre d'affaires réalisé sur la plateforme d'au moins 13 % du plafond annuel de la sécurité sociale (D7342-1, à vérifier). Le modèle actuel de la Coaching Session (prix unique fixé par Jobbbox, format fixé) est exactement ce cas si Jobbbox est une plateforme de mise en relation. Il pèse aussi un risque de requalification en salariat si Jobbbox ajoute au prix fixé un pouvoir de direction et de sanction (présomption simple de non-salariat de L8221-6). **Juriste** : c'est l'argument le plus fort pour laisser le Human Coach fixer son prix sur la marketplace, et pour rédiger #518 sans lien de subordination.

### 5.4 Encaisser pour le compte d'un coach

Recevoir le prix d'une masterclass pour le reverser au Human Coach est un service de paiement (CMF L314-1), sauf exclusion étroite de l'agent commercial. Position : passer par Stripe Connect, Stripe restant l'établissement régulé et Jobbbox ne détenant jamais les fonds ; ne pas encaisser sur le compte de Jobbbox pour reverser à la main.

### 5.5 TVA

Hors périmètre CGV, à confier à l'expert-comptable : présomption de l'art. 9 bis du règlement 282/2011 pour le replay (Jobbbox réputé prestataire) ; l'enseignement en direct par un enseignant sur internet n'est pas un service fourni par voie électronique (art. 7, à vérifier) ; règles de lieu des services diffusés en direct modifiées par la directive (UE) 2022/542 depuis 2025 (à vérifier).

## 6. Médiateur (#515) et ventes des tiers

- L612-1 : tout consommateur a droit au recours gratuit à un médiateur de la consommation **pour un litige avec un professionnel** ; le professionnel le garantit et en affiche les coordonnées (L616-1, R616-1).
- **Modèle vendeur** : le médiateur que #515 désigne couvre les Coaching Sessions et les masterclasses que Jobbbox vend. Rien de plus.
- **Place de marché** : le contrat de la masterclass lie le Candidate et le Human Coach. C'est **le coach** qui doit un médiateur. Le médiateur de Jobbbox couvre le contrat d'intermédiation entre Jobbbox et le Candidate (et le Plan), pas la vente du coach, sauf si la convention d'adhésion l'étend aux vendeurs de la plateforme.
- Options :
  1. exiger dans le contrat vendeur que chaque Human Coach adhère à un médiateur référencé et en fournisse les coordonnées, affichées sur sa page, dans l'Order et dans l'Order Confirmation ;
  2. négocier avec le médiateur choisi pour #515 une convention qui couvre aussi les vendeurs de la plateforme, chaque coach y adhérant à ses frais ou aux frais de Jobbbox ;
  3. garder les masterclasses dans le modèle vendeur, et un seul médiateur.
- Action pour #515 : avant de signer, demander au médiateur s'il propose une adhésion « plateforme et vendeurs ». Ne pas bloquer #515 pour autant : la Coaching Session en a besoin seule.

## 7. Modération, propriété intellectuelle et droit à l'image

### 7.1 Contenu des masterclasses

- Risques propres au domaine : promesse trompeuse (« décrochez un CDI en 30 jours », taux de retour inventés, L121-2), conseils discriminatoires à l'embauche, contrefaçon dans les supports, données de Candidates montrées à l'écran, publicité pour des services tiers non signalée.
- **Modèle vendeur** : Jobbbox répond du contenu comme de sa propre offre ; une revue avant publication est nécessaire.
- **Place de marché** : Jobbbox est hébergeur pour la fiche et le replay, tant qu'il ne joue pas un rôle actif (CJUE C-324/09) et ne fait pas croire qu'il vend (DSA art. 6 § 3). Une charte de contenu dans les conditions des coachs, appliquée par le mécanisme des art. 16 et 17, suffit en droit ; une revue avant publication reste possible et prudente, mais rapproche du rôle d'éditeur (**Juriste**).
- Marquage des contenus générés par IA (AI Act art. 50, #337) si un coach publie un support ou un résumé généré.

### 7.2 Droits d'auteur du Human Coach

- Une masterclass est une œuvre de l'esprit : le CPI cite expressément « les conférences, allocutions » (L112-2 2°), et l'auteur est le coach (L111-1).
- Pour diffuser le live, enregistrer, héberger et vendre le replay, Jobbbox a besoin d'une **cession ou d'une licence écrite** : chaque droit mentionné distinctement, domaine d'exploitation délimité dans son étendue, sa destination, son lieu et sa durée (L131-3). Une cession globale des œuvres futures est nulle (L131-1) : une licence par masterclass, acceptée à sa mise en ligne, ou un contrat-cadre avec un avenant par masterclass.
- Le **droit moral** (L121-1) limite les coupes, le montage, les extraits promotionnels et les résumés par IA du replay sans accord du coach : à prévoir dans la licence.
- Garantie du coach sur les contenus de tiers qu'il montre (images, extraits, musique) et sur les supports qu'il partage.

### 7.3 Image et voix des participants d'un live

- L'image et la voix d'un Candidate identifiable sont des données personnelles (RGPD) et relèvent du droit à l'image (C. civ. art. 9). Enregistrer et surtout **diffuser en replay** un Candidate qui pose une question demande son information avant l'enregistrement et, pour la diffusion, son accord, retirable.
- Conception qui évite le problème : le replay n'enregistre que le Human Coach et son écran ; caméras et micros des participants hors enregistrement ; questions par écrit, lues par le coach, sans nom ; un bandeau « enregistrement en cours » ; un participant qui veut apparaître le choisit expressément.
- Le traitement (base légale, durée de conservation du replay, sous-traitance de la visio, transcription) relève de #847 et du registre ; la qualification RGPD du Human Coach (responsable distinct pour sa masterclass, ou sous-traitant de Jobbbox) prolonge #518 (**Juriste**).

## 8. Les deux qualifications comparées

| Sujet | Jobbbox vendeur, le Human Coach prestataire | Jobbbox opérateur de place de marché |
|---|---|---|
| Qui contracte avec le Candidate | Jobbbox | Le Human Coach ; Jobbbox pour le service d'intermédiation |
| Prix | Fixé par Jobbbox | Fixé par le Human Coach (le fixer soi-même fait retomber vers le vendeur, et vers L7342-1) |
| **Textes publics (Legal Texts)** | CGV de Jobbbox étendues à la masterclass ; CGU inchangées pour le vendeur ; politique de confidentialité, section Human Coach | CGU de la place de marché (rôle, classement, avis, modération, art. 14 DSA) ; conditions de vente types des Human Coaches ; rubrique L111-7 / D111-7 / D111-8 ; rubrique avis D111-17 ; politique de confidentialité |
| Information précontractuelle | Jobbbox ; nommer le Human Coach qui anime | Le coach, affichée par Jobbbox : identité, SIREN, adresse, médiateur, qualité de professionnel, répartition des obligations |
| Withdrawal | Dû par Jobbbox, remboursé par Stripe (ADR-0071) | Dû par le coach, mais la fonction « Renoncer au contrat ici » est sur l'interface de Jobbbox ; remboursement par Stripe Connect |
| Immediate Performance Request | Étendue à la masterclass (1°) et au replay (13°) | Même chose, recueillie pour le compte du coach |
| Médiateur | Celui de #515 | Un par coach, ou une convention élargie ; celui de #515 pour l'intermédiation |
| DSA | Hébergeur seulement pour ce que le coach publie lui-même ; art. 16, 17 si oui | Plateforme en ligne et place de marché ; art. 11 à 18 ; section 3 et 4 exemptées (micro) sauf 24 § 3 ; perte de l'exemption de responsabilité si confusion (art. 6 § 3) |
| P2B | Non (le coach ne propose rien au consommateur par la plateforme) | Oui : conditions pour les coachs, préavis, motivation, classement |
| DAC7 | Douteux, prudence : déclarer | Oui pour les services personnels, sans seuil |
| 242 bis 1° | Douteux | Oui, à chaque transaction |
| L7342-1 (responsabilité sociale) | **Risque fort** : Jobbbox fixe prix et format | Faible si le coach fixe prix et contenu |
| Requalification en salariat | À surveiller (#518) | Faible |
| Paiement | Jobbbox encaisse, paie le coach sur facture | Stripe Connect obligatoire en pratique |
| TVA | Jobbbox facture le tout | Présomption art. 9 bis pour le replay ; facturation à démêler |
| Responsabilité du contenu | Éditeur : revue préalable | Hébergeur : charte, signalement, motivation |
| Propriété intellectuelle | Licence du coach à Jobbbox (L131-3) | Licence d'hébergement et de diffusion, plus large si Jobbbox fait la promotion |
| **Contrats** | Contrat de prestation B2B (#518) avec licence des masterclasses | Conditions générales vendeurs (P2B), licence, mandat d'encaissement (Stripe Connect), engagement médiateur, auto-certification art. 30, information 242 bis |
| **Produit** | Order et Order Confirmation existants, avec la masterclass ; deuxième case pour le replay ; formulaire de signalement si le coach publie | Page vendeur avec identité et qualité ; mention « vendu par » à chaque offre et dans l'Order ; Acceptance des conditions du coach ; rubrique classement ; badge « sponsorisé » ; formulaire de signalement ouvert à tous ; motivation des retraits et recours dans l'Espace coach ; collecte KYC et DAC7 ; encart fiscal 242 bis ; export DAC7 annuel |

## 9. Première passe de conformité (`/legal:compliance-check`)

| # | Risque | Texte | Gravité | Probabilité | Mesure |
|---|---|---|---|---|---|
| R1 | Modèle mixte non signalé : le Candidate ne sait pas qui vend | L111-7 II, DSA art. 6 § 3, L121-3 | Élevée | Moyenne | « Vendu par » sur chaque offre, l'Order et l'Order Confirmation |
| R2 | Responsabilité sociale ou requalification des Human Coaches (prix fixé par Jobbbox) | C. trav. L7342-1, L8221-6 | Élevée | Moyenne | Trancher au grilling #851 ; contrat #518 sans subordination |
| R3 | Masterclass qualifiée d'action de formation vendue à un particulier : contrat écrit, rétractation et paiement encadrés (rien avant la fin du délai, 30 % au plus ensuite, L6353-6), déclaration d'activité | C. trav. L6313-1, L6351-1, L6353-3 à L6353-7 | Élevée | Incertaine | **Juriste** : dire si le régime s'applique à un contrat à distance, ou concevoir la masterclass hors « action de formation » ; ne jamais la présenter comme un bilan de compétences (L6313-4) |
| R4 | Replay sans renoncement exprès : rétractation possible après visionnage | L221-28 13°, L221-13 | Moyenne | Élevée sans la case | Deuxième case à l'Order, confirmée dans l'Order Confirmation |
| R5 | Coach sans médiateur | L612-1, L616-1 | Moyenne | Élevée en marketplace | Exigence contractuelle ou convention élargie |
| R6 | Signalement réservé aux comptes connectés | DSA art. 16 | Moyenne | Certaine si rien n'est fait | Formulaire « Signaler ce contenu » ouvert à tous |
| R7 | Retrait d'une masterclass sans motivation | DSA art. 17, P2B art. 4 | Moyenne | Moyenne | Modèle de décision motivée dans le Back Office |
| R8 | Défaut DAC7 ou 242 bis | CGI 1649 ter A, 242 bis, 1731 ter | Moyenne | Élevée en marketplace | Collecte à l'inscription vendeur, export annuel, encart fiscal |
| R9 | Replay diffusant un Candidate sans accord | C. civ. art. 9, RGPD | Moyenne | Moyenne | Enregistrer le coach seul ; accord exprès sinon |
| R10 | Diffusion sans cession valable des droits du coach | CPI L131-1, L131-3, L121-1 | Moyenne | Moyenne | Licence écrite par masterclass |
| R11 | Avis non contrôlés présentés comme vérifiés, ou faux avis | L111-7-2, D111-17, L121-4 | Moyenne | Faible tant qu'il n'y a pas d'avis | Avis réservés aux acheteurs, rubrique D111-17 |
| R12 | Mise en avant payée non signalée | L111-7 II, D111-7, L121-4 | Faible | Faible | Libellé « sponsorisé » |
| R13 | Encaissement pour compte de tiers sans agrément | CMF L314-1 | Élevée | Faible avec Stripe Connect | Stripe Connect |

## 10. Positions à valider en Legal Review (#507)

1. **P1** : la Coaching Session reste une vente de Jobbbox ; #518 garde « Jobbbox est le vendeur, le Human Coach son prestataire ».
2. **P2** : une masterclass incluse dans un Plan est une vente de Jobbbox (licence du coach) ; seule la masterclass vendue à l'unité, au prix du coach et en son nom, relève de la place de marché.
3. **P3** : n'admettre comme vendeurs que des Human Coaches professionnels, immatriculés.
4. **P4** : le vendeur est nommé sur chaque offre, dans l'Order et dans l'Order Confirmation ; aucune présentation ne laisse croire que Jobbbox vend une offre du coach (DSA art. 6 § 3).
5. **P5** : Jobbbox est une micro ou petite entreprise au sens de 2003/361 ; il applique les art. 11 à 18 du DSA et, volontairement, l'art. 30 (une seule collecte pour l'art. 30, DAC7 et Stripe) et l'art. 25.
6. **P6** : les conditions de vente des coachs sont des conditions types de Jobbbox, une Legal Text par version, acceptées à l'Order avec les CGU de la place de marché.
7. **P7** : live = service (L221-28 1°), replay = contenu numérique (13°) ; deux demandes distinctes à l'Order ; pas d'appui sur le 12° (loisirs).
8. **P8** : le Withdrawal d'une masterclass passe par « Renoncer au contrat ici » de Jobbbox et par un remboursement Stripe Connect automatique, comme ADR-0071, quel que soit le vendeur.
9. **P9** : chaque coach vendeur justifie d'un médiateur, ou adhère à la convention élargie négociée avec le médiateur de #515.
10. **P10** : Jobbbox se considère opérateur DAC7 dans les deux modèles et informe les coachs à chaque paiement (242 bis 1°). **Juriste** ou expert-comptable.
11. **P11** : le Human Coach fixe le prix de sa masterclass, pour sortir du L7342-1 ; à mettre en regard du prix unique de la Coaching Session. **Juriste**.
12. **P12** : la masterclass n'est pas vendue comme « action de formation » au sens de L6313-1, sauf décision contraire, auquel cas le régime de L6353-3 à L6353-7 s'applique. **Juriste**.
13. **P13** : le replay n'enregistre que le Human Coach et son écran ; une licence par masterclass couvre live, replay, extraits et résumé.
14. **P14** : modération par charte et par signalement (art. 16, 17), sans revue éditoriale systématique en marketplace ; revue préalable dans le modèle vendeur. **Juriste**.
15. **P15** : des avis seulement s'ils sont réservés aux acheteurs, avec la rubrique D111-17 ; sinon pas d'avis.

## 11. Questions ouvertes pour le product owner

1. **Q1** : effectif et chiffre d'affaires de Jobbbox, et entreprises liées : la société est-elle bien micro ou petite (DSA art. 19 et 29) ?
2. **Q2** : masterclass incluse dans un Plan, vendue à l'unité, ou les deux ? Qui en fixe le prix ?
3. **Q3** : Jobbbox veut-il garder la main sur le contenu des masterclasses (revue avant publication, format imposé) ? Plus la main est forte, plus Jobbbox est vendeur et éditeur.
4. **Q4** : commission prélevée par Jobbbox, ou achat du coach à un prix convenu ? Stripe Connect est-il acceptable (frais, vérification des coachs) ?
5. **Q5** : faut-il revoir le prix unique de la Coaching Session au regard de L7342-1, ou le garder en sachant le risque ?
6. **Q6** : les masterclasses viseront-elles des financements (CPF, France Travail, OPCO) ? Si oui, déclaration d'activité et Qualiopi, et un autre projet.
7. **Q7** : replay prévu ? Combien de temps reste-t-il en ligne, et qui en garde les droits après le départ du coach (Retired Human Coach) ?
8. **Q8** : des avis des Candidates sur les coachs et les masterclasses sont-ils voulus (Fog de #841) ?
9. **Q9** : le médiateur de #515 doit-il être choisi aussi pour sa capacité à couvrir les vendeurs de la plateforme ?
10. **Q10** : mise en avant payée par les coachs envisagée ?
11. **Q11** : les Human Coaches vendeurs seront-ils tous établis en France, ou dans l'UE ? Un coach hors UE change DAC7, la médiation et la TVA.

## 12. Suites pour la carte #841

- **#851** (cadrage) : trancher Q2 à Q5 avec ce tableau ; c'est le choix du modèle qui fixe les Legal Texts.
- **#858** (marketplace) : reprendre §4, §6 et §7 ; un ADR « qui vend une masterclass » est probable (coûteux à défaire : contrats, fiscalité, médiation).
- **#518** : garder la qualification « prestataire » pour la Coaching Session, ajouter la licence des masterclasses et écarter le lien de subordination (R2).
- **#515** : poser la question de la convention élargie au médiateur avant de signer.
- **#847** : image, voix et enregistrement des participants.
- **#860** : termes à poser : masterclass, vendeur, la variante « contenu numérique » de l'Immediate Performance Request, signalement de contenu (distinct du Signalement).
- **#861** : issues « Légal : » attendues, selon le modèle retenu : CGV (masterclass), CGU de la place de marché, conditions de vente types des coachs, rubrique classement et avis, politique de confidentialité (section Human Coach vendeur, DAC7).
