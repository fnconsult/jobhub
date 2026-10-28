# Recherche #442 : réception des mails transférés via Brevo Inbound Parsing

Carte : #426. Vérifié le 2026-10-28 auprès des docs Brevo. Complète `docs/research/issue-431.md` (branche `research/forwarding-address`), qui couvre le choix du fournisseur, les MX et le transfert côté messagerie. Ici : seulement ce qu'il faut savoir pour écrire la route `POST /api/email-intake/inbound`.

## Ce qui est confirmé

- **Payload** (https://developers.brevo.com/docs/inbound-parse-webhooks) : objet `{ items: [...] }`, un élément par mail. Champs : `Uuid` (string[]), `MessageId`, `InReplyTo` (nullable), `From {Name, Address}`, `To[]`, `Recipients[]` (RCPT TO), `Cc[]`, `ReplyTo` (nullable), `SentAtDate` (RFC822), `Subject`, `RawHtmlBody` (nullable), `RawTextBody` (nullable), `ExtractedMarkdownMessage`, `ExtractedMarkdownSignature`, `Spam`, `Attachments[]`, `Headers`.
  - `Headers` : string si l'en-tête apparaît une fois, string[] sinon (typer en `string | string[]`).
  - `Attachments[]` : `Name`, `ContentType`, `ContentLength` (estimée), `ContentID`, `DownloadToken` ; métadonnées seulement, donc ignorer les pièces jointes ne coûte rien.
  - Le tableau de champs dit `Recipients` = RCPT TO (boîtes), l'exemple de la page montre des chaînes. Accepter les deux formes.
- **Score de spam** : le tableau documente `Spam.Score` (rspamd), mais l'exemple montre `SpamScore` à la racine. La page ne tranche pas. Le parseur doit lire les deux et traiter l'absence comme « inconnu ».
- **Création du webhook** (https://developers.brevo.com/reference/createwebhook) : `type: "inbound"`, `domain` obligatoire, `events` défaut `inboundEmailProcessed` (seul événement). Option `headers[]` (`key`, `value`) envoyés à chaque requête, et `auth {type, token}`.
- **Sécurité** (https://developers.brevo.com/docs/secured-webhooks.md) : quatre moyens, aucun de signature : liste blanche d'IP, `user:pass@` dans l'URL, `auth.type = "bearer"` + token, en-têtes personnalisés. Aucune signature HMAC ni du payload. Pour `BREVO_INBOUND_SECRET`, l'en-tête personnalisé (ou `bearer`) convient ; comparer en temps constant.
- **Plages d'IP des webhooks** (https://help.brevo.com/hc/en-us/articles/15127404548498, lue via un résumé de recherche car la page répond 403 à un fetch direct) : `1.179.112.0/20` et `172.246.240.0/20`. Les quatre IP « plugins » (91.121.36.98, 91.121.61.102, 87.98.220.61, 87.98.147.208) ne concernent pas les webhooks. Les plages sont sous la rubrique webhooks marketing/transactionnels ; la page ne dit pas explicitement qu'elles couvrent aussi l'inbound (voir ci-dessous).
- **Limite** : 40 webhooks au total par compte (https://developers.brevo.com/docs/how-to-use-webhooks).

## Non documenté par Brevo (à traiter comme inconnu dans le code)

1. **Politique de retry** et **codes de réponse attendus** pour l'inbound : aucune des pages lues n'en parle. L'issue suppose que « 500 laisse Brevo retenter » ; c'est une hypothèse, pas un fait sourcé. Conséquences pour le code : rendre le traitement **idempotent sur `MessageId`** (un retry ou un doublon ne doit ni doubler la file ni compter deux fois au plafond), répondre 2xx pour tout mail volontairement écarté (inconnu, plafond atteint) afin de ne pas provoquer de retry, et réserver 5xx aux vraies pannes.
2. **Taille maximale** d'un mail ou d'un corps : non documentée. Plafonner le texte conservé côté code (déjà prévu) et borner la taille du corps de requête lu.
3. **Valeurs admises de `auth.type`** : seul `bearer` est cité (page « secured webhooks »). Préférer l'en-tête personnalisé, qui est documenté sans ambiguïté.
4. **Plages d'IP pour l'inbound** : rien ne confirme que les mêmes CIDR sont utilisés pour l'inbound. À valider en staging avant de rendre le filtre IP bloquant : journaliser l'IP source (derrière le proxy, lire l'en-tête de l'hôte, pas un en-tête forgeable) et comparer. Prévoir la liste en Platform Setting plutôt qu'en dur.
5. **Authentification de l'expéditeur** (DMARC, SPF/DKIM alignés pour « expéditeur reconnu ») : Brevo ne fournit aucun résultat pass/fail (voir #431) ; la décision doit se lire dans `Headers` (`Authentication-Results`, `Received-SPF`, `ARC-Authentication-Results`). Le format et la présence de ces en-têtes sur le trafic réel d'inbound n'est pas documenté : à vérifier sur de vrais mails de staging, et à défaut, retomber sur « expéditeur non reconnu ».
6. **Ordre de réception et doublons** : non documentés.

## Implications pour l'implémentation

- Lire `RawHtmlBody` (rendu en texte) sinon `RawTextBody` ; ne jamais lire `Attachments` ni stocker `Headers` hormis les valeurs d'authentification nécessaires à la décision.
- Résoudre l'adresse via `Recipients` (RCPT TO), repli sur `To`.
- Écrire les fixtures de test d'après la forme documentée ci-dessus, y compris les deux variantes de score de spam.
