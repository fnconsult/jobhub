---
kind: page
audience: administrator
topic: coaching
title: Garde-fous
synonyms: [garde-fous, garde-fou, guardrail, guardrails, bloquer, signaler seulement, désactivé, injection d'instructions, fuite de données personnelles, divulgation de secrets, conseil dangereux, détresse, 3114, email piégé, déclenchements, message du garde-fou, réglage, périmètre du coach, renvoi typé, réponse non fondée, hors sujet, dernier filet]
route: /admin/garde-fous
---
Garde-fous (menu Coaching) règle les contrôles automatiques sur ce que reçoivent le coach IA, ses Playbook Agents et l'assistant du back office, et sur ce qu'ils répondent. Ils contrôlent aussi les emails reçus par la réception par email avant qu'une IA ne les lise. Leur liste est fixée dans le code : « Injection d'instructions », « Fuite de données personnelles », « Divulgation de secrets », « Conseil hors rôle ou dangereux », « Détresse », « Contenu piégé dans un email », « Réponse non fondée sur le profil » et « Périmètre du coach ». Ici, vous réglez chacun et écrivez le message qu'il affiche à la place de la réponse.

Le tableau « Les garde-fous et leur réglage » dit, pour chacun, « Ce qu'il contrôle » et son « Réglage ». Dans « Quand il détecte quelque chose », « Bloquer » arrête le message, ou fait réécrire la réponse une fois puis la remplace par le message du garde-fou. « Signaler seulement » laisse tout passer et compte le déclenchement. « Désactivé » n'existe que pour le contenu piégé dans un email. La détresse, la fuite de données personnelles et la divulgation de secrets bloquent toujours (« Bloque toujours »).

« Périmètre du coach » contrôle la réponse finale du coach IA, en cinq contrôles : (1) une modification annoncée comme faite sans carte ; (2) un CV, une lettre, un message, une note ou une réponse à un e-mail écrits dans la réponse au lieu d'une carte ; (3) un refus sans raison ni alternative : ni carte, ni renvoi typé (le lien « Où le faire vous-même » que Jobbbox construit sous la réponse), ni « Poser la question à l'équipe », ni, pour ce que le coach ne fait jamais, ce qu'il propose à la place ; (4) l'identité du CV de référence ou une note privée d'un coach reprise dans la réponse ; (5) « hors sujet » : une réponse qui ne traite pas la demande du candidat. Les contrôles 3 et 4 reposent sur des règles fixes, les contrôles 1, 2 et 5 sur un modèle d'IA, qui lit la demande du candidat à côté de la réponse pour le contrôle 5. Les contrôles 3 et 4 bloquent toujours, quel que soit le réglage. Les contrôles 1, 2 et 5 suivent le réglage, « Signaler seulement » par défaut : passez-le à « Bloquer » une fois ses cas d'évaluation et ses déclenchements relus. Bloquée, la réponse est réécrite une fois avec la raison ; si elle l'est encore, son message s'affiche.

Le coach IA ne répond jamais par un texte générique. S'il termine sans rien écrire, un dernier tour, sans outil, lui demande de répondre à la demande. S'il n'écrit toujours rien, le dernier filet répond : « Je n'ai pas réussi à traiter votre demande. Reformulez-la, ou posez la question à l'équipe », avec « Poser la question à l'équipe ». Ce dernier filet n'est pas un refus pour le contrôle 3. Son appel est signalé dans l'Activité, avec la raison « Le coach n'a rien écrit, même au dernier tour : le dernier filet a répondu ».

Avant d'enregistrer un réglage avec « Enregistrer le réglage », les cas d'évaluation des garde-fous sont joués avec lui. Il est refusé s'il laisse passer un cas que ces trois garde-fous, ou les contrôles 3 et 4 de « Périmètre du coach », doivent bloquer ; « Voir l'évaluation jouée sur ce réglage » montre le résultat.

Chaque message existe en français et en anglais. En production, il n'est servi qu'une fois validé par un administrateur nommé autre que son auteur, chaque langue à part. D'ici là, le « Texte par défaut de Jobbbox » s'applique. Le message de détresse doit donner le 3114. Personne n'est alerté quand un candidat exprime une détresse.

« Déclenchements » compte, par jour (heure de Paris) et par garde-fou, les messages « Bloqués », « Signalés » et les « Contrôle indisponible », ces derniers par raison. Aucun candidat, aucune conversation, aucun texte : le texte, si besoin, reste dans Activité › Appels IA. Quand le contrôle par IA est indisponible, seules les règles fixes s'appliquent et le message passe.

Les super-admins modifient les réglages et les messages ; le Support lit la page.
