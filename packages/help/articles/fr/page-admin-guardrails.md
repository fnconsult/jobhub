---
kind: page
audience: administrator
topic: coaching
title: Garde-fous
synonyms: [garde-fous, garde-fou, guardrail, guardrails, bloquer, signaler seulement, désactivé, injection d'instructions, fuite de données personnelles, divulgation de secrets, conseil dangereux, détresse, 3114, email piégé, déclenchements, message du garde-fou, réglage]
route: /admin/garde-fous
---
Garde-fous (menu Coaching) règle les contrôles automatiques sur ce que reçoivent le coach IA, ses Playbook Agents et l'assistant du back office, et sur ce qu'ils répondent. Ils contrôlent aussi les emails reçus par la réception par email avant qu'une IA ne les lise. Leur liste est fixée dans le code : « Injection d'instructions », « Fuite de données personnelles », « Divulgation de secrets », « Conseil hors rôle ou dangereux », « Détresse » et « Contenu piégé dans un email ». Ici, vous réglez chacun et écrivez le message qu'il affiche à la place de la réponse.

Le tableau « Les garde-fous et leur réglage » dit, pour chacun, « Ce qu'il contrôle » et son « Réglage ». Dans « Quand il détecte quelque chose », « Bloquer » arrête le message, ou fait réécrire la réponse une fois puis la remplace par le message du garde-fou. « Signaler seulement » laisse tout passer et compte le déclenchement. « Désactivé » n'existe que pour le contenu piégé dans un email. La détresse, la fuite de données personnelles et la divulgation de secrets bloquent toujours (« Bloque toujours »).

Avant d'enregistrer un réglage avec « Enregistrer le réglage », les cas d'évaluation des garde-fous sont joués avec lui. Il est refusé s'il laisse passer un cas que ces trois garde-fous doivent bloquer ; « Voir l'évaluation jouée sur ce réglage » montre le résultat.

Chaque message existe en français et en anglais. En production, il n'est servi qu'une fois validé par un administrateur nommé autre que son auteur, chaque langue à part. D'ici là, le « Texte par défaut de Jobbbox » s'applique. Le message de détresse doit donner le 3114. Personne n'est alerté quand un candidat exprime une détresse.

« Déclenchements » compte, par jour (heure de Paris) et par garde-fou, les messages « Bloqués », « Signalés » et les « Contrôle indisponible », ces derniers par raison. Aucun candidat, aucune conversation, aucun texte : le texte, si besoin, reste dans Activité › Appels IA. Quand le contrôle par IA est indisponible, seules les règles fixes s'appliquent et le message passe.

Les super-admins modifient les réglages et les messages ; le Support lit la page.
