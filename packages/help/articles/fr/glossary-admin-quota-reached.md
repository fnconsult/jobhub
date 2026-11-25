---
kind: glossary
audience: administrator
topic: fournisseurs-et-tools
title: Quota atteint
synonyms: [quota atteint, quota épuisé, limite atteinte, quota, crédit épuisé, plan épuisé, limite de débit, rate limit, 429, facturation, renouveler le quota, bandeau]
---
Un outil a son **quota atteint** quand son fournisseur refuse de l'appeler pour une question de quota. Seuls les outils à API qui en ont un sont concernés : les modèles d'IA, la recherche web, l'enrichissement de contacts et Fantastic.jobs. Il y a deux états :

- **« limite atteinte »** : le fournisseur limite le débit (trop d'appels en peu de temps, HTTP 429) ;
- **« quota épuisé »** : le crédit ou le plan payé chez le fournisseur est épuisé.

Chaque état commence au premier refus du fournisseur et dure tant qu'il refuse : il prend fin au premier appel accepté de cet outil, ou à la date de renouvellement donnée par le fournisseur. Un test de connexion réussi ne suffit pas : il vérifie la clé, pas le quota.

Tant qu'au moins un outil a son quota atteint, le bandeau « Quota atteint » s'affiche en tête de chaque page du Back Office, pour tout Administrator, quel que soit son rôle. Il disparaît de lui-même dans la demi-minute qui suit le retour à la normale. Chaque ligne nomme l'outil, son état et depuis quand.

Pour y remédier, chaque ligne donne deux liens :

- « Facturation de … » ouvre, dans un nouvel onglet, la page du fournisseur où se paie ou se renouvelle le quota ;
- « Configurer … » mène là où l'outil se règle dans le Back Office : sa fiche dans Paramètres quand sa clé s'y saisit, sinon sa page dans Outils. Ce lien n'apparaît qu'aux rôles qui peuvent ouvrir ces pages (super-admin, Technique et Support).

Une « limite atteinte » se lève souvent seule après quelques instants. Un « quota épuisé » demande de recréditer le compte ou de changer de plan chez le fournisseur, ou, en attendant, de choisir un autre fournisseur dans Paramètres.
