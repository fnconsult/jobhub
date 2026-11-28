# Recherche #1162 : envoi Brevo au nom du Candidate, avec copie

Note : le skill `mattpocock-skills:research` n'était pas disponible dans la session. developers.brevo.com n'est pas résolu depuis le réseau autorisé de la session : rien ci-dessous n'a pu être confirmé contre la documentation primaire. Les points marqués « à confirmer » doivent l'être avant de figer le code (ajouter developers.brevo.com et help.brevo.com à la liste réseau, ou vérifier à la main).

## Ce que le ticket suppose de l'extérieur

L'envoi existe déjà côté code : `apps/web/src/auth/mailers.ts` appelle `POST https://api.brevo.com/v3/...` avec un `sender` analysé (`parseSender`). Le ticket ajoute trois choses : un expéditeur « Prénom Nom via Jobbbox », un destinataire tiers, une copie au Candidate.

1. Endpoint : `POST /v3/smtp/email` (e-mail transactionnel). Champs attendus (connaissance de l'API, à confirmer) : `sender {name, email}`, `to [{email, name}]`, `cc [{email, name}]`, `replyTo {email, name}`, `subject`, `textContent`/`htmlContent`, `headers`, `tags`. La réponse porte un `messageId`.
2. Expéditeur : Brevo n'envoie que depuis un expéditeur ou un domaine validé du compte. L'adresse doit donc être une adresse fixe du domaine d'envoi Jobbbox ; seul le nom d'affichage varie (« Prénom Nom via Jobbbox »). On ne peut pas mettre l'adresse du Candidate en `sender` : elle échouerait à la validation et au DMARC (From non aligné).
3. Réponse : `replyTo` = adresse de connexion du Candidate. Le tiers qui répond écrit donc directement au Candidate, pas à Jobbbox.
4. Copie : `cc` = adresse de connexion du Candidate. Conséquence à trancher : avec `cc` et `replyTo` identiques, « Répondre à tous » du tiers contient le Candidate deux fois sans gravité, mais le destinataire voit l'adresse du Candidate (c'est voulu par le ticket ; à dire dans le registre et sur la carte).
5. Authentification : SPF, DKIM, DMARC déjà en place pour le domaine transactionnel (dit par le ticket). Vérifier que c'est le même domaine que celui retenu pour l'envoi (pas un sous-domaine différent) et que le DMARC aligné tient pour le `From` choisi. Réputation : un envoi à des tiers non sollicités n'a pas le profil des e-mails transactionnels ; risque de plaintes pour spam sur le domaine partagé. Brevo applique ses propres limites et sa politique d'usage (à confirmer : conditions d'utilisation sur l'envoi à des destinataires qui n'ont pas opté pour recevoir).
6. Pas de clé d'idempotence connue sur `/smtp/email` (à confirmer). Le « double clic n'envoie qu'une fois » doit donc être garanti côté Jobbbox : un identifiant d'envoi unique, réservé en base avant l'appel, transition d'état atomique (par exemple `proposé -> envoyé`), et ne jamais réessayer automatiquement après un délai d'attente (le message a pu partir).
7. Limites : taille du message, nombre de destinataires, quota d'envois selon l'offre Brevo (à confirmer). Un seul `to` et un seul `cc` ici, donc pas de problème de volume ; le plafond journalier du ticket est un paramètre de plateforme, indépendant de Brevo.

## Règlement et vie privée

- RGPD : Jobbbox envoie au nom du Candidate des données personnelles (nom, adresse du Candidate, nom et adresse du tiers) via Brevo, sous-traitant. À inscrire au registre de traitement ; le tiers destinataire n'a pas de relation avec Jobbbox, informer par la mention dans le message (« envoyé via Jobbbox au nom de ... ») plutôt que de supposer un consentement. Base légale côté Candidate : exécution du service demandé par le clic ; côté tiers : à trancher par #1160.
- Prospection : un Outreach Message à un recruteur est du B2B ; en France (CPCE L34-5) la prospection électronique B2B reste permise sans consentement préalable si le message a un rapport avec la fonction du destinataire et s'accompagne d'un moyen simple de s'opposer. Candidature spontanée à titre individuel : probablement hors prospection commerciale, mais à faire confirmer par #1160. À confirmer par le conseil, pas ici.
- Brevo : transferts hors UE et clauses contractuelles à vérifier dans l'accord de traitement de données Brevo ; déjà dans le registre pour les e-mails transactionnels, donc ajouter la finalité, pas un nouveau sous-traitant.
- Pour la décision PO du 2026-11-27 : réglage désactivé par défaut en Production, brouillons de registre/politique/CGU dans la PR, aucune donnée réelle dans le code ni les tests (adresses de test en `example.com`/`example.test`).

## Recommandation d'implémentation

- `sender.email` fixe (domaine d'envoi validé), `sender.name` = « Prénom Nom via Jobbbox » (assainir le nom : retirer retours à la ligne, guillemets, `<>`, limiter la longueur, pour empêcher l'injection d'en-têtes).
- `replyTo` et `cc` = adresse de connexion du Candidate ; `to` = destinataire de la carte, relu côté serveur depuis l'Application, jamais depuis le corps de la requête du client.
- Idempotence côté Jobbbox, pas de nouvelle tentative automatique, enregistrement sur l'Application avec date et `messageId`.
- Tests avec le mailer simulé existant : un clic = un appel, `cc`/`replyTo` justes, double clic = un appel.
- Avant production : confirmer les points « à confirmer » ci-dessus contre developers.brevo.com et le DPA Brevo.
