---
kind: tutorial
audience: administrator
topic: fournisseurs-et-tools
title: Activer l'enrichissement de contacts et son DPA
synonyms: [enrichissement de contacts, contacts enrichis, dpa, accord de traitement, lusha, kaspr, apollo, sous-traitant, téléphone, marquer le dpa signé]
---
Les contacts enrichis restent désactivés tant que le DPA (l'accord de traitement des données) avec leur fournisseur n'est pas marqué signé, quels que soient le fournisseur et sa clé. Le code ne peut pas vérifier le DPA : le marquer signé est une étape volontaire, confirmée et inscrite dans Activité.

1. Faites signer le DPA avec le fournisseur choisi, hors de Jobbbox. Lusha et Apollo traitent les données hors UE, Kaspr là où ce n'est pas établi : lisez d'abord « Activer un destinataire hors UE ».
2. Ouvrez Paramètres, onglet « Enrichissement de contacts ».
3. Un super-admin ouvre la fiche du fournisseur et saisit sa clé, comme dans « Ajouter un fournisseur et le rendre actif ».
4. Dans « Fournisseurs possibles », cliquez sur « Rendre actif » sur la ligne du fournisseur. Le « Fournisseur des contacts enrichis » prend sa valeur.
5. Dans la carte « Fournisseur actif », sur la ligne « Accord de traitement (DPA) signé », choisissez true dans « Nouvelle valeur de CONTACT_ENRICHMENT_DPA_SIGNED » et cliquez sur « Enregistrer ».
6. À la question « Marquer le DPA signé ? », cliquez sur « Oui, le DPA est signé » si c'est vrai, sinon sur « Annuler ».

Les contacts enrichis s'activent alors. Pour les arrêter, remettez false dans le même réglage, ou cliquez sur « Rétablir ».
