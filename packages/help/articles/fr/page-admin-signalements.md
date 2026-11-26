---
kind: page
audience: administrator
topic: candidats
title: Signalements
synonyms: [signalements, signalement, feedback, bug, idée, question à l'équipe, retour candidat, à traiter, nouveau, vu, traité, réponse de l'équipe, support, prêt à clore, brouillon, issue, tri des signalements]
route: /admin/signalements
---
Signalements (menu Candidats) liste les bugs, idées et questions que les candidats envoient depuis l'application, du plus ancien au plus récent. Le nombre « à traiter » s'affiche à côté du nom de la section pour qui peut les traiter. Les signalements envoyés avec la mention « Un outil d'IA peut lire votre message pour nous aider à le traiter. » sont aussi lus, anonymisés, par l'agent du tri des signalements, avec une clé d'agent (onglet « Clés d'agent » de Paramètres) ; les autres sont lus par l'équipe seulement. Un statut posé par l'agent s'affiche « vu par triage-beta », du nom de sa clé.

Le type est « Bug », « Idée » ou « Question ». Une question arrive quand l'aide ou le coach IA n'a pas suffi au candidat : elle porte une copie de sa question et de la réponse du coach IA. Le statut est « Nouveau », « Vu » ou « Traité ». Filtrez avec « Filtrer par type » et « Filtrer par statut » (« À traiter » ou « Tous »).

Chaque ligne montre la date, le message, la page d'où il vient, la version de Jobbbox, le navigateur, la langue, la taille du texte, le candidat et son offre. « Ouvrir » donne le signalement entier, son « Contexte », son statut et la « Réponse de l'équipe ». Ouvrir un signalement ne change pas son statut.

Le candidat voit la réponse signée « L'équipe Jobbbox », jamais avec votre nom, et une notification quand l'équipe a répondu ou marqué « Traité ». Une question ne se marque « Traité » qu'une fois répondue. Un signalement ne se supprime pas depuis le back office.

**Le tri des signalements.** Pour un signalement envoyé avec la mention IA, l'agent du tri propose une issue ou un brouillon de réponse ; c'est Jobbbox qui publie l'issue sur GitHub, après avoir retiré le nom, l'e-mail et le téléphone du candidat et vérifié qu'elle ne cite pas son message (garde-fou « Données du Candidate dans une issue »). La carte « Issues » du signalement donne le ou les numéros d'issue, avec un lien : visibles par l'équipe seulement, jamais par le candidat. L'issue ne porte que l'identifiant du signalement, jamais son texte ; supprimer le signalement retire le lien et laisse l'issue.

**Prêt à clore.** Quand le correctif d'une issue liée est déployé dans l'environnement d'où vient le signalement (la Beta, ou la version promue pour la Production), le signalement passe « Prêt à clore », en même temps que tous ceux liés à la même issue. Ce statut n'est visible que par l'équipe : le candidat garde « Vu » ou « Nouveau ».

**Le brouillon de réponse.** La carte « Brouillon de réponse » montre le brouillon « proposé par triage-beta » (le nom de la clé), dans la langue du candidat et sa traduction. Modifiez-le, puis « Envoyer au candidat » : il reçoit la version dans sa langue, signée « L'équipe Jobbbox », et le signalement passe « Traité » avec elle, en une seule notification. « Enregistrer le brouillon » le garde sans l'envoyer ; « Supprimer le brouillon » l'efface. Une idée refusée, ou une question sans issue, s'envoie dès que son brouillon est prêt. L'agent n'envoie jamais rien au candidat et ne marque jamais « Traité ».

Le Support et les super-admins changent le statut et répondent. Les rédacteurs de l'aide voient les questions seulement, sans l'e-mail ni l'offre du candidat. Chaque statut changé, chaque réponse écrite et chaque brouillon envoyé sont inscrits dans Actions des administrateurs (qui, quand), sans leurs mots.

La rubrique « Signalements de contenus de coaching », réservée aux personnes qui peuvent traiter les signalements, reçoit aussi les demandes sans compte. Toute décision de retrait, suspension ou maintien exige un motif notifié au signaleur et au responsable du contenu. Les coordonnées et l’explication originale du signaleur ne sont pas transmises au responsable.
