---
kind: faq
audience: administrator
topic: fournisseurs-et-tools
title: Que faire d'une variable d'environnement qui n'est plus lue ?
synonyms: [variable d'environnement, .env, variable inutilisée, variables qui ne servent plus, remplacée par, environnement, ancienne variable, nettoyer, diffère du défaut, env]
---
L'onglet « Environnement » de Paramètres liste, sous « Variables qui ne servent plus », les variables que l'environnement du serveur définit encore mais que Jobbbox ne lit plus. La colonne « Remplacée par » dit ce qui les remplace, par exemple les Coaching Playbooks, réglés dans Playbooks. Leur valeur n'est jamais affichée.

Elles ne changent rien : vous pouvez les retirer du .env du serveur au prochain déploiement. Réglez à la place ce que « Remplacée par » indique. Sans variable inutilisée, la liste dit « Aucune variable inutilisée dans l'environnement. »

À ne pas confondre avec deux autres cas :

- « Réglages de l'environnement » : des variables encore lues, qui ne se changent pas dans le back office (« Pourquoi dans l'environnement » dit pourquoi) ;
- l'avertissement « … réglages viennent de l'environnement et diffèrent de la valeur par défaut du code » et le badge « env » dans Outils : la variable est lue et remplace la valeur par défaut du code. Vérifiez qu'elle est voulue ; une valeur saisie dans le back office l'emporterait sur elle.
