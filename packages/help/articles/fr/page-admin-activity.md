---
kind: page
audience: administrator
topic: plateforme
title: Activité
synonyms: [activité, recherches, runs, run, job discovery, recherche d'offres, entonnoir, pages écartées, secours, fournisseur de secours, appels ia, journal ia, prompt, réponse de l'ia, débogage, déclencheur, jetons, jetons d'entrée, estimation des jetons]
route: /admin/activite
---
Activité (menu Plateforme) réunit, en onglets, ce que la plateforme a fait : « Recherches », « Emails reçus », « Appels IA » et « Actions des administrateurs ». Chaque onglet n'apparaît qu'aux rôles qui le lisent. « Emails reçus » et « Actions des administrateurs » ont chacun leur article.

**Recherches** liste chaque run de la recherche d'offres, lancé par une recherche d'offres d'un candidat ou pour compléter un Job Digest. Filtrez avec « Déclencheur », « Période » et « Bascules sur le fournisseur de secours seulement », puis cliquez sur « Afficher ». Chaque ligne donne le profil (« Profil #… », jamais le nom du candidat), les recherches, le fournisseur, les pages lues, les « Offres nouvelles / extraites », l'arrêt, la durée et le coût. « Ouvrir » montre l'« Entonnoir (Discovery metrics) », les « Recherches du run », les « Sources », les « Pages écartées » avec leur raison et « Appels IA de ce run ». Les requêtes et les critères sont effacés après 30 jours ; les chiffres restent. Un super-admin peut « Ouvrir la recherche d'offres du candidat » : cette consultation est inscrite dans Actions des administrateurs.

**Appels IA** est le journal de ce que chaque appel à l'IA a dit, tel qu'il a été envoyé : les instructions, les messages après Redaction et la réponse, clés et secrets masqués, avec le résultat (« OK », « Avertissement » ou « Échec ») et sa raison. Filtrez par « Tâche », « Modèle », « E-mail du candidat », « Jour », résultat et raison, puis cliquez sur « Filtrer » ; « Effacer les filtres » revient à la liste entière. Pour un appel qui a écrit une réponse du coach IA, la colonne « Contexte estimé / mesuré » donne, en jetons, le contexte estimé par Jobbbox (environ 4 caractères par jeton), celui compté par le fournisseur (ses jetons d'entrée, ceux lus dans son cache compris) et, entre parenthèses, l'écart entre les deux, signé et en pourcentage de l'estimation : elle sert à corriger l'estimation par fournisseur et par modèle. Les autres appels y montrent un tiret. Chaque appel ouvert montre « Détails de l'appel », « Pourquoi » et le « Détail technique » d'un échec. Ces textes contiennent des données personnelles : seuls les super-admins les lisent, chaque appel ouvert est inscrit dans Actions des administrateurs, et ils sont effacés après 30 jours. N'ouvrez un appel que pour comprendre un problème.

Les super-admins, Technique et le Support lisent Recherches ; seuls les super-admins lisent Appels IA.
