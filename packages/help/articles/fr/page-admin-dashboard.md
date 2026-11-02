---
kind: page
audience: administrator
topic: plateforme
title: Dashboard et Consommation IA
synonyms: [dashboard, tableau de bord, consommation ia, coût, coûts, dépense, budget, seuil d'alerte, recherche web, tokens, appels ia, échecs, taux d'échec, prix inconnu, fournisseur, modèle, tâche, période, run]
route: /admin/consommation-ia
---
Le Dashboard est la première page du back office. Il montre ce que la plateforme consomme et comment se porte la recherche d'offres. Chaque bloc n'apparaît qu'aux rôles qui lisent sa rubrique : sans aucun, la page affiche « Aucun indicateur pour vos rôles : la barre latérale mène à vos rubriques. »

Le bloc « Recherche d'offres : consommation et budget » donne, pour le mois en cours, la « Dépense recherche web du mois » face au seuil d'alerte, le « Coût moyen d'un run » face au « Budget par run », le « Coût par nouvelle offre », les « Runs », les « Runs passés au secours » (sur le fournisseur de secours) et les « Appels IA en échec ». Ses graphiques montrent la dépense quotidienne par Search provider, le « Cumul du mois et seuil d'alerte » avec la fin de mois estimée, « Pourquoi les runs s'arrêtent » et « Où va le coût d'un run (moyenne) ». « Vue tableau » donne les mêmes chiffres en tableau. « Tout le détail dans Consommation IA » ouvre la page suivante.

Consommation IA (menu Plateforme) compte chaque appel à l'IA, toutes tâches comprises, les outils que les modèles utilisent et les appels aux API externes (France Travail, enrichissement de contacts, Stripe, Brevo, connexion…). Choisissez la « Période » (« 7 derniers jours », « 30 derniers jours », « 90 derniers jours » ou « 12 derniers mois, par mois ») puis cliquez sur « Afficher ». La page détaille ensuite les « Totaux », « Par fournisseur, point d'accès et modèle », « Par tâche », « Par jour » ou « Par mois », les « Outils » et les « API externes ».

« Échecs et avertissements par raison » compte les appels échoués ou en avertissement par Failure Reason : le code et son libellé seulement, jamais la raison technique. Pour lire un appel précis, un super-admin passe par Activité › Appels IA.

Les coûts sont des estimations aux prix publics des fournisseurs, en dollars convertis en euros, figées au moment de chaque appel. Un outil sans prix connu est compté 0 et signalé « prix inconnu ». Ce sont des agrégats : aucun candidat, aucun texte. Quand le seuil d'alerte mensuel de la recherche web est atteint, un bandeau le dit et les super-admins sont prévenus par e-mail ; rien n'est coupé. Le seuil et les prix se règlent dans Paramètres.

Les super-admins, Technique et le Support lisent ces deux pages ; personne n'y modifie rien.
