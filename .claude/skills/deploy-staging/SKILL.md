---
name: deploy-staging
description: Déploie un commit de main sur la Beta (staging.jobbbox.ai) avec le workflow deploy.yml, en suit l'exécution, vérifie /api/health et dit où en est la Release Note de la prochaine Version. Ne crée ni tag ni GitHub Release et ne change pas la Version (ADR-0063). `à blanc` / `--dry-run` fait toutes les vérifications sans déployer. Use when asked to deploy staging, the Beta, or « déployer la bêta ».
---

# deploy-staging — déployer la Beta

Copie versionnée du skill pour ce dépôt (#562) : elle prend le pas sur celle de l'utilisateur (`~/.claude/skills/deploy-staging/`).

Depuis ADR-0063, une Version naît à sa Promotion, pas à un déploiement de staging. Ce skill :

- **ne crée aucun tag**, aucune GitHub Release, et ne reconstitue aucune Version passée : c'est la Promotion (`docs/ops/promotion.md`), que seul le product owner lance, qui étiquette `vX.Y.Z` et publie la Release ;
- **ne change pas la Version** : `main` porte déjà la prochaine (le `version` du `package.json` racine), et c'est la PR « Version suivante » ouverte par la Promotion qui la fait avancer. Ne modifiez aucun `package.json` ni `package-lock.json` ;
- ne déploie **jamais la Production** (`target=production` est refusé aux agents, `scripts/hooks/no-promotion.mjs`) ;
- ne touche pas au `.env` de staging : la configuration vient du Back Office (Platform Settings, Provider Secrets).

## Arguments

- rien : déploie `origin/main` (son dernier commit) sur la Beta ;
- `à blanc` ou `--dry-run` : fait les étapes 1 à 3, affiche la commande de l'étape 4 sans la lancer, et rend le rapport. Rien n'est déployé.

## 1. Le commit à déployer

```bash
git fetch origin main
SHA=$(git rev-parse origin/main)
VERSION=$(node -p "require('./package.json').version")
```

La CI de ce commit doit être verte : `deploy.yml` refuse sinon. Vérifiez-le avant de lancer :

```bash
gh api "repos/fnconsult/jobhub/commits/$SHA/check-runs" --jq '.check_runs[] | "\(.name) \(.status) \(.conclusion)"'
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

## 4. Déployer

En mode à blanc, affichez cette commande et passez à l'étape 6.

```bash
gh workflow run deploy.yml --ref main -f target=staging
```

## 5. Suivre le workflow

```bash
sleep 5
RUN=$(gh run list --workflow deploy.yml --branch main --limit 1 --json databaseId --jq '.[0].databaseId')
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

- **Déployé** (ou **À blanc : rien déployé**) : `$SHA` court, Version `$VERSION`, lien vers l'exécution du workflow ;
- **Beta** : ce que répond `/api/health` (avant, et après en mode normal) ;
- **Release Note** : la phrase de l'étape 3 ;
- **Rappel** : aucun tag, aucune GitHub Release, Version inchangée ; la prochaine Version naîtra à la Promotion du product owner.
