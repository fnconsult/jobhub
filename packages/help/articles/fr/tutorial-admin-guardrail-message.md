---
kind: tutorial
audience: administrator
topic: coaching
title: Écrire le message d'un garde-fou, en français et en anglais
synonyms: [message du garde-fou, guardrail message, texte du message, valider un message, message en français, message en anglais, 3114, détresse, texte par défaut]
---
Le message d'un garde-fou s'affiche au candidat à la place de la réponse, sans dire quel garde-fou a agi. Il existe en français et en anglais, et chaque langue se valide à part. Il faut être super-admin pour l'écrire, et un autre super-admin pour le valider.

1. Ouvrez Garde-fous (menu Coaching) et trouvez le garde-fou.
2. Sous « Modifier le message en français », écrivez le « Texte du message » : clair, bref, au vouvoiement. Pour la détresse, il doit donner le 3114, le numéro national de prévention du suicide.
3. Cliquez sur « Enregistrer le message ». La page affiche « Message enregistré : il doit être validé par un autre administrateur pour être servi en production. »
4. Faites de même sous « Modifier le message en anglais ». La version anglaise dit la même chose ; pour la détresse, elle donne aussi le 3114.
5. Demandez à un autre super-admin de relire chaque version. Sous « Valider le message en français, version … », puis en anglais, il saisit « Votre nom » et clique sur « Valider ce message ».

Tant qu'une langue n'est pas validée, la production sert le « Texte par défaut de Jobbbox » dans cette langue. Changer un message ne joue aucun cas d'évaluation, contrairement à un réglage. Chaque version et chaque validation sont inscrites dans Actions des administrateurs.
