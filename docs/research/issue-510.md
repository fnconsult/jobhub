# Recherche pour l'issue #510 : table d'acceptations des CGU et CGV

Vérifié le 2026-10-31, seulement ce que l'implémentation exige. **Pas un avis juridique.** Les sources primaires (Légifrance, EUR-Lex, CNIL) n'étaient pas joignables depuis cette session (hôte hors des domaines autorisés) : les faits ci-dessous reprennent `docs/research/issue-496.md` §4 et §5 (branche `research/issue-496`, vérifié sur Légifrance le 2026-10-29), non revérifiés ici. Les liens Légifrance sont dans la section Sources de cette note.

Réponse courte : le modèle de données de l'issue (une ligne par acceptation, version, date, canal, session Checkout, demande d'exécution immédiate) est cohérent avec ce que la preuve exige. Trois points reposent sur une hypothèse ou une lecture à faire trancher.

## 1. Faits qui fondent la conception (repris de #496)

- **Opposabilité** : des conditions générales sont opposables si elles ont été portées à la connaissance de la partie et acceptées (C. civ. art. 1119, 1127-1). Une case pré-cochée ne vaut pas consentement au sens du RGPD (CJUE C-673/17 *Planet49*) ; on applique la même règle par prudence. L'écran d'acceptation après connexion (amendement ADR-0062) doit donc exiger un geste actif.
- **Conservation de la preuve** : contrat conclu par voie électronique d'au moins 120 EUR : 10 ans (C. conso. L213-1, D213-1). Pour les CGU et les CGV sous le seuil, la durée est une hypothèse de l'issue (5 ans après l'Account deletion ; 10 ans après la fin du dernier contrat payant), pas une durée imposée par un texte.
- **Minimisation** : pas d'IP ni d'agent utilisateur ; le lien au compte authentifié suffit (RGPD art. 5(1)(c)).
- **Modification** : une clause qui laisse le professionnel modifier seul les caractéristiques ou le prix est abusive de façon irréfragable (R212-1 3°) ; pour un contrat à durée indéterminée, exception avec préavis « raisonnable » et droit de résilier (R212-4). Service numérique : information claire, à l'avance, sur support durable, et résolution gratuite sous 30 jours si la modification nuit à l'usage (L224-25-26). Pour les CGU, #496 recommande d'informer à l'avance, de laisser l'Account deletion possible et de faire accepter de nouveau à la connexion suivante si la modification est substantielle.
- **Version applicable** : pour un contrat déjà conclu, la version acceptée à la conclusion reste celle qui s'applique, sauf modification valable. La table doit donc garder la version exacte, pas seulement la dernière.
- **Langue** : le français fait foi (loi Toubon art. 2), d'où l'empreinte SHA-256 sur le texte FR et la mention « traduction, le texte français fait foi » en EN.

## 2. Ce que l'amendement ADR-0062 ajoute, et ce qui n'est pas couvert

| Point de l'issue | Statut |
|---|---|
| Préavis d'au moins 30 jours par e-mail pour une version substantielle | Choix produit. Aucun texte ne fixe 30 jours pour les CGU ; R212-4 dit « délai raisonnable », #496 propose « au moins un mois ». 30 jours est compatible. Mineure sans préavis : **Juriste** (la frontière substantielle/mineure est une qualification juridique, pas technique). |
| Accès limité à l'écran d'acceptation, au Data export, à `/abonnement` et à l'Account deletion tant que non accepté | Non couvert par #496. Garder le Data export (RGPD art. 15 et 20), la résiliation (décret 2023-417) et la rétractation (L221-21) accessibles va dans le bon sens. **Juriste** : bloquer l'usage d'un service payant pour défaut d'acceptation d'une nouvelle version, sans remboursement, alors que le Plan court. |
| Première version des CGU « substantielle » pour tout Candidate existant | Cohérent avec l'opposabilité (aucune acceptation antérieure). |
| Identifiant pseudonyme conservé à la place de l'e-mail | Une donnée pseudonymisée reste une donnée personnelle (RGPD considérant 26, art. 4(5)). Il faut le dire dans le registre `docs/privacy/register.md` : base légale (obligation légale pour les CGV ≥ 120 EUR ; intérêt légitime de preuve pour le reste), durée, et le fait que la clé de rattachement est détruite ou séparée. Le pseudonyme ne doit pas être dérivable de l'e-mail sans secret (pas de simple hash non salé). |

## 3. Dépendances externes pour le code

- Aucune API tierce n'est nécessaire pour #510. Le `checkout_session_id` est un identifiant opaque Stripe : seule sa conservation est en jeu, pas son format.
- Stripe `consent_collection.terms_of_service = required` ne convient pas (une seule URL par compte, pas de version), donc la preuve est recueillie chez Jobbbox (#496 §5.1). Non revérifié ici contre la documentation Stripe.
- Le registre des versions vient de #546 (déjà fusionné, #589) : identifiant = date d'effet, SHA-256 du FR.

## Points pour le juriste

1. Durée de conservation des acceptations CGU (5 ans après l'Account deletion) et CGV (10 ans après le dernier contrat payant) : confirmer, notamment le calcul du seuil de 120 EUR pour un abonnement mensuel.
2. Blocage de l'accès aux fonctions payantes tant qu'une version substantielle n'est pas acceptée, alors que le Plan continue de courir.
3. Critère « substantielle ou mineure », et absence de préavis pour une version mineure.
4. Statut du pseudonyme conservé (donnée personnelle) et base légale par document.

## Questions ouvertes

- Les sources primaires n'ont pas été relues dans cette session ; refaire une passe Légifrance sur L213-1 et D213-1 si le juriste conteste les durées.
- Le skill `mattpocock-skills:research` n'était pas disponible dans cette session ; la note suit le format des autres `docs/research/issue-*.md`.
