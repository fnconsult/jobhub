# EU hosting

Decision: ADR-0007 (all data stored in the EU, provider-agnostic AI). This page records where Jobbbox runs.

## Now: Hostinger VPS (Paris)

Staging (`staging.jobbbox.ai`) and production run on one Hostinger VPS in Paris (`vps.fnconsult.co`), shared with other apps behind its Traefik. Each environment is one Docker Compose stack (`deploy/compose.yml`): Postgres (its own volume), a one-shot `migrate`, the web app and the worker. Email intake's MTA is one more stack, shared by both (below).

| Environment | Folder on the VPS | Compose project | GitHub Environment |
| --- | --- | --- | --- |
| staging | `/opt/jobbbox/staging` | `jobbbox-staging` | `staging` |
| production | `/opt/jobbbox/production` | `jobbbox-production` | `production` |

Each folder holds `.env` (every application secret, mode 600, only on the VPS; keys in `.env.example` plus `POSTGRES_PASSWORD`) and `app/`, the checkout of the deployed commit. `DATABASE_URL` and `APP_URL` are set by the compose file.

Deploying is manual: `gh workflow run deploy.yml -f target=staging` (production also needs `-f confirm=jobbbox.ai`). `.github/workflows/deploy.yml` refuses a commit CI has not passed on, builds the `web`, `migrate`, `worker` and `mta` images and pushes them to GHCR (`ghcr.io/fnconsult/jobhub/*:<sha>`), then connects to the VPS as `jobbbox-deploy`, checks out the commit and runs `deploy/deploy.sh`: pull, migrate, start, wait for `/api/health`. The images carry the commit and the target they were built for (`JOBHUB_COMMIT`, `JOBHUB_TARGET`, #559); with the Version, bundled from the root `package.json`, `/api/health` answers them (`{ status, version, commit, environment }`), and the Back Office and Mon compte show « X.Y.Z (main·sha) » on the Beta, « X.Y.Z » in Production. The VPS builds nothing. A push to `main` deploys nothing.

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

## Later: AWS, region eu-west-3 (Paris)

| Piece | Service | Region |
| --- | --- | --- |
| Web app (`apps/web`, Next.js `output: "standalone"`) | Container on ECS Fargate behind an ALB | eu-west-3 |
| Background-job runner (`apps/worker`, `apps/worker/Dockerfile`) | Container on ECS Fargate | eu-west-3 |
| Database (Postgres, also holds the job queue) | RDS for PostgreSQL 17, encrypted, automated backups | eu-west-3 |
| Files (uploaded CVs, exported documents) | S3, encrypted, versioned | eu-west-3 |
| Transactional email (magic links, Job Digests) | SES | eu-west-3 |
| Claude (default AI provider) | Bedrock (Claude Opus 5; bedrock-mantle is not served in eu-west-3) | eu-north-1 |
| Logs and metrics | CloudWatch | eu-west-3 |

Rules:
- Every resource that stores or processes personal data (CVs, Profiles, Applications, Tailored Documents) is created in an EU region. No cross-region replication outside the EU.
- Backups and snapshots stay in eu-west-3 (or another EU region for disaster recovery, e.g. eu-central-1).
- Every AI call is redacted of the Candidate's identity before it leaves (ADR-0007, amendment of 2026-10-20); an AI provider may be outside the EU when an Administrator configures or chooses it. Web-search providers only receive search queries.
- The browser extension is distributed through the Chrome Web Store; it holds no data beyond the session and talks only to the EU-hosted API.

## Staying portable

The deployable units are two plain containers and a Postgres database, with no AWS-specific code in the apps. Moving to another EU provider (Scaleway fr-par, OVHcloud) means re-creating those three pieces there, plus switching Claude to Vertex AI EU or Mistral.

## Local equivalent

`docker compose up -d` runs Postgres and the worker; `npm run dev` runs the web app. See the README.
