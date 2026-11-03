---
kind: page
audience: administrator
topic: coaching
title: Playbooks
synonyms: [playbooks, playbook, playbooks de coaching, socle, socle de coaching, liste des sources, playbook agent, playbook de tâche ia, règles du coach, version, version servie, évaluation, eval run, cas d'évaluation, archiver, modèle autorisé, effort]
route: /admin/playbooks
---
Playbooks (menu Coaching) ouvre « Playbooks de coaching » : les règles que l'AI Coach applique. Le tableau « Socle, liste des sources et playbooks » montre le « Socle de coaching », la « Liste des sources » et chaque playbook, avec sa « Dernière version », sa « Version servie », son Playbook Agent (le spécialiste que l'AI Coach consulte : fournisseur, modèle et effort) et son état, « Actif » ou « Archivé ». Plus bas, « Playbooks des tâches IA » donne les consignes de chaque tâche IA (lire une offre ou un CV, rédiger un document…) et l'IA qui l'exécute ; l'AI Coach ne les consulte jamais. « Modèles autorisés » liste les modèles proposés, leur hébergement (« UE » ou « hors UE ») et leur effort.

En production, seule la dernière version validée par une personne (Human-validated) de chacun est servie. Ailleurs, la dernière version est servie, validée ou non : la page le rappelle en tête.

Cliquez sur le nom d'un playbook pour l'ouvrir. Sa page liste ses « Versions », puis, pour la version choisie, qui l'a écrite, sa « Validation », ses « Règles » et la carte « Modifier ». Enregistrer une version non validée la modifie ; enregistrer une version validée crée la version suivante, à valider à son tour. Toutes les versions sont gardées.

Viennent ensuite les « Cas d'évaluation » du playbook (des scénarios fictifs, notés par un juge IA) et ses « Évaluations ». Une version n'est validée qu'après une évaluation sur elle, quel que soit son score, et par une personne qui ne l'a pas écrite. « Archiver ce playbook » arrête de le servir sans rien effacer ; « Rétablir ce playbook » le sert de nouveau. Le socle et la liste des sources ne s'archivent pas.

Un modèle « hors UE » reçoit des appels expurgés par la Redaction. Les rédacteurs de playbooks et les super-admins modifient, évaluent et valident ; le Support lit. Chaque changement est inscrit dans Actions des administrateurs.
