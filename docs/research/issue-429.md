# Recherche #429 : accès IMAP à iCloud, Yahoo (et AOL) avec mot de passe d'application

Vérifié le 2026-10-27 pour la carte #426 (offres reçues par email). Sources : pages d'aide Apple et Yahoo, conditions d'utilisation, page développeur Yahoo, et un sondage `CAPABILITY` avant authentification des serveurs IMAP (aucun identifiant utilisé). Les points non confirmés sont listés à la fin.

## Réponse courte

- **iCloud Mail** : IMAP uniquement par **mot de passe d'application** (pas d'OAuth ouvert aux tiers). Faisable techniquement, sans démarche auprès d'Apple.
- **Yahoo Mail / AOL** (même plateforme Yahoo Inc.) : deux voies. Le **mot de passe d'application** marche aujourd'hui pour les comptes gratuits (rien dans l'aide ne le réserve à Yahoo Mail Plus), mais sa création est soumise à un contrôle d'« éligibilité » opaque. La voie **OAuth2 IMAP** existe mais passe par une **candidature commerciale** (formulaire, accord signé, exigences de sécurité), non disponible en libre-service.
- **Recommandation** : faisable pour le MVP **comme option secondaire, en bêta**, derrière l'adresse de transfert personnelle qui reste le geste principal pour ces fournisseurs. Lecture seule par polling, filtre `SEARCH FROM` sur les expéditeurs d'alertes, mot de passe d'application chiffré comme un Provider Secret mais par Candidat. Déposer en parallèle la candidature OAuth Yahoo si on veut industrialiser Yahoo/AOL.

## 1. Mots de passe d'application

### Apple (iCloud)
Source : [Apple, « Utiliser des mots de passe pour app » (102654)](https://support.apple.com/en-us/102654).
- **Prérequis** : identifiant Apple protégé par la **double authentification** (« your Apple Account must be protected with two-factor authentication »).
- **Création** : account.apple.com → Connexion et sécurité → Mots de passe pour app → générer, nommer, copier dans l'app.
- **Limite** : **25** mots de passe d'application actifs au plus.
- **Révocation** : un par un ou « Tout révoquer » au même endroit ; l'app utilisatrice est déconnectée.
- **Durée de vie** : aucune expiration documentée. Ils sont **tous révoqués automatiquement si le Candidat change ou réinitialise son mot de passe Apple**. Nous devons donc détecter l'échec d'authentification et passer la boîte en « déconnectée ».

### Yahoo
Sources : [Yahoo, « Generate and manage 3rd-party app passwords » (SLN15241)](https://help.yahoo.com/kb/sln15241.html), [« Ways to securely access Yahoo Mail » (SLN27791)](https://help.yahoo.com/kb/SLN27791.html).
- **Création** : page Sécurité du compte → « Connexions externes » → « Créer un mot de passe d'application » → nommer → « Générer » → saisir une fois dans l'app.
- **Prérequis** : l'aide ne mentionne ni double authentification ni ancienneté du compte, mais un **contrôle d'éligibilité** : utiliser un navigateur où l'on s'est connecté à Yahoo plusieurs jours de suite, hors navigation privée ; sinon, utiliser le webmail ou l'app Yahoo. « Customer care can't override this process ». SLN27791 ajoute qu'avec la validation en deux étapes, un mot de passe d'application « may » être nécessaire, et que « not all third-party email apps are supported ».
- **Révocation** : le supprimer (même page). **Il reste actif même si le Candidat change son mot de passe principal** : la déconnexion de Jobbbox doit lui dire de le supprimer chez Yahoo.
- **Durée de vie** : aucune expiration documentée.
- **Comptes gratuits vs Yahoo Mail Plus** : aucune des pages officielles lues ne fait de distinction ; l'IMAP par mot de passe d'application est ouvert aux comptes gratuits.

### AOL
AOL fait partie de Yahoo Inc. et tourne sur la même plateforme : son serveur IMAP annonce exactement les mêmes capacités que celui de Yahoo (sondage ci-dessous). L'aide AOL a un article « [Create and manage 3rd-party app passwords](https://help.aol.com/articles/create-and-manage-app-password) » (« you may need a special code to give that app permission to access your AOL account ») dont le corps n'est pas lisible sans JavaScript ; on suppose le même fonctionnement que Yahoo (non vérifié en détail).

## 2. Programme OAuth Yahoo pour applications tierces

Source : [Yahoo Sender Hub, « API Access »](https://senders.yahooinc.com/developer/developer-access/).
- Yahoo n'a plus d'API Mail propriétaire ; l'accès passe par **IMAP (et CardDAV/CalDAV) avec OAuth2**. Les scopes Mail **ne sont pas disponibles en libre-service** dans la console développeur : il faut une **demande d'accès commercial** (formulaire, contact mail-api@yahooinc.com), puis accepter les conditions des API Yahoo et « any additional terms ».
- Conditions : satisfaire des **exigences minimales de sécurité et de confidentialité** ; données utilisées seulement pour des fonctions visibles par l'utilisateur qui améliorent son expérience mail ; **ni vente ni transfert** à des tiers ; **ni publicité, ni profilage, ni suivi d'engagement** ; politique de confidentialité exacte ; **consentement par cas d'usage**. Yahoo peut révoquer l'accès à tout moment et limiter le débit.
- Lecture des offres d'emploi pour le Candidat, à son profit, sans revente : cela semble compatible, mais l'approbation n'est pas garantie et son délai n'est pas publié. Les serveurs annoncent bien `AUTH=XOAUTH2` et `AUTH=OAUTHBEARER`.
- D'après la doc d'un intégrateur ([Nylas](https://developer.nylas.com/docs/provider-guides/yahoo-authentication/), source secondaire), le scope lecture est `mail-r` et Yahoo envoie un « Yahoo Mail Products Commercial Access Agreement » à signer.

**Apple** : aucun programme OAuth pour l'accès d'un tiers à iCloud Mail n'a été trouvé. Le serveur annonce `AUTH=XOAUTH2`/`ATOKEN`, mais rien ne documente leur usage par des tiers ; « Se connecter avec Apple » ne donne pas accès au courrier.

## 3. Paramètres IMAP et capacités

| | iCloud | Yahoo | AOL |
|---|---|---|---|
| Hôte IMAP | `imap.mail.me.com` | `imap.mail.yahoo.com` | `imap.aol.com` (l'aide AOL UK cite aussi `export.imap.aol.com`) |
| Port / TLS | 993, SSL/TLS requis | 993, SSL requis | 993, TLS (vérifié par connexion) |
| Identifiant | nom sans domaine (sinon adresse complète) | adresse complète | adresse complète (source secondaire) |
| Mot de passe | mot de passe d'application | mot de passe d'application | mot de passe d'application |
| Source | [Apple 102525](https://support.apple.com/en-us/102525) | [Yahoo SLN3697](https://help.yahoo.com/kb/SLN3697.html) | sondage + [aide AOL UK](https://help.aol.co.uk/articles/download-your-email-from-aol-mail-with-imap) |

iCloud ne propose pas POP.

**Capacités annoncées avant authentification** (sondage `CAPABILITY` du 2026-10-27) :
- Yahoo et AOL : `IMAP4rev1 SASL-IR AUTH=PLAIN AUTH=XOAUTH2 AUTH=OAUTHBEARER ID MOVE NAMESPACE XYMHIGHESTMODSEQ UIDPLUS LITERAL+ CHILDREN UNSELECT X-MSG-EXT OBJECTID IDLE ENABLE UIDONLY X-UIDONLY LIST-EXTENDED LIST-STATUS SPECIAL-USE PARTIAL APPENDLIMIT=41697280`. **IDLE** est donc présent ; pas de `CONDSTORE` standard annoncé (un `XYMHIGHESTMODSEQ` propriétaire à la place).
- iCloud : `XAPPLEPUSHSERVICE IMAP4 IMAP4rev1 SASL-IR AUTH=ATOKEN AUTH=PLAIN AUTH=ATOKEN2 AUTH=XOAUTH2`. Les extensions (IDLE, etc.) ne sont annoncées qu'après connexion : à vérifier avec un compte de test.

**Recherche côté serveur** : `SEARCH`/`UID SEARCH` avec `FROM`, `SINCE`, `SUBJECT` font partie du socle IMAP4rev1 ([RFC 3501 §6.4.4](https://www.rfc-editor.org/rfc/rfc3501#section-6.4.4)) et sont donc disponibles sur les trois. Approche proposée : `UID SEARCH SINCE <date> OR FROM "jobalerts-noreply@linkedin.com" FROM "…indeed…"`, puis `UID FETCH` des seuls messages retenus, avec mémorisation du dernier UID et de `UIDVALIDITY` par boîte. On ne lit pas le reste de la boîte, ce qui est la minimisation RGPD.

**IDLE ou polling** : IDLE suppose une connexion TCP ouverte en permanence **par Candidat**, ce qui ne tient pas à l'échelle dans le worker et se heurte aux limites de connexions. Le flux « continu » de la carte supporte quelques minutes de retard : **polling** par pg-boss (par exemple toutes les 10 à 15 min, avec étalement), une connexion courte par passage.

**Limites de connexions** : ni Apple ni Yahoo ne publient de chiffre (seuls des fils de discussion communautaires en parlent). Une connexion courte à la fois par boîte, un backoff sur erreur, et considérer `NO`/`BYE` avec throttling comme « réessayer plus tard ».

## 4. Stocker un mot de passe d'application

- **Chiffrement** : réutiliser le chiffre d'ADR-0020 (`SecretCipher`, AES-256-GCM, trousseau `SECRETS_MASTER_KEYS`, re-chiffrement nocturne), dans une **table à part par Candidat** (ce n'est pas un Provider Secret de plateforme), avec des données authentifiées `candidat|boîte|id de ligne|version de clé`. Jamais en log, jamais dans l'AI Message Log ni dans les AI Activity, `scrubSecrets` sur les erreurs IMAP. Effacé à la déconnexion et à la suppression du compte ; absent de l'export de données (on y signale seulement la boîte connectée).
- **Risque principal** : un mot de passe d'application n'a **pas de scope**. Il donne lecture, écriture, suppression **et envoi (SMTP)** sur toute la boîte, et chez Apple il sert aussi à d'autres services iCloud. Une fuite de notre base, avec les clés maîtresses, compromettrait la messagerie des Candidats. D'où : clés maîtresses hors base, code IMAP en lecture seule (`EXAMINE` plutôt que `SELECT`, aucun `STORE` ni `EXPUNGE`), aucun code SMTP sur ces identifiants.
- **Cycle de vie** : iCloud révoque tout au changement de mot de passe, alors que Yahoo/AOL gardent le mot de passe d'application actif. Sur échec d'authentification : marquer la boîte « déconnectée », arrêter le polling, prévenir le Candidat. À la déconnexion : lui dire de **supprimer le mot de passe chez Apple/Yahoo**, car on ne peut pas le révoquer pour lui.
- **Conditions d'utilisation** :
  - Apple, [conditions iCloud](https://www.apple.com/legal/internet-services/icloud/) : §IV.A demande de ne pas partager ses identifiants de compte avec une autre personne ; §V.B.10 interdit d'« interfere with or disrupt the Service (including accessing the Service through any automated means, like scripts or web crawlers) ». Le mot de passe d'application est le mécanisme qu'Apple fournit justement pour les apps tierces, et l'interdiction vise la perturbation du service. Pour un client IMAP hébergé qui fait un polling modéré, c'est une **zone grise tolérable mais non autorisée explicitement**.
  - Yahoo, [conditions Yahoo (UE)](https://legal.yahoo.com/ie/en/yahoo/terms/otos/index.html) : §2(d)(ix) interdit de collecter des données « using any automated means » **sans permission expresse et préalable** ; §2(e) interdit d'accéder aux services par une autre méthode que « the interface and the instructions that we provide ». Le mot de passe d'application est une instruction fournie par Yahoo pour les apps tierces, mais un service SaaS qui lit les boîtes en masse correspond à ce que Yahoo veut encadrer par le programme OAuth commercial, qui est la « permission expresse ». **Risque plus élevé que chez Apple** : blocage possible des IP du worker, ou refus de l'éligibilité.
- **RGPD / ADR-0007** : le contenu des mails est porteur d'identité, donc l'extraction passe par Mistral sous l'EU AI Consent. Base légale : consentement explicite du Candidat à la connexion, finalité limitée aux expéditeurs d'offres.

## 5. Recommandation

**Faisable pour le MVP, mais pas comme geste principal pour iCloud/Yahoo/AOL.**
1. **Geste principal** pour ces fournisseurs : l'**adresse de transfert personnelle** (filtre de transfert réglé par le Candidat). Pas d'identifiant stocké, aucune question de conditions d'utilisation ; iCloud et Yahoo proposent des règles de transfert dans leur webmail (à confirmer dans la recherche dédiée au transfert).
2. **Option « connexion IMAP » en bêta** : iCloud d'abord (mécanisme stable et documenté, sans démarche), Yahoo/AOL ensuite avec un message clair si le mot de passe d'application est refusé. Lecture seule, polling, `SEARCH FROM` sur une liste d'expéditeurs d'alertes, mot de passe d'application chiffré par Candidat, déconnexion automatique sur échec d'authentification.
3. **Yahoo/AOL durable** : déposer la candidature OAuth commerciale Yahoo (scope lecture seule), ce qui supprime le stockage de mot de passe et règle la question des conditions. Délai et exigences de sécurité inconnus, à mettre dans « Not yet specified » de la carte (comme CASA pour Gmail).
4. **Parcours du Candidat** : il doit activer la double authentification (Apple), créer le mot de passe dans une autre fenêtre puis le coller. Ce sont plusieurs étapes, donc une friction réelle : prévoir une aide pas à pas, avec liens directs vers account.apple.com et la page Sécurité du compte Yahoo.

## Non vérifié

1. Capacités IMAP d'iCloud **après connexion** (IDLE, MOVE, CONDSTORE) et comportement de `SEARCH FROM` (sous-chaîne, insensibilité à la casse) sur iCloud et Yahoo : à tester avec un compte de test.
2. Critères exacts de l'« éligibilité » Yahoo aux mots de passe d'application, et taux de refus pour des comptes récents ou peu utilisés.
3. Limites de connexions simultanées et de débit, chez Apple comme chez Yahoo/AOL : non publiées.
4. Délai, coût et contenu exact de l'audit de sécurité du programme OAuth Yahoo, et texte du « Mail Products Commercial Access Agreement ».
5. Article d'aide AOL sur les mots de passe d'application : corps illisible sans JavaScript ; prérequis supposés identiques à Yahoo.
6. Possibilité pour Yahoo de bloquer des connexions IMAP venant d'IP de cloud (AWS) par heuristique anti-abus : aucune source.
