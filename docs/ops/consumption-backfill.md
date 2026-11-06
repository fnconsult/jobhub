# Consumption backfill

_#800, ADR-0091. Terms: **Consumption** (`CONTEXT.md`)._

**Run once per environment (staging, then production), after #799's migration is deployed there and before « Votre consommation » (#801) ships there.**

```sh
npm run db:backfill-consumption -- --live-from YYYY-MM-DD
```

`--live-from` is the day #799 was deployed in that environment, French time: from that day, uses are counted live and the backfill never touches them. It writes the days from 12 months ago to the day before, from the results the database still holds, and prints the rows and uses per Tool it wrote. Run again, it gives the same rows: it replaces what it wrote, never adds to it. A date it cannot read, or one still to come, is refused and nothing is written.

## The deploy date

- **Staging**: the day of the first `deploy.yml` run (`target=staging`) of a commit that contains #799's (`b7ce73e4`): `gh run list --workflow deploy.yml`.
- **Production**: the day of the Promotion of the first Version that contains it: `git tag --contains b7ce73e4 --sort=creatordate | head -1`, then that Version's GitHub Release date.
- Check before the first run: `SELECT min(day) FROM consumption_day;` is that day or later (only live counts are there yet). If the day you found is later than it, use the earlier one.
- The script checks it too: it refuses a `--live-from` later than the earliest day already counted live (`SELECT min(day) FROM consumption_day` on the first run), and writes nothing. The first run records its `--live-from` in `consumption_backfill`; a later run must give the same day, or it is refused.

## On the VPS

The `migrate` image holds the script. From the environment's folder (`/opt/jobbbox/staging` or `/opt/jobbbox/production`), with the deployed commit and the environment's names (as `deploy/deploy.sh` sets them):

```sh
cd /opt/jobbbox/staging   # or /opt/jobbbox/production
export JOBHUB_TARGET=staging JOBHUB_HOST=staging.jobbbox.ai JOBHUB_SLUG=jobbbox-staging \
  JOBHUB_ENV_FILE="$PWD/.env" JOBHUB_IMAGES=ghcr.io/fnconsult/jobhub JOBHUB_REVISION="$(git -C app rev-parse HEAD)"
docker compose -f app/deploy/compose.yml -p "$JOBHUB_SLUG" --env-file .env run --rm --no-deps migrate \
  node_modules/.bin/tsx apps/web/scripts/backfill-consumption.ts --live-from YYYY-MM-DD   # this environment's #799 deploy day
```

Production: `JOBHUB_TARGET=production JOBHUB_HOST=jobbbox.ai JOBHUB_SLUG=jobbbox-production`, and its own deploy date.

## What it counts

Each use on its French day, from what is still stored: AI Coach replies; Job Searches whose Plan Quota use was kept (done, or stopped with a Job Offer); Tailored CVs (the proposal under review and the one saved); Tailored Documents; Company Dossiers built; CVs read from a file (Master CV Versions with a Provenance); the ATS Score kept per Profile; Enriched Contacts whose details were retrieved. For the Tools with a weekly Plan Quota, the week's uses no stored result shows (every Match Score, since none is stored; ATS Scores replaced since) are counted on the week's Monday, for the weeks wholly before the deploy date.

What was deleted (an Application, an « Effacer » conversation) cannot be counted: the backfill is a best effort, as ADR-0091 records, and the section says nothing about it.
