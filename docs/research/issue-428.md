# Recherche #428 : accès à Outlook.com, Hotmail, Live et Microsoft 365

Vérifié le 2026-10-27 sur Microsoft Learn et le support Microsoft. Partie de la carte #426. Aucune application enregistrée ni identifiant utilisé : rien n'a été testé en réel.

## Réponse courte

Oui, c'est faisable pour le MVP, avec **une seule intégration Microsoft Graph** couvrant à la fois les comptes personnels (Outlook.com, Hotmail, Live) et Microsoft 365 :

- autorité `common`, permissions déléguées `Mail.Read` + `offline_access` (+ `openid`, `email`) ;
- aucune permission ne demande de consentement administrateur ; le Candidat consent lui-même ;
- coût Microsoft : **0 €** (Graph mail non facturé, vérification de l'éditeur gratuite) ;
- seul vrai prérequis non technique : **la vérification de l'éditeur (Publisher verification)**, gratuite mais qui demande un compte Microsoft AI Cloud Partner Program vérifié et un tenant Entra professionnel.

IMAP + XOAUTH2 fonctionne aussi, mais n'apporte rien de plus que Graph pour nous et oblige à analyser du MIME : à écarter.

## Constats (sources primaires)

### 1. Permissions Graph et comptes personnels

- `Mail.Read` (délégué, id `570282fd-fa5c-430d-a7fd-fc8dc98a9dca`) : « lire le courrier de l'utilisateur connecté », **AdminConsentRequired : No**, « disponible pour le consentement dans les comptes Microsoft personnels ». ([permissions reference](https://learn.microsoft.com/en-us/graph/permissions-reference))
- `Mail.ReadBasic` (délégué, id `a4b8392a-d8d1-4954-a029-8e668a39a170`) : tout **sauf `body`, `previewBody`, pièces jointes et propriétés étendues** ; pas de consentement admin ; disponible pour les comptes personnels. ([même page](https://learn.microsoft.com/en-us/graph/permissions-reference))
  - Conséquence : pour lire le contenu d'une offre, il faut `Mail.Read`. `Mail.ReadBasic` ne suffit que pour trier par expéditeur/objet.
- `offline_access` : scope OIDC nécessaire pour obtenir un refresh token, sans consentement admin. ([même page](https://learn.microsoft.com/en-us/graph/permissions-reference))
- `GET /me/messages` et `GET /me/mailFolders/{id}/messages` : comptes pro et personnels supportés, moindre privilège `Mail.ReadBasic`. ([list messages](https://learn.microsoft.com/en-us/graph/api/user-list-messages))
- Autorité : le segment `{tenant}` accepte `common`, `organizations`, `consumers` ou un id de tenant. `common` = pro + perso, `consumers` = perso uniquement. ([auth code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow))

### 2. Filtrage côté serveur, delta, webhooks

- `list messages` supporte `$filter`/`$orderby`, avec une contrainte : les propriétés de `$orderby` doivent aussi figurer dans `$filter`, dans le même ordre, sinon erreur `InefficientFilter`. ([list messages](https://learn.microsoft.com/en-us/graph/api/user-list-messages))
- **Delta query** (`/me/mailFolders/{id}/messages/delta`) : fonctionne pour les comptes personnels (`Mail.ReadBasic` minimum), **par dossier**, et le seul `$filter` accepté est `receivedDateTime ge|gt {date}` ; pas de `$search`, pas de filtre par expéditeur. ([message delta](https://learn.microsoft.com/en-us/graph/api/message-delta))
- **Abonnements (webhooks)** sur `message` : supportés pour les comptes personnels (`Mail.ReadBasic` ou `Mail.Read`) ; durée de vie max **10 080 min (< 7 jours)**, ou 1 440 min (< 1 jour) avec données incluses dans la notification. Il faut donc les renouveler et exposer un endpoint HTTPS public. ([subscription create](https://learn.microsoft.com/en-us/graph/api/subscription-post-subscriptions), [subscription resource](https://learn.microsoft.com/en-us/graph/api/resources/subscription))
- Implication : pour le MVP, **polling delta sur la boîte de réception** (par ex. toutes les 15 à 60 min), puis filtrage par expéditeur (alertes emploi connues) **chez nous**. Les webhooks peuvent venir plus tard.

### 3. Vérification de l'éditeur et consentement

- Depuis novembre 2020, si le consentement « step-up » basé sur le risque est actif dans un tenant, **les utilisateurs ne peuvent pas consentir à une application multitenant non vérifiée** enregistrée après le 8 novembre 2020 et demandant plus que la connexion et le profil de base. ([publisher verification](https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview))
- Pour une application non vérifiée, l'écran de consentement affiche « Unverified » à la place du nom de l'éditeur. ([consent experience](https://learn.microsoft.com/en-us/entra/identity-platform/application-consent-experience))
- Prérequis de vérification ([publisher verification](https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview)) :
  - Partner One ID d'un compte **Microsoft AI Cloud Partner Program** vérifié (compte global, pas un compte « location ») ;
  - app enregistrée **avec un compte Entra pro**, pas un compte Microsoft personnel ;
  - publisher domain défini, pas en `*.onmicrosoft.com` ; le domaine de l'email utilisé pour la vérification CPP doit correspondre (ex. `jobbbox.ai`) ;
  - MFA, rôles Application Administrator (Entra) et Partner Admin (Partner Center).
  - « Microsoft doesn't charge developers for publisher verification. No license is required. »
- Côté tenants pro, les admins peuvent restreindre le consentement, par ex. la politique intégrée `microsoft-user-default-low` : « consentement utilisateur seulement pour les éditeurs vérifiés et les permissions classées à faible impact ». ([configure user consent](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/configure-user-consent))
  - Implication : même vérifiée, l'app peut être bloquée dans un tenant M365 strict (`Mail.Read` n'est pas forcément classée à faible impact). Il faut alors afficher un message « demandez à votre administrateur » (consentement admin). C'est surtout un cas d'adresse pro, peu typique pour une recherche d'emploi.

### 4. IMAP avec OAuth, fin de l'authentification basique

- OAuth2 pour IMAP/POP/SMTP est disponible « pour Microsoft 365 et les utilisateurs Outlook.com ». Scope IMAP : `https://outlook.office.com/IMAP.AccessAsUser.All` (+ `offline_access`) ; authentification SASL `XOAUTH2` : `base64("user=" + email + "^Aauth=Bearer " + token + "^A^A")`. ([IMAP OAuth](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth))
- Outlook.com (comptes personnels) : **l'authentification basique n'est plus disponible depuis le 16 septembre 2024** ; les clients tiers doivent passer en OAuth2 (Thunderbird : « OAuth2 » au lieu de « Normal password »). ([support Microsoft](https://support.microsoft.com/en-us/office/modern-authentication-methods-now-needed-to-continue-syncing-outlook-email-in-non-microsoft-email-apps-c5d65390-9676-4763-b41f-d7986499a90d))
- Exchange Online : authentification basique désactivée pour IMAP/POP/EWS/EAS depuis le 1er octobre 2022. ([deprecation EXO](https://learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/deprecation-of-basic-authentication-exchange-online))
- Mots de passe d'application : non confirmés par une source primaire. Ils relèvent de l'authentification basique, donc ne devraient plus marcher en IMAP sur Outlook.com depuis septembre 2024. **À ne pas proposer.**

### 5. Limites de débit et durée des jetons

- Limites Outlook **par couple (app, boîte aux lettres)** : **10 000 requêtes / 10 min**, **4 requêtes simultanées**. Dépasser la limite sur une boîte n'affecte pas les autres. Respecter `Retry-After` sur les 429. ([throttling limits](https://learn.microsoft.com/en-us/graph/throttling-limits))
- Refresh tokens : **90 jours** par défaut ; **24 h** pour une SPA (redirect URI de type `spa`). Ils sont remplacés à chaque usage, il faut donc stocker le nouveau. ([refresh tokens](https://learn.microsoft.com/en-us/entra/identity-platform/refresh-tokens))
  - Implication : échange du code **côté serveur** (client confidentiel, redirect URI `web`), jamais dans l'extension ni le navigateur. Un polling régulier fait glisser la fenêtre de 90 jours. Après 90 jours d'inactivité ou une révocation, il faut redemander la connexion.

### 6. Usage des données et résidence

- Conditions d'utilisation des API Microsoft ([Microsoft APIs Terms of Use](https://learn.microsoft.com/en-us/legal/microsoft-apis/terms-of-use)) :
  - interdiction d'utiliser les données obtenues (même agrégées, anonymisées ou dérivées) **à des fins de publicité ou de marketing** ;
  - interdiction de revendre ou de redistribuer ces données ;
  - application développée de façon sécurisée ;
  - à la résiliation, **supprimer ou restituer les données selon l'instruction du client**.
- Résidence : Microsoft n'impose pas de lieu de stockage pour les données que nous copions. Le RGPD s'applique côté Jobbbox (minimisation : ne garder que les emails d'offres, base légale, droit à la suppression). Aucune source primaire trouvée sur la localisation des boîtes Outlook.com personnelles. Ça ne change rien pour nous.

## Recommandation

**Faisable pour le MVP.** Intégration Graph unique :

1. App Entra **multitenant + comptes personnels**, enregistrée dans un tenant Entra pro au domaine `jobbbox.ai`, client confidentiel (secret ou certificat côté serveur), autorité `common`.
2. Scopes : `openid email offline_access Mail.Read`. Pas de `Mail.ReadWrite` (lecture seule).
3. Synchro : delta query sur `Inbox` (et éventuellement d'autres dossiers choisis), filtrage par expéditeur chez Jobbbox, et uniquement les emails d'offres conservés. Webhooks plus tard.
4. Refresh token chiffré en base, rotation à chaque usage ; état « reconnexion requise » si `invalid_grant`.
5. Lancer la **vérification de l'éditeur** dès maintenant, en parallèle du dev.

**Coût** : 0 € chez Microsoft.
**Délai estimé (pas une source Microsoft)** : environ 3 à 5 jours de dev pour l'OAuth, la synchro delta et la gestion des erreurs. Il faut aussi compter le délai de vérification du compte Partner Program, qui n'est pas documenté (« quelques minutes » une fois les prérequis remplis, mais la vérification CPP du compte peut prendre plus longtemps). On peut développer et tester sans vérification : les comptes perso verront simplement « Unverified » à l'écran de consentement.

## Non vérifié

1. Syntaxe exacte et performance de `$filter=from/emailAddress/address eq '...'` sur `/me/messages`. La page documente le `$filter` mais l'exemple d'expéditeur n'a pas été lu. À tester.
2. Comportement exact du consentement pour un **compte personnel** face à une app non vérifiée : avertissement seul ou blocage ? La règle de blocage documentée vise les tenants avec step-up consent.
3. Délai réel de vérification d'un compte Microsoft AI Cloud Partner Program pour FNCONSULT.
4. Mots de passe d'application avec IMAP Outlook.com (voir §4).
