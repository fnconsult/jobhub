# L'app Jobbbox : builds, canaux, mise à jour imposée

_ADR-0076, ADR-0063, #704. Termes : **Version**, **Beta**, **Promotion**, **Release Note**, **API Version** (`CONTEXT.md`)._

L'app (`apps/mobile`, Expo) est construite et envoyée aux stores par **EAS Build** et **EAS Submit**, et reçoit ses correctifs JavaScript par **EAS Update**. Tout passe par le workflow `.github/workflows/mobile.yml`, lancé à la main par le product owner.

## Les profils (`apps/mobile/eas.json`)

| Profil | Pointe sur | Distribution | Canal EAS Update |
| --- | --- | --- | --- |
| `development` | `staging.jobbbox.ai` | build de développement (`expo-dev-client`), appareils de l'équipe | aucun |
| `staging` | `staging.jobbbox.ai` | TestFlight (iOS) et test interne de Play (Android) | `staging` |
| `production` | `jobbbox.ai` | App Store et Play, piste production (en brouillon sur Play) | `production` |

L'adresse de la plateforme est `EXPO_PUBLIC_WEB_APP_URL`, fixée par profil dans `eas.json` (la Beta pour le développement, TestFlight et le test interne, ADR-0076) et intégrée au bundle à la build. Elle vaut pour **toute l'app** : la connexion et la session (`src/session`), les appels à l'API (`src/api`) et les adresses web qu'elle partage (`src/navigation/links.ts`). L'app ne la lit qu'à un endroit, `apps/mobile/src/web-app-url.ts` ; une build `staging` ne parle donc jamais à Production. `eas update` la reprend du profil de son canal (`mobile.yml`), comme ses builds.

## La Version

La version de l'app est la **Version de la plateforme** : `apps/mobile/app.config.ts` lit le `version` du `package.json` racine (ADR-0063). La Promotion la fait avancer pour le web app, le worker et l'app ensemble ; rien à changer dans `apps/mobile`. Les numéros de build (`buildNumber` iOS, `versionCode` Android) sont tenus par EAS (`appVersionSource: remote`) et montent à chaque build `staging` ou `production` (`autoIncrement`).

## EAS Update : les correctifs JavaScript seulement

Une build écoute **un canal** : `staging` ou `production`. `eas update` publie sur ce canal un nouveau JavaScript (écrans, textes, logique), que l'app installée télécharge et applique au lancement suivant.

Un update n'atteint **que les builds au même code natif** : la runtime version de l'app est son empreinte native (`runtimeVersion: { policy: "fingerprint" }`). Un changement natif (une dépendance native ajoutée ou montée, un plugin, `app.json` côté iOS ou Android, le SDK Expo) change l'empreinte : l'update ne trouve aucune build, et le changement passe par une **nouvelle build et la revue des stores**.

Règle : un correctif de JavaScript seul, sans changement de contrat avec le web app, peut partir en update. Tout le reste, et toute nouveauté qu'un Candidate voit, part en build.

### EAS Update et la vie privée

EAS Update est **coupé** dans les builds : `apps/mobile/app.json`, `updates.enabled: false`. Expo (650 Industries, États-Unis) sert les updates et reçoit à chaque lancement l'adresse IP de l'appareil et un identifiant propre à l'installation (`EAS-Client-ID`) : un **destinataire hors de l'UE**, qui n'entre en service qu'après la version de la politique de confidentialité qui le nomme (ADR-0064, registre `docs/privacy/register.md`, « Légal : » #762).

- `apps/mobile/e2e/delivery.e2e.test.ts` refuse `updates.enabled` tant qu'aucune version de `packages/help/legal/confidentialite/` ne nomme Expo ;
- `mobile.yml` refuse `action=update` tant qu'il est coupé ;
- l'allumer (`updates.enabled: true`, ou retirer la clé) est un changement natif : une build `staging` puis `production`, par les stores. Les builds d'avant ne prendront jamais d'update.

D'ici là, tout correctif, même de JavaScript seul, part en build.

## Les « Nouveautés » des stores

Elles viennent de la **même Release Note** que Nouveautés (`packages/help/releases/{fr,en}/X.Y.Z.md`, ADR-0063) : le titre, puis une ligne par changement (son début en gras, ou tout le texte), en texte brut, coupé à 500 caractères pour Play. Une Version sans Release Note dit « Corrections et améliorations ».

```sh
npm run store-whats-new -w @jobhub/help -- ./whatsnew   # écrit whatsnew/whatsnew-fr-FR et whatsnew-en-US
```

Le workflow les écrit à chaque exécution, dans son résumé et dans l'artefact `whatsnew-<profil>` (le format que lit Play). Tant qu'aucune clé n'est donnée pour écrire les fiches des stores, le product owner les recopie dans App Store Connect (« Nouveautés de cette version ») et la Play Console (« Notes de version »).

## La mise à jour imposée (426)

Chaque appel de l'app passe par `useApi()` (`apps/mobile/src/api/api.tsx`), qui envoie l'API Version qu'elle parle (`Jobbbox-Api-Version`), se nomme (`Jobbbox-Client: mobile`) et porte la session en cookie (`AppSession.cookie()`, #685, que `@better-auth/expo` garde dans le Keychain ou le Keystore, pas dans le magasin de cookies du système : l'en-tête `Cookie` est posé à la main, `credentials: "omit"`, et seulement vers un chemin de la plateforme) : la plateforme répond au Candidat connecté. Les écrans lisent par `src/api/reads.ts` (`useAgenda`, `useProfiles`, `useProfile`, `useApplication`, `useTailoredDocuments` ; #693, #695), chaque lecture analysée avec son schéma de `@jobhub/shared/reads`, gardée dans le cache des lectures (#701), qui ne garde sur l'appareil que ce que `READS` liste, et montrée par `ReadState` (chargement, échec avec « Réessayer », hors ligne) ; une lecture répondue 401 renvoie à la connexion, et toute fin de session oublie ces lectures. Quand la plateforme ne sert plus cette API Version (elle sert la courante et la précédente, `docs/ops/extension-api-version.md`), elle répond **426 Upgrade Required** avec le code `app_outdated`. L'app affiche alors, à la place de tout le reste, « **Mettre à jour Jobbbox** », avec un bouton vers son store :

- le lien que nomme une réponse `app_outdated` (`storeUrl`), s'il y en a un : la plateforme n'en nomme aucun pour l'instant (`apps/web/src/api-version/index.ts`), et l'app ignore celui d'une réponse à un autre code, comme le lien du Chrome Web Store qu'`extension_outdated` donne à l'extension ;
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

## Les e2e Maestro : le plancher de vérification en CI

_#705, ADR-0076, ADR-0009, ADR-0061._

Les parcours de l'app tournent sur des simulateurs iOS et des émulateurs Android, contre une **pile de test semée** : le serveur web e2e et ses faux services (`playwright.config.ts`), sa base jetable, et un petit assistant (`e2e/mobile-stack.spec.ts`, `e2e/support/mobile-stack.ts`) qui crée un Candidate inventé par passage (`MAESTRO_SEED`, `apps/mobile/maestro/seed.ts`) et donne aux flux le code de son e-mail de connexion. Le job dédié est `.github/workflows/mobile-e2e.yml`, lancé à chaque pull request et sur `main` quand `apps/mobile` ou `packages/shared` change.

### Ce qui tourne

| Fichier | Ce qu'il vérifie |
| --- | --- |
| `apps/mobile/maestro/flows/1-connexion.yaml` | connexion par code, la session gardée après relance |
| `2-ecrans-cles.yaml` | les écrans clés (accueil, Mes candidatures, Fiche, Recherches d'offres sur ses Offres à traiter, Agenda, une conversation), la disposition attendue, la capture de chacun |
| `3-accueil.yaml` | l'accueil, la Sidebar et ses menus |
| `4-candidature.yaml` | une Application : sa Fiche, son statut passé à « Entretien », un entretien ajouté |
| `5-recherches.yaml` | Recherches d'offres : la page s'ouvre sur ses Offres à traiter (ADR-0090), les deux offres de la recherche semée ; « Suivre » garde la première, qui passe dans « Déjà suivies » ; puis, sous la boîte, la recherche semée et ses offres trouvées. « Écarter » s'y ajoute avec #816 |
| `6-agenda.yaml` | l'Agenda, l'entretien semé, qui mène à la rubrique Entretiens |
| `7-conversation.yaml` | une conversation, la réponse en flux (« Arrêter » pendant qu'elle arrive) |

Les appareils et ce que chaque passage règle sont dans `apps/mobile/maestro/devices.ts` : iPhone SE, iPad Pro 13 pouces en paysage et en portrait, tablette Android (`pixel_tablet`), pliable (`pixel_fold`) déplié et replié. Un job par matériel ; sur chacun, chaque appareil passe trois fois : tous les flux en thème clair, puis les écrans clés en thème sombre, puis à **la plus grande taille de texte du système** (AX5 sur iOS, 200 % sur Android), où les colonnes d'une tablette passent en pleine page (`subflows/layout.yaml`). Le simulateur ou l'émulateur parle français (les flux cherchent les libellés français de l'app), sa barre d'état est figée à 09:41.

Ce qui se vérifie sans simulateur tourne avec les tests de l'app (`npm run test:mobile`) :

- `apps/mobile/maestro/flows.test.ts` : chaque libellé qu'un flux cherche existe dans les textes français de l'app ou dans les données semées ; un libellé renommé casse ici, pas sur un simulateur ;
- `apps/mobile/e2e/accessibility.e2e.test.tsx` : chaque écran clé, sur un petit téléphone et une tablette, à la plus grande taille de texte d'iOS et d'Android : chaque contrôle a un nom pour VoiceOver et TalkBack (`src/testing-accessibility.ts`), aucun texte n'est coupé, les colonnes passent en pleine page.

### Lancer les e2e sur un poste

Un Mac pour iOS (Xcode et un simulateur), ou un émulateur Android, et [Maestro](https://maestro.dev) à la version de `MAESTRO_VERSION` (`mobile-e2e.yml`). Depuis la racine du dépôt, Postgres démarré (`npm run db:up`) :

```sh
npm run build
E2E_WEB_PORT=3705 MOBILE_STACK_PORT=4705 bash apps/mobile/maestro/start-stack.sh /tmp/maestro-stack.json
# la build e2e de l'app, pointée sur la pile (comme le job build-ios ou build-android du workflow) :
cd apps/mobile && JOBHUB_E2E_BUILD=1 EXPO_PUBLIC_WEB_APP_URL=http://localhost:3705 npx expo run:ios --configuration Release   # ou run:android --variant release
cd ../.. && npx tsx apps/mobile/maestro/run.ts iphone-se --stack /tmp/maestro-stack.json --captures off
touch /tmp/maestro-stack.json.done   # arrête la pile
```

Seule une build e2e (`JOBHUB_E2E_BUILD=1`) accepte le HTTP, et seulement vers `localhost` (`app.config.ts`) ; une build des stores ne l'accepte jamais. Sur Android, `run.ts` renvoie le port de la pile vers l'émulateur (`adb reverse`).

### Les captures de référence

Les écrans clés sont comparés à `apps/mobile/maestro/captures/<appareil>/<thème>[-largest-text]/<écran>.png`, au pixel près à 1 % (`subflows/capture.yaml`). Comme pour le web (ADR-0061), elles ne sont **dessinées et comparées qu'en CI**, sur l'image des runners du workflow (`macos-26`, `ubuntu-latest` et l'image système Android `api-level: 35`) : un poste les saute (`--captures off`). Les captures claires d'un appareil qui en a une (`store`, `devices.ts`) servent aussi aux captures des stores (#708).

Une capture qui manque est dessinée et fait échouer son passage, comme une capture du web qui manque. Pour **redessiner** une capture (un écran qui change exprès) :

1. Lancer le workflow à la main, `gh workflow run mobile-e2e.yml --ref <branche> -f captures=record` ;
2. Télécharger les artefacts `maestro-captures-<matériel>` de l'exécution (`gh run download <id> -p 'maestro-captures-*'`) et recopier les images changées dans `apps/mobile/maestro/captures/` ;
3. Les relire dans la PR, image par image, puis pousser : l'exécution suivante les compare.

Un écart à la comparaison laisse dans l'artefact `maestro-results-<matériel>` la capture prise et la différence.

### Les téléchargements du workflow

Ce qu'un job télécharge n'est plus un point de panne de chaque exécution (une panne coûte, sur macOS, une à deux heures de file d'attente des runners) :

| Téléchargement | Ce qui le couvre |
| --- | --- |
| Le CLI de Maestro | Gardé dans le cache d'Actions (`~/.maestro/bin`, `~/.maestro/lib`), par version et empreinte. Sinon `apps/mobile/maestro/ci/install-maestro.sh` le prend à sa release GitHub, 5 essais au plus, et **vérifie l'archive avant de s'en servir** : son SHA-256 est `MAESTRO_SHA256`, et elle se décompresse en entier |
| Le navigateur de Playwright | La pile semée connecte le Candidate de chaque passage par une page (`e2e/support/mobile-stack.ts`) : il lui faut un navigateur, mais le « headless shell » de Chromium suffit (`--only-shell`), pas Chrome for Testing. Gardé dans le cache par version de Playwright ; sinon 4 essais |
| Gradle (distribution, compilateur Kotlin, bibliothèques) | `~/.gradle/caches` et `~/.gradle/wrapper` dans le cache, par `package-lock.json` ; `./gradlew assembleRelease` relancé jusqu'à 3 fois, Gradle reprenant où il s'est arrêté |
| CocoaPods | `~/Library/Caches/CocoaPods` dans le cache, par `package-lock.json` ; `expo prebuild --clean` relancé jusqu'à 3 fois |
| `npm ci`, `brew install postgresql@17`, le runtime iOS 18.6 de l'iPad (8,9 Go, trop gros pour le cache) | Relancés, un nombre borné de fois, par `apps/mobile/maestro/ci/retry.sh`, l'attente doublant à chaque essai |

Les caches de Maestro et du navigateur sont enregistrés dès l'installation, pas à la fin du job : une exécution dont les flux échouent les laisse à la suivante. Un cache enregistré par une pull request ne sert qu'à elle ; celui de `main` sert à toutes.

**Changer la version de Maestro** : `MAESTRO_VERSION` et `MAESTRO_SHA256` ensemble, dans `mobile-e2e.yml` (`shasum -a 256 maestro.zip` sur l'archive de la release `cli-<version>`).

Le simulateur et l'émulateur, eux :

- le simulateur iOS est créé **en français avant son premier démarrage** (`.GlobalPreferences.plist`), ce qui évite le second démarrage que `run.ts` faisait pour prendre la langue (6 à 14 minutes sur l'iPad) ; `bootSetup` (`devices.ts`) le vérifie et, s'il n'est pas en français, le règle et le redémarre comme avant ;
- un premier démarrage qui échoue, ou qui finit sur « Data Migration Failed », fait supprimer et recréer le simulateur, une fois ;
- le pilote XCTest de Maestro a 6 minutes pour démarrer (`MAESTRO_DRIVER_STARTUP_TIMEOUT`) ; s'il ne démarre pas, `run.ts` redémarre le simulateur une fois (`ios-driver-recovery.ts`, #944) ;
- une commande Maestro qui ne se termine pas est arrêtée : après 15 minutes pour la préparation de l'app (qui compte alors comme échouée, d'où le second essai ou la reprise ci-dessus), après une heure pour les flux d'un passage (qui échoue). Sans cela, un Maestro planté sans quitter gardait le job jusqu'à sa limite de 3 heures (exécution 43182114920) ;
- après le redémarrage du framework Android (pour la langue), `bootSetup` attend que ses services répondent (`cmd uimode`, `wm`), et les réglages d'un passage (thème, taille du texte, barre d'état) sont réessayés 3 fois : ce sont des préparatifs, jamais une vérification de l'app.

Aucun flux n'est réessayé, et aucune vérification de l'app n'est assouplie par ces reprises.

### À vérifier au premier passage d'un nouvel Xcode ou d'une nouvelle image Android

L'iPad en Split View (1/2) n'est pas dans la matrice Maestro (décision du product owner, #705) : ni `simctl` ni Maestro ne le mettent en Split View, et, fait à la main par le bouton multitâche d'iPadOS, le pilote iOS de Maestro place les éléments de l'app sur la mauvaise moitié de l'écran, ses taps allant à l'autre app (quatre approches essayées, détail dans #904). Sa fenêtre (683 × 1032) est vérifiée par la suite d'accessibilité (`apps/mobile/e2e/accessibility.e2e.test.tsx` : mise en page pleine page, libellés et aucun texte coupé à la plus grande taille), et **à la main sur un iPad avant chaque Version** : l'app ouverte en Split View à côté de Safari, en paysage, la connexion, l'Accueil, Mes candidatures et une Fiche parcourus. #904 la ramène dans Maestro quand son pilote le permettra ; le job de l'iPad reste sur iPadOS 18 (`ios` dans la matrice de `mobile-e2e.yml`, runtime téléchargé si l'image macOS ne l'a pas), qui a Split View, et sur lequel ses captures de référence sont enregistrées. Sur iOS 18, WebKit laisse parfois sans réponse l'effacement des cookies des WebViews (`removeData` « started » sans « finished » dans `device.log`) : l'app ne l'attend que 3 s (`WEB_VIEWS_WAIT_MS`, `src/session/app-session.ts`), sans quoi elle restait vide après la connexion sur chaque passage de l'iPad. De même, le pliable se plie par la console de l'émulateur (`adb emu fold`, `adb emu unfold`) et la langue d'Android se règle par `adb root` (`bootSetup`, `devices.ts`), ce qu'une image `google_apis` permet.

### Libellés VoiceOver et TalkBack vérifiés à la main

Le contrôle automatique (`accessibility.e2e.test.tsx`) vérifie que chaque contrôle a un nom. Que ce nom se lise bien, dans l'ordre, se vérifie sur un appareil avec VoiceOver ou TalkBack ; la liste cochée va dans la PR qui change un écran clé : la connexion par code (les deux champs, « Me connecter avec ce code »), l'accueil (« Votre message », « Envoyer », « Menu »), une candidature (« Fiche », « Statut : … », « Entretiens »), l'Agenda (chaque entretien, « Ajouter à mon calendrier »), une conversation (« Arrêter » pendant la réponse, puis la réponse annoncée).

## Mise en place, une fois

Le script `scripts/setup/issue-704.sh` fait ces étapes pas à pas (projet EAS, jeton, identifiants Apple et Play) ; à lancer depuis la racine du dépôt, `bash scripts/setup/issue-704.sh`.

1. **Projet EAS** : dans `apps/mobile`, `npx eas-cli init`, puis recopier l'identifiant du projet dans `app.json`, `expo.extra.eas.projectId` (`app.config.ts` en tire l'adresse d'EAS Update, `https://u.expo.dev/<id>`) ; EAS Update reste coupé tant que la politique de confidentialité ne nomme pas Expo, voir « EAS Update et la vie privée ».
2. **Jeton** : créer un jeton d'accès sur expo.dev (compte de l'organisation) et l'enregistrer comme secret du dépôt : `gh secret set EXPO_TOKEN`.
3. **Identifiants des stores, gardés par EAS** (`npx eas-cli credentials`) : la clé d'API App Store Connect (iOS, signature et envoi à TestFlight) et la clé du compte de service Google Play (Android, envoi au test interne). Aucun autre secret dans le dépôt.
4. **Fiches des stores** : créer l'app `ai.jobbbox.app` dans App Store Connect et la Play Console. Sur Play, le tout premier envoi se fait à la main (exigence de Google), les suivants par EAS Submit. Une fois l'app créée dans App Store Connect, renseigner son identifiant Apple dans `app.json` (`expo.extra.appStoreId`, pour le lien « Mettre à jour Jobbbox ») et dans `eas.json` (`submit.staging.ios.ascAppId` et `submit.production.ios.ascAppId`).
5. **Rapports de plantage (Sentry, #703)** : tant que cette étape n'est pas faite, les profils `staging` et `production` d'`eas.json` portent `SENTRY_DISABLE_AUTO_UPLOAD: "true"`. Sans cela, la build `release` échoue : le plugin `@sentry/react-native` envoie les source maps et les fichiers de débogage à Sentry depuis Xcode et Gradle, et cet envoi échoue faute d'identifiants. L'app se construit alors sans DSN, donc sans rapport de plantage. Pour les activer :
   1. Créer l'organisation Sentry avec l'UE (Francfort) comme Data Storage Location, puis le projet React Native, réglé comme le dit `apps/mobile/.env.example` (Data Scrubber, « Prevent Storing of IP Addresses », règle d'Advanced Data Scrubbing, voir `docs/privacy/register.md`, « Crash reports »).
   2. Enregistrer comme variables d'environnement du projet EAS (`npx eas-cli env:create`), dans l'environnement que lisent les builds `staging` et `production`, le jeton en visibilité « secret » : `EXPO_PUBLIC_SENTRY_DSN` (le DSN du projet, `https://<clé>@<org>.ingest.de.sentry.io/<projet>`), `SENTRY_ORG`, `SENTRY_PROJECT` et `SENTRY_AUTH_TOKEN` (un jeton d'organisation qui peut envoyer les source maps). Ils restent chez EAS, pas dans le dépôt.
   3. Retirer `SENTRY_DISABLE_AUTO_UPLOAD` des deux profils d'`eas.json` : une valeur d'`eas.json` passe avant celle d'EAS. Le test `apps/mobile/e2e/delivery.e2e.test.ts` est à mettre à jour dans le même changement.
6. **Extension de partage iOS (Share capture, #697)** : le plugin `apps/mobile/plugins/with-share-extension.js` ajoute à la build iOS la cible `JobbboxShare`, identifiant `ai.jobbbox.app.share`, signée par EAS avec l'app (`extra.eas.build.experimental.ios.appExtensions`). Au premier `eas build` iOS, laisser EAS créer cet identifiant dans le compte Apple Developer (ou le créer à la main, sans capacité particulière : l'extension n'a ni App Group ni trousseau partagé). Sur Android, l'activité de partage vient du module local `apps/mobile/modules/share-intent`, sans réglage. À vérifier sur un appareil avant la première soumission : depuis Safari, LinkedIn, Indeed et Mail, « Partager → Jobbbox » ouvre l'app sur l'écran de capture (l'extension ouvre l'app par la chaîne des répondeurs, ce que l'App Review doit accepter).
