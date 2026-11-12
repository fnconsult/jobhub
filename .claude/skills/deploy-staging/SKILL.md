---
name: deploy-staging
description: Déploie le dernier commit vert de main (ou celui qu'on lui nomme) sur la Beta (staging.jobbbox.ai) avec le workflow deploy.yml, en suit l'exécution, vérifie /api/health et dit où en est la Release Note de la prochaine Version. Ne crée ni tag ni GitHub Release et ne change pas la Version (ADR-0063). `à blanc` / `--dry-run` fait toutes les vérifications sans déployer. Use when asked to deploy staging, the Beta, or « déployer la bêta ».
---

# deploy-staging — déployer la Beta

Copie versionnée du skill pour ce dépôt (#562) : elle prend le pas sur celle de l'utilisateur (`~/.claude/skills/deploy-staging/`).

Depuis ADR-0063, une Version naît à sa Promotion, pas à un déploiement de staging. Ce skill :

- **ne crée aucun tag**, aucune GitHub Release, et ne reconstitue aucune Version passée : c'est la Promotion (`docs/ops/promotion.md`), que seul le product owner lance, qui étiquette `vX.Y.Z` et publie la Release ;
- **ne change pas la Version** : `main` porte déjà la prochaine (le `version` du `package.json` racine), et c'est la PR « Version suivante » ouverte par la Promotion qui la fait avancer. Ne modifiez aucun `package.json` ni `package-lock.json` ;
- ne déploie **jamais la Production** (`target=production` est refusé aux agents, `scripts/hooks/no-promotion.mjs`) ;
- ne touche pas au `.env` de staging : la configuration vient du Back Office (Platform Settings, Provider Secrets) ;
- **ne lance pas la build staging de l'app Jobbbox** (#704) : elle passe par `.github/workflows/mobile.yml` (EAS, TestFlight et test interne Play), que le product owner lance quand une build native est utile (`docs/ops/mobile.md`). Le skill la mentionne dans son rapport, il ne la lance pas.

## Arguments

- rien : déploie sur la Beta **le dernier commit vert de `main`**, le plus récent de son historique sur lequel `ci.yml` a réussi, pas forcément sa tête : plusieurs PR y arrivent chaque heure et la CI dure près d'une heure, la tête n'a donc souvent pas encore la sienne ;
- un SHA de `main` (court ou complet) : déploie ce commit, s'il est sur `main` et que sa CI est verte (`deploy.yml` refuse sinon) ;
- `à blanc` ou `--dry-run` : fait les étapes 1 à 3, affiche la commande de l'étape 4 sans la lancer, et rend le rapport. Rien n'est déployé.

## 1. Le commit à déployer

Le dernier commit vert de `main` : le premier de son historique parmi ceux où une exécution de `ci.yml` sur `main` a réussi (la même règle que `-f sha=latest-green` de `deploy.yml`). Si on vous a nommé un SHA, prenez-le à la place (`SHA=$(git rev-parse <sha>)`).

```bash
git fetch origin main
GREEN=$(gh run list --workflow ci.yml --branch main --event push --status success --limit 100 --json headSha --jq '.[].headSha')
SHA=$(git rev-list --first-parent --max-count 100 origin/main | grep -Fx -m1 -e "$GREEN")
NEWER=$(git rev-list --count "$SHA..origin/main")
VERSION=$(git show "$SHA:package.json" | node -p "JSON.parse(require('fs').readFileSync(0, 'utf8')).version")
```

Si `SHA` est vide, aucun des 100 derniers commits de `main` n'a de CI verte : dites-le et arrêtez-vous. `NEWER` compte les commits de `main` plus récents, que ce déploiement n'emporte pas (leur CI tourne encore, ou a échoué).

La CI de ce commit doit être verte : `deploy.yml` refuse sinon. Vérifiez-le avant de lancer :

```bash
gh api --paginate "repos/fnconsult/jobhub/commits/$SHA/check-runs?per_page=100" --jq '.check_runs[] | "\(.name) \(.status) \(.conclusion)"'
```

Si un check est rouge ou encore en cours, dites-le et arrêtez-vous (ou attendez qu'il finisse) : ne relancez pas la CI par un commit vide.

## 2. Ce que sert la Beta aujourd'hui

```bash
curl -fsS https://staging.jobbbox.ai/api/health
```

Elle répond `{ status, version, commit, environment }`. Si `commit` est déjà `$SHA`, il n'y a rien à déployer : dites-le (en mode normal, ne redéployez que si on vous le demande).

## 3. La Release Note de la prochaine Version

```bash
npm run --silent release-note -w @jobhub/help -- --check
```

Une phrase, recopiée telle quelle dans le rapport : la Release Note `releases/{fr,en}/$VERSION.md` est écrite, ou des fragments l'attendent dans `packages/help/releases/unreleased/` (à assembler avec `npm run release-note -w @jobhub/help` avant la Promotion), ou elle manque. **Ce constat ne bloque jamais le déploiement de la Beta** : il prépare la Promotion.

Puis l'Extension Version que porte `$SHA`, et si sa GitHub Release existe (#989) :

```bash
EXT=$(git show "$SHA:apps/extension/package.json" | jq -r .version)
gh api "repos/fnconsult/jobhub/releases/tags/extension-v$EXT" --jq .html_url 2>/dev/null || echo "aucune Release extension-v$EXT"
```

Une phrase pour le rapport : la Release `extension-v$EXT` existe (son lien), ou elle n'existe pas encore. Dans ce cas, dites que c'est l'étape du product owner pour les fiches du Chrome Web Store (`docs/ops/extension.md`, étape 3) et donnez-lui la commande, sans la lancer : `gh workflow run extension.yml --ref main`. Ce constat ne bloque pas non plus le déploiement : la Beta sert elle-même son zip de test dans Outils (`apps/web/Dockerfile`).

## 4. Déployer

En mode à blanc, affichez cette commande et passez à l'étape 6.

```bash
SINCE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
gh workflow run deploy.yml --ref main -f target=staging -f sha="$SHA"
```

`-f sha` nomme le commit choisi à l'étape 1, pas la tête de `main` : `deploy.yml` vérifie qu'il est sur `main` et que sa CI est verte, puis construit, étiquette, déploie et enregistre (GitHub Deployment) ce commit-là. Le passer en clair, plutôt que `latest-green`, garde le commit annoncé même si une CI finit entre-temps.

## 5. Suivre le workflow

```bash
# The run this dispatch started: from main, dispatched since $SINCE (its own commit is main's head, not $SHA).
# GitHub may take a few seconds to list it.
for attempt in 1 2 3 4 5 6; do
  RUN=$(gh run list --workflow deploy.yml --event workflow_dispatch --branch main --limit 5 --json databaseId,createdAt --jq "[.[] | select(.createdAt >= \"$SINCE\")] | last | .databaseId // empty")
  [ -n "$RUN" ] && break
  sleep 5
done
gh run watch "$RUN" --exit-status
```

En cas d'échec, lisez le job en erreur (`gh run view "$RUN" --log-failed`), dites quelle étape a échoué et pourquoi. Ne corrigez rien sur le VPS à la main.

Puis vérifiez que la Beta sert le commit :

```bash
curl -fsS https://staging.jobbbox.ai/api/health
```

`commit` doit être `$SHA`, `version` `$VERSION` et `environment` `staging`. La Beta affiche « $VERSION (main·sha court) ».

## 6. Le rapport

En français, court :

- **Déployé** (ou **À blanc : rien déployé**) : `$SHA` court et son titre (`git log -1 --format=%s "$SHA"`), Version `$VERSION`, lien vers l'exécution du workflow ;
- **Commit choisi** : le dernier commit vert de `main` (ou le SHA demandé), et `$NEWER` commit(s) de `main` plus récent(s) non déployé(s), avec leur état de CI ;
- **Beta** : ce que répond `/api/health` (avant, et après en mode normal) ;
- **Release Note** : la phrase de l'étape 3 ;
- **Extension** : la phrase de l'étape 3 sur la Release `extension-v$EXT` ;
- **App Jobbbox** : si ce déploiement change l'app (`git log --oneline <commit servi à l'étape 2>..$SHA -- apps/mobile packages/shared`), dites qu'une build staging de l'app est à faire, avec la commande pour le product owner, et ne la lancez pas : `gh workflow run mobile.yml -f profile=staging -f action=build` (ou `-f action=update -f message=…` pour un correctif JavaScript seul) ;
- **Rappel** : aucun tag, aucune GitHub Release (ni `v*`, ni `extension-v*`), Version inchangée ; la prochaine Version naîtra à la Promotion du product owner.
