# EU hosting target

Decision: ADR-0007 (all data stored in the EU, provider-agnostic AI). This page records where Jobbbox runs.

## Target: AWS, region eu-west-3 (Paris)

| Piece | Service | Region |
| --- | --- | --- |
| Web app (`apps/web`, Next.js `output: "standalone"`) | Container on ECS Fargate behind an ALB | eu-west-3 |
| Background-job runner (`apps/worker`, `apps/worker/Dockerfile`) | Container on ECS Fargate | eu-west-3 |
| Database (Postgres, also holds the job queue) | RDS for PostgreSQL 17, encrypted, automated backups | eu-west-3 |
| Files (uploaded CVs, exported documents) | S3, encrypted, versioned | eu-west-3 |
| Transactional email (magic links, Job Digests) | SES | eu-west-3 |
| Claude (default AI provider) | Bedrock | eu-west-3 |
| Logs and metrics | CloudWatch | eu-west-3 |

Rules:
- Every resource that stores or processes personal data (CVs, Profiles, Applications, Tailored Documents) is created in an EU region. No cross-region replication outside the EU.
- Backups and snapshots stay in eu-west-3 (or another EU region for disaster recovery, e.g. eu-central-1).
- AI calls with personal data only go to EU-resident endpoints (ADR-0007). Perplexity only receives search queries.
- The browser extension is distributed through the Chrome Web Store; it holds no data beyond the session and talks only to the EU-hosted API.

## Staying portable

The deployable units are two plain containers and a Postgres database, with no AWS-specific code in the apps. Moving to another EU provider (Scaleway fr-par, OVHcloud) means re-creating those three pieces there, plus switching Claude to Vertex AI EU or Mistral.

## Local equivalent

`docker compose up -d` runs Postgres and the worker; `npm run dev` runs the web app. See the README.
