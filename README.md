# Jobbbox (jobhub)

Coaching platform for job seekers aged 40+ in France. Vocabulary: [`CONTEXT.md`](CONTEXT.md). Decisions: [`docs/adr/`](docs/adr/).

## Layout

| Workspace | What it is |
| --- | --- |
| `apps/web` | Next.js web app |
| `apps/extension` | Chrome MV3 extension (WXT) |
| `apps/worker` | Background-job runner (pg-boss on Postgres) |
| `packages/shared` | Domain types, translations (`@jobhub/shared/i18n`) and design tokens (`@jobhub/shared/design`) |

## Getting started

Requires Node 22+ and Docker.

```sh
npm install
cp .env.example .env
docker compose up -d          # Postgres (host port 5433) + worker
npm run dev                   # web app on http://localhost:3000
npm run dev -w @jobhub/extension   # extension, with a Chrome dev profile
```

## Checks (also run in CI)

```sh
npm run lint        # includes the "no hard-coded user-facing strings" rule
npm run typecheck
npm test            # worker integration tests run when DATABASE_URL is set
npm run build
npx playwright install chromium   # once
npm run test:e2e    # e2e: built web app, built extension, docker compose stack (E2E_SKIP_DOCKER=1 to skip)
```

## Conventions

- **Translations**: every user-facing string lives in `packages/shared/src/i18n/locales/*.json`. French (`fr`) is the default and reference locale; every locale must have the same keys.
- **Accessibility (ADR-0009)**: colours and type come from `packages/shared/src/design/tokens.ts`. `auditDesignTokens` checks WCAG 2.1 AA contrast, the 16px body-text floor and every text-size setting in the test suite. Light greys are for surfaces and borders only.
- **Hosting**: EU only, see [`docs/ops/hosting.md`](docs/ops/hosting.md).
