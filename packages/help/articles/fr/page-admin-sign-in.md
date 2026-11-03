---
kind: page
audience: administrator
topic: fournisseurs-et-tools
title: Connexion
synonyms: [connexion, fournisseur de connexion, sign-in provider, sso, google, apple, microsoft, oidc, lien par e-mail, connexion de l'équipe, exiger, url de redirection]
route: /admin/parametres?tab=connexion
---
L'onglet « Connexion » de Paramètres règle les moyens de connexion, en plus du lien reçu par e-mail : Google, Apple, Microsoft et tout fournisseur OIDC. Une modification s'applique en quelques secondes, sans redéploiement ni déconnexion.

La carte « Connexion de l'équipe » porte la case « Exiger un fournisseur de connexion pour les administrateurs » : cochée, le back office demande à un administrateur connecté par un lien reçu par e-mail de se reconnecter avec un fournisseur autorisé pour les administrateurs. Les super-admins permanents ne sont jamais concernés.

La liste « Fournisseurs » montre chaque fournisseur avec son « Type », son « URL de redirection » à coller dans la console du fournisseur, son « Utilisation » (proposé aux candidats, autorisé pour les administrateurs), ses « Secrets » et son « Test de connexion ». Un fournisseur ne s'active qu'après un test de connexion réussi, et de nouveau après chaque changement de ses identifiants. Un secret saisi est chiffré et n'est jamais réaffiché.

Les super-admins ajoutent, modifient, testent et suppriment les fournisseurs ; « Technique » et le Support les lisent.
