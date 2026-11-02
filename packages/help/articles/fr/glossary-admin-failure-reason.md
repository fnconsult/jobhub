---
kind: glossary
audience: administrator
topic: plateforme
title: Raison d'échec (Failure Reason)
synonyms: [raison d'échec, failure reason, code d'erreur, raison, pourquoi, échec, avertissement, erreur inattendue, raison technique, détail technique, provider_unavailable, key_missing, data_residency, test_failed, other]
---
Une raison d'échec dit pourquoi quelque chose a échoué ou averti, en deux parties.

La **raison fonctionnelle** est un code stable, tiré d'un catalogue fixé dans le code, avec un libellé en français : par exemple `provider_unavailable`, `key_missing`, `data_residency`, `test_failed`, `eval_refused`, `last_super_admin` ou `invalid_value`. Une erreur inconnue est `other`, « Erreur inattendue ». Le code est compté là où l'on garde des chiffres : Consommation IA, « Échecs et avertissements par raison », et les déclenchements des garde-fous. Le Support le lit.

La **raison technique** est le type d'erreur, le fournisseur, le statut HTTP et le message, sans clé ni secret, passé par la Redaction et coupé à 500 caractères. Elle n'apparaît qu'avec ce qu'elle explique : le « Détail technique » d'un appel dans Activité › Appels IA, gardé 30 jours, ou une ligne d'Actions des administrateurs, gardée 3 ans. Seuls les super-admins la lisent.

Pour un problème, partez du code dans Consommation IA, puis ouvrez un appel concerné dans Appels IA si vous êtes super-admin.
