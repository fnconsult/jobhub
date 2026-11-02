---
kind: tutorial
audience: administrator
topic: fournisseurs-et-tools
title: Changer le fournisseur ou le modèle d'une tâche IA
synonyms: [tâche ia, route, routage de l'ia, modèle, fournisseur, mistral, claude, bedrock, changer de modèle, refusé, route_missing, test_failed, résidence, hors ue]
---
Chaque tâche IA a son fournisseur et son modèle, un Paramètre de plateforme appliqué dès le prochain appel. Les super-admins et « Technique » le changent.

1. Ouvrez Paramètres, onglet « IA ». Le tableau « Tâches » montre chaque tâche avec son « Fournisseur · modèle », sa « Source », la « Clé du fournisseur » et ses « Données ».
2. Sur la ligne de la tâche, cliquez sur « Modifier… ». Le panneau « Tâche IA » s'ouvre sur le côté.
3. Choisissez le « Fournisseur », puis le « Modèle » : laissé vide, c'est le modèle par défaut du fournisseur ; un modèle saisi est testé par un appel à l'enregistrement.
4. Cliquez sur « Enregistrer ». Le message « Route enregistrée : elle s'applique dès le prochain appel, sans redémarrage. » le confirme ; un run déjà lancé garde son modèle.
5. Pour revenir à la valeur de l'environnement, sinon au défaut du code, cliquez sur « Rétablir le défaut ».

La route est vérifiée avant d'être enregistrée. Refusée, elle reste comme avant, avec un message « … n'a pas été modifié : … » et son « Détail : » :

- « Aucun fournisseur configuré pour cette tâche » (`route_missing`) : ce fournisseur ne sert pas cette tâche, ou un réglage dont il a besoin manque. Choisissez-en un autre.
- « Règle de résidence des données » (`data_residency`) : la tâche ne s'exécute que dans l'UE et le fournisseur est hors UE. Choisissez un fournisseur dans l'UE.
- « Test de connexion échoué » (`test_failed`) : l'appel de test au modèle saisi a échoué. Vérifiez le nom du modèle chez le fournisseur.

Un fournisseur sans clé est signalé, jamais refusé : ses appels échouent jusqu'à ce que la clé soit saisie. Le modèle d'un Playbook Agent, lui, se change par « Modifier… » sous « Playbook Agents » : il crée une version brouillon à valider dans Playbooks.
