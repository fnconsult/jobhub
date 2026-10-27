# Recherche #431 : adresse de transfert dédiée par Candidat

Carte : #426. Vérifié le 2026-10-27, sources primaires (docs des fournisseurs, pages d'aide officielles, RFC). Ce qui n'a pas pu être confirmé à la source est rangé dans « Non vérifié ».

Question : Jobbbox peut-il recevoir les mails d'offres qu'un Candidat transfère vers une adresse personnelle (ex. `prenom-x7k2@alertes.jobbbox.ai`) ?

## Réponse courte

Oui, faisable pour le MVP. **Brevo Inbound Parsing** suffit : même fournisseur que l'envoi, hébergement UE, un sous-domaine `alertes.jobbbox.ai` avec deux MX, un webhook JSON par mail. Le transfert automatique **filtré par expéditeur** est possible chez Gmail, Outlook.com, iCloud et Orange ; Yahoo exige un abonnement payant ; Free et SFR ne sont pas documentés officiellement. Le transfert manuel d'un mail de recruteur marche partout, l'expéditeur d'origine n'étant lisible que dans le corps du mail.

## 1. Réception entrante

### Brevo Inbound Parsing (recommandé)

Source : https://developers.brevo.com/docs/inbound-parse-webhooks

- Mise en place : domaine d'envoi vérifié chez Brevo ; domaine de réception **distinct** du domaine d'envoi (ex. `alertes.jobbbox.ai`, `hello@jobbbox.ai` reste intact) ; deux MX : `inbound1.sendinblue.com.` (priorité 10) et `inbound2.sendinblue.com.` (priorité 20) ; webhook créé par `POST /v3/webhooks` avec `type: "inbound"`, `domain`, `url`, événement `inboundEmailProcessed`.
- Tout le sous-domaine est reçu : n'importe quelle partie locale arrive au webhook. C'est notre code qui reconnaît l'adresse du Candidat (champ `Recipients` = RCPT TO, ou `To`) et rejette les inconnues.
- Contenu : JSON `items[]`, un élément par mail : `MessageId`, `InReplyTo`, `From`, `To`, `Cc`, `ReplyTo`, `Recipients`, `SentAtDate`, `Subject`, `RawHtmlBody`, `RawTextBody`, `ExtractedMarkdownMessage` (sans la signature), `ExtractedMarkdownSignature`, `Spam.Score` (rspamd ; l'exemple montre `SpamScore` à la racine, à vérifier), `Attachments`, `Headers`.
- **Pas de MIME brut.** Corps HTML et texte et en-têtes analysés seulement. Suffisant pour une alerte de job board (HTML) ou un mail de recruteur.
- Pièces jointes : métadonnées seulement (`Name`, `ContentType`, `ContentLength`, `ContentID`, `DownloadToken`) ; le contenu se télécharge par l'endpoint « get inbound email attachment ». On peut donc ignorer les pièces jointes sans les télécharger.
- Authentification SPF/DKIM : aucun champ « pass/fail » fourni par Brevo ; les en-têtes d'origine (`Received-SPF`, `ARC-Authentication-Results`, `DKIM-Signature`) sont dans `Headers`.
- Logs : endpoints pour lister les mails reçus et en lire un par UUID.
- Brevo prévient que l'analyse ne réussit pas à 100 %.
- Sécurité du webhook (https://developers.brevo.com/reference/createwebhook, https://developers.brevo.com/docs/how-to-use-webhooks) : pas de signature HMAC. Moyens disponibles : objet `auth` (`type`, `token`), en-têtes personnalisés `headers[]` (on peut y mettre un secret aléatoire), et liste blanche des IP de Brevo. Recommandation : secret dans un en-tête personnalisé, comparé en temps constant, plus liste blanche d'IP.
- Résidence : serveurs OVH (France, Allemagne) et Google Cloud (Belgique), tous dans l'UE (https://help.brevo.com/hc/en-us/articles/360001005510). Conforme à ADR-0007.
- Prix : aucune page officielle consultée n'indique si l'inbound parsing est compris dans un plan ou facturé à part (voir « Non vérifié »).

### Alternatives

| Fournisseur | UE | Format | Signature | Remarques |
|---|---|---|---|---|
| **Mailgun Routes** | Région UE : MX `mxa.eu.mailgun.org` / `mxb.eu.mailgun.org`, données gardées dans la région | Form ou JSON (URL finissant par `json`) ; **MIME brut** si l'URL finit par `mime` (`body-mime`) ; PJ en base64 en JSON | HMAC-SHA256 (`X-Mailgun-Signature`, `X-Mailgun-Timestamp`) | Retries 8 h (200 = ok, 406 = rejet). Nombre de routes selon le plan. https://documentation.mailgun.com/docs/mailgun/user-manual/receive-forward-store/receive-http, https://www.mailgun.com/pricing/ |
| **Amazon SES receiving** | Oui : Frankfurt, Ireland, London, Milan, Paris, Stockholm (`inbound-smtp.eu-west-3.amazonaws.com` pour Paris) | Règles de réception → S3 (MIME brut) / SNS / Lambda | IAM (pas de webhook public) | Plus d'infra à monter (compte AWS, S3, SNS). https://docs.aws.amazon.com/general/latest/gr/ses.html#ses_inbound_endpoints |
| **Postmark Inbound** | Pas d'option UE trouvée dans la doc | JSON, PJ en base64, 35 Mo cumulés | Non documentée sur la page | Écarté (ADR-0007). https://postmarkapp.com/developer/user-guide/inbound/parse-an-email |
| **Cloudflare Email Routing + Email Workers** | Pas de déclaration de résidence UE sur les pages lues | MIME brut en flux (`message.raw`), 25 Mio max, `setReject()` | Code dans un Worker | 200 règles par domaine ; il faudrait un Worker qui relaie vers notre API. https://developers.cloudflare.com/email-routing/email-workers/runtime-api/, https://developers.cloudflare.com/email-routing/limits/ |

Conclusion : Brevo pour le MVP (déjà sous contrat, UE, clé déjà gérée dans Paramètres, aucune infra). Mailgun UE en repli si on a besoin du MIME brut ou d'une vraie signature HMAC.

### SPF, DKIM, DMARC et ARC d'un mail transféré

- Un transfert automatique réémet le mail depuis les serveurs du fournisseur du Candidat (Gmail, Microsoft…) : le SPF de l'expéditeur d'origine échoue chez nous ; la signature DKIM d'origine survit en général si le corps n'est pas modifié. ARC (RFC 8617, https://www.rfc-editor.org/rfc/rfc8617.html §1, §7.2.1) permet à chaque intermédiaire de sceller ses résultats d'authentification ; un récepteur peut, par politique locale, s'y fier malgré l'échec DMARC. La §9.4 avertit qu'un scelleur malveillant peut aider du spam à passer.
- Pour nous, ce n'est pas un contrôle d'accès : on ne fait confiance ni à l'expéditeur ni au contenu (le mail devient au plus une Job Offer « reçue par email »). Le vrai contrôle est l'adresse secrète du Candidat (§4). On peut journaliser `ARC-Authentication-Results` et le score de spam, et écarter au-dessus d'un seuil.

## 2. Transfert automatique chez chaque fournisseur

| Messagerie | Transfert auto | Filtré par expéditeur | Confirmation par l'adresse cible | Source |
|---|---|---|---|---|
| **Gmail** | Oui (Paramètres > Transfert et POP/IMAP) | Oui : créer un filtre (critère « De ») avec l'action « Transférer à » ; l'adresse doit d'abord être ajoutée et confirmée | **Oui** : mail de confirmation envoyé à l'adresse cible, avec lien et code | https://support.google.com/mail/answer/10957, https://support.google.com/mail/answer/6579 |
| **Outlook.com** | Oui (Paramètres > Courrier > Transfert) ; la double authentification du compte Microsoft est exigée | Oui : Règles > Ajouter une règle, condition sur l'expéditeur, action « Transférer à » | Non documentée | https://support.microsoft.com/en-us/outlook/turn-on-or-off-automatic-forwarding-in-outlook-com, https://support.microsoft.com/en-us/outlook/mail/use-rules-to-automatically-forward-messages |
| **iCloud Mail** | Oui (icloud.com > Réglages > Transfert de mail) | Règles : « seulement certains mails », une adresse de transfert par règle ; la page ne confirme pas explicitement la condition « De » + « Transférer » | Non documentée | https://support.apple.com/guide/icloud/automatically-forward-email-mm6b1a3960/icloud, https://support.apple.com/guide/icloud/set-up-filtering-rules-mm6b1a3f8a/icloud |
| **Yahoo Mail** | **Seulement avec Yahoo Mail Plus (payant)**, et pas dans toutes les régions | Non documenté | Oui : bouton « Vérifier », instructions envoyées à l'adresse cible | https://help.yahoo.com/kb/new-yahoo-mail/enable-automatic-email-forwarding-yahoo-mail-sln36684.html |
| **Orange** | Oui (Paramètres > Tous les paramètres > Généralités > Transfert de mails) | **Oui** : « certains mails », critères expéditeur, objet, destinataire | Non documentée | https://assistance.orange.fr/ordinateurs-peripheriques/installer-et-utiliser/l-utilisation-du-mail-et-services-associes/mail-orange/parametrer-la-boite-mail/mail-orange-rediriger-vos-emails-vers-une-autre-boite-mail_196861-741574 |
| **Free** | Non documenté sur assistance.free.fr | — | — | Voir « Non vérifié » |
| **SFR** | Non documenté sur une page officielle accessible | — | — | Voir « Non vérifié » |

### Outlook.com bloque-t-il le transfert externe ?

Aucune page officielle Microsoft consultée ne dit que le transfert externe est bloqué pour un compte personnel Outlook.com. Les seules conditions documentées : double authentification obligatoire, nombre d'adresses de transfert « éventuellement limité selon les paramètres du compte », règles inactives si la boîte est pleine. (Le blocage du transfert externe par défaut concerne Microsoft 365 en entreprise, pas Outlook.com ; non sourcé ici.)

### Le code de confirmation Gmail : comment le montrer au Candidat

Gmail envoie à l'adresse cible un mail « (#code) Gmail Forwarding Confirmation » avec un lien et le code. Il arrive donc dans **notre** webhook, à l'adresse du Candidat. Proposition :
- reconnaître ce mail (expéditeur Google, sujet « Forwarding Confirmation ») avant tout traitement d'offre, ne pas en faire une Job Offer ;
- afficher le code (et le lien) au Candidat dans Paramètres > Sources, sur la carte de son adresse de transfert, en direct pendant qu'il configure Gmail ;
- ne jamais cliquer nous-mêmes sur le lien (c'est au titulaire de la boîte de consentir).
Même mécanisme pour la vérification Yahoo et toute autre confirmation : un état « mail de confirmation reçu » avec son contenu, visible du seul Candidat.

## 3. Transfert manuel d'un mail (recruteur)

- Le mail transféré à la main est un **nouveau** mail : `From` = le Candidat, l'objet commence par « Fwd: » / « TR: ». L'expéditeur d'origine (nom, adresse, date, objet) n'apparaît que dans le **corps**, dans le bloc d'en-tête cité inséré par le client mail (Gmail : « ---------- Forwarded message --------- / De : … », Outlook : « De : … Envoyé : … »). Brevo nous donne ce corps en HTML, texte et Markdown (`ExtractedMarkdownMessage`), lisible par l'IA.
- Le format de ce bloc varie selon le client et la langue : on le laisse à l'extraction par l'IA (Mistral sous l'EU AI Consent, contenu porteur d'identité) plutôt qu'à des expressions régulières.
- Le transfert « en pièce jointe » (Outlook) met le mail d'origine en `.eml` : Brevo n'en donne que les métadonnées et un `DownloadToken`. Cas à gérer plus tard ou à décourager dans le guide.
- Un mail transféré à la main venant du Candidat lui-même, on peut le reconnaître (`From` = une adresse connue du Candidat) et le traiter comme intentionnel.

## 4. Abus et spam

- **Adresse devinable** : la partie locale doit être imprévisible. `prenom-x7k2` (4 caractères) est trop court : préférer un suffixe aléatoire d'au moins 10 caractères en base32 (≈ 50 bits), sans le prénom si on veut limiter la fuite d'identité (`x7k2m9q4ta@alertes.jobbbox.ai`). Le prénom est un confort, pas une sécurité.
- **Révocation** : le Candidat peut régénérer son adresse ; l'ancienne est refusée (le webhook ignore et journalise). Désactiver aussi l'adresse quand le compte est supprimé.
- **Plafond de volume** : quota par adresse (ex. N mails/jour) et par Plan ; au-delà, on ignore et on signale au Candidat. Mailgun permet le rejet (406) ; avec Brevo, le mail est déjà reçu, on l'écarte côté code.
- **Filtrage** : ignorer les mails dont le score de spam Brevo dépasse un seuil ; ignorer les mails sans contenu d'offre (l'IA classe « pas une offre », trace dans l'AI Activity) ; ne jamais suivre les liens d'un mail, a fortiori ceux d'un Forbidden site (règle de la carte #426).
- **Authentification du webhook** : secret dans un en-tête personnalisé + IP de Brevo ; idempotence sur `MessageId` (retries).
- **Données personnelles** : un mail contient l'adresse et le nom du Candidat et du recruteur ; le journal des Tools ne garde jamais d'adresse ni de contenu (règle CONTEXT.md « Tool »). Durée de conservation du corps brut à fixer (le minimum : garder la Job Offer, jeter le mail).

## 5. Recommandation

**Faisable pour le MVP, ouvert à tous les Plans.**

- Fournisseur : Brevo Inbound Parsing sur `alertes.jobbbox.ai` (MX Brevo), webhook vers notre API avec secret d'en-tête.
- Coût : a priori nul en plus du contrat Brevo actuel (à confirmer auprès de Brevo) ; coût IA par mail (classification + extraction Mistral), à plafonner par le quota.
- Délai estimé : 2 à 4 jours de dev (DNS + webhook + adresse par Candidat + carte dans Paramètres > Sources avec code de confirmation + guide), hors l'extraction en Job Offer qui relève d'autres tickets de la carte.
- Guide pas à pas à fournir dans l'app pour : Gmail (ajout de l'adresse, code affiché par Jobbbox, filtre par expéditeur des alertes), Outlook.com (règle par expéditeur), iCloud (règle), Orange (transfert de certains mails par expéditeur). Yahoo : transfert manuel seulement sauf Mail Plus. Free et SFR : transfert manuel en attendant de vérifier leur webmail.
- Proposer en premier le **filtre par expéditeur** (alertes LinkedIn, Indeed, Welcome to the Jungle, APEC, France Travail…) plutôt que le transfert de toute la boîte : moins de données personnelles, moins de coût IA, meilleur consentement.

## Non vérifié

1. **Prix et disponibilité par plan de Brevo Inbound Parsing** : aucune page officielle consultée ne le dit. Demander au support Brevo ou tester sur le compte.
2. **Taille maximale** d'un mail reçu par Brevo et **politique de retry** du webhook inbound : non documentées.
3. Valeurs admises de `auth.type` dans la création de webhook Brevo (basic, bearer ?) : non listées.
4. **Free** (webmail Free / Zimbra) et **SFR** : aucune page d'aide officielle trouvée sur le transfert ou les filtres de transfert ; à tester sur un compte réel avant d'écrire le guide.
5. iCloud : combinaison exacte « De contient … » + « Transférer à » dans une règle, à confirmer sur l'écran Règles d'icloud.com.
6. Outlook.com : pas de confirmation envoyée à l'adresse cible documentée ; plafond du nombre d'adresses de transfert non chiffré.
7. Résidence UE de Cloudflare Email Routing : non établie sur les pages lues.
