# Promouvoir une Version

_ADR-0063, #560. Termes : **Version**, **Beta**, **Promotion**, **Release Note** (`CONTEXT.md`)._

La Promotion fait de ce que sert la Beta (`staging.jobbbox.ai`, déployée depuis `main`) une Version en Production (`jobbbox.ai`). Seul le product owner la lance, depuis son poste, **hors de tout agent** : le hook du dépôt (`scripts/hooks/no-promotion.mjs`, déclaré dans `.claude/settings.json`) refuse à un agent le script, `git push` vers `prod` ou d'un tag `v*`, et `gh workflow run deploy.yml … production`.

La branche `prod` est la seule source des déploiements de Production : `.github/workflows/deploy.yml` refuse `target=production` depuis `main`, une branche, ou un tag qui n'est pas un tag `vX.Y.Z` de l'historique de `prod` (`scripts/deploy/check-production-ref.mjs`).

## Lancer la Promotion

Depuis un clone à jour, `gh` connecté :

```sh
npx tsx scripts/promote.ts                     # Version suivante : X.Y.(Z+1)
npx tsx scripts/promote.ts --minor             # ou X.(Y+1).0, --major pour (X+1).0.0
npx tsx scripts/promote.ts --rien-de-visible   # aucune Release Note : rien de visible pour un Candidat
```

Le script promeut `origin/main`. Il vérifie d'abord, et dit en clair chaque précondition qui manque ; dans ce cas, **rien n'est poussé** :

1. **Les versions concordent** : `package.json`, `apps/web` et `apps/worker` portent la même Version `X.Y.Z` (#559), et le tag `vX.Y.Z` n'existe pas encore.
2. **`prod` avance sans réécriture** : son sommet est un ancêtre du commit promu.
3. **La CI de ce commit est verte** (`ci.yml`).
4. **La Beta sert ce commit** : `https://staging.jobbbox.ai/api/health` répond ce SHA et cette Version. Sinon, déployez d'abord ce commit sur la Beta.
5. **Les Release Notes FR et EN existent** : `packages/help/releases/fr/X.Y.Z.md` et `en/X.Y.Z.md`, sauf avec `--rien-de-visible`, que le résumé rappelle.
6. **Aucun fragment ne reste** dans `packages/help/releases/unreleased/` : ils sont assemblés dans la Release Note par `npm run release-note -w @jobhub/help` (#562), qui écrit le brouillon `releases/{fr,en}/X.Y.Z.md` et les retire ; l'agent le réécrit dans un ton unique, vous le validez ici.

Il résume ensuite ce qu'il va faire et demande de taper la Version (`--yes` pour s'en passer), puis :

1. crée le tag annoté `vX.Y.Z` sur ce commit ;
2. pousse `prod` et le tag ensemble, `git push --atomic` : les deux ou aucun ;
3. lance `deploy.yml` (`target=production`) depuis le tag, en suit l'exécution, puis vérifie que `https://jobbbox.ai/api/health` sert `X.Y.Z` et ce commit ;
4. ouvre la PR « Version suivante » qui fait passer `main` (les trois `package.json` et `package-lock.json`) à la Version suivante. Fusionnez-la : la Beta affiche alors « X.Y.Z+1 (main·sha) ».

Si le déploiement échoue, `prod` et le tag sont déjà poussés : le script le dit, n'ouvre pas la PR, et donne la commande pour relancer le déploiement.

## La GitHub Release

Le tag poussé, le workflow `publier-releases` (`.github/workflows/publier-releases.yml`, #561) publie la GitHub Release de la Version : la Release Note en français, puis en anglais, puis la liste des pull requests depuis le tag précédent. Une Version promue avec `--rien-de-visible` reçoit une **Release technique**, « vX.Y.Z (technique) », avec la liste des pull requests seule. La Release Note de la Version suivante, sans tag, ne publie rien. Il repasse sur chaque tag à chaque push sur `main` qui touche `packages/help/releases/{fr,en}/` : une Release déjà à jour n'est pas touchée, une Release qui diffère est corrigée, jamais doublée. Pour le relancer à la main : `gh workflow run publier-releases.yml -f dry-run=false`.

Une Release Note publiée ne change plus : si `releases/{fr,en}/X.Y.Z.md` diffère de ce que porte le tag `vX.Y.Z` (modifiée, supprimée ou ajoutée après coup), le workflow échoue sans rien publier, dès la pull request. Une correction va dans la Release Note de la Version suivante.

## Revenir en arrière

Redéployez le tag précédent, qui est dans l'historique de `prod` :

```sh
gh workflow run deploy.yml --ref vX.Y.(Z-1) -f target=production -f confirm=jobbbox.ai
```

`prod` ne recule pas : la Promotion suivante repart de `main`, corrigé. Les migrations de base de données ne sont pas annulées par un redéploiement ; une migration incompatible avec la Version précédente se corrige par une nouvelle Version.

## Recommandé côté GitHub

Le hook protège des agents dans Claude Code. Une règle de dépôt (Settings → Rules) qui réserve au product owner la branche `prod` et les tags `v*` protège aussi d'un push fait autrement.

---

# Promoting a Version (EN)

The Promotion turns what the Beta (`staging.jobbbox.ai`, deployed from `main`) serves into a Version in Production (`jobbbox.ai`). Only the product owner runs it, from their machine, **outside any agent**: the repo's hook (`scripts/hooks/no-promotion.mjs`) refuses an agent the script, `git push` to `prod` or of a `v*` tag, and `gh workflow run deploy.yml … production`. `deploy.yml` refuses `target=production` from anything but a `vX.Y.Z` tag on `prod`'s history.

Run `npx tsx scripts/promote.ts` (`--minor`, `--major`, `--rien-de-visible` for a Version with nothing a Candidate can see, `--yes`). It promotes `origin/main` once every precondition holds, and pushes nothing otherwise: one Version across the manifests and no existing tag; `prod` moves forward only; green CI on the commit; the Beta's `/api/health` serves that commit; the FR and EN Release Notes exist (unless `--rien-de-visible`); no fragment left in `releases/unreleased/`. It then tags `vX.Y.Z`, pushes `prod` and the tag with `--atomic`, deploys Production from the tag, checks Production's `/api/health`, and opens the pull request that moves `main` to the next Version.

Once the tag is pushed, the `publier-releases` workflow publishes the Version's GitHub Release: the French Release Note, then the English one, then the pull requests since the previous tag; a Version with no Release Note gets a technical Release, « vX.Y.Z (technique) », with the pull requests alone; the next Version's untagged note publishes nothing. Running it again never duplicates a Release. A published Release Note never changes: the workflow fails, from the pull request on, when `releases/{fr,en}/X.Y.Z.md` differs from what tag `vX.Y.Z` carries.

To roll back, redeploy the previous tag: `gh workflow run deploy.yml --ref vX.Y.(Z-1) -f target=production -f confirm=jobbbox.ai`.
