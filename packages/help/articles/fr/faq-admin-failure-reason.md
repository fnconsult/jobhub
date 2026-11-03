---
kind: faq
audience: administrator
topic: fournisseurs-et-tools
title: Comment lire une raison d'échec ?
synonyms: [failure reason, raison d'échec, raison, échec, erreur, tentative refusée, code, détail, avertissement, provider_unavailable, key_missing, rate_limited, route_missing, test_failed]
---
Une raison d'échec (Failure Reason) dit en une ligne pourquoi un appel ou une modification n'a pas abouti. Elle a un « Code » stable, par exemple `key_missing`, et des mots, par exemple « Clé d'API absente ». Le détail technique l'accompagne, jamais une clé ni le contenu d'un appel.

Vous la lisez à trois endroits :

- dans Paramètres, juste après une modification refusée : « … n'a pas été modifié : … », suivi de « Détail : » ;
- dans Outils, sur la page d'un modèle d'IA : le tableau « Échecs et avertissements par raison (30 j) » compte les appels par « Code » et « Raison » ;
- dans Activité, Actions des administrateurs, où chaque « Tentative refusée » garde sa raison.

Les plus fréquentes : « Clé d'API absente » (saisissez la clé sur la fiche du fournisseur), « Appel refusé par le fournisseur » (clé révoquée, compte ou crédit épuisé), « Limite d'appels du fournisseur atteinte » (attendre, ou changer d'offre chez le fournisseur), « Fournisseur indisponible » (panne passagère), « Aucun fournisseur configuré pour cette tâche » et « Règle de résidence des données » (voir « Changer le fournisseur ou le modèle d'une tâche IA »), « Test de connexion échoué » (clé ou identifiants à vérifier).
