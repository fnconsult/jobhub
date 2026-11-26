# Correcting the titles of the Job Offers already stored

_#1128, ADR-0117. Terms: **Job Offer**, **Application** (`CONTEXT.md`)._

Before #1128, a slogan in a careers page's header could be taken for the job title (« Doing what matters starts here »). The import now reads the posting's JobPosting `title`, else its own `<h1>`, never the site banner's. This script reads again the source page of each shared Job Offer already stored and gives it the title that rule finds.

**Run once per environment (staging, then production), after #1128 is deployed there: first a dry run, then, once its list is checked, with `--apply`.**

```sh
npm run db:retitle-job-offers                 # dry run: lists what would change, changes nothing
npm run db:retitle-job-offers -- --apply      # changes them
npm run db:retitle-job-offers -- --limit 50   # at most 50 Job Offers, oldest first (with or without --apply)
```

## What it does

- **Only shared Job Offers with a source URL.** A Private Job Offer (ADR-0049) comes from a recruiter's message, with no page to read again.
- **It reads each page politely**, as Job discovery does (ADR-0002): robots.txt first, as JobbboxBot, never a Forbidden site. It gives up at bot protection, a sign-in or `noindex`. It makes no AI call.
- **A heading is cleaned first** (#1154). A job board's `<h1>` often goes on past the title. The title ends with its gender marker (« H/F », « F/H/X », « (m/w/d) »), so the employer or recruiting firm after it is left out. The site's own name (`og:site_name`) at its end is left out too, and so is a parenthesis the page cut off (« … PME (m »). A careers page's own heading (« Open Roles », « Nous rejoindre ») states no title.
- **A heading only replaces a title it has nothing in common with** (#1154), such as a slogan. A heading that holds the title, or that the title holds, only says it otherwise: a place added, « Senior » left out, other case or accents. The title is then left as it is and counted `heading_overlaps_title`. A JobPosting's `title` replaces any other.
- **It changes a title only when the page states another one.** A page that states none (no JobPosting, no posting heading) or cannot be read is left as it is. The summary line counts these by reason (`gone`, `robots`, `no_stated_title`, `unreachable`…).
- **Never a Candidate's own title.** A Candidate who renamed their Application (`application.job_title`, ADR-0117) keeps their title. The script reads and writes only `job_offer.title`. Other Candidates see the corrected title.
- **It is idempotent.** Run again, a Job Offer whose title is already the one its page states is counted « déjà juste » and left alone. A Job Offer whose title changed between the read and the write is left for the next run.
- **It keeps each change** in `job_offer_title_correction` (Job Offer, title before, title after, `job_posting` or `heading`, date). That table lets you read the changes back or undo one by hand:

```sql
UPDATE job_offer o SET title = c.title_before
  FROM job_offer_title_correction c
 WHERE c.job_offer_id = o.id AND c.id = <id> AND o.title = c.title_after;
```

## Checking the dry run

Each line reads `à corriger <id> : « before » → « after » (job_posting|heading)`. A `job_posting` title is the posting's own. Look closer at `heading` titles: on some sites the posting's `<h1>` is not the job title. The first dry run on the Beta (2026-11-26) proposed 62 changes, 61 of them from headings that added the employer to the title: #1154 is the fix. If a page gives a wrong one, apply with `--limit` past it, or undo that line afterwards with the query above.

## On the VPS

The `migrate` image holds the script. From the environment's folder, with the environment's names set as in [consumption-backfill.md](consumption-backfill.md#on-the-vps):

```sh
docker compose -f app/deploy/compose.yml -p "$JOBHUB_SLUG" --env-file .env run --rm --no-deps migrate \
  node_modules/.bin/tsx apps/web/scripts/retitle-job-offers.ts            # then again with --apply
```

The `migrate` service must reach the sites, as the worker does for Job discovery.

## Staging from GitHub, without the VPS

For the Beta only, the `retitle-job-offers.yml` workflow runs the **dry run** over SSH, with the `staging` Environment's secrets, as `consumption-backfill.yml` does. It uses the `migrate` image of the commit the Beta serves, and refuses to overlap a deployment of staging. It has no way to `--apply`: that stays a hand step on the VPS, once the list is checked.

```sh
gh workflow run retitle-job-offers.yml               # dry run, every shared Job Offer
gh workflow run retitle-job-offers.yml -f limit=50   # at most 50, oldest first
```

The list is in the run's log.
