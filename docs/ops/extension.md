# Publier l'extension

_ADR-0063, #563. Termes : **Extension Version**, **Beta**, **Release Note** (`CONTEXT.md`)._

L'extension a sa propre **Extension Version** `X.Y.Z`, en chiffres seulement (les stores refusent un suffixe), dans `apps/extension/package.json`, que le manifeste reprend. Elle avance indépendamment de la Version du web : un examen du store peut la retenir, et un changement de l'extension n'en demande aucun côté web.

Chaque Extension Version a **deux builds**, chacun sur sa fiche du Chrome Web Store :

| Build | Fiche | Branchée sur | Nom | Commande |
| --- | --- | --- | --- | --- |
| publique | publique | la Production, `https://jobbbox.ai` | Jobbbox | `npm run zip -w @jobhub/extension` |
| beta | non répertoriée | la Beta, `https://staging.jobbbox.ai` | Jobbbox (bêta), icône orange marquée β | `npm run zip:beta -w @jobhub/extension` |

Le domaine du web vient du build (`apps/extension/src/build-target.ts`), jamais d'un réglage de l'utilisateur : une variable `WXT_WEB_ORIGIN` restée dans l'environnement ne change pas un build de store. `npm run dev -w @jobhub/extension` et les tests e2e (`--mode e2e`) parlent, eux, à `WXT_WEB_ORIGIN`.

Les textes des deux fiches, en français (qui fait foi) et en anglais, sont dans `apps/extension/store/fr.md` et `en.md` : description, résumé, liens vers la politique de confidentialité (`/legal/confidentialite`) et vers l'aide (`/aide/extension`, rubrique « L'extension »), justification des autorisations. Les icônes sont dessinées depuis `apps/extension/icons/*.svg` par `npx tsx apps/extension/scripts/draw-icons.ts`.

## Publier une Extension Version

Le product owner, seul : aucun agent ne crée de tag ni de Release, et aucun agent ne publie sur le Chrome Web Store.

1. **Monter l'Extension Version** dans `apps/extension/package.json` (et `package-lock.json`, `npm install`), par une PR fusionnée sur `main`. La CI construit et vérifie alors les deux zip (`extension.yml` sur la PR).
2. **Release Note** : si un Candidate voit quelque chose de nouveau dans l'extension, la PR qui l'apporte a son fragment `packages/help/releases/unreleased/<pr>.md` (format de #505), et la Release Note de la Version qui suit porte le tag `extension` dans Nouveautés.
3. **Lancer le workflow** `extension` sur `main` (Actions → extension → Run workflow, ou `gh workflow run extension.yml --ref main`). Il refuse une Extension Version qui n'est pas `X.Y.Z` ou dont la Release existe déjà, lance les tests de l'extension, construit les deux zip, vérifie leur manifeste (version, domaine, nom), puis crée la GitHub Release `extension-vX.Y.Z` et son tag sur ce commit, avec les deux zip attachés. Cette Release n'est jamais la « latest » du dépôt, qui reste la dernière Version du web.
4. **Fiche publique** (tableau de bord du Chrome Web Store, élément « Jobbbox ») : Package → Importer un nouveau package → `jobbbox-extension-X.Y.Z-chrome.zip`. Recopier la fiche depuis `store/fr.md` (et la fiche localisée anglaise depuis `store/en.md`) si le texte a changé. Envoyer pour examen.
5. **Fiche beta** (élément « Jobbbox (bêta) », visibilité **non répertoriée**) : même chose avec `jobbbox-extension-X.Y.Z-chrome-beta.zip`, et la partie « Fiche beta » des textes. La publier d'abord permet de la tester sur la Beta avant la fiche publique.
6. **Lien vers la fiche** : une fois une fiche publiée la première fois, renseigner son URL dans le Back Office, Paramètres, réglage `EXTENSION_STORE_URL` : l'URL de la fiche publique en Production, celle de la fiche beta sur la Beta. Mon compte → Outils et « Extension », en bas des pages publiques, y mènent alors au lieu d'afficher « L'extension arrive bientôt sur le Chrome Web Store. »

La publication reste manuelle tant qu'aucune clé d'API du Chrome Web Store n'est fournie. Microsoft Edge accepte le même zip (Partner Center), avec les mêmes textes.

## Le zip de test dans Outils

Indépendamment de la Release, chaque image web déployée porte les deux zip de l'Extension Version de son commit : `apps/web/Dockerfile` les construit (étape `extension`, les mêmes commandes que ci-dessus) dans `/app/extension`, que nomme `EXTENSION_ZIP_DIR`. Mon compte → Outils, bloc « Dernière version de l'extension », propose aux Administrators de télécharger celui de l'environnement (le zip beta sur la Beta, le public en Production) depuis le serveur, par `/api/account/extension-test-build` (404 à qui n'est pas Administrator). Aucun accès au dépôt n'est nécessaire, et rien ne dépend de l'étape 3 (#989). Hors image (`npm run dev`, un build local), le bloc dit que ce serveur n'a pas de zip.

La GitHub Release `extension-vX.Y.Z` reste ce que le product owner envoie aux fiches du Chrome Web Store (étapes 4 et 5). Pour savoir si l'Extension Version de `main` a déjà la sienne : `gh release view extension-v$(jq -r .version apps/extension/package.json)`.

## Recommandé côté GitHub

Une règle de dépôt (Settings → Rules) qui réserve au product owner les tags `extension-v*`, comme `prod` et `v*` (`promotion.md`).

---

# Publishing the extension (EN)

The extension has its own **Extension Version** `X.Y.Z`, digits only, in `apps/extension/package.json`, which the manifest repeats; it moves apart from the web app's Version. Each Extension Version has **two builds**: the public one (`npm run zip -w @jobhub/extension`), tied to Production (`https://jobbbox.ai`), for the public listing; and the beta one (`npm run zip:beta -w @jobhub/extension`), « Jobbbox (beta) » with an orange β icon, tied to the Beta (`https://staging.jobbbox.ai`), for the unlisted beta listing. The web app's origin comes from the build (`apps/extension/src/build-target.ts`), never from a user setting nor from a stray `WXT_WEB_ORIGIN`. The listings' texts, French (prevailing) and English, are in `apps/extension/store/`.

Only the product owner publishes: raise the Extension Version through a merged pull request; run the `extension` workflow on `main`, which checks the version, tests the extension, builds and checks both zips, and creates the GitHub Release `extension-vX.Y.Z` (never the repo's latest) with both attached; upload each zip to its listing in the Chrome Web Store dashboard and submit it for review; once a listing is first published, set its URL in the Back Office setting `EXTENSION_STORE_URL` (the public listing in Production, the beta one on the Beta). An Extension Version a Candidate can see gets its Release Note through the delivering pull request's fragment, tagged `extension` in Nouveautés. Publishing stays manual while no Chrome Web Store API key is provided.

Apart from the Release, each deployed web image carries both zips of its commit's Extension Version (`apps/web/Dockerfile` builds them into `/app/extension`, named by `EXTENSION_ZIP_DIR`): Mon compte › Outils lets Administrators download the one for the environment from the server (`/api/account/extension-test-build`, 404 to anyone else), with no repo access needed (#989). To check whether `main`'s Extension Version already has its Release: `gh release view extension-v$(jq -r .version apps/extension/package.json)`.
