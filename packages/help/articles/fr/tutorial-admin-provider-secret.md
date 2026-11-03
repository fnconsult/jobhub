---
kind: tutorial
audience: administrator
topic: fournisseurs-et-tools
title: Remplacer ou effacer une clé de fournisseur
synonyms: [provider secret, clé, clé d'api, remplacer une clé, effacer une clé, rotation, renouveler, secret, tester une clé, test de connexion, environnement, repli]
---
Une clé de fournisseur (Provider Secret) saisie dans le back office est chiffrée et remplace celle de l'environnement en moins d'une minute, sans redéploiement. Seuls les super-admins la remplacent, l'effacent ou la testent ; « Technique » n'en voit que la source et les 4 derniers caractères.

1. Ouvrez Paramètres, l'onglet du fournisseur, puis sa fiche en cliquant sur son nom dans « Fournisseurs possibles ».
2. Dans la rubrique « Clés », repérez la clé : sa source (« Back office », « Environnement (repli) », « Absente » ou « Illisible : l'environnement prend le relais ») et sa fin.
3. Pour la remplacer, ouvrez « Remplacer … », collez la nouvelle valeur dans « Nouvelle valeur de … » et cliquez sur « Tester et enregistrer … ».
4. Si le fournisseur refuse la clé, rien n'est enregistré : vérifiez-la. Pour l'enregistrer malgré tout, par exemple pendant une panne du fournisseur, cochez « Enregistrer même si le test de connexion échoue » ; ce choix est inscrit dans Activité.
5. Pour revenir à la valeur de l'environnement, cliquez sur « Effacer … (revenir à l'environnement) ». Sans valeur dans l'environnement, la clé devient « Absente » et les fonctions qui en dépendent s'arrêtent.
6. « Tester … » refait le test de connexion de la clé en usage, sans rien changer.

Ne collez jamais une clé ailleurs que dans ce champ : ni dans l'assistant, ni dans un signalement. Le journal n'enregistre que le remplacement, jamais la valeur.
