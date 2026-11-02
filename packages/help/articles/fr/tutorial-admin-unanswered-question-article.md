---
kind: tutorial
audience: administrator
topic: contenu
title: Transformer une question sans réponse en article
synonyms: [écrire un article d'aide, article écrit, combler un manque de l'aide, ajouter un synonyme, help article, rédacteur de l'aide, écarter une question]
---
Une question sans réponse montre un manque de l'aide. La combler, c'est écrire un article ou ajouter un synonyme à un article existant. Il vous faut le rôle Rédacteur de l'aide ou Super-admin.

1. Ouvrez Questions sans réponse (menu Contenu). Les plus posées viennent d'abord ; filtrez si besoin avec « Filtrer par public », « Filtrer par page » et « Filtrer par langue ».
2. Lisez la question et la « Réponse de l'IA ». C'est une matière première, jamais un article : vérifiez chaque fait et chaque libellé dans l'interface en vigueur.
3. Cherchez d'abord un article proche, dans l'aide (/aide) ou dans l'aide du back office. S'il répond déjà, ajoutez à ses synonymes les mots de la question.
4. Sinon, écrivez l'article en français d'abord, il fait foi, puis en anglais, avec un public et une rubrique, au vouvoiement, en citant les libellés mot pour mot. Les articles sont dans le dépôt, sous `packages/help/articles/`.
5. Proposez le changement en revue. Une personne relit et fusionne : aucun article n'est servi avant cette fusion.
6. Revenez sur la question et cliquez sur « Article écrit ». Pour une question qui n'est pas un manque de l'aide, cliquez sur « Écarter ».

La question est gardée masquée, sans le nom de qui l'a posée, puis effacée 30 jours après avoir été marquée.
