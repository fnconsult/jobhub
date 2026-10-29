# Issue #495 : quelle IA juridique pour évaluer les textes publics FR

Périmètre : choisir l'outil d'une passe d'évaluation par IA des textes publics de Jobbbox (CGU/CGV, politique de confidentialité, mentions légales, cookies, information AI Act) avant la relecture par le juriste. Sources de première main (éditeurs, CGV, textes officiels), consultées le 2026-10-29. Les prix des outils non publiés par l'éditeur sont signalés comme tels.

## Constat préalable : la confidentialité n'est pas le critère décisif

Les textes à évaluer sont destinés à être publiés. Le sort des documents soumis (hébergement UE, rétention, entraînement) compte donc peu ici, contrairement à un contrat ou à un dossier client. Les critères décisifs sont : (1) la connaissance du droit français de la consommation et des recommandations de la CNIL, (2) l'accès pour une petite structure sans service juridique, (3) le coût.

## Comparatif

### Plugin `legal` d'Anthropic (déjà installé)
Source : README et `skills/*/SKILL.md` du plugin (v1.3.0, auteur Anthropic), lus en local.
- Couverture : `compliance-check` contient une section RGPD (art. 28, transferts, droits des personnes) et cite la CNIL parmi les autorités. Rien sur l'AI Act, le Code de la consommation ni la LCEN. Le README avertit que le playbook par défaut reflète des positions américaines (Delaware, New York, Californie) et qu'un utilisateur UE doit le personnaliser dans `.claude/legal.local.md` avant de s'y fier.
- `legal-risk-assessment` fournit une grille gravité × probabilité et des critères d'escalade, utile pour trier les constats avant le juriste. Elle est pensée pour une équipe juridique interne (seuils exprimés en % de la valeur d'un contrat).
- Données : le plugin tourne sur Claude. Sur les offres commerciales (Team, Enterprise, API), Anthropic n'utilise pas les entrées et sorties pour l'entraînement par défaut, sauf retour volontaire (pouce haut/bas) (https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training). L'API directe propose `inference_geo` = `us` ou `global`, pas de région UE documentée (https://platform.claude.com/docs/en/build-with-claude/data-residency). Sans enjeu ici : les textes sont publics.
- Prix et accès : aucun coût supplémentaire, déjà installé. Procédure : `/legal:compliance-check` avec le texte collé ou le chemin du fichier, puis `legal-risk-assessment` pour classer les constats.
- Limites : pas de base de jurisprudence ni de doctrine française ; le modèle peut citer un article inexact. Il faut lui fournir les textes de référence (voir « Playbook » plus bas) et vérifier chaque citation sur Légifrance.

### Doctrine
Sources : https://www.doctrine.fr/tarifs ; https://www.avocatparis.org/actualites/partenariat-barreau-de-paris-x-doctrine ; https://www.lexisnexis.com/community/espace-presse/b/nouvelles/posts/le-groupe-relx-finalise-l-acquisition-de-doctrine-et-vise-a-equiper-1-million-de-professionnels-du-droit-en-europe-1150383333
- Couverture : base française (codes, lois, décisions). Le meilleur fonds jurisprudentiel FR accessible en self-service, pertinent pour les clauses abusives.
- Hébergement : « nos serveurs sont hébergés dans l'Union européenne », ISO 27001. La page tarifs ne dit rien de l'entraînement sur les données clients.
- Prix et accès : trois offres (avocat individuel, cabinet, direction juridique), prix non affichés, abonnement individuel ; essai gratuit de 7 jours sans carte bancaire ni engagement. Les modules d'analyse de documents (Flow Counsel, « analysez vos contrats ») demandent un abonnement complémentaire.
- Le barreau de Paris a négocié une offre préférentielle (souscriptions jusqu'au 31/12/2025) : le juriste de Jobbbox en dispose peut-être déjà.
- Doctrine appartient au groupe RELX (LexisNexis) depuis 2026.
- Limites : outil de recherche ; l'analyse d'un document soumis est un module payant à part, et rien ne dit que l'essai le comprend.

### Lexis+ avec Protégé (LexisNexis France)
Source : https://www.lexisnexis.com/supportandtraining/fr/lexis-plus-ai/b/lexis-plus-ai/posts/faq-protege-tout-savoir-sur-l-intelligence-artificielle-juridique-de-lexisnexis ; https://www.lexisnexis.com/community/espace-presse/b/nouvelles/posts/lexisnexis-integration-mistral
- Couverture : droit français et européen (contenus JurisClasseur). La FAQ ne cite pas nommément le Code de la consommation ni le RGPD.
- Hébergement et données : serveurs en Europe, ISO 27001, « les données ne sont pas utilisées pour entraîner les modèles ». Prompts conservés 90 jours ; documents importés supprimés en fin de session ou après 10 minutes d'inactivité. Coffre-fort : 50 dossiers × 500 documents, 20 Mo par document (en cours de déploiement). Modèles Mistral intégrés en France.
- Prix et accès : option premium en sus de l'abonnement Lexis+ ; aucun tarif publié, démonstration et devis via un commercial.
- Limites : coût d'entrée (abonnement base + option) disproportionné pour une passe ponctuelle.

### GenIA-L (Lefebvre Dalloz)
Sources : https://formation.lefebvre-dalloz.fr/nos-formations-avec-genia-l-assistant ; https://assistance.lefebvre-dalloz.fr/wp-content/uploads/2024/10/Tout-comprendre-sur-GenIAL-for-Search.pdf ; CGV juillet 2026 : https://assistance.lefebvre-dalloz.fr/wp-content/uploads/2026/07/CGV-GenIA-L-Metiers-Reference-juillet-2026.pdf
- Couverture : fonds Lefebvre Dalloz (Mémentos, Dalloz, revues). Le meilleur fonds doctrinal FR des candidats.
- Hébergement et données : hébergé « exclusivement en Europe, de l'infrastructure aux modèles » ; données non utilisées pour l'entraînement, requêtes et réponses non conservées (page formation de l'éditeur).
- Prix et accès : vendu sous licence avec un abonnement professionnel aux bases ; aucun tarif public. Le barreau de Paris a offert GenIA-L à ses avocats (partenariat 2024, CGV « Barreau Paris » 2026) : à vérifier auprès du juriste.
- Limites : le PDF des CGV n'a pas pu être extrait (texte compressé), donc les clauses sur la clientèle admise et la responsabilité ne sont pas vérifiées. Produit orienté recherche et rédaction, pas audit d'un document.

### Harvey
Source : https://www.harvey.ai/security
- Traitement possible dans l'UE et en Suisse, y compris chez les sous-traitants ; rétention fixée par le client ; interdiction contractuelle d'entraîner les modèles sur les données client.
- Couverture FR non décrite. Aucun prix publié, accès sur démonstration. Les estimations tierces (non vérifiables, p. ex. https://www.vaquill.ai/blog/harvey-legora-cocounsel-pricing-reality-2026) parlent de minimums de 20 à 25 sièges sur 12 mois.
- Verdict : hors de portée d'une structure d'une personne.

### Legora
Source : https://legora.com/security
- Pas d'engagement explicite d'hébergement UE sur la page sécurité (choix du lieu de stockage dans les offres « enterprise ») ; rétention paramétrable, suppression en fin de contrat ; pas d'entraînement sur les données client.
- Couverture FR non décrite. Prix sur démonstration ; estimations tierces non vérifiables d'environ 3 000 $/siège/an avec 10 sièges minimum.
- Verdict : hors de portée.

## Tableau de synthèse

| Outil | Droit FR/UE | Analyse d'un document soumis | Accès petite structure | Coût marginal |
|---|---|---|---|---|
| Plugin `legal` (Claude) | RGPD seulement par défaut ; FR à fournir | Oui (texte collé ou fichier) | Immédiat | 0 € |
| Doctrine | Fort (jurisprudence FR) | Module payant à part | Essai 7 j sans CB | Devis |
| Lexis+ Protégé | Fort | Oui (coffre-fort) | Commercial, abonnement base | Devis |
| GenIA-L | Fort (doctrine FR) | Recherche/rédaction | Abonnement pro | Devis |
| Harvey | Non décrit | Oui | Non (minimum de sièges) | Très élevé |
| Legora | Non décrit | Oui | Non (minimum de sièges) | Élevé |

## Playbook FR à fournir au plugin `legal`

Le plugin ne vaut que par les textes de référence qu'on lui donne. Créer `.claude/legal.local.md` (cf. README du plugin) avec, pour chaque texte public, la grille et les sources officielles :
- Mentions légales : LCEN, loi n° 2004-575, art. 1-1 (ex-art. 6-III) — https://www.legifrance.gouv.fr/loda/id/JORFTEXT000000801164
- Information précontractuelle et droit de rétractation : Code de la consommation, art. L221-5 et suivants — https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000006069565/LEGISCTA000032226842/
- Clauses abusives : Code de la consommation, art. L212-1 et R212-1/R212-2 — https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000032227315
- Politique de confidentialité : RGPD, art. 12 à 14 — https://eur-lex.europa.eu/legal-content/FR/TXT/?uri=CELEX:32016R0679
- Cookies : lignes directrices et recommandation CNIL — https://www.cnil.fr/fr/cookies-et-autres-traceurs/regles/cookies
- Information IA : AI Act, règlement (UE) 2024/1689, art. 50 (transparence envers les personnes qui interagissent avec un système d'IA) — https://eur-lex.europa.eu/legal-content/FR/TXT/?uri=CELEX:32024R1689

## Recommandation

Utiliser le plugin `legal` déjà installé comme outil de la passe IA, après avoir écrit le playbook FR ci-dessus dans `.claude/legal.local.md`. Procédure par texte : `/legal:compliance-check` sur le texte avec la grille correspondante, puis `legal-risk-assessment` pour classer les constats (gravité × probabilité) et produire la liste transmise au juriste. Chaque article cité par l'IA est vérifié sur Légifrance ou EUR-Lex avant transmission.

Les outils éditeurs français (Doctrine, Lexis+ Protégé, GenIA-L) ont un meilleur fonds FR, mais ils sont vendus sur devis à des professionnels du droit, et leur garantie d'hébergement UE n'apporte rien sur des textes destinés à être publiés. Option à coût nul : demander au juriste s'il a accès à Doctrine ou GenIA-L via l'offre du barreau de Paris, et lui laisser la vérification jurisprudentielle (clauses abusives) dans sa propre relecture. En contre-vérification ponctuelle, l'essai Doctrine de 7 jours sans carte bancaire suffit pour une recherche sur les clauses abusives. Harvey et Legora sont écartés : seuils de sièges et prix incompatibles avec la taille de Jobbbox.

Aucune IA ne remplace la relecture du juriste. Le plugin le dit lui-même : « does not provide legal advice ».
