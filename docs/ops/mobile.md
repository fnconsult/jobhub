# L'app Jobbbox : builds, canaux, mise à jour imposée

_ADR-0076, ADR-0063, #704. Termes : **Version**, **Beta**, **Promotion**, **Release Note**, **API Version** (`CONTEXT.md`)._

L'app (`apps/mobile`, Expo) est construite et envoyée aux stores par **EAS Build** et **EAS Submit**, et reçoit ses correctifs JavaScript par **EAS Update**. Tout passe par le workflow `.github/workflows/mobile.yml`, lancé à la main par le product owner.

## Les profils (`apps/mobile/eas.json`)

| Profil | Pointe sur | Distribution | Canal EAS Update |
| --- | --- | --- | --- |
| `development` | `staging.jobbbox.ai` | build de développement (`expo-dev-client`), appareils de l'équipe | aucun |
| `staging` | `staging.jobbbox.ai` | TestFlight (iOS) et test interne de Play (Android) | `staging` |
| `production` | `jobbbox.ai` | App Store et Play, piste production (en brouillon sur Play) | `production` |

L'adresse de la plateforme est `EXPO_PUBLIC_API_URL`, fixée par profil dans `eas.json`, comme la Beta pour TestFlight et le test interne (ADR-0076).

## La Version

La version de l'app est la **Version de la plateforme** : `apps/mobile/app.config.ts` lit le `version` du `package.json` racine (ADR-0063). La Promotion la fait avancer pour le web app, le worker et l'app ensemble ; rien à changer dans `apps/mobile`. Les numéros de build (`buildNumber` iOS, `versionCode` Android) sont tenus par EAS (`appVersionSource: remote`) et montent à chaque build `staging` ou `production` (`autoIncrement`).

## EAS Update : les correctifs JavaScript seulement

Une build écoute **un canal** : `staging` ou `production`. `eas update` publie sur ce canal un nouveau JavaScript (écrans, textes, logique), que l'app installée télécharge et applique au lancement suivant.

Un update n'atteint **que les builds au même code natif** : la runtime version de l'app est son empreinte native (`runtimeVersion: { policy: "fingerprint" }`). Un changement natif (une dépendance native ajoutée ou montée, un plugin, `app.json` côté iOS ou Android, le SDK Expo) change l'empreinte : l'update ne trouve aucune build, et le changement passe par une **nouvelle build et la revue des stores**.

Règle : un correctif de JavaScript seul, sans changement de contrat avec le web app, peut partir en update. Tout le reste, et toute nouveauté qu'un Candidate voit, part en build.

## Les « Nouveautés » des stores

Elles viennent de la **même Release Note** que Nouveautés (`packages/help/releases/{fr,en}/X.Y.Z.md`, ADR-0063) : le titre, puis une ligne par changement (son début en gras, ou tout le texte), en texte brut, coupé à 500 caractères pour Play. Une Version sans Release Note dit « Corrections et améliorations ».

```sh
npm run store-whats-new -w @jobhub/help -- ./whatsnew   # écrit whatsnew/whatsnew-fr-FR et whatsnew-en-US
```

Le workflow les écrit à chaque exécution, dans son résumé et dans l'artefact `whatsnew-<profil>` (le format que lit Play). Tant qu'aucune clé n'est donnée pour écrire les fiches des stores, le product owner les recopie dans App Store Connect (« Nouveautés de cette version ») et la Play Console (« Notes de version »).

## La mise à jour imposée (426)

Chaque appel de l'app passe par `useApi()` (`apps/mobile/src/api/api.tsx`), qui envoie l'API Version qu'elle parle (`Jobbbox-Api-Version`) et se nomme (`Jobbbox-Client: mobile`). Quand la plateforme ne sert plus cette API Version (elle sert la courante et la précédente, `docs/ops/extension-api-version.md`), elle répond **426 Upgrade Required** avec le code `app_outdated`. L'app affiche alors, à la place de tout le reste, « **Mettre à jour Jobbbox** », avec un bouton vers son store :

- le lien que nomme la réponse (`storeUrl`), s'il y en a un ;
- sinon celui de la build : Google Play pour le paquet `ai.jobbbox.app`, l'App Store pour l'identifiant Apple de l'app (`extra.appStoreId` de `apps/mobile/app.json`), ou la recherche « Jobbbox » de l'App Store tant que cet identifiant n'est pas renseigné.

Monter l'API Version coupe donc les apps qui parlent l'avant-dernière : suivre l'ordre de `docs/ops/extension-api-version.md`, et attendre que les stores aient servi la build qui parle la nouvelle.

## Lancer le workflow

Depuis un poste, `gh` connecté :

```sh
gh workflow run mobile.yml -f profile=staging -f action=build                          # iOS et Android, vers TestFlight et le test interne
gh workflow run mobile.yml -f profile=staging -f action=build -f platform=ios          # une seule plateforme
gh workflow run mobile.yml -f profile=staging -f action=update -f message="Corrige …"  # correctif JavaScript seul
```

`production` n'est accepté que depuis un tag de Version `vX.Y.Z` (`--ref vX.Y.Z`), que seule la Promotion pousse ; les agents ne le lancent pas (`scripts/hooks/no-promotion.mjs` refuse `gh workflow run … production`). Le lancement depuis la Promotion viendra plus tard. La build se suit sur expo.dev (le workflow n'attend pas la fin : `--no-wait`), puis EAS Submit l'envoie au store du profil.

Le skill `deploy-staging` ne lance pas la build de l'app : il dit seulement, après avoir déployé la Beta, si `apps/mobile` a changé et quelle commande lancer.

## Mise en place, une fois

1. **Projet EAS** : dans `apps/mobile`, `npx eas-cli init`, puis recopier l'identifiant du projet dans `app.json`, `expo.extra.eas.projectId` (`app.config.ts` en tire l'adresse d'EAS Update, `https://u.expo.dev/<id>`).
2. **Jeton** : créer un jeton d'accès sur expo.dev (compte de l'organisation) et l'enregistrer comme secret du dépôt : `gh secret set EXPO_TOKEN`.
3. **Identifiants des stores, gardés par EAS** (`npx eas-cli credentials`) : la clé d'API App Store Connect (iOS, signature et envoi à TestFlight) et la clé du compte de service Google Play (Android, envoi au test interne). Aucun autre secret dans le dépôt.
4. **Fiches des stores** : créer l'app `ai.jobbbox.app` dans App Store Connect et la Play Console. Sur Play, le tout premier envoi se fait à la main (exigence de Google), les suivants par EAS Submit. Une fois l'app créée dans App Store Connect, renseigner son identifiant Apple dans `app.json` (`expo.extra.appStoreId`, pour le lien « Mettre à jour Jobbbox ») et dans `eas.json` (`submit.staging.ios.ascAppId` et `submit.production.ios.ascAppId`).
