# Jobbbox (jobhub)

Coaching platform for job seekers aged 40+ in France. Vocabulary: [`CONTEXT.md`](CONTEXT.md). Decisions: [`docs/adr/`](docs/adr/).

## Layout

| Workspace | What it is |
| --- | --- |
| `apps/web` | Next.js web app |
| `apps/extension` | Chrome MV3 extension (WXT) |
| `apps/worker` | Background-job runner (pg-boss on Postgres) |
| `packages/shared` | Domain types, translations (`@jobhub/shared/i18n`) and design tokens (`@jobhub/shared/design`) |
| `packages/ai` | Provider-agnostic AI layer (`@jobhub/ai`, server-side only): Anthropic, Mistral, OpenAI, Perplexity; fake provider in `@jobhub/ai/testing` |

## Getting started

Requires Node 22+ and Docker.

```sh
npm install
cp .env.example .env
docker compose up -d          # Postgres (host port 5433) + worker
npm run db:migrate            # create / upgrade the database tables
npm run dev                   # web app on http://localhost:3000
npm run dev -w @jobhub/extension   # extension, with a Chrome dev profile
```

## Agent Run log

Delivery workflows (e.g. `wf-dev`) can record each Agent Run in the `workflow_agent_run` table (after `npm run db:migrate`):

```sh
npm run wf:record -- --issue 31 --workflow-id wf-dev --workflow-ref .claude/workflows/wf-dev.js \
  --workflow-instance wf_c2d1ad6a-1bc --workflow-date 2026-10-06T08:00:00Z \
  --agent "wf-dev/#31/implement" --model claude-opus-5-5 --effort high \
  --time-ms 754000 --round 0 --tokens 182345
```

`--round` defaults to 0 (first pass). `--workflow-date` is an ISO 8601 date (`2026-10-06`, read as UTC midnight) or a date-time with an explicit offset (`Z` or `+02:00`). Exits with code 2 and the usage line when a flag is missing or invalid.

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
- **AI calls (ADR-0007)**: always through `@jobhub/ai` (`createAiLayerFromEnv()` → `generate` / `searchWeb`), never a provider SDK directly. The provider of each task is set by `AI_<TASK>_PROVIDER` / `AI_<TASK>_MODEL` (see `.env.example`). Tasks that carry personal data refuse non-EU endpoints at start-up and on every call; web search only ever receives a query built from Search Criteria. Every call logs its token usage per Candidate (`ai_usage` JSON lines). Tests use `createFakeProvider` from `@jobhub/ai/testing`, or `AI_FAKE=true`.
- **Candidate accounts**: passwordless (magic link + Google, ADR-0008) in `apps/web/src/auth` (Better Auth, ADR-0011). Sign in at `/connexion`; in development the magic link is printed in the `npm run dev` log. The extension shares the web app's session through its host permission on `WXT_WEB_ORIGIN`; list the extension's `chrome-extension://<id>` origin in `EXTENSION_ORIGINS`.
- **Profiles from a CV**: `/profils/nouveau` uploads a PDF or Word (.docx) CV. `draftFromCv` (`apps/web/src/cv`) reads it into a draft Master CV and Search Criteria (AI task `cv_parsing`, with a rule-based fallback); the Candidate reviews it, and `createProfiles` (`apps/web/src/profiles`) saves it as a Profile with version 1 of its Master CV. No LinkedIn import (ADR-0001).
- **Hosting**: EU only, see [`docs/ops/hosting.md`](docs/ops/hosting.md).
