# Recherche #451 : assistant de transfert, procédures par messagerie

Carte : #426. Vérifié le 2026-10-28. Complète `docs/research/issue-442.md` (réception côté Brevo). Ici : seulement ce qu'il faut savoir pour écrire les guides de l'assistant (Gmail, Outlook.com, iCloud, Orange, « Autre ») et l'étape du code de confirmation Gmail. Les libellés de menu changent : les textes de l'assistant doivent rester génériques et ne pas citer de captures figées.

## Ce qui est confirmé

### Gmail (https://support.google.com/mail/answer/10957)
- Chemin : Paramètres, Voir tous les paramètres, onglet « Transfert et POP/IMAP » ; ajouter l'adresse de destination.
- **Gmail envoie un message de vérification à l'adresse de transfert**, pas à la boîte Gmail. Le transfert ne démarre qu'après vérification. C'est ce qui fait de la Forwarding address Jobbbox la destinataire du code : l'étape « afficher le code reçu » est réalisable en lisant ce mail dans la route d'entrée.
- Le transfert par défaut envoie tout (hors spam). Pour ne transférer que certains expéditeurs : **désactiver le transfert automatique**, puis créer un filtre (recherche, « Créer un filtre », « Le transférer à », choisir l'adresse, valider). Un filtre par adresse de destination. L'adresse doit donc être vérifiée avant le filtre : l'ordre de l'assistant est adresse, code, filtre.
- Non couvert par la page : limites (nombre d'adresses, volume), restrictions Google Workspace.

### Outlook.com (https://support.microsoft.com/en-us/outlook/turn-on-or-off-automatic-forwarding-in-outlook-com)
- Chemin : Paramètres (engrenage), Courrier, Transfert ; « Activer le transfert », saisir l'adresse, Enregistrer ; case « Conserver une copie des messages transférés ».
- Si la vérification en deux étapes est absente, Microsoft demande de l'activer ; si elle est active, une nouvelle vérification d'identité est demandée à l'ouverture de la page. Prévoir un avertissement dans le guide.
- Le mail transféré apparaît comme transféré depuis le compte du candidat, donc l'expéditeur d'origine n'est pas dans `From` (à gérer pour « Recognised sender » : lire `Reply-To` et les en-têtes d'origine, à vérifier sur de vrais mails).
- Transfert filtré par expéditeur : passe par des règles (« Use rules to automatically forward messages »). Les étapes exactes des règles Outlook.com n'ont pas été lues ici ; seule la page classic Outlook les décrit. À vérifier avant d'écrire ce guide.
- Aucune étape de code de confirmation documentée.

### iCloud Mail (https://support.apple.com/guide/icloud/mm6b1a3960/icloud)
- Chemin : icloud.com/mail, Réglages, « Transfert de courrier », cocher « Transférer mon e-mail à » ; option « Supprimer les messages après le transfert ». Garder des copies consomme du stockage iCloud.
- Règles : un transfert filtré est possible, **une seule adresse de transfert par règle** ; la page renvoie vers un autre article pour les étapes des règles (non lu).
- La page ne mentionne aucune vérification ni délai. Aucune étape de code.

### Yahoo (https://help.yahoo.com/kb/SLN36684.html)
- Transfert automatique **réservé à Yahoo Mail Plus**, non proposé dans toutes les régions, navigateur de bureau uniquement. Chemin : Paramètres, Boîtes aux lettres, boîte principale, section transfert automatique, saisir l'adresse, Vérifier ; Yahoo envoie des instructions à l'adresse de destination, à compléter avant activation.
- Le transfert gratuit a été arrêté (https://help.yahoo.com/kb/SLN35503.html). Cohérent avec l'issue : Yahoo ou AOL sans Mail Plus va vers « Autre » avec un avis.
- La page ne dit rien des filtres.

## Pas de source officielle trouvée (à traiter comme inconnu)

1. **Orange** : aucune page officielle d'assistance trouvée, seulement des messages d'utilisateurs du forum communautaire (non primaires). Ils indiquent : roue crantée, « Généralités et transfert de mail ». Ils indiquent aussi qu'Orange aurait restreint ou réinitialisé les redirections pour lutter contre le piratage, et ne les permettrait plus que pour les adresses liées à une Livebox active. **Rien de cela n'est confirmé par Orange.** Conséquence : ne pas écrire de guide Orange pas à pas ; le traiter comme « Autre » avec un avis prudent, ou le tester sur un compte réel avant de le publier. Même règle pour Free et SFR (déjà prévue par l'issue).
2. **Format du code de confirmation Gmail** : aucun document Google ne décrit la longueur, le jeu de caractères ni la durée de validité. Des sources secondaires indiquent expéditeur `forwarding-noreply@google.com`, sujet contenant « Gmail Forwarding Confirmation », un code (souvent numérique, longueur variable selon les exemples) et un lien ; au moins un témoignage mentionne un lien sans code utilisable. Conséquences pour le code :
   - extraire le code par une expression tolérante (tout motif numérique dans le sujet puis le corps), et **toujours afficher aussi le lien de confirmation** comme repli ;
   - ne pas coder de longueur fixe ;
   - écrire la fixture e2e d'après un vrai mail de confirmation capturé sur staging, pas d'après cet exemple ;
   - détecter l'expéditeur par adresse exacte mais traiter tout mail inconnu comme un mail normal.
3. **Règles Outlook.com et iCloud** : étapes détaillées non lues (voir plus haut). Les guides « filtre sur expéditeurs d'alertes » pour ces deux messageries doivent être validés à la main.
4. **Délai d'application** d'un transfert ou d'une règle : non documenté (un guide tiers parle de 15 minutes pour iCloud, non primaire). Prévoir une étape « en attente du premier mail » sans délai promis.

## Implications pour l'implémentation

- Ordre Gmail : adresse Jobbbox, code ou lien lu dans le mail de vérification, activation du transfert, filtre sur les expéditeurs d'alertes.
- Outlook.com et iCloud : pas de code ; l'étape « premier mail reçu » sert de confirmation.
- Un seul guide « Autre » générique couvre Yahoo sans Mail Plus, AOL, Free, SFR, Orange tant qu'ils ne sont pas testés.
- Textes FR/EN sans captures ni libellés de menu cités comme certains ; indiquer la date de vérification des guides dans la documentation interne.
