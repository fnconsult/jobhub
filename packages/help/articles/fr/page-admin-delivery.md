---
kind: page
audience: administrator
topic: plateforme
title: Livraison
synonyms: [livraison, déploiement, beta, production, staging, tickets, pull request, PR, chantier, carte, suivi, fonctionnalité, en cours, github, statut de livraison]
route: /admin/livraison
---
Livraison (menu Plateforme) montre ce qui est en cours de construction et où cela tourne, lu en direct sur GitHub. Les super-admins, Technique et Support la lisent ; rien ne s'y modifie. GitHub est relu au plus toutes les 5 minutes ; « Actualiser » le relit tout de suite.

**Environnements** donne, pour la Beta et la Production, le « Commit déployé » par le dernier déploiement réussi, « Quand », « Depuis » quelle branche ou version, et la « Vérification en direct » : le /api/health de l'environnement dit quel commit il sert. « Le site sert ce commit » confirme le déploiement ; sinon la page dit ce que le site sert, ou pourquoi elle n'a pas pu vérifier.

**En cours** liste les tickets « Pris », « En développement » ou « En revue », et les pull requests ouvertes qui ne ferment aucun ticket suivi.

**Chantiers et fonctionnalités** reprend chaque chantier (une carte wayfinder), ses fonctionnalités (les issues « Suivi ») et leurs tickets, chacun à son « Étape » avec sa « Preuve » : un ticket est « En Beta » ou « En Production » quand le commit de sa pull request fusionnée fait partie du commit déployé ; « Fusionné » s'il n'y est pas encore.

**Ce que cette page ne garantit pas** dit ce qui n'a pas pu être vérifié : un environnement non vérifié en direct, une branche déployée, un ticket encore ouvert dont la PR est fusionnée.

Livraison lit GitHub avec un jeton en lecture seule, GITHUB_STATUS_TOKEN, saisi par un super-admin dans Paramètres, onglet « Environnement », sur la fiche GitHub. Sans lui, la page affiche « Jeton GitHub manquant ».
