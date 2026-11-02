---
kind: faq
audience: administrator
topic: fournisseurs-et-tools
title: Quel rôle change quoi dans les fournisseurs et les outils ?
synonyms: [back office role, rôle, rôles, droits, permissions, super-admin, technique, support, lecture seule, qui peut, accès, modifier une clé]
---
Vos rôles du back office décident de ce que vous lisez et changez dans Paramètres et Outils :

- **Super-admin** : change tout, y compris les clés des fournisseurs (les remplacer, les effacer, les tester) et les fournisseurs de connexion.
- **Technique** : change chaque réglage de Paramètres qui n'est pas secret (fournisseur actif, route d'une tâche IA, prix des outils), les sources et les sites ; voit les clés par leur source et leurs 4 derniers caractères, sans jamais les remplacer ; lit les fournisseurs de connexion et Outils.
- **Support** : lit Paramètres, les sources et les sites, les fournisseurs de connexion et Outils, sans rien changer ; d'une clé, il ne voit que si elle est « Définie » ou « Manquante ».
- **Rédacteur de playbooks** : ne touche pas aux fournisseurs, mais valide dans Playbooks la version qu'un changement de modèle d'un Playbook Agent a créée en brouillon.

Les autres rôles (« Responsable des offres », « Responsable coaching », « Rédacteur de l'aide ») n'ouvrent pas ces pages. Une page que vos rôles ne permettent pas de modifier affiche « Lecture seule : vos rôles ne permettent pas de modifier cette section. » Les rôles se donnent dans Administrateurs, par un super-admin.
