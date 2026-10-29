# Recherche pour l'issue #496 : documents légaux obligatoires d'un SaaS B2C payant en France

Vérifié le 2026-10-29 sur `main` (`4bb35f1f`), contre Légifrance (versions en vigueur à cette date), EUR-Lex, la CNIL, la DGCCRF et la documentation Stripe. Carte : #494. **Ceci n'est pas un avis juridique.** Les points à faire trancher par un juriste sont marqués **Juriste** et repris à la fin. Le volet AI Act (art. 50) est traité dans `docs/research/issue-318.md` et n'est pas repris ici.

Réponse courte : Jobbbox doit publier **cinq textes publics**, plus une page de rangement et un formulaire.

1. Mentions légales (LCEN art. 1-1, ex-art. 6 III).
2. CGU : contrat d'usage du service, Free compris, et de l'extension.
3. CGV : Plans payants et Coaching Sessions.
4. Politique de confidentialité (RGPD art. 13 et 14), qui inclut la section « IA dans Jobbbox ».
5. Information cookies et traceurs. Aujourd'hui, Jobbbox n'utilise que des traceurs exemptés de consentement : une section de la politique de confidentialité suffit, **sans bandeau**.

Il faut aussi le formulaire type de rétractation (annexe de l'art. R221-1), joint aux CGV.

Deux obligations récentes touchent directement le parcours d'achat, et aucune n'est en place aujourd'hui :
- **la fonctionnalité « renoncer au contrat ici »** (art. L221-21 al. 3 et D221-5), due depuis le **19 juin 2026** pour tout contrat conclu en ligne ;
- **la demande expresse d'exécution immédiate**, sans laquelle un Candidate qui se rétracte dans les 14 jours ne doit rien (art. L221-25).

Pour un abonnement SaaS, il n'existe **pas d'exception totale** au droit de rétractation. Si la demande expresse a été recueillie, le Candidate qui se rétracte doit seulement le prorata du service déjà fourni.

État du code : `apps/web/src/billing/index.ts` crée les sessions Stripe Checkout sans `consent_collection`. Aucune acceptation de CGU ou de CGV n'est recueillie ni tracée, ni à l'inscription ni au paiement. Aucun outil de mesure d'audience n'est présent dans `apps/` ni dans `packages/`.

## Sources

**Légifrance**
- LCEN, loi n° 2004-575, art. 1-1 (créé par la loi SREN n° 2024-449) : https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000049568614
- Code de la consommation (sigle C. conso.). Chaque article est cité par son lien :
  - L111-7 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000049571125
  - L215-1 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000034072591/
  - L215-1-1 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000046190107
  - D215-1 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000047614999
  - D215-2 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000047615001
  - L221-5 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000044563141
  - L221-14 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000032226854
  - L221-18 à L221-28 (section 6) : https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000006069565/LEGISCTA000032221365/
  - L221-21 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000044563193
  - L221-28 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000044563170
  - D221-5 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000053303365
  - L213-1 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000032226994
  - D213-1 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000032807208
  - R212-1 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000032807196
  - R212-4 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000032807202
  - L224-25-4 à L224-25-9 : https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000006069565/LEGISCTA000044132845/
  - L224-25-24 à L224-25-26 : https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000006069565/LEGISCTA000044132895/
  - L241-3-1 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000046190202
  - L616-1 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000032224762
  - R616-1 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000032808378
- Ordonnance n° 2026-2 et décret n° 2026-3 du 5 janvier 2026 (transposition de la directive (UE) 2023/2673) :
  - https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000053298845
  - https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000053298978
  - rapport au Président : https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000053298834
- Décret n° 2023-417 du 31 mai 2023 (résiliation en ligne) : https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000047613963
- Code civil :
  - art. 1125 à 1127-4 (contrat conclu par voie électronique) : https://www.legifrance.gouv.fr/codes/id/LEGISCTA000032007249/
  - art. 1127-2 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000032007506
- Loi n° 78-17 Informatique et Libertés (art. 82 traceurs, art. 45 mineurs) : https://www.legifrance.gouv.fr/loda/id/JORFTEXT000000886460
- Loi n° 94-665 (loi Toubon) : https://www.legifrance.gouv.fr/loda/id/JORFTEXT000000349929

**CNIL**
- Délibération n° 2020-091 (lignes directrices cookies et autres traceurs) : https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000042388179
- Délibération n° 2020-092 (recommandation), version consolidée de janvier 2026 : https://www.cnil.fr/sites/default/files/2026-01/recommandation_cookies_consolidee.pdf
- Page « Les mentions légales sur un site web » : https://www.cnil.fr/fr/cnil-direct/question/les-mentions-legales-sur-un-site-web-est-ce-obligatoire

**DGCCRF / ministère de l'Économie**
- Médiation, obligations du professionnel : https://www.economie.gouv.fr/mediation-conso/vous-etes-un-professionnel/vos-principales-obligations
- Mentions obligatoires d'un site : https://www.economie.gouv.fr/entreprises/developper-son-entreprise/innover-et-numeriser-son-entreprise/mentions-sur-votre-site-internet-les-obligations-respecter
- Directive « Accessibilité » : https://www.economie.gouv.fr/dgccrf/les-fiches-pratiques/professionnels-vos-produits-et-services-doivent-etre-conformes-la-directive-accessibilite
- Résiliation en trois clics : https://presse.economie.gouv.fr/01062023-cp-entree-en-vigueur-de-la-resiliation-en-ligne-des-contrats-en-trois-clics/

**EUR-Lex et CJUE**
- RGPD (UE) 2016/679 : https://eur-lex.europa.eu/eli/reg/2016/679/oj
- Directive 2011/83/UE (droits des consommateurs) : https://eur-lex.europa.eu/eli/dir/2011/83/oj
- Directive (UE) 2023/2673 : https://eur-lex.europa.eu/eli/dir/2023/2673/oj
- Directive (UE) 2019/770 (contenus et services numériques) : https://eur-lex.europa.eu/eli/dir/2019/770/oj
- Règlement (UE) 2024/3228 (fin de la plateforme RLL) : https://eur-lex.europa.eu/eli/reg/2024/3228/oj/eng
- Règlement (UE) 2022/2065 (DSA) : https://eur-lex.europa.eu/eli/reg/2022/2065/oj
- CJUE C-673/17 *Planet49* : https://curia.europa.eu/juris/liste.jsf?num=C-673/17
- Groupe de l'article 29 / CEPD, lignes directrices sur la transparence (WP260 rév.01) : https://ec.europa.eu/newsroom/article29/items/622227

**Tiers**
- Stripe, Checkout, champs et consentement aux conditions : https://docs.stripe.com/payments/checkout/custom-components?ui=full-page
- Chrome Web Store, règles sur la confidentialité : https://developer.chrome.com/docs/webstore/program-policies/privacy
- Chrome Web Store, règles sur l'usage limité : https://developer.chrome.com/docs/webstore/program-policies/limited-use

## 1. Inventaire des documents

| Document | Base | Public | Acceptation |
|---|---|---|---|
| Mentions légales | LCEN art. 1-1 ; C. conso. R616-1 (médiateur) | Tous, dont le Visitor | Aucune : accessibles depuis chaque page (pied de page) |
| CGU | C. civ. 1119, 1127-1 ; C. conso. L224-25-5 ; L111-7 si applicable (§7) | Candidate (Free compris), Guest | Case à cocher à l'inscription (§5) |
| CGV | C. conso. L221-5, L221-13, L221-14, L215-1-1, L616-1 | Candidate qui paie (Plan ou Coaching Session) | Case à cocher avant paiement, avec la demande d'exécution immédiate (§5) |
| Formulaire de rétractation | C. conso. L221-5 7° ; annexe à R221-1 | Acheteur | Joint aux CGV et à la confirmation |
| Politique de confidentialité | RGPD art. 12 à 14 | Tous : Visitor, Guest, Candidate, Human Coach, Administrator | **Pas d'acceptation** : c'est une information (§5.3) |
| Cookies et traceurs | Loi I&L art. 82 ; CNIL 2020-091 et 2020-092 | Tous | Aucune tant que tous les traceurs sont exemptés (§6) |
| IA dans Jobbbox | AI Act art. 50 ; RGPD art. 13(2)(f) | Tous | Information (voir `issue-318.md`) |
| Déclaration d'accessibilité | Directive (UE) 2019/882 ; décret 2023-931 | Tous | Probablement non due si Jobbbox est une microentreprise (§8). **Juriste** |

Langue : la loi Toubon (art. 2) impose le français pour l'offre et les conditions proposées à un consommateur. La version FR fait foi, ce qui est cohérent avec la décision de cadrage de #494. Les versions EN sont des traductions de courtoisie.

## 2. Mentions légales

**Contenu (LCEN art. 1-1 I, dans sa version issue de la loi SREN, en vigueur depuis le 23 mai 2024).** L'ancien art. 6 III a été déplacé à l'art. 1-1, ce qui règle le point 9 « Needs counsel » de `issue-318.md`. Une personne morale indique :
- dénomination ou raison sociale, siège social, téléphone ;
- numéro d'immatriculation (RCS) et capital social ;
- directeur ou codirecteur de la publication ;
- nom, dénomination, adresse et téléphone de l'hébergeur (art. 1-1 I 5°) ;
- les données de chaque prestataire qui stocke les données de l'éditeur.

La CNIL et la page de l'Économie le confirment.

**À ajouter, hors LCEN :**
- coordonnées et site du **médiateur de la consommation**, « de manière visible et lisible » sur le site (R616-1). La DGCCRF demande qu'elles figurent sur le site **et** dans les CGV ;
- pour une activité de commerce électronique : adresse électronique, numéro de TVA intracommunautaire et prix TTC clairs (LCEN art. 19, à vérifier sur Légifrance : non relu pour cette note). Les placer dans les mentions légales et dans les CGV.

**À ne plus mettre.** Le lien vers la plateforme européenne RLL. Le règlement (UE) 2024/3228 a abrogé le règlement 524/2013 au 20 juillet 2025, et l'obligation de lien a disparu avec lui.

## 3. CGV : Plans payants et Coaching Sessions

### 3.1 Information précontractuelle (C. conso. L221-5, version du 19 juin 2026)

Elle doit être donnée avant la commande, de façon lisible :
- caractéristiques essentielles du service (L111-1) : Plans, Plan Quotas par semaine, Plan Features. Les Plan Quotas changent en Back Office (ADR-0014). Les CGV doivent donc renvoyer à la comparaison des Plans comme description contractuelle, et encadrer leur modification (§4) ;
- prix TTC, périodicité, reconduction ;
- identité et coordonnées de Jobbbox ;
- **droit de rétractation** : conditions, délai, modalités, formulaire type, et « l'existence et l'emplacement » de la fonctionnalité de rétractation de l'art. L221-21 (L221-5 7°) ;
- coût à payer en cas de rétractation après une demande d'exécution immédiate (L221-5 9° ; L221-25) ;
- médiateur de la consommation (L221-5 6° ; L616-1) ;
- durée, renouvellement et conditions de résiliation (L224-25-5 4° pour les services numériques).

### 3.2 Droit de rétractation

- **Délai.** 14 jours à compter de la conclusion du contrat, pour une prestation de services (L221-18).
- **Abonnement (Plan).** C'est un « service numérique » (L224-25-1 et s.). L'exception de l'art. L221-28 13° vise le **contenu** numérique sans support matériel, pas le service numérique. L'exception du 1° ne vaut que pour un service « pleinement exécuté » avant la fin du délai, ce qu'un abonnement mensuel n'est pas. Le régime applicable est donc celui de **L221-25** :
  - le Candidate qui veut l'exécution immédiate en fait la « demande expresse », que Jobbbox recueille ;
  - s'il se rétracte, il paie un montant « proportionné au prix total » pour la période écoulée ;
  - sans demande expresse recueillie, ou sans l'information du 9° de L221-5, il ne doit **rien**.
  - En pratique : un remboursement au prorata, via un remboursement partiel Stripe. **Juriste** pour confirmer la qualification « service » plutôt que « contenu ».
- **Coaching Session.** C'est une prestation de service (vidéo avec un Human Coach). Deux cas :
  - la séance a lieu dans les 14 jours : il faut la demande expresse (L221-25). Pour éteindre le droit une fois la séance faite (L221-28 1°), il faut en plus la reconnaissance par le Candidate qu'il perd son droit de rétractation une fois le service pleinement exécuté ;
  - la séance a lieu après les 14 jours : remboursement intégral si le Candidate se rétracte avant.
  - Aujourd'hui, la date est réservée sur Cal.com *après* le paiement (ADR-0027). Jobbbox ne sait donc pas, au paiement, si la séance tombera dans le délai. La demande expresse doit donc être recueillie dans tous les cas.
- **Fonctionnalité « renoncer au contrat ici »** (L221-21 al. 3, créé par l'ordonnance 2026-2 ; D221-5), pour les contrats conclus en ligne depuis le 19 juin 2026 :
  - une fonction gratuite, intitulée « renoncer au contrat ici » ou une formule analogue sans ambiguïté ;
  - visible, facile d'accès, disponible pendant tout le délai ;
  - elle permet de donner son nom, d'identifier le contrat et de choisir le support de l'accusé de réception ;
  - l'étape d'envoi est intitulée « confirmer la rétractation » ;
  - Jobbbox envoie ensuite un accusé de réception sur support durable, avec le contenu de la rétractation, la date et l'heure.
  - Les contrats en cours au 19 juin 2026 restent régis par l'ancien texte (ordonnance, art. 26 II).
  - Le portail client Stripe ne propose pas cette fonction : c'est un développement Jobbbox (page Abonnement et Agenda pour les Coaching Sessions).

### 3.3 Conclusion du contrat en ligne

- **Bouton de commande** (L221-14) : « commande avec obligation de paiement » ou une formule analogue sans ambiguïté. Stripe Checkout en mode `subscription` affiche son propre libellé, et `submit_type` ne vaut que pour les paiements ponctuels (doc Stripe). Il faut vérifier le libellé FR effectivement affiché (« S'abonner », « Payer ») sous le paiement d'un Plan et d'une Coaching Session. **Juriste** pour dire si « S'abonner » est une formule analogue.
- **Récapitulatif et correction** avant confirmation (C. civ. 1127-2). Checkout le fait pour le prix. Le récapitulatif doit aussi rappeler le Plan et la périodicité.
- **CGV reproductibles et conservables** (C. civ. 1127-1) : une page HTML stable par version, et un PDF.
- **Confirmation sur support durable** (L221-13), avec les CGV et, le cas échéant, la demande expresse. Les reçus Stripe ne contiennent pas les CGV : il faut un e-mail Jobbbox (Brevo) avec la version acceptée en pièce jointe ou en lien permanent vers cette version.

### 3.4 Résiliation et reconduction

- **Résiliation en trois clics** (L215-1-1 ; D215-1 et D215-2, en vigueur depuis le 1er juin 2023) :
  - une fonction gratuite, intitulée « résilier votre contrat » ou une formule équivalente ;
  - directement accessible depuis l'interface où l'on souscrit ;
  - suivie d'un accusé de réception qui indique la date de fin du contrat.
  - Sanction : amende administrative jusqu'à 75 000 € pour une personne morale (L241-3-1).
  - Le portail client Stripe permet d'annuler (Scheduled Cancellation). Il faut vérifier trois points :
    - un bouton libellé ainsi sur la page Abonnement de Jobbbox, et pas seulement à l'intérieur du portail ;
    - le nombre d'étapes ;
    - l'accusé de réception avec la date de fin.
  - **Juriste**.
- **Préavis** : 10 jours au plus après réception de la demande de résiliation, pour un service numérique sans durée minimale (L224-25-9). La Scheduled Cancellation « à la fin de la période payée » reste compatible, car le Candidate n'est pas prélevé ensuite.
- **Information sur la reconduction tacite** (L215-1) : elle s'applique aux contrats « à durée déterminée » avec reconduction tacite. Il faut écrire au Candidate entre 3 mois et 1 mois avant la date limite de non-reconduction. Un abonnement mensuel sans terme se lit plutôt comme un contrat à durée indéterminée, résiliable à tout moment. Un **Plan annuel** relève clairement de L215-1 : il faut l'e-mail de rappel avec un encadré, et l'article reproduit dans les CGV (fiche DGCCRF). **Juriste** sur la qualification du mensuel.

### 3.5 Garanties et conformité

Garantie légale de conformité des services numériques (L224-25-12 et s.) et mises à jour (L224-25-24 à L224-25-26) : à mentionner dans les CGV.

## 4. Nouvelles versions des textes

| Texte | Changement | Ce qu'il faut |
|---|---|---|
| CGU / CGV, prix d'un abonnement en cours | Hausse de prix | Une clause qui laisse le professionnel modifier seul la durée, les caractéristiques ou le prix est abusive de façon irréfragable (R212-1 3°). Exception pour un contrat à durée indéterminée : la clause peut prévoir une modification du prix si le consommateur est averti « dans un délai raisonnable » pour pouvoir résilier (R212-4). En pratique : préavis d'au moins un mois par e-mail, avec rappel du droit de résilier sans frais. Le nouveau prix ne s'applique qu'à l'échéance suivante. |
| Service numérique (fonctionnalités, Plan Quotas) | Modification hors maintien de la conformité | L224-25-26 : le contrat autorise le principe et donne une raison valable ; information claire, à l'avance, sur support durable ; aucun coût supplémentaire. Si la modification nuit à l'usage, le Candidate peut résoudre le contrat, gratuitement, dans un délai maximal de 30 jours. **Conséquence** : une baisse de Plan Quota en Back Office qui s'applique « à l'instant » (ADR-0014) va contre ce régime pour les abonnés en cours. Elle doit être annoncée et donner ce droit, ou ne s'appliquer qu'aux nouveaux abonnements. **Juriste.** |
| CGU (Free, Guest) | Toute modification | Même logique (R212-1 3°, L224-25-26). Informer à l'avance, laisser la possibilité de supprimer le compte (Account deletion), et faire accepter de nouveau à la connexion suivante si la modification est substantielle. |
| CGV, contrats déjà conclus | — | La version acceptée au moment du contrat reste celle qui s'applique à ce contrat, sauf modification valable selon les lignes ci-dessus. |
| Politique de confidentialité | Nouvelle finalité ou changement substantiel | Ce n'est pas un contrat : pas d'acceptation. Il faut informer **avant** le traitement nouveau (RGPD art. 13(3) ; WP260 § 29 à 32 : changement porté activement à la connaissance des personnes, pas seulement publié). Si une base de consentement est en jeu, comme l'EU AI Consent, il faut un nouveau consentement. |

## 5. Acceptation : ce qui se signe, comment, et la preuve

### 5.1 Mécanique

- **CGU** : case à cocher **non pré-cochée** à l'inscription (Candidate), « J'accepte les CGU (version du JJ/MM/AAAA) » avec lien. C'est ce qui rend des conditions générales opposables : elles ont été portées à la connaissance de la partie et acceptées (C. civ. 1119). Une case pré-cochée ne vaut pas consentement au sens du RGPD (CJUE *Planet49*). Par prudence, on applique la même règle à l'acceptation des CGU.
- **CGV** : avant le paiement, sur la page Jobbbox qui précède la redirection vers Checkout, deux cases distinctes :
  1. « J'accepte les CGV (version …) » ;
  2. « Je demande que le service commence immédiatement. Je comprends qu'en cas de rétractation je paierai le service déjà fourni » (L221-25). Pour une Coaching Session : « … et que je perds mon droit de rétractation une fois la séance réalisée » (L221-28 1°).
- **Alternative Stripe.** `consent_collection.terms_of_service = required` affiche dans Checkout une case vers l'URL des conditions configurée dans les informations publiques du compte. Le résultat est lu dans `session.consent.terms_of_service = accepted` (doc Stripe). Limites :
  - une seule URL par compte, donc pas de version ;
  - un seul consentement ;
  - les champs personnalisés sont limités à trois et Stripe déconseille d'y recueillir des informations légales.
  - Recommandation : recueillir les deux cases chez Jobbbox. Stripe n'est qu'un complément éventuel.
- **Politique de confidentialité, cookies, mentions légales** : aucune acceptation. Il suffit d'un lien au moment de la collecte, par exemple « En créant un compte, vous êtes informé(e) de notre politique de confidentialité ». L'EU AI Consent reste un consentement distinct.

### 5.2 Preuve : ce qu'il faut garder

Une table d'acceptations, une ligne par acceptation :
- Candidate, document (CGU, CGV), identifiant de version, date d'effet de la version ;
- date et heure de l'acceptation, canal (inscription, paiement de Plan, paiement de Coaching Session, nouvelle acceptation) ;
- pour un paiement : l'identifiant de la session Checkout et la demande d'exécution immédiate (oui/non) ;
- le texte exact de chaque version, archivé et immuable (fichier versionné daté, avec une empreinte) ;
- pas d'adresse IP ni d'agent utilisateur bruts : le lien au compte authentifié suffit (minimisation, RGPD art. 5(1)(c)). **Juriste** si une preuve plus forte est souhaitée.

**Durée de conservation :**
- contrat d'un montant ≥ 120 € conclu par voie électronique : 10 ans (L213-1 ; D213-1). Un Plan annuel ou un cumul d'abonnement peut atteindre ce seuil. **Juriste** sur le calcul pour un abonnement mensuel ;
- sinon : durée du contrat, plus la prescription. Par simplicité, 10 ans après la fin du dernier contrat payant pour les CGV, et 5 ans après la suppression du compte pour les CGU.
- Cela doit survivre à l'Account deletion, qui supprime « everything tied to the Candidate ». Il faut donc :
  - une exception documentée : nouvelle entrée du registre, intérêt légitime ou obligation légale ;
  - l'ajout de la table à `OPERATIONS_RECORD_TABLES` ;
  - la ligne d'acceptation dans le Data export.

### 5.3 Pourquoi la politique de confidentialité ne s'accepte pas

Les bases des traitements sont le contrat, l'intérêt légitime, l'obligation légale et, pour l'EU AI Consent, le consentement. Faire « accepter » la politique ferait croire à un consentement global. Or un consentement doit être spécifique (RGPD art. 4(11), 7). Le CEPD/WP260 traite la politique de confidentialité comme une information.

## 6. Cookies et traceurs

- **Règle** (loi I&L art. 82) : il faut le consentement pour lire ou écrire dans le terminal, sauf pour les traceurs strictement nécessaires au service demandé, ou ceux qui ont pour seule finalité de permettre la communication.
- **Liste CNIL des traceurs exemptés** (délibération 2020-091, art. 5) :
  - authentification ;
  - conservation des choix sur les traceurs ;
  - panier ;
  - « personnalisation de l'interface utilisateur », si elle est un élément intrinsèque et attendu du service ;
  - équilibrage de charge ;
  - mesure d'audience strictement limitée, qui ne produit que des statistiques anonymes.
- **Constat dans le code (2026-10-29)** :
  - cookie de session Better Auth (authentification, ADR-0011) ;
  - `localStorage` / `sessionStorage` pour l'état de la Sidebar, la taille du texte, le thème, l'Agenda et le Coach Panel (personnalisation de l'interface) ;
  - `sessionStorage` de l'extension pour la Guest session (CV et Job Offer conservés à la demande du Guest) ;
  - aucun outil d'audience, de publicité ni de pixel.
  - Tout est exempté. **Pas de bandeau.**
- **Ce qui reste dû** : la CNIL recommande d'informer quand même, dans une section « Cookies et traceurs » de la politique de confidentialité, avec la liste, la finalité et la durée de chaque traceur (recommandation 2020-092 consolidée).
- **Stripe Checkout** se charge sur le domaine de Stripe. Ses traceurs (anti-fraude) relèvent de Stripe. Les mentionner par un lien. **Juriste** si Stripe.js est un jour chargé sur le domaine de Jobbbox.
- **Le bandeau ne devient obligatoire** qu'avec un outil d'audience non exempté, de la publicité, un pixel, ou une vidéo intégrée qui dépose des traceurs. Ce dernier cas concerne directement les **motions** de #494 : héberger les vidéos soi-même, ou utiliser un lecteur sans traceur avant le clic. C'est le point « Bandeau cookies » laissé ouvert dans #494.

## 7. Par rôle

| Rôle | Mentions légales | CGU | CGV | Confidentialité | Particularités |
|---|---|---|---|---|---|
| **Visitor** (site public) | Oui | Non (aucun service rendu) | Non | Oui : journaux serveur, éventuel formulaire de contact | Cookies : rien à demander tant que le site public ne dépose pas de traceur non exempté |
| **Guest** (extension sans compte, ADR-0003) | Oui (lien depuis l'extension et la fiche Chrome Web Store) | Oui, en version courte : une case ou une mention claire avant le premier envoi de CV. Un usage gratuit reste un contrat de service numérique. **Juriste** sur l'opposabilité d'une simple mention | Non | Oui, **avant** l'envoi du CV : CV en mémoire de session, lu par règles sans IA, effacé dans les 23 h (ADR-0003). Le Chrome Web Store exige une politique de confidentialité dès qu'une extension traite des données utilisateur, même stockées localement, et une divulgation visible avant l'installation qui ne soit pas seulement dans la politique | Les appels IA de Guests apparaissent dans l'AI Message Log sans identifiant (registre) : à dire dans la politique |
| **Candidate** | Oui | Oui, à l'inscription | Oui, à chaque achat | Oui | Mineurs : un consentement (EU AI Consent) donné par un mineur de moins de 15 ans exige l'accord du titulaire de l'autorité parentale (loi I&L art. 45 ; RGPD art. 8). Fixer dans les CGU un âge minimum (16 ou 18 ans). **Juriste** |
| **Human Coach** | Oui | Non : son rapport avec Jobbbox est un **contrat de prestation B2B** (non public), qui couvre la sélection, la rémunération, la confidentialité et la sous-traitance des données des Candidates (RGPD art. 28 ou responsabilité conjointe, **Juriste**). L'espace coach peut y renvoyer | Non (il ne paie pas) | Oui, au moment de son ajout : nom, e-mail, bio publiée, lien Cal.com (registre « Back Office Audit ») | **Côté Candidate**, les CGV doivent dire qui exécute la Coaching Session. Jobbbox fixe le prix et encaisse : Jobbbox est le vendeur, et le Human Coach son prestataire (art. L221-5 : identité du professionnel). Rétractation : §3.2 |
| **Administrator** | — | Non (règlement interne et contrat de travail) | — | Oui, une note interne : Back Office Audit, Back Office Assistant (registre) | Hors documentation publique, sauf les traitements qui touchent des tiers |

## 8. Autres textes à vérifier (hors périmètre strict, mais à trancher)

- **L111-7 (comparateur et place de marché).** Depuis la loi SREN, le I est abrogé et le II ne vise plus que les fournisseurs de **places de marché** et de **comparateurs en ligne**. Jobbbox classe des Job Offers de tiers (Match Score) mais ne vend rien pour eux. Il est probablement hors champ, mais publier les principaux critères du Match Score dans l'aide est utile en tout état de cause. **Juriste.**
- **DSA (règlement 2022/2065).** Jobbbox stocke des contenus fournis par le Candidate (CV), ce qui ressemble à un service d'hébergement (art. 3(g)(iii)), même sans diffusion au public. Si c'est le cas, l'art. 14 (règles de modération dans les CGU) et les art. 11 et 12 (points de contact) s'appliquent, sans les obligations des plateformes en ligne. **Juriste.**
- **Accessibilité (directive 2019/882, décret 2023-931, depuis le 28 juin 2025).** Le commerce électronique est visé. Selon la DGCCRF, une microentreprise (moins de 10 salariés et au plus 2 M€) qui fournit des services n'a pas d'obligation. Une exemption se déclare. À vérifier selon la taille de Jobbbox. Le plancher 40+ (ADR-0009) va de toute façon au-delà.
- **Registre.** La politique publique devra dire la vérité sur les transferts hors UE (Claude en direct, Stripe), contrairement à l'en-tête actuel de `docs/privacy/register.md` (« no transfer outside the EU »), déjà signalé dans #494 et `issue-318.md`.

## 9. Conséquences pour les issues de rédaction (#494)

1. **Textes** (rédaction, puis IA juridique, puis juriste) : mentions légales ; CGU (Candidate et Guest) ; CGV (Plans et Coaching Sessions) avec le formulaire de rétractation ; politique de confidentialité avec ses sections « Cookies et traceurs » et « IA dans Jobbbox ».
2. **Versionnage** : un fichier par version et par langue, avec une date d'effet. La page publique affiche la version en vigueur et donne accès aux versions précédentes.
3. **Acceptations tracées** : table d'acceptations ; cases à l'inscription et avant Checkout ; nouvelle acceptation à la connexion après une modification substantielle ; exception à l'Account deletion ; Data export ; entrée au registre.
4. **Parcours d'achat** :
   - demande expresse d'exécution immédiate ;
   - libellé du bouton de commande ;
   - e-mail de confirmation avec les CGV ;
   - **fonctionnalité « renoncer au contrat ici »** et accusé de réception ;
   - remboursement au prorata ;
   - bouton « résilier votre contrat » sur la page Abonnement ;
   - rappel de reconduction pour un Plan annuel.
5. **Encadrer les changements** de Plan Quotas et de prix pour les abonnés en cours (§4).
6. **Liens** dans l'en-tête et le pied de page du site, de l'app et de l'extension, et sur la fiche Chrome Web Store.
7. **Désigner un médiateur de la consommation** : une action de l'entreprise, pas du code. Ses coordonnées vont dans les mentions légales et les CGV.

## Points pour le juriste

1. Qualification de l'abonnement comme « service numérique » (L221-25, prorata) plutôt que « contenu numérique » (L221-28 13°).
2. Coaching Session : demande expresse et renoncement quand la date est réservée après le paiement.
3. Libellé du bouton Stripe Checkout en mode abonnement au regard de L221-14.
4. Conformité du portail client Stripe à L215-1-1 et D215-1, ou bouton propre à Jobbbox.
5. Plan mensuel : contrat à durée indéterminée ou à durée déterminée reconduite (L215-1) ; calcul du seuil de 120 € (D213-1).
6. Baisse d'un Plan Quota ou hausse de prix pour les abonnés en cours (R212-1 3°, R212-4, L224-25-26).
7. Opposabilité des CGU au Guest sans case à cocher ; âge minimum.
8. Rapport avec le Human Coach : sous-traitant ou responsable conjoint ; contenu du contrat B2B.
9. Champ L111-7 et DSA (hébergement) pour Jobbbox.
10. Exemption « microentreprise » de la directive Accessibilité.
11. Niveau de preuve d'acceptation (faut-il l'IP et l'agent utilisateur ?) et durées de conservation.
