---
kind: tutorial
audience: administrator
topic: equipe
title: Vérification en deux étapes obligatoire et réinitialisation
synonyms: [vérification en deux étapes, clé d'accès, double authentification, 2fa, mfa, obligatoire, application d'authentification, codes de secours, réinitialiser, réinitialisation, facteur perdu, téléphone perdu, aucun facteur, configurer, lien magique, fournisseur de connexion, sso]
---
La vérification en deux étapes est obligatoire pour les administrateurs, super-admins permanents (ADMIN_EMAILS) compris, et pour les coachs humains. Après un lien magique, un compte qui n'a encore aucun facteur la configure avant toute autre page : il ne peut rien faire d'autre que la configurer ou se déconnecter, dans l'application comme dans l'extension. Cela vaut dès la page suivante pour quelqu'un qui reçoit un rôle ou devient coach pendant qu'il est connecté. Une connexion par un fournisseur de connexion (Google, Microsoft…) ne demande pas de deuxième étape. Dans Mon compte, rubrique « Sécurité », ces comptes n'ont pas de bouton « Désactiver », ni de « Supprimer » sur une clé d'accès qui est leur dernier facteur.

Dans Administrateurs (menu Équipe), la colonne « Vérification en deux étapes » indique « Activée » ou « Aucun facteur ». Un administrateur sans facteur ne peut être qu'un administrateur qui se connecte par un fournisseur de connexion.

Pour quelqu'un qui a perdu son application d'authentification, ses clés d'accès et ses codes de secours, un super-admin réinitialise sa vérification en deux étapes :

1. Ouvrez Administrateurs (menu Équipe).
2. Dans « Réinitialiser la vérification en deux étapes », saisissez l'« Adresse e-mail du compte ».
3. Cochez « Je confirme : les facteurs, les codes de secours et les sessions de ce compte seront supprimés. »
4. Cliquez sur « Réinitialiser la vérification en deux étapes ». La page indique que la vérification en deux étapes du compte est réinitialisée.

Son application, ses clés d'accès, ses codes de secours et ses sessions sont supprimés, et un e-mail l'en informe. À sa prochaine connexion par lien magique, un administrateur ou un coach la configure de nouveau. Chaque réinitialisation est inscrite dans Actions des administrateurs : qui, quand et quel compte, jamais un code ni un secret. Seuls les super-admins voient cette page.
