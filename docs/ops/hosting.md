# EU hosting

Decision: ADR-0007 (all data stored in the EU, provider-agnostic AI). This page records where Jobbbox runs.

## Now: Hostinger VPS (Paris)

Staging (`staging.jobbbox.ai`) and production run on one Hostinger VPS in Paris (`vps.fnconsult.co`), shared with other apps behind its Traefik. Each environment is one Docker Compose stack (`deploy/compose.yml`): Postgres (its own volume), a one-shot `migrate`, the web app, the worker and `edge`. Email intake's MTA is one more stack, shared by both (below).

| Environment | Folder on the VPS | Compose project | GitHub Environment |
| --- | --- | --- | --- |
| staging | `/opt/jobbbox/staging` | `jobbbox-staging` | `staging` |
| production | `/opt/jobbbox/production` | `jobbbox-production` | `production` |

Each folder holds `.env` (every application secret, mode 600, only on the VPS; keys in `.env.example` plus `POSTGRES_PASSWORD`) and `app/`, the checkout of the deployed commit. `DATABASE_URL` and `APP_URL` are set by the compose file.

Deploying is manual: `gh workflow run deploy.yml -f target=staging`. Production deploys only a Version's tag `vX.Y.Z` on the `prod` branch, from the Promotion the product owner runs (`docs/ops/promotion.md`, ADR-0063); it also needs `-f confirm=jobbbox.ai`. `.github/workflows/deploy.yml` refuses a commit CI has not passed on, builds the `web`, `migrate`, `worker` and `mta` images and pushes them to GHCR (`ghcr.io/fnconsult/jobhub/*:<sha>`), then connects to the VPS as `jobbbox-deploy`, checks out the commit and runs `deploy/deploy.sh`: pull, migrate, start, wait for `/api/health`. The images carry the commit and the target they were built for (`JOBHUB_COMMIT`, `JOBHUB_TARGET`, #559); with the Version, bundled from the root `package.json`, `/api/health` answers them (`{ status, version, commit, environment }`), and the Back Office and Mon compte show « X.Y.Z (main·sha) » on the Beta, « X.Y.Z » in Production. The VPS builds nothing. A push to `main` deploys nothing. The browser extension is not deployed here: its two store builds, tied to Production and to the Beta, are published by hand (`docs/ops/extension.md`).

Staging may deploy a commit of `main` other than the ref's head: several PRs reach `main` every hour and CI takes close to an hour, so its head often has no green CI yet. `gh workflow run deploy.yml --ref main -f target=staging -f sha=<sha>` deploys that commit (short or full SHA), and `-f sha=latest-green` the newest commit of `main`'s history with a successful `ci.yml` run on `main`. The `check` job refuses a commit that is not on `main` (GitHub's comparison `compare/<sha>...main` must be `identical` or `ahead`) or that CI has not passed on, and refuses `sha` with `target=production`, which keeps its own rule above. Without `sha`, the ref's head is deployed as before. The `deploy-staging` skill (`.claude/skills/deploy-staging/SKILL.md`) picks `main`'s newest green commit itself, passes it as `-f sha=…` and says which one it deployed. Whatever the commit, the images' tag, the `JOBHUB_COMMIT` that `/api/health` reports, the VPS checkout and the GitHub Deployment record all name it, never the ref's head: both jobs that use the GitHub Environment set `deployment: false`, and the `deploy` job writes the Deployment record for that commit itself (`in_progress`, then `success`, `failure` or `inactive`). An environment with a custom deployment protection rule (a GitHub App) fails at once with `deployment: false`: add one only together with a change to this workflow.

### When the web app does not answer (`edge`)

Traefik routes the host to the web container only while it is healthy. A deploy, a crash or a failing health check leaves the host with no route, and Traefik would answer its bare `404 page not found`. The `edge` container (nginx, `deploy/edge/`, ADR-0094) takes the host at the lowest priority meanwhile: a 503 with Jobbbox's page in both languages (the URL's language first), which reloads itself every 15 s, or `{"error":"unavailable"}` under `/api`. When the routed container does not answer, the web router's `errors` middleware shows the same page for Traefik's 502 and 504. The API's router has no such middleware, so its JSON passes untouched. The pages are generated: change `apps/web/src/edge/pages.ts`, then `npm run edge-pages -w @jobhub/web`. `deploy.sh` starts and reloads `edge` before it replaces the web container, so a change to `deploy/edge/` takes effect with the next deploy. To check it on the VPS: `docker compose -p jobbbox-staging ps edge`. A host that the DNS points at the VPS but no environment serves still gets Traefik's own answer, since that is Traefik's configuration, outside the repo.

Setting up an environment (GitHub Environment, SSH key, folder, `.env`): `scripts/setup/deploy-vps.sh` (`TARGET=production` for production).

### Email intake's MTA (port 25)

Email intake receives the emails Candidates forward on Jobbbox's own MTA (#580): Haraka (`apps/mta`), one for the whole VPS since only one process can listen on port 25. It runs as its own Compose project, `jobbbox-mta` (`deploy/mta/compose.yml`), with its configuration in `/opt/jobbbox/mta/.env` (mode 600, readable by `jobbbox-deploy`). `deploy/deploy.sh` pulls and starts it during the deployment of the environment its `MTA_DEPLOYED_BY` names (staging today); its image (`ghcr.io/fnconsult/jobhub/mta:<sha>`) is built with the others.

| | |
| --- | --- |
| DNS (GoDaddy) | `mx.jobbbox.ai` A `72.61.106.167` (no AAAA: Docker's NAT keeps an IPv4 sender's address, SPF needs it); each Email intake domain MX 10 `mx.jobbbox.ai.` (`alertes.staging.jobbbox.ai` now, `alertes.jobbbox.ai` with #457) |
| Firewall | 25/tcp open in ufw (IPv4 and IPv6) |
| Routes | `INTAKE_ROUTE_<n>_DOMAIN`, `_URL` (`http://jobbbox-<env>-web:3000/api/email-intake/inbound`, the web container's alias on the Traefik network) and `_SECRET` (that environment's `EMAIL_INTAKE_INBOUND_SECRET`, as entered in Clés) |
| Limits | mail for the routes' domains only (550 otherwise: no relay), 10 MB per message, STARTTLS offered (self-signed unless a certificate is mounted at `/etc/haraka-tls`) |
| Disk | none: read-only container, emails in memory until the app has them; an app failure is a 450, so the sender retries |

Setting it up: `scripts/setup/issue-580.sh`. Checking it from outside: `node apps/mta/scripts/probe.mjs mx.jobbbox.ai alertes.staging.jobbbox.ai`.

### Motions (media.jobbbox.ai)

The Explainer Videos are files in a Scaleway Object Storage bucket in `fr-par` (`media.jobbbox.ai`), served over HTTPS
by Scaleway Edge Services at `https://media.jobbbox.ai`, never by the VPS (ADR-0066). The `motions` workflow publishes
them: `docs/ops/motions.md`. The Help Centre plays them from the origin the Platform Setting `HELP_MEDIA_ORIGIN` names
(Paramètres, « Environnement »; `https://media.jobbbox.ai` by default), which every page's Content-Security-Policy
`media-src` allows, and nothing else (#568). The web server reads the bucket's `manifest.json` (at most once a minute) to
know which video each Tutorial shows; a viewer's browser asks the bucket for the poster, then the video and its captions
once played. Scaleway is on the Recipient list as an EU host (`HOSTS` in `packages/shared/src/tools.ts`).

## Later: AWS, region eu-west-3 (Paris)

| Piece | Service | Region |
| --- | --- | --- |
| Web app (`apps/web`, Next.js `output: "standalone"`) | Container on ECS Fargate behind an ALB | eu-west-3 |
| Background-job runner (`apps/worker`, `apps/worker/Dockerfile`) | Container on ECS Fargate | eu-west-3 |
| Database (Postgres, also holds the job queue) | RDS for PostgreSQL 17, encrypted, automated backups | eu-west-3 |
| Files (uploaded CVs, exported documents) | S3, encrypted, versioned | eu-west-3 |
| Transactional email (magic links, Job Digests) | SES | eu-west-3 |
| Claude (default AI provider) | Claude's direct API (Anthropic, outside the EU, after Redaction), not Bedrock: Bedrock was turned down (ADR-0007, amendment of 2026-10-28). The identity route under EU AI Consent and the `euOnly` tasks go to Mistral (`api.eu.mistral.ai`, EU). | — |
| Logs and metrics | CloudWatch | eu-west-3 |

Rules:
- Every resource that stores or processes personal data (CVs, Profiles, Applications, Tailored Documents) is created in an EU region. No cross-region replication outside the EU.
- Backups and snapshots stay in eu-west-3 (or another EU region for disaster recovery, e.g. eu-central-1).
- Every AI call is redacted of the Candidate's identity before it leaves (ADR-0007, amendment of 2026-10-20); Claude's direct API, the default for every task, is outside the EU (amendment of 2026-10-28), and the Recipient list (`/legal/destinataires`) names it with its safeguard. Web-search providers only receive search queries.
- The browser extension is distributed through the Chrome Web Store; it holds no data beyond the session and talks only to the EU-hosted API.

## Staying portable

The deployable units are two plain containers and a Postgres database, with no AWS-specific code in the apps. Moving to another EU provider (Scaleway fr-par, OVHcloud) means re-creating those three pieces there, Claude's direct API and Mistral are reached the same way from anywhere.

## Local equivalent

`docker compose up -d` runs Postgres and the worker; `npm run dev` runs the web app. See the README.
