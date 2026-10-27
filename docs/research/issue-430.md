# Recherche #430 : IMAP chez Orange/Wanadoo, Free, SFR, La Poste et repli IMAP générique

Vérifié le 2026-10-27, pour la carte #426 (offres reçues par email). Aucun identifiant utilisé : seules des requêtes publiques (ISPDB, DNS, salutation IMAP avant authentification) et la lecture des pages d'assistance.

## Réponse courte

**Faisable pour le MVP, pour les quatre FAI et en repli générique**, avec une seule méthode : **IMAP sur TLS (993) + identifiant et mot de passe**, découverte des paramètres par l'ISPDB de Thunderbird. Aucun des quatre serveurs n'annonce OAuth (pas de `AUTH=XOAUTH2` ni `AUTH=OAUTHBEARER`). Le coût n'est pas une vérification tierce (pas de CASA comme chez Google) mais le **risque de garder un mot de passe de messagerie** : chiffrement obligatoire, consentement explicite, et préférence pour l'**adresse de transfert** quand le Candidat peut régler un transfert.

## 1. Par fournisseur

| Domaines | Hôte IMAP | Port / TLS | Identifiant | Mot de passe | À activer ? |
|---|---|---|---|---|---|
| orange.fr, wanadoo.fr | imap.orange.fr | 993, TLS implicite (TLS 1.3 observé) | adresse complète | mot de passe du compte, **ou** mot de passe d'application de 20 caractères s'il a été généré (alors seul valable) | non, actif par défaut ; désactivable |
| free.fr | imap.free.fr | 993 SSL (143 en clair « en repli » selon Free) | adresse complète (Free) ; l'ISPDB dit partie locale | mot de passe de la boîte Free | rien de documenté par Free |
| sfr.fr, neuf.fr (et cegetel.net, 9online.fr selon des tiers) | imap.sfr.fr | 993, TLS (1.2 observé) | adresse complète | mot de passe de la boîte | rien de documenté |
| laposte.net | imap.laposte.net | 993, TLS obligatoire (TLS 1.0/1.1 refusés) | partie locale (ISPDB) | mot de passe du compte | accès POP/IMAP **coupé par La Poste en 2022** ; rétabli après réinitialisation du mot de passe (sources de presse) |

Capacités annoncées avant authentification (sonde `a1 CAPABILITY` sur 993, 2026-10-27) :

- Orange : `IMAP4rev1 LITERAL+ SASL-IR LOGIN-REFERRALS ID ENABLE AUTH=PLAIN AUTH=LOGIN` (Dovecot ; « post-login capabilities have more »).
- Free : `IMAP4REV1 X-NETSCAPE LOGIN-REFERRALS AUTH=PLAIN`.
- SFR et La Poste : `IMAP4rev1 UIDPLUS AUTH=PLAIN` (même bannière : probablement la même plateforme).

Conséquences : **pas d'OAuth** chez ces quatre FAI ; `IDLE` n'est pas annoncé avant login (il peut l'être après : non vérifié faute de compte).

### Orange / Wanadoo
- Activer/désactiver : webmail > roue crantée > tous les paramètres > **Sécurité > Protocoles POP ou IMAP** ; **activés par défaut** ; désactivés, les logiciels tiers reçoivent une erreur ([Assistance Orange, maj 06/07/2026](https://assistance.orange.fr/ordinateurs-peripheriques/installer-et-utiliser/l-utilisation-du-mail-et-services-associes/mail-orange/parametrer-la-boite-mail/mail-orange-comment-activer-ou-desactiver-les-acces-pop-imap-pour-les-logiciels-ou-applications-de-messagerie-tiers_427398-957069)).
- Mot de passe d'application : documenté officiellement pour la **Messagerie Pro** — 20 caractères, génération **irréversible**, ensuite le mot de passe internet ne sert plus aux logiciels tiers ; activation POP/IMAP Pro depuis la Livebox ou avec Mobile Connect ([Orange Pro, mot de passe](https://assistancepro.orange.fr/mail_pro/parametrer_le_mail_pro/sur_un_ordinateur/messagerie_pro_orange__generer_un_mot_de_passe_pour_consulter_vos_mails_orange_depuis_une_application_ou_un_logiciel_tiers-448026), [Orange Pro, POP/IMAP](https://assistancepro.orange.fr/mail_pro/parametrer_le_mail_pro/sur_un_ordinateur/messagerie_pro_orange__activer_ou_desactiver_le_protocole_popimap_pour_les_logiciels_de_messagerie_-448045)). Pour le grand public, la même option existe (Espace client > Infos personnelles > Connexion et sécurité > « Mot de passe pour logiciels et applications de messagerie tiers ») mais n'est sourcée que par la [Communauté Orange](https://communaute.orange.fr/t5/mon-mail-Orange/Mot-de-passe-d-application-d%C3%A9di%C3%A9-Orange/td-p/3380371) ; elle y est décrite comme **facultative**.
- Paramètres : ISPDB [orange.fr](https://autoconfig.thunderbird.net/v1.1/orange.fr), [wanadoo.fr](https://autoconfig.thunderbird.net/v1.1/wanadoo.fr) → imap.orange.fr:993 SSL, `%EMAILADDRESS%`.

### Free
- [Assistance Free, article 609](https://assistance.free.fr/articles/quelles-informations-sont-necessaires-pour-ajouter-mon-email-free-dans-mon-client-de-messagerie--609) : imap.free.fr, 993 en SSL (143 sans SSL en repli), adresse complète, mot de passe de la boîte. **Aucune activation préalable ni mot de passe dédié mentionnés** : l'hypothèse « IMAP à activer chez Free » du ticket n'est pas confirmée par une source primaire.
- ISPDB [free.fr](https://autoconfig.thunderbird.net/v1.1/free.fr) donne `%EMAILLOCALPART%` : les deux formes sont à essayer (adresse complète d'abord, comme Free l'écrit).

### SFR
- Pas de page officielle assistance.sfr.fr trouvée par recherche. Sources primaires utilisées : l'**enregistrement DNS publié par SFR** `_imaps._tcp.sfr.fr SRV 0 1 993 imap.sfr.fr.` et `_imap._tcp.sfr.fr SRV 0 0 0 .` (IMAP en clair non offert, RFC 6186) ; ISPDB [sfr.fr](https://autoconfig.thunderbird.net/v1.1/sfr.fr) et [neuf.fr](https://autoconfig.thunderbird.net/v1.1/neuf.fr) → imap.sfr.fr:993, `%EMAILADDRESS%`.
- Des guides tiers évoquent un mot de passe d'application quand la double authentification SFR est activée : non vérifié.

### La Poste (laposte.net)
- Aide officielle : POP/IMAP/SMTP restent possibles **uniquement chiffrés** (arrêt des protocoles en clair, puis de TLS 1.0/1.1) ([aide.laposte.net](https://aide.laposte.net/contents/comment-parametrer-laposte-net-sur-mon-logiciel-de-messagerie-suite-a-l-arret-des-protocoles-en-clair-non-cryptes) ; page rendue en JavaScript, contenu lu via les extraits du moteur de recherche).
- 2022 : La Poste a coupé l'accès POP/IMAP pour raisons de sécurité ; il revenait après une réinitialisation par « mot de passe oublié » ([MacGeneration](https://www.macg.co/services/2022/05/lapostenet-un-changement-de-mot-de-passe-est-necessaire-pour-reactiver-les-acces-pop3-et-imap-129085), source secondaire). À traiter comme un **blocage possible côté FAI** avec message dédié.
- ISPDB [laposte.net](https://autoconfig.thunderbird.net/v1.1/laposte.net) → imap.laposte.net:993 SSL, `%EMAILLOCALPART%`.

## 2. Repli IMAP générique : découverte des paramètres

Ordre recommandé, calqué sur Thunderbird ([wiki Autoconfiguration](https://wiki.mozilla.org/Thunderbird:Autoconfiguration), [FetchConfig.sys.mjs](https://hg-edge.mozilla.org/comm-central/file/tip/mail/components/accountcreation/modules/FetchConfig.sys.mjs)) :

1. **Table embarquée** pour nos domaines prioritaires (tableau ci-dessus) : pas de dépendance réseau pour 80 % des cas français.
2. **Configuration publiée par le fournisseur** : `https://autoconfig.<domaine>/mail/config-v1.1.xml?emailaddress=…` puis `https://<domaine>/.well-known/autoconfig/mail/config-v1.1.xml` (`autoconfig.<domaine>` ne répond pour aucun des quatre FAI ; `.well-known` non testé). Ne pas envoyer l'adresse si on veut rester minimal (paramètre facultatif).
3. **ISPDB** : `https://autoconfig.thunderbird.net/v1.1/<domaine>` (XML, `incomingServer type="imap"`, gabarits `%EMAILADDRESS%` / `%EMAILLOCALPART%`). Dépôt [thunderbird/autoconfig](https://github.com/thunderbird/autoconfig), licence MPL-2.0 affichée ; mettre en cache.
4. **MX** : pour un domaine personnel hébergé ailleurs, Thunderbird prend le MX préféré, en déduit le domaine de base (eTLD+1, et le sous-domaine suivant) et refait les étapes 2-3 sur ce domaine (`fetchConfigForMX`). Ex. MX `smtp-in.orange.fr` → `orange.fr`.
5. **SRV (RFC 6186)** : `_imaps._tcp.<domaine>` puis `_imap._tcp.<domaine>` ; cible `.` = service absent ([RFC 6186](https://www.rfc-editor.org/rfc/rfc6186.html)). Thunderbird ne l'implémente pas, mais SFR le publie. **Sécurité (RFC 6186 §6)** : sans DNSSEC, n'accepter une cible hors du domaine interrogé qu'après confirmation du Candidat ; vérifier le certificat TLS sur le nom cible.
6. **Devinette** : `imap.<domaine>`, `mail.<domaine>` en 993 TLS puis 143 STARTTLS.
7. **Saisie manuelle** (hôte, port, identifiant).

Règles pour Jobbbox : **refuser toute authentification sans TLS** (pas de 143 sans STARTTLS réussi), valider le certificat, et ne jamais suivre une cible SRV/MX hors domaine sans confirmation (sinon un DNS piégé récupère le mot de passe).

### Validation et messages au Candidat
Valider à l'enregistrement par un vrai `LOGIN` puis `SELECT INBOX` (ou `STATUS`). Avec imapflow, un échec de login lève une `AuthenticationFailure` (`authenticationFailed: true`, texte serveur dans `response`) ; les autres erreurs portent `code`, `responseText`, `serverResponseCode` (ex. `AUTHENTICATIONFAILED`) ([API imapflow](https://imapflow.com/docs/api/imapflow-client)). Messages proposés :

- hôte introuvable / TLS refusé → « Paramètres introuvables pour ce domaine : indiquez le serveur IMAP » ;
- `AUTHENTICATIONFAILED` chez Orange → « Mot de passe refusé. Si vous avez créé un mot de passe pour les logiciels de messagerie, utilisez-le ; vérifiez aussi que l'accès POP/IMAP est activé (Sécurité > Protocoles POP ou IMAP) » ;
- chez La Poste → « Accès refusé : La Poste bloque parfois l'IMAP ; une réinitialisation du mot de passe le rétablit » ;
- Free / La Poste → réessayer automatiquement avec la partie locale si l'adresse complète échoue (ISPDB vs assistance divergent).

## 3. Lecture : recherche, IDLE ou polling, limites

- **Recherche côté serveur** : `UID SEARCH FROM "<expéditeur>" SINCE <date>` est du IMAP4rev1 de base, donc disponible partout ; imapflow : `search({ from, since }, { uid: true })`. Une requête par expéditeur connu (LinkedIn, Indeed, WTTJ…) ou une recherche `SINCE` puis filtrage local. Garder le dernier `UID` vu + `UIDVALIDITY` par boîte pour ne relire que le nouveau (UIDPLUS est annoncé chez SFR/La Poste, pas nécessaire en lecture).
- **IDLE vs polling** : IDLE n'est annoncé avant login par aucun des quatre (peut l'être après : à vérifier). Une connexion IDLE permanente par Candidat ne passe pas à l'échelle et ressemble à un abus ; le besoin (« flux continu ») est satisfait par un **polling** court et poli : connexion, `STATUS INBOX (UIDNEXT)`, recherche si changé, déconnexion, toutes les 10-15 min. imapflow sait faire IDLE automatiquement (`autoIdleDelay`, `maxIdleTime`) et retombe sur `NOOP`/`STATUS` si IDLE manque (`missingIdleCommand`) ; pour notre worker, `disableAutoIdle: true` et connexions courtes.
- **Limites de connexions / anti-abus** : aucune page officielle des quatre FAI ne publie de limite de connexions simultanées ni de taux. Principes : **une seule connexion à la fois par boîte**, polling espacé avec gigue, arrêt après 2-3 échecs d'authentification consécutifs (sinon verrouillage du compte probable, cf. La Poste 2022) et passage de la source à l'état « déconnectée » avec notification au Candidat. Tous les worker sortent de la même IP : un FAI peut la limiter ; surveiller les erreurs par domaine.

## 4. Identifiants, conditions, bibliothèque

- **Stockage** : réutiliser le schéma de `apps/web/src/provider-secrets/cipher.ts` (ADR-0020) : AES-256-GCM dans l'application, IV aléatoire, AAD liant la valeur à sa ligne (Candidat + boîte), trousseau `SECRETS_MASTER_KEYS` hors base, rotation par version de clé. Ne jamais journaliser le mot de passe ni le renvoyer au navigateur ; déchiffrer seulement dans le worker au moment de la connexion ; supprimer à la déconnexion et à la suppression du compte (RGPD).
- **Risques** : un mot de passe de messagerie donne accès à **toute** la boîte (et souvent au compte FAI : chez Orange le mot de passe du compte est celui de l'Espace client, sauf mot de passe d'application). Recommander au Candidat le mot de passe d'application quand il existe (Orange), le dire dans l'écran de connexion. Lecture seule : ne jamais `STORE`/`EXPUNGE` ; ouvrir avec `EXAMINE` (`readOnly`) pour ne pas modifier le drapeau `\Seen`.
- **Conditions d'utilisation des FAI** : aucune clause sur l'accès par un service tiers trouvée dans les sources lues ; les FAI documentent l'usage de « logiciels et applications de messagerie tiers » sans le restreindre. Non vérifié dans les CGU complètes (voir plus bas).
- **Bibliothèque Node** : **imapflow** (MIT, Postal Systems, moteur d'EmailEngine) : version 2.9.1, publiée le 2026-10-22 (`npm view imapflow`), API à promesses, TLS, `auth.pass` ou `auth.accessToken` (OAuth2, utile pour Gmail/Outlook ailleurs dans la carte), recherche, IDLE, événement `exists` ([imapflow.com](https://imapflow.com/), [API](https://imapflow.com/docs/api/imapflow-client)). Pour le MIME : `mailparser` (même éditeur). Les alternatives `node-imap`/`imap-simple` ne sont plus maintenues (non revérifié ici).

## Recommandation

1. **MVP : oui** pour Orange/Wanadoo, Free, SFR/Neuf et La Poste, et en **repli générique** (table embarquée → autoconfig fournisseur → ISPDB → MX → SRV → saisie manuelle), via **imapflow**, TLS obligatoire, polling court en lecture seule, mot de passe chiffré AES-256-GCM comme les Provider Secrets.
2. **Pas d'OAuth possible** chez ces FAI : la connexion de boîte y coûte peu (pas de vérification CASA) mais porte un risque de sécurité ; elle reste un **second geste** derrière l'**adresse de transfert**, qui ne stocke aucun mot de passe. Proposer IMAP quand le Candidat ne peut pas ou ne veut pas régler un transfert.
3. Messages d'erreur spécifiques Orange (mot de passe d'application, POP/IMAP désactivé) et La Poste (blocage, réinitialisation) dès le MVP.

## Non vérifié

1. Capacités après login (IDLE, ESEARCH, CONDSTORE) : nécessite un compte de test par FAI.
2. Limites de connexions simultanées et de fréquence, et seuils de verrouillage : non publiés.
3. Page officielle SFR (assistance.sfr.fr) : introuvable par recherche ; paramètres pris de l'ISPDB et du SRV DNS de SFR.
4. Mot de passe d'application Orange grand public : seulement attesté par la Communauté Orange (l'officiel couvre la Messagerie Pro).
5. Identifiant Free et La Poste (adresse complète vs partie locale) : sources divergentes ; essayer les deux.
6. CGU complètes des FAI sur l'accès par un service tiers.
7. Exhaustivité des domaines SFR (cegetel.net, 9online.fr) et Orange (voila.fr…) : seulement via des tiers.
