---
kind: page
audience: administrator
topic: plateforme
title: Actions des administrateurs (journal)
synonyms: [journal, audit, actions des administrateurs, historique des modifications, qui a changé, avant après, tentative refusée, back office audit, filtre outils, boîtes reliées, traçabilité]
route: /admin/activite/actions
---
L'onglet « Actions des administrateurs » d'Activité est le journal du back office, qui s'appelait « Journal ». Il enregistre chaque modification faite dans le back office : qui, quand, la section, l'élément, l'action, et les valeurs avant et après. Il enregistre aussi chaque tentative refusée ou échouée, avec sa raison mais sans les valeurs saisies, et chaque appel IA ou recherche d'offres d'un candidat qu'un super-admin a ouvert.

Les valeurs secrètes ne sont jamais enregistrées : une clé apparaît « Valeur remplacée (jamais enregistrée) » ou « Valeur effacée : la variable d'environnement reprend le relais ». Une question sans réponse ou un signalement est nommé par son identifiant, jamais par ses mots. Chaque entrée est gardée 3 ans.

« Afficher » filtre par section : « Tout », « Rôles », « Offres », « Codes promo », « Coachs humains », « Playbooks de coaching », « Garde-fous », « Signalements »… Le filtre « Outils » ajoute chaque appel aux outils externes (Stripe, Brevo, connexion, tests de connexion, pages lues), avec son outil, son opération, son résultat et sa durée : ni contenu, ni candidat, ni secret. Le filtre « Boîtes reliées » ajoute les boîtes reliées activées, remplacées, coupées ou à leur plafond du jour, sans candidat ni adresse. Les modifications les plus récentes viennent d'abord.

La section « Code de revue des stores » inscrit chaque connexion d'un compte de démonstration par le code de revue des stores (action « Connexion »), et chaque « Code faux » tapé pour lui, au nom du compte de démonstration. Le code n'y figure jamais. Elle ne se remplit que pendant une revue de l'app par l'App Store ou Google Play, quand le code est allumé.

Les super-admins et Technique lisent ce journal. Personne ne le modifie ni n'en efface une ligne.
