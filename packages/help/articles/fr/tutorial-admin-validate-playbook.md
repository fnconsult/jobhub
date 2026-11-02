---
kind: tutorial
audience: administrator
topic: coaching
title: Valider une version d'un playbook
synonyms: [valider un playbook, validation, human-validated, relire une version, évaluer la version, lancer l'évaluation, eval run, cas d'évaluation, version servie, production]
---
En production, l'AI Coach n'applique que la dernière version Human-validated d'un playbook. La valider, c'est attester que vous l'avez relue. Il vous faut le rôle Rédacteur de playbooks ou Super-admin, et ne pas avoir écrit cette version : une relecture par une IA ne compte jamais.

1. Ouvrez Playbooks (menu Coaching), puis cliquez sur le nom du playbook.
2. Dans « Versions », choisissez la dernière version : seule la dernière peut être validée. Lisez ses « Règles » et son Playbook Agent.
3. Vérifiez ses « Cas d'évaluation ». S'il n'y en a aucun, ajoutez-en un avec « Ajouter un cas d'évaluation », puis « Ajouter ce cas ».
4. Sous « Évaluer la version … », gardez « Le Playbook Agent de la version, tel qu'enregistré », puis cliquez sur « Lancer l'évaluation ». L'évaluation peut prendre quelques minutes.
5. Lisez le résultat et les réponses notées par le juge IA. Aucun score ne bloque la validation : c'est à vous de juger, en lisant les réponses, à côté de la version servie.
6. Sous « Valider la version … », saisissez « Votre nom », puis cliquez sur « Valider la version … ».

La page affiche « Version … validée. » et la production sert cette version. Si vous modifiez ensuite une version validée, l'enregistrer crée une nouvelle version, à évaluer et valider à son tour. La validation est inscrite dans Actions des administrateurs, avec votre nom et la date.
