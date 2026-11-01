# Playbook juridique FR : Legal Review de Jobbbox

Playbook du plugin `legal` pour Jobbbox. Il **remplace les positions américaines par défaut** du plugin (Delaware, New York, Californie ; plafonds de responsabilité en mois d'honoraires, indemnification, etc.) : Jobbbox publie des textes pour des consommateurs français, sous le droit français et le droit de l'Union.

Décidé par #507 (circuit de relecture), livré par #525. Recherches : `docs/research/issue-495.md` (outil), `docs/research/issue-496.md` (documents obligatoires et les 11 points), `docs/research/issue-318.md` (AI Act art. 50). Termes : **Legal Text**, **Legal Text Version**, **Legal Review**, **Acceptance** (`CONTEXT.md`). Décisions : ADR-0062 (versions dans le dépôt), ADR-0064 (« IA dans Jobbbox » et Recipient list), ADR-0007 (hébergement UE, IA interchangeable).

**Ceci n'est pas un avis juridique.** Il n'y a pas de juriste à ce stade (#507) : la Legal Review est une évaluation par IA, signée par le product owner, et un juriste n'est appelé que sur un déclencheur de la liste fermée du § 8.

## 0. Règles pour l'agent qui fait la Legal Review

1. **Droit applicable** : droit français (Code de la consommation, Code civil, LCEN, loi Informatique et Libertés, loi Toubon) et droit de l'Union (RGPD, AI Act, directive 2011/83, DSA). Aucune référence au droit américain, aucune position « standard » US. Une notion qui n'existe qu'en droit US (indemnification, warranty disclaimer « AS IS », class action waiver, arbitrage obligatoire, choix d'un for étranger) est un **constat** dans un texte destiné à un consommateur français, jamais une recommandation.
2. **Le consommateur d'abord** : la Legal Review évalue un texte proposé à un consommateur (B2C). Une clause qui serait banale entre professionnels peut être abusive ici (C. conso. L212-1, R212-1, R212-2).
3. **Citer exactement** : chaque constat cite l'article, son code ou son texte, et le lien de la table des sources (§ 9). Un article absent de la table est cité avec son lien Légifrance, EUR-Lex ou CNIL et marqué « à ajouter au playbook ». Un article dont l'agent n'est pas sûr est marqué **« à vérifier »** : il ne compte pas comme vérifié pour la condition de merge (§ 6).
4. **Ne rien inventer** : un fait que seul le product owner connaît (entité, identifiants, médiateur, adresse, prix) n'est jamais complété par l'agent. Il reste un **placeholder visible** `[À FOURNIR : …]` et devient un constat ouvert.
5. **Le français fait foi** (loi Toubon art. 2 ; ADR-0062). L'anglais est une traduction, vérifiée pour sa seule fidélité (§ 7).
6. **Position prudente** : quand la loi laisse un doute, le texte prend **la position la plus protectrice pour le consommateur** (#507), et la Legal Review la nomme dans la liste des positions prudentes (§ 6). Les positions déjà retenues sont au § 4.
7. **Pas d'avertissement public** : le texte publié ne dit ni « non relu par un avocat » ni « rédigé avec une IA » (#507). La trace reste dans la PR.

## 1. Faits fixes sur Jobbbox

| Fait | Valeur | Source |
|---|---|---|
| Éditeur, forme, capital, siège, RCS/SIREN, TVA, téléphone | `[À FOURNIR : entité juridique qui édite Jobbbox et ses identifiants]` | #572 |
| Directeur de la publication | Le product owner, représentant légal | #507, #572 |
| Médiateur de la consommation | `[À FOURNIR : médiateur désigné, coordonnées et site]` | #496 § 9.7 |
| Adresse e-mail de contact | Celle de l'article d'aide « Nous contacter » | #572, ADR-0035 |
| Hébergeur | Hostinger International Ltd (Chypre), serveur à Paris | #522, #572 |
| Public | Consommateurs (B2C). Rôles : Visitor, Guest (extension sans compte), Candidate, Human Coach, Administrator | `CONTEXT.md` |
| Âge minimum | 18 ans, écrit dans les CGU, sans case séparée | ADR-0062 |
| Ce qui se vend | Plans payants (abonnement Stripe) et Coaching Sessions (séance vidéo avec un Human Coach, date réservée sur Cal.com après le paiement) | ADR-0014, ADR-0016, ADR-0027 |
| Vendeur de la Coaching Session | Jobbbox, qui fixe le prix et encaisse ; le Human Coach est son prestataire | #496 § 7 |
| Ce qui s'accepte | CGU et CGV seulement ; la politique de confidentialité et les mentions légales ne s'acceptent jamais | ADR-0062 |
| Traceurs | Uniquement exemptés de consentement : session d'authentification, préférences d'interface, Guest session. Aucun outil d'audience, publicité ni pixel. **Pas de bandeau** | #496 § 6 |
| IA | Claude hors UE après Redaction ; Mistral dans l'UE (identité sous EU AI Consent, lecture des e-mails) ; recherche web hors UE sur requêtes seulement. Les noms vont dans la Recipient list `/legal/destinataires` | ADR-0064, ADR-0007 |
| Fichiers | `packages/help/legal/<texte>/<AAAA-MM-JJ>.<fr|en>.md`, `<texte>` parmi `mentions-legales`, `cgu`, `cgv`, `confidentialite` ; frontmatter `title`, `effective`, `change: substantielle | mineure`, `approved_by`, `summary` ; pour `confidentialite`, aussi `recipients_outside_eu: [<id de Tool>, …]` (`[]` si aucun), les Tools hors UE (ou de résidence non établie) que la version couvre, chaque id existant dans `packages/shared/src/tools.ts` | ADR-0062, #546, ADR-0064, #548 |

## 2. Échelle de risque pour `legal-risk-assessment`

La grille gravité × probabilité du plugin est gardée (score = gravité × probabilité ; 10 à 15 = **élevé**, 16 à 25 = **critique**). Ses seuils en pourcentage de la valeur d'un contrat ne s'appliquent pas à un texte public. Pour Jobbbox, la **gravité** se lit ainsi :

| Gravité | Pour un Legal Text de Jobbbox |
|---|---|
| 5 Critique | Obligation légale absente qui rend le contrat inopposable ou ouvre une sanction lourde : information sur la rétractation manquante (le délai est prolongé de 12 mois, L221-20 [S4]), fonction « renoncer au contrat ici » absente, traitement de données sans information ni base légale (RGPD art. 83 [S30] : jusqu'à 4 % du CA mondial), clause « noire » irréfragablement abusive (R212-1). |
| 4 Élevé | Mention obligatoire manquante sanctionnée d'une amende administrative (LCEN art. 1-1, L215-1-1 et L241-3-1, médiateur L616-1), clause « grise » présumée abusive (R212-2), information RGPD art. 13 ou 14 incomplète, information AI Act art. 50 absente, contradiction avec le comportement réel du produit. |
| 3 Moyen | Rédaction ambiguë interprétée contre Jobbbox (C. civ. 1190 [S42] ; C. conso. L211-1 [S43]), renvoi à une page qui n'existe pas, recommandation CNIL non suivie sans obligation dure. |
| 2 Faible | Lisibilité, ordre des sections, tonalité. |
| 1 Négligeable | Typographie. |

La **probabilité** tient compte de ce que Jobbbox est petit et grand public : un contrôle DGCCRF ou CNIL est rare, mais un consommateur mécontent invoque facilement une clause abusive ou une rétractation. Dans le doute, la probabilité est « possible » (3), jamais « improbable ».

« Constat élevé ou critique » au sens de la condition de merge (§ 6) = score ≥ 10.

## 3. Grille par texte

Chaque ligne est un point à vérifier dans le texte. « Lien » renvoie à la table des sources (§ 9). Les sections exigées ont des ancres stables (#546) : `#cookies` et `#ia` dans `confidentialite`, `#invite` dans `cgu`, `#retractation` dans `cgv`.

### 3.1 Mentions légales (`mentions-legales`)

Information, jamais acceptée (`change: mineure` par défaut). Accessible depuis chaque page.

| # | Point | Base |
|---|---|---|
| ML1 | Dénomination ou raison sociale, forme, siège social, téléphone, adresse e-mail | LCEN art. 1-1 I [S1] |
| ML2 | Numéro RCS ou SIREN, capital social | LCEN art. 1-1 I [S1] |
| ML3 | Directeur de la publication (le product owner) | LCEN art. 1-1 I [S1] |
| ML4 | Hébergeur : nom, dénomination, adresse, téléphone | LCEN art. 1-1 I 5° [S1] |
| ML5 | Médiateur de la consommation : coordonnées et site, « de manière visible et lisible » | C. conso. L616-1 [S14], R616-1 [S15] |
| ML6 | Numéro de TVA intracommunautaire, adresse électronique (commerce électronique) | LCEN art. 19 [S2] (« à vérifier » tant que l'article n'est pas relu) |
| ML7 | Pas de lien vers la plateforme européenne RLL (abrogée le 20 juillet 2025) | Règlement (UE) 2024/3228 [S40] |
| ML8 | Propriété intellectuelle de la marque et des contenus ; « Signaler un contenu » avec une adresse | #572 ; DSA art. 11, 12 et 16 si le point 9 du § 4 s'applique [S38] |
| ML9 | Renvois vers CGU, CGV, politique de confidentialité, Recipient list | ADR-0064 |

### 3.2 CGU (`cgu`)

Contrat d'usage du service, Free compris, et de l'extension. Accepté sur l'écran après connexion (ADR-0062) ; version courte cochée par le Guest dans l'extension (`#invite`).

| # | Point | Base |
|---|---|---|
| CGU1 | Identité de Jobbbox et moyen de la joindre | C. conso. L221-5 [S3] ; C. civ. 1127-1 [S22] |
| CGU2 | Conditions générales portées à la connaissance et acceptées, reproductibles et conservables (page HTML stable par version, PDF) | C. civ. 1119, 1127-1 [S22] |
| CGU3 | Description du service, des rôles et de ce que l'IA fait ; aucune promesse de résultat d'embauche | L111-1 [S5] ; ADR-0006 (le Tailored CV n'invente aucun fait) |
| CGU4 | Âge minimum 18 ans | ADR-0062 ; RGPD art. 8 [S30] ; loi I&L art. 45 [S26] |
| CGU5 | Section Guest (`#invite`) : CV en mémoire de session, lu sans IA, effacé sous 23 h | ADR-0003 |
| CGU6 | Modification des CGU : information à l'avance, e-mail ≥ 30 jours avant une version substantielle, nouvelle Acceptance, possibilité de supprimer le compte ; aucune modification unilatérale des caractéristiques essentielles | R212-1 3° [S12] ; L224-25-26 [S20] ; ADR-0062 |
| CGU7 | Responsabilité : aucune clause qui supprime ou réduit le droit à réparation du consommateur en cas de manquement de Jobbbox | R212-1 6° [S12] |
| CGU8 | Résiliation par le Candidate à tout moment (Account deletion) ; suspension ou résiliation par Jobbbox seulement pour un motif écrit et avec un préavis raisonnable, sauf manquement grave | R212-1 8° [S12] ; R212-2 4° [S13] |
| CGU9 | Garantie légale de conformité du service numérique et mises à jour | L224-25-12 et s. [S19b], L224-25-24 à L224-25-26 [S20] |
| CGU10 | Contenus fournis par le Candidate (CV) : règles d'usage et de modération, point de contact | DSA art. 11, 12, 14 [S38] (position prudente, § 4 point 9) |
| CGU11 | Classement des offres : principaux critères du Match Score | L111-7 [S6] (position prudente, § 4 point 9) |
| CGU12 | Médiateur de la consommation et droit applicable français ; aucune clause attributive de juridiction qui prive le consommateur de son juge | L616-1 [S14] ; R212-2 10° [S13] |
| CGU13 | Le français fait foi ; l'EN est marqué « traduction, le texte français fait foi » | loi Toubon art. 2 [S27] ; ADR-0062 |

### 3.3 CGV (`cgv`) et formulaire de rétractation

Plans payants et Coaching Sessions. Acceptées avant le paiement, à chaque achat, avec la demande expresse d'exécution immédiate. Le contrat garde la version acceptée à l'achat.

| # | Point | Base |
|---|---|---|
| CGV1 | Information précontractuelle : caractéristiques essentielles (Plans, Plan Quotas par semaine, Plan Features, renvoi à la comparaison des Plans), prix TTC, périodicité, reconduction, identité et coordonnées de Jobbbox | L221-5 [S3] ; L111-1 [S5] |
| CGV2 | Droit de rétractation : 14 jours à compter de la conclusion, conditions, délai, modalités | L221-18 et s. [S4] |
| CGV3 | Formulaire type de rétractation joint (`#retractation`) | L221-5 7° [S3] ; annexe à l'art. R221-1 [S8] |
| CGV4 | Existence et emplacement de la fonction **« Renoncer au contrat ici »** (page `/abonnement` pour un Plan, Agenda pour une Coaching Session), son bouton « Confirmer la rétractation », l'accusé de réception sur support durable | L221-21 al. 3 [S7] ; D221-5 [S9] ; L221-5 7° [S3] ; #511 |
| CGV5 | Demande expresse d'exécution immédiate et coût en cas de rétractation (prorata) ; sans demande expresse recueillie, rien n'est dû | L221-25 [S4] ; L221-5 9° [S3] |
| CGV6 | Coaching Session : perte du droit de rétractation une fois la séance pleinement exécutée, seulement avec demande expresse et reconnaissance de la perte | L221-28 1° [S10] |
| CGV7 | Remboursement sous 14 jours, par le même moyen de paiement | L221-24 [S4] |
| CGV8 | Bouton de commande : « commande avec obligation de paiement » ou formule analogue sans ambiguïté | L221-14 [S11] (position prudente, § 4 point 3) |
| CGV9 | Récapitulatif et correction avant confirmation ; confirmation sur support durable avec les CGV acceptées (e-mail Jobbbox, pas le seul reçu Stripe) | C. civ. 1127-2 [S23] ; L221-13 [S4b] |
| CGV10 | Résiliation en trois clics : fonction gratuite « Résilier votre contrat » sur la page Abonnement de Jobbbox, accusé de réception avec la date de fin | L215-1-1 [S16] ; D215-1 [S17] ; L241-3-1 [S21] |
| CGV11 | Préavis de résiliation ≤ 10 jours pour un service numérique sans durée minimale ; Scheduled Cancellation à la fin de la période payée sans nouveau prélèvement | L224-25-9 [S19] |
| CGV12 | Plan annuel : information sur la reconduction tacite entre 3 mois et 1 mois avant l'échéance, article L215-1 reproduit | L215-1 [S18] |
| CGV13 | Modification du prix d'un abonnement en cours : préavis d'au moins un mois par e-mail, droit de résilier sans frais, nouveau prix à l'échéance suivante seulement | R212-1 3° [S12] ; R212-4 [S13b] |
| CGV14 | Baisse d'un Plan Quota ou retrait d'une Plan Feature : raison valable, préavis de 30 jours sur support durable, droit de résoudre sans frais avec prorata | L224-25-26 [S20] ; #514 |
| CGV15 | Garantie légale de conformité du service numérique | L224-25-12 et s. [S19b] |
| CGV16 | Qui exécute la Coaching Session : Jobbbox vend, le Human Coach est son prestataire ; Jobbbox reste l'interlocuteur du Candidate | L221-5 [S3] ; #496 § 7 |
| CGV17 | Médiateur de la consommation (coordonnées) | L616-1 [S14] ; L221-5 6° [S3] |
| CGV18 | Aucune clause abusive : liste noire R212-1, liste grise R212-2 | L212-1 [S12a] ; R212-1 [S12] ; R212-2 [S13] |
| CGV19 | Conservation de la preuve du contrat ≥ 120 € : 10 ans, et accès du consommateur | L213-1 [S24] ; D213-1 [S25] |
| CGV20 | Changement de Plan dans le portail : n'ouvre pas de nouveau délai de rétractation (hypothèse de #511, à écrire) | #511 |

### 3.4 Politique de confidentialité (`confidentialite`)

Information, jamais acceptée (ADR-0062). Une version substantielle (nouvelle finalité, nouveau destinataire hors UE) est annoncée par e-mail avant son entrée en vigueur (ADR-0064).

| # | Point | Base |
|---|---|---|
| PC1 | Information concise, transparente, compréhensible, en termes clairs et simples | RGPD art. 12 [S30] ; WP260 rév.01 [S41] |
| PC2 | Identité et coordonnées du responsable du traitement (l'entité de § 1) ; DPO s'il y en a un | RGPD art. 13(1)(a)(b) [S30] |
| PC3 | Pour chaque traitement : finalités et base juridique ; intérêt légitime nommé quand il est la base | RGPD art. 13(1)(c)(d) [S30] ; `docs/privacy/register.md` |
| PC4 | Destinataires, et transferts hors UE avec leur garantie (renvoi à la Recipient list `/legal/destinataires`) ; dire vrai sur Claude hors UE et Stripe | RGPD art. 13(1)(e)(f), 44 et s. [S30] ; ADR-0064 |
| PC5 | Durées de conservation par traitement, dont les Acceptances (10 ans CGV, 5 ans CGU après Account deletion) | RGPD art. 13(2)(a) [S30] ; #510 |
| PC6 | Droits : accès, rectification, effacement, limitation, opposition, portabilité, retrait du consentement, réclamation auprès de la CNIL, directives post mortem | RGPD art. 13(2)(b)(c)(d), 15 à 22 [S30] ; loi I&L art. 85 [S26] |
| PC7 | Données reçues d'un tiers (offres reçues par e-mail, Company Dossier) : source et catégories | RGPD art. 14 [S30] |
| PC8 | Décision automatisée et profilage (Match Score) : existence, logique, conséquences ; dire qu'aucune décision ne produit d'effet juridique | RGPD art. 13(2)(f), 22 [S30] |
| PC9 | Par rôle : Visitor, Guest (avant l'envoi du CV, appels IA sans identifiant), Candidate, Human Coach ; mineurs exclus (18 ans) | #496 § 7 ; ADR-0003 |
| PC10 | EU AI Consent : consentement distinct, spécifique, retirable ; la politique elle-même n'est pas « acceptée » | RGPD art. 4(11), 7 [S30] ; ADR-0062 |
| PC11 | Section **« Cookies et traceurs »** (`#cookies`) : liste, finalité et durée de chaque traceur ; tous exemptés, d'où l'absence de bandeau ; Stripe Checkout sur le domaine de Stripe, par lien | loi I&L art. 82 [S26] ; CNIL 2020-091 art. 5 [S31] ; CNIL 2020-092 [S32] |
| PC12 | Section **« IA dans Jobbbox »** (`#ia`) : informer qu'on interagit avec une IA (AI Coach, Back Office Assistant) au plus tard à la première interaction ; dire que les textes générés sont marqués ; décrire les routes (Claude hors UE après Redaction, Mistral UE, recherche web sur requêtes), les Guardrails et leurs limites ; renvoi à la Recipient list pour les noms | AI Act art. 50(1), 50(2), 50(5) [S34] ; ADR-0007 ; ADR-0064 ; `docs/research/issue-318.md` |
| PC13 | Changement de la politique : information active avant le traitement nouveau | RGPD art. 13(3) [S30] ; WP260 § 29 à 32 [S41] |

### 3.5 Points communs à tous les textes

| # | Point | Base |
|---|---|---|
| T1 | Fichier au format de #546 : `effective` égale au nom du fichier, `change`, `summary` FR et EN, `approved_by` laissé au product owner ; pour la politique de confidentialité, `recipients_outside_eu` identique en FR et EN, et un destinataire hors UE ajouté rend la version substantielle | ADR-0062, #546, ADR-0064, #548 |
| T2 | Le texte dit ce que le produit fait vraiment : chaque fonction citée (« Renoncer au contrat ici », « Résilier votre contrat », écran d'Acceptance, Data export) existe ou la PR est suspendue jusqu'à sa livraison | #507 |
| T3 | Les libellés de l'interface sont cités mot pour mot | `docs/agents/documentation.md` |
| T4 | Vouvoiement, français clair ; un « En bref » en tête n'a pas de valeur contractuelle et le dit | `docs/agents/documentation.md` |

## 4. Les 11 points de #496 et la position prudente retenue

Chaque point reste ouvert pour un juriste ; en attendant, le texte prend la position ci-dessous, la plus protectrice pour le consommateur (#507). Une Legal Review qui s'en écarte la signale comme constat **élevé**.

| # | Point (#496) | Position prudente retenue | Où elle est écrite |
|---|---|---|---|
| 1 | Abonnement : service numérique (L221-25, prorata) ou contenu numérique (L221-28 13°) | **Service numérique** : le droit de rétractation de 14 jours s'applique ; le Candidate qui se rétracte après une demande expresse ne paie que le prorata ; sans demande expresse recueillie, il ne doit rien. Tant que la page avant Checkout (#512) ne recueille pas la demande, remboursement **intégral**. | #507 ; #511 ; CGV2, CGV5 |
| 2 | Coaching Session : demande expresse et renoncement quand la date est réservée après le paiement | Demande expresse recueillie **à chaque achat** ; le droit ne s'éteint qu'une fois la séance réalisée et avec la reconnaissance de la perte ; avant la séance, remboursement intégral, séance annulée, Human Coach prévenu. | #511 ; CGV6 |
| 3 | Libellé du bouton Stripe Checkout en mode abonnement (L221-14) | « S'abonner » seul **n'est pas tenu pour suffisant**. Le libellé doit dire le paiement (« Payer », « Commander avec obligation de paiement ») ; sinon, la page Jobbbox avant Checkout porte ce libellé sur le bouton qui engage. | CGV8 |
| 4 | Portail client Stripe et L215-1-1 / D215-1 | Un bouton **« Résilier votre contrat »** sur la page Abonnement de Jobbbox, pas seulement dans le portail, avec un accusé de réception qui donne la date de fin. | CGV10 |
| 5 | Plan mensuel : durée indéterminée ou déterminée reconduite (L215-1) ; seuil de 120 € (D213-1) | Mensuel **résiliable à tout moment** ; un Plan annuel reçoit l'information de L215-1. Preuve gardée **10 ans** après la fin du dernier contrat payant, quel que soit le montant cumulé. | #510 ; CGV11, CGV12, CGV19 |
| 6 | Baisse d'un Plan Quota ou hausse de prix pour les abonnés en cours (R212-1 3°, R212-4, L224-25-26) | Baisse **programmée à 30 jours** au moins, annoncée par e-mail avec la raison, droit de résilier sans frais avec remboursement au prorata avant la date d'effet ou dans les 30 jours qui suivent. Hausse de prix : préavis d'au moins un mois, appliquée à l'échéance suivante. | #514 ; CGV13, CGV14 |
| 7 | Opposabilité des CGU au Guest ; âge minimum | **Case à cocher** des CGU courtes dans l'extension avant l'envoi du CV (pas une simple mention) ; âge minimum **18 ans**. | ADR-0062 ; CGU4, CGU5 |
| 8 | Human Coach : sous-traitant ou responsable conjoint ; contrat B2B | Jobbbox est le **vendeur et le seul interlocuteur** du Candidate ; la politique traite le Human Coach comme destinataire agissant pour Jobbbox ; le contrat B2B (#518) est un déclencheur du juriste (§ 8 d). | CGV16 ; PC4 |
| 9 | Champ de L111-7 et du DSA (hébergement) | Appliquer **comme si** Jobbbox était visé : publier les principaux critères du Match Score ; dans les CGU, règles d'usage des contenus fournis, point de contact et moyen de signaler un contenu (DSA art. 11, 12, 14, 16). | CGU10, CGU11, ML8 |
| 10 | Exemption « microentreprise » de la directive Accessibilité | **Ne pas invoquer l'exemption** dans un texte public ; publier une déclaration d'accessibilité courte qui renvoie au plancher d'ADR-0009. | (texte à venir) |
| 11 | Niveau de preuve d'acceptation (IP, agent utilisateur) et durées | **Pas d'IP ni d'agent utilisateur** (minimisation, RGPD art. 5(1)(c)) ; conservation **10 ans** après la fin du dernier contrat payant (CGV), **5 ans** après l'Account deletion (CGU) ; lien au Candidate pseudonymisé après l'Account deletion. | #510 ; PC5 |

Hypothèses déjà écrites dans les issues, à reprendre telles quelles :
- **#510** : pas d'IP ni d'agent utilisateur ; 10 ans (CGV) et 5 ans (CGU) ; Acceptance sur un écran après connexion ; première version des CGU substantielle pour chaque Candidate existant ; tant qu'il n'a pas accepté, le Candidate n'a accès qu'à l'écran d'Acceptance, au Data export, à `/abonnement` et à l'Account deletion.
- **#511** : rétractation sur `/abonnement` et dans l'Agenda ; annulation immédiate et remboursement automatique Stripe ; délai de 14 jours depuis la création de l'abonnement, sans nouveau délai sur changement de Plan ; accusé envoyé même si le remboursement échoue.
- **#514** : préavis de 30 jours pour une baisse ; hausse et baisse sur Free immédiates.

## 5. Procédure de la Legal Review

Une Legal Text Version = une PR (ADR-0062), jamais dans une PR de livraison. Elle s'ouvre avec le gabarit `.github/PULL_REQUEST_TEMPLATE/legal-text-version.md` (URL de création de PR suivie de `?template=legal-text-version.md`).

1. **Brouillon** par un agent, FR d'abord, puis la traduction EN, au format de #546. Les faits inconnus restent `[À FOURNIR : …]`.
2. **`/legal:compliance-check`** sur le fichier FR, avec ce playbook et la grille du § 3 qui correspond au texte. Chaque point de la grille reçoit un statut : conforme, non conforme, absent, ou sans objet (avec la raison). Chaque constat cite son article et son lien (§ 9).
3. **`legal-risk-assessment`** sur les constats, avec l'échelle du § 2 : gravité, probabilité, score, et pour chaque constat élevé ou critique la position prudente qui le referme, ou le déclencheur du juriste qu'il active.
4. **Corriger** le texte jusqu'à ce qu'aucun constat élevé ou critique ne reste ouvert, puis relancer les étapes 2 et 3 sur le texte corrigé.
5. **Rapport dans la PR**, à la place prévue par le gabarit : le tableau des points de la grille, les constats et leur score, la liste des positions prudentes prises (§ 4), les sources vérifiées avec leur lien, et la mention **« Pas de juriste (#507) »**.
6. **Traduction EN** : vérifiée pour sa seule fidélité au FR (§ 7).
7. **Le product owner** relit, fixe la date d'effet, renseigne `approved_by` et merge. **Un agent ne merge jamais une Legal Text Version** (#507 ; hook de #546).

## 6. Condition de merge

Une Legal Text Version ne se merge que si :

- [ ] **aucun constat élevé ou critique ouvert** (score ≥ 10 au § 2) ;
- [ ] **chaque article cité vérifié** sur Légifrance, EUR-Lex ou le site de la CNIL, avec son lien, dans le texte et dans le rapport ; aucun « à vérifier » restant ;
- [ ] **la liste des positions prudentes prises** figure dans le rapport, chacune avec son point du § 4 ;
- [ ] aucun placeholder `[À FOURNIR : …]` dans un fichier dont la date d'effet sera atteinte ;
- [ ] aucun déclencheur du juriste (§ 8) actif ;
- [ ] la case de signature du product owner est cochée par lui.

## 7. Les deux variantes

- **Version mineure** (`change: mineure`) : la Legal Review ne porte **que sur le diff** avec la version précédente du même texte. La grille du § 3 s'applique aux seules lignes touchées, plus les points dont le sens dépend d'elles. Même signature, même condition de merge.
- **Traduction EN** : vérifiée **seulement pour sa fidélité au FR**, qui fait foi : même structure, mêmes ancres, aucun ajout, aucune omission, aucun sens déplacé ; libellés de l'interface repris tels qu'ils s'affichent en anglais ; mention « Translation: the French text prevails » en tête. Pas de Legal Review de fond sur l'EN.

## 8. Déclencheurs du juriste (liste fermée)

Un juriste n'est appelé que dans l'un de ces cas (#507). Un déclencheur actif **suspend la PR** ; la Legal Review le nomme.

- **(a)** un constat élevé ou critique sans position prudente possible ;
- **(b)** une position prudente trop coûteuse pour le produit ;
- **(c)** une mise en demeure, un litige, un contrôle DGCCRF ou CNIL, ou une saisine du médiateur ;
- **(d)** un changement de périmètre : Stripe.js chargé sur le domaine de Jobbbox, un outil d'audience, le contrat B2B avec les Human Coaches (#518), le rôle Organisation ;
- **(e)** **3 000 € de revenu mensuel récurrent** : une consultation forfaitaire sur les 11 points de #496 (§ 4).

Aucun autre motif n'appelle un juriste. L'agent ne recommande pas « l'avis d'un avocat » hors de cette liste ; il écrit la position prudente.

## 9. Sources

Colonne « Vérifié » : **#496** = lien et identité de l'article vérifiés sur le site officiel par la recherche `docs/research/issue-496.md` le 2026-10-29 ; **#495** ou **#318** = lien relevé par cette recherche, identité non revérifiée ; **à vérifier** = à contrôler avant de compter comme vérifié (§ 0 règle 3, § 6). Légifrance sert la version en vigueur le jour de la consultation : la Legal Review relit l'article à la date d'effet de la version qu'elle évalue, et met à jour cette colonne.

| Réf. | Texte | Lien | Vérifié |
|---|---|---|---|
| S1 | LCEN, loi n° 2004-575, art. 1-1 | https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000049568614 | #496 |
| S2 | LCEN, loi n° 2004-575 (texte ; art. 19) | https://www.legifrance.gouv.fr/loda/id/JORFTEXT000000801164 | #495 ; art. 19 à vérifier |
| S3 | C. conso. L221-5 | https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000044563141 | #496 |
| S4 | C. conso. L221-18 à L221-28 (rétractation : L221-18, L221-20, L221-24, L221-25…) | https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000006069565/LEGISCTA000032221365/ | #496 |
| S4b | C. conso. L221-13 (confirmation sur support durable) | `[À COMPLÉTER : lien]` | à vérifier |
| S5 | C. conso. L111-1 | `[À COMPLÉTER : lien]` | à vérifier |
| S6 | C. conso. L111-7 | https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000049571125 | #496 |
| S7 | C. conso. L221-21 | https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000044563193 | #496 |
| S8 | C. conso. annexe à l'art. R221-1 (formulaire type de rétractation) | `[À COMPLÉTER : lien]` | à vérifier |
| S9 | C. conso. D221-5 | https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000053303365 | #496 |
| S10 | C. conso. L221-28 | https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000044563170 | #496 |
| S11 | C. conso. L221-14 | https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000032226854 | #496 |
| S12a | C. conso. L212-1 (clauses abusives) | https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000032227315 | #495 ; à vérifier |
| S12 | C. conso. R212-1 (liste noire) | https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000032807196 | #496 |
| S13 | C. conso. R212-2 (liste grise) | `[À COMPLÉTER : lien]` | à vérifier |
| S13b | C. conso. R212-4 | https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000032807202 | #496 |
| S14 | C. conso. L616-1 | https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000032224762 | #496 |
| S15 | C. conso. R616-1 | https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000032808378 | #496 |
| S16 | C. conso. L215-1-1 | https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000046190107 | #496 |
| S17 | C. conso. D215-1 | https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000047614999 | #496 |
| S18 | C. conso. L215-1 | https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000034072591/ | #496 |
| S19 | C. conso. L224-25-4 à L224-25-9 (services numériques, dont le préavis de L224-25-9) | https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000006069565/LEGISCTA000044132845/ | #496 |
| S19b | C. conso. L224-25-12 et s. (garantie de conformité des services numériques) | `[À COMPLÉTER : lien]` | à vérifier |
| S20 | C. conso. L224-25-24 à L224-25-26 (mises à jour, modification du service numérique) | https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000006069565/LEGISCTA000044132895/ | #496 |
| S21 | C. conso. L241-3-1 | https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000046190202 | #496 |
| S22 | Code civil, art. 1125 à 1127-4 (contrat conclu par voie électronique) | https://www.legifrance.gouv.fr/codes/id/LEGISCTA000032007249/ | #496 ; art. 1119 à vérifier |
| S23 | Code civil, art. 1127-2 | https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000032007506 | #496 |
| S24 | C. conso. L213-1 | https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000032226994 | #496 |
| S25 | C. conso. D213-1 | https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000032807208 | #496 |
| S26 | Loi n° 78-17 Informatique et Libertés (art. 45, 82, 85) | https://www.legifrance.gouv.fr/loda/id/JORFTEXT000000886460 | #496 (art. 45 et 82) ; art. 85 à vérifier |
| S27 | Loi n° 94-665 (loi Toubon) | https://www.legifrance.gouv.fr/loda/id/JORFTEXT000000349929 | #496 |
| S28 | Ordonnance n° 2026-2 du 5 janvier 2026 (« renoncer au contrat ici ») | https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000053298845 | #496 |
| S30 | RGPD, règlement (UE) 2016/679 | https://eur-lex.europa.eu/eli/reg/2016/679/oj | #496 |
| S31 | CNIL, délibération n° 2020-091 (lignes directrices cookies et autres traceurs) | https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000042388179 | #496 |
| S32 | CNIL, délibération n° 2020-092 (recommandation), version consolidée de janvier 2026 | https://www.cnil.fr/sites/default/files/2026-01/recommandation_cookies_consolidee.pdf | #496 |
| S33 | CNIL, « Cookies et autres traceurs : les règles » | https://www.cnil.fr/fr/cookies-et-autres-traceurs/regles/cookies | #495 |
| S34 | AI Act, règlement (UE) 2024/1689, art. 50 | https://eur-lex.europa.eu/legal-content/FR/TXT/?uri=CELEX:32024R1689 | #495 |
| S35 | Commission, lignes directrices sur l'art. 50 (C(2026) 5054, 20 juillet 2026) | https://digital-strategy.ec.europa.eu/en/library/guidelines-transparency-obligations-providers-and-deployers-ai-systems | #318 |
| S36 | Directive 2011/83/UE (droits des consommateurs) | https://eur-lex.europa.eu/eli/dir/2011/83/oj | #496 |
| S38 | DSA, règlement (UE) 2022/2065 | https://eur-lex.europa.eu/eli/reg/2022/2065/oj | #496 |
| S40 | Règlement (UE) 2024/3228 (fin de la plateforme RLL) | https://eur-lex.europa.eu/eli/reg/2024/3228/oj/eng | #496 |
| S41 | Groupe de l'article 29 / CEPD, lignes directrices sur la transparence (WP260 rév.01) | https://ec.europa.eu/newsroom/article29/items/622227 | #496 |
| S42 | Code civil, art. 1190 (interprétation contre celui qui a proposé le contrat d'adhésion) | `[À COMPLÉTER : lien]` | à vérifier |
| S43 | C. conso. L211-1 (clauses claires, interprétation favorable au consommateur) | `[À COMPLÉTER : lien]` | à vérifier |

## 10. À fournir par le product owner

Ces faits ne sont pas dans le dépôt. Tant qu'ils manquent, le texte garde le placeholder et la condition de merge (§ 6) n'est pas remplie pour une version qui les contient.

- `[À FOURNIR : entité juridique qui édite Jobbbox]` : dénomination, forme, capital, siège, RCS/SIREN, TVA intracommunautaire, téléphone (#572).
- `[À FOURNIR : médiateur de la consommation]` : nom, adresse, site (#496 § 9.7).

Liens à compléter dans la table du § 9 (marqués `[À COMPLÉTER : lien]`) : L111-1, L221-13, annexe à R221-1, R212-2, L224-25-12, C. civ. 1190, L211-1. Les sources marquées « à vérifier » le restent tant qu'une Legal Review ne les a pas contrôlées sur le site officiel.
