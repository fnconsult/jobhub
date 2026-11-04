---
kind: page
audience: administrator
topic: fournisseurs-et-tools
title: Outils
synonyms: [outils, tools, routes locales, coach actions, outil externe, service tiers, état, appels, échecs, coût, résidence, hors UE, fiche d'un outil, derniers appels, raison]
route: /admin/outils
---
Outils liste chaque outil externe que Jobbbox appelle, depuis l'app web et le worker, rangé par catégorie : à quoi il sert (« Usage »), qui l'appelle (« Appelé par »), où il traite les données (« Données traitées » : « Dans l'UE », « Hors UE » ou « Non établi »), son « État », ses « Clés », ses « Appels (30 j) », ses « Échecs » et son « Coût (30 j) ». Ni le contenu des appels ni les clés ne sont affichés.

L'« État » dit si l'outil peut être appelé : « Configuré », « Sans clé », « Clé manquante », « Paramètre manquant », « Désactivé », « Non configuré » ou « En attente d'accès ». Le badge « env » signale un réglage venu de l'environnement qui diffère de la valeur par défaut du code.

« Fiche » ouvre la page d'un outil : ses chiffres des « 30 derniers jours », ses « Derniers appels » avec leur « Résultat » et leur « Durée », pour un modèle d'IA le tableau « Échecs et avertissements par raison (30 j) », et ses « Paramètres », en lecture seule. Un outil hors UE activé sans être nommé par la politique de confidentialité en vigueur y garde l'avertissement « … : destinataire hors UE non couvert ».

Les outils rangés sous « Routes locales » ne sont pas des services externes : ce sont les groupes de Coach Actions, le code de Jobbbox que le coach IA appelle pour lire les données du candidat ou lui préparer une modification, qu'il applique lui-même. Sans appel d'IA ni clé, dans l'UE, ils sont un par groupe : « Candidatures », « Agenda », « Profil », « Recherches d'offres », « Job Digests » et « Documents ». Chaque appel compte dans leurs « Appels (30 j) » sous le nom de la Coach Action, sans le candidat ni ce qu'elle a lu ou préparé ; un appel refusé, jamais exécuté (outil inconnu, arguments invalides, proposition de trop), est un échec de raison « Appel refusé : outil inconnu ou arguments invalides ». Ils restent « Désactivé » tant que « Coach Actions activées (le coach IA lit et propose) » est à false, sa valeur par défaut : le coach IA n'a alors aucun outil et répond comme avant. Ce réglage s'allume dans Paramètres, onglet « IA », groupe « Coach IA », d'abord sur la Beta, avec « Tours d'appels de Coach Actions par réponse, au plus » : 2 par défaut, de 0 à 4, 0 revenant à répondre sans eux. Allumés, ils sont « Sans clé ».

GitHub, rangé sous « Livraison », sert la page Livraison : son jeton en lecture seule se saisit dans Paramètres, onglet « Environnement ».

Outils se lit seulement : une clé, un réglage ou un fournisseur se change dans Paramètres. « Tous les outils » ramène à la liste.
