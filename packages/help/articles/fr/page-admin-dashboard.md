---
kind: page
audience: administrator
topic: plateforme
title: Dashboard et Consommation IA
synonyms: [dashboard, tableau de bord, consommation ia, coût, coûts, dépense, budget, seuil d'alerte, recherche web, tokens, appels ia, échecs, taux d'échec, prix inconnu, fournisseur, modèle, tâche, période, run, origine, extension, application, web, tâches de fond, inconnue, carte extension, captures, invités, candidats actifs, versions en service, pages impossibles à capturer]
route: /admin/consommation-ia
---
Le Dashboard est la première page du back office. Il montre ce que la plateforme consomme, comment se porte la recherche d'offres et ce que fait l'extension. Chaque bloc n'apparaît qu'aux rôles qui lisent sa rubrique : sans aucun, la page affiche « Aucun indicateur pour vos rôles : la barre latérale mène à vos rubriques. »

Le bloc « Recherche d'offres : consommation et budget » donne, pour le mois en cours, la « Dépense recherche web du mois » face au seuil d'alerte, le « Coût moyen d'un run » face au « Budget par run », le « Coût par nouvelle offre », les « Runs », les « Runs passés au secours » (sur le fournisseur de secours) et les « Appels IA en échec ». Ses graphiques montrent la dépense quotidienne par Search provider, le « Cumul du mois et seuil d'alerte » avec la fin de mois estimée, « Pourquoi les runs s'arrêtent » et « Où va le coût d'un run (moyenne) ». « Vue tableau » donne les mêmes chiffres en tableau. « Tout le détail dans Consommation IA » ouvre la page suivante.

Le bloc « Extension » couvre les 30 derniers jours : les « Captures » (par des candidats et par des invités), les « Match Scores » demandés depuis l'extension, les « Candidatures créées » depuis l'extension, les « Candidats actifs » (chacun compté une fois) et les « Erreurs » qu'elle remonte. Ses graphiques montrent les « Captures par jour, candidats et invités », les « Erreurs par jour », les « Versions en service » avec leur nombre d'événements (« Non indiquée » pour une extension qui n'envoie pas sa version) et « Pages impossibles à capturer : les 5 domaines ». La « Vue tableau » des captures donne, jour par jour, les captures, les Match Scores, les candidatures, les candidats actifs, les versions et les erreurs. Un invité n'y est jamais compté comme une personne : seules ses actions le sont. « Voir Activité › Extension » liste chaque événement. Les super-admins, Technique et le Support voient ce bloc.

Consommation IA (menu Plateforme) compte chaque appel à l'IA, toutes tâches comprises, les outils que les modèles utilisent et les appels aux API externes (France Travail, enrichissement de contacts, Stripe, Brevo, connexion…). Choisissez la « Période » (« 7 derniers jours », « 30 derniers jours », « 90 derniers jours » ou « 12 derniers mois, par mois ») et, au besoin, l'« Origine » des appels à l'IA (« Web », « Extension », « Application », « Tâches de fond » ou « Inconnue » pour ceux enregistrés sans origine, dont tous ceux d'avant), puis cliquez sur « Afficher ». L'origine restreint les appels à l'IA et leurs outils ; les API externes n'en enregistrent pas et restent toutes comptées. La page détaille ensuite les « Totaux », « Par fournisseur, point d'accès et modèle », « Par tâche », « Par jour » ou « Par mois », les « Outils » et les « API externes ».

« Échecs et avertissements par raison » compte les appels échoués ou en avertissement par Failure Reason : le code et son libellé seulement, jamais la raison technique. Pour lire un appel précis, un super-admin passe par Activité › Appels IA.

Les coûts sont des estimations aux prix publics des fournisseurs, en dollars convertis en euros, figées au moment de chaque appel. Un outil sans prix connu est compté 0 et signalé « prix inconnu ». Ce sont des agrégats : aucun candidat, aucun texte. Quand le seuil d'alerte mensuel de la recherche web est atteint, un bandeau le dit et les super-admins sont prévenus par e-mail ; rien n'est coupé. Le seuil et les prix se règlent dans Paramètres.

Les super-admins, Technique et le Support lisent ces deux pages ; personne n'y modifie rien.
