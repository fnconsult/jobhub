---
kind: tutorial
audience: administrator
topic: fournisseurs-et-tools
title: Configurer un fournisseur de connexion, puis exiger le SSO
synonyms: [sign-in provider, fournisseur de connexion, sso, require sso, exiger, google, apple, microsoft, oidc, connexion de l'équipe, url de redirection, client id, secret client, tester la connexion]
---
Seuls les super-admins configurent un fournisseur de connexion. Gardez cet ordre : un fournisseur testé et autorisé pour les administrateurs d'abord, l'exigence ensuite, sinon l'équipe ne pourrait plus se reconnecter.

1. Ouvrez Paramètres, onglet « Connexion ». Sous « Ajouter un fournisseur », ouvrez « Ajouter Google », « Ajouter Apple », « Ajouter Microsoft » ou « Ajouter OIDC ».
2. Saisissez le « Nom affiché sur le bouton », l'« Identifiant client (client ID) » (l'« Identifiant de service (Service ID) » pour Apple) et chaque secret demandé : le « Secret client », ou pour Apple l'« Identifiant d'équipe (Team ID) », l'« Identifiant de clé (Key ID) » et la « Clé privée (.p8) ». Pour OIDC, ajoutez l'« Identifiant » (en minuscules, chiffres et tirets : il fait partie de l'URL de redirection et ne change plus) et l'« URL de découverte OIDC » ; pour Microsoft, le « Locataire (tenant) ».
3. Laissez activé « Autoriser pour la connexion au back office » ; désactivez « Proposer aux candidats sur la page de connexion » si les candidats ne doivent pas le voir. Pour OIDC, n'activez « Associer automatiquement un compte de même adresse e-mail » que si ce fournisseur vérifie les adresses e-mail. Laissez « Activé » désactivé.
4. Cliquez sur « Enregistrer le fournisseur ».
5. Dans la liste « Fournisseurs », copiez son « URL de redirection » et collez-la dans la console du fournisseur, comme URI de redirection autorisée.
6. Cliquez sur « Tester la connexion avec … ». Personne n'est connecté et aucun compte n'est créé ; le message « … : le test de connexion a réussi. Vous pouvez l'activer. » le confirme.
7. Ouvrez « Modifier … », activez « Activé », puis « Enregistrer le fournisseur ».
8. Connectez-vous une fois au back office avec ce fournisseur, pour vérifier qu'il vous laisse entrer.
9. Dans la carte « Connexion de l'équipe », cochez « Exiger un fournisseur de connexion pour les administrateurs » et cliquez sur « Enregistrer ».

Un administrateur connecté par un lien reçu par e-mail devra alors se reconnecter avec un fournisseur autorisé pour les administrateurs ; ses pages de candidat restent accessibles. Changer les identifiants d'un fournisseur demande un nouveau test avant de le réactiver.
