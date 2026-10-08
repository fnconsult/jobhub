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
cp .env.example .env          # repo-root .env, read by `npm run dev`, `build`, `start` and `db:migrate`
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
- **AI calls (ADR-0007)**: always through `@jobhub/ai` (`createAiLayerFromEnv()` → `generate` / `searchWeb` / `searchCompany`), never a provider SDK directly. The provider of each task is set by `AI_<TASK>_PROVIDER` / `AI_<TASK>_MODEL` (see `.env.example`). Tasks that carry personal data refuse non-EU endpoints at start-up and on every call; web search only ever receives a query built from Search Criteria, or from an employer's name for a Company Dossier (`searchCompany`; never a person's name, see the ADR-0007 amendment). Every call logs its token usage per Candidate (`ai_usage` JSON lines). Tests use `createFakeProvider` from `@jobhub/ai/testing`, or `AI_FAKE=true`.
- **Candidate accounts**: passwordless (magic link + Google, ADR-0008) in `apps/web/src/auth` (Better Auth, ADR-0011). Sign in at `/connexion`; in development the magic link is printed in the `npm run dev` log. The extension shares the web app's session through its host permission on `WXT_WEB_ORIGIN`; list the extension's `chrome-extension://<id>` origin in `EXTENSION_ORIGINS`.
- **Company Dossier**: `apps/web/src/company-dossiers` builds the dossier of an Application's employer from public data only. French employers are matched to a SIREN and read from the INSEE SIRENE register (`french-register.ts`, executives by role only); foreign ones come from `searchCompany` and are labelled less reliable, each fact kept only if it has the expected shape. A sole trader or unlisted SIREN is refused (`not_a_company`) before any search. A Presumed Employer is looked up only after the Candidate confirms it. Shown on `/candidatures/[id]`; API: `/api/applications/[id]/company-dossier` and `.../company-dossier/employer`.
- **Profiles from a CV**: `/profils/nouveau` uploads a PDF or Word (.docx) CV. `draftFromCv` (`apps/web/src/cv`) reads it into a draft Master CV and Search Criteria (AI task `cv_parsing`, with a rule-based fallback); the Candidate reviews it, and `createProfiles` (`apps/web/src/profiles`) saves it as a Profile with version 1 of its Master CV. No LinkedIn import (ADR-0001).
- **Master CV editor**: `/profils/[id]/cv` edits a Master CV, `/profils/[id]/versions` lists its versions and restores one. `saveMasterCv`, `masterCvVersions` and `restoreMasterCv` (`apps/web/src/profiles`) are scoped to the Candidate; a save based on an outdated version is refused (ADR-0012). API: `PUT /api/profiles/[id]/master-cv` and `POST /api/profiles/[id]/master-cv/restore`.
- **Several Profiles**: a Candidate creates a Profile from a CV or from scratch (`/profils/nouveau`), duplicates, renames, archives or restores it from its page (`PATCH /api/profiles/:id`, `POST /api/profiles/:id/duplicate`), and moves between active Profiles with the Profile switcher in the workspace header. The number of active Profiles respects the Plan Quota: the app passes billing's `profiles` limit to `createProfiles(database, { profileQuota })` (`profilePlanQuota`, `apps/web/src/profiles/plan-quota.ts`). A refused create, duplicate or restore answers 409 `{ error: "plan_quota_reached", prompt }`, where `prompt` is the Upgrade Prompt from billing's `allowsAnother`; the review form, the Profile page and `/profils/nouveau` show it.
- **Job Offers and Match Score**: `POST /api/job-offers` captures a Job Offer without an account (`apps/web/src/job-offers`); `POST /api/match-score` scores it (`apps/web/src/match-score`), against a Profile (`profileId`, signed in) or a CV sent in the request (Guest or Tailored CV, scored and never stored, ADR-0003). Each Match Score a signed-in Candidate requests counts against their Plan Quota (`matchScoreQuota`, wired to billing's `use(candidateId, "matchScores")` in `match-score/server.ts`, asked only once the Job Offer and CV are found); past it the route answers 402 with the Upgrade Prompt, which the extension's analysis page shows. A Guest's Match Scores are not counted, and an Application's Match Score, recomputed when it is shown, is not either. `POST /api/cv/draft` also reads a Guest's CV, by rules only (no AI, nothing saved). The extension (`apps/extension`) detects offers on the sites listed in `JOB_SITES` (`src/job-page.ts`), captures any other page by hand (`activeTab`), and keeps the Guest session (CV, offer) in session storage for at most `GUEST_RETENTION_HOURS` (ADR-0003); the worker job `guests.forget` runs every 15 minutes and deletes Guest-only Job Offers (`apps/web/src/job-offers/guest-retention.ts`, imported by the worker by relative path and copied in its Dockerfile). The scoring rules live in `scoreMatch` (`packages/shared/src/match-score`) so the extension and the web app score the same way (ADR-0013).
- **Onboarding without a CV**: `/profils/nouveau` offers both paths. The Onboarding Questionnaire (`apps/web/src/questionnaire`, pure: `startQuestionnaire` / `currentQuestion` / `answer` / `draftFromQuestionnaire`) asks one question at a time and gives the same `CvDraft` as `draftFromCv`, so both paths share the review form and `createProfiles`. Question wording lives in the catalogue (`questionnaire.questions.<id>`).
- **Coach Panel**: on every page a signed-in Candidate sees (root layout). A page declares what it shows with `<CoachInView kind="profile" id name />`; `createCoach` (`apps/web/src/coach`, AI task `coaching`) reads that Profile, scoped to the Candidate, into the AI Coach's context. `POST /api/coach`.
- **Action Cards**: `createActionCards(database, { onAccept })` (`apps/web/src/action-cards`) — `propose` a card about a Profile or Application, list `pending` cards for a page, `decide` once (accept runs the kind's handler in the same transaction). Shown on the Profile page by `ActionCardList`; `POST /api/action-cards/:id` `{ decision }`. Each new kind (ATS Fix, Follow-up…) registers its handler in `apps/web/src/action-cards/server.ts`.
- **Cover Letter and Outreach Message** (`apps/web/src/tailored-documents`): on `/candidatures/[id]` the AI Coach (AI task `writing`) drafts a Cover Letter and an Outreach Message (channel `email` or `inmail`), stored on the Application. The Document Language defaults to the Job Offer's (`jobOfferLanguage`, `packages/shared/src/document-language`). With a Company Dossier built, the Outreach Message names its Suggested Contact Roles. The Candidate edits a draft, drafts again (replaces it), copies it or opens it in their mail client (`mail-link.ts`, `mailto:`). Nothing is sent (ADR-0005). API: `GET`, `POST` (draft) and `PATCH` (edit) `/api/applications/[id]/tailored-documents`.
- **Plans and Plan Quotas (ADR-0014)**: `apps/web/src/billing` (`createBilling` → `entitlements`, `use`, `allowsAnother`, Stripe checkout / portal / webhooks, `setPlanQuotas`). Before doing metered work, call `use(candidateId, "matchScores" | "atsScores" | "enrichedContacts")` (or `allowsAnother(candidateId, "profiles", held)`); on a refusal, answer with `quotaExceededResponse` (API, 402) or render `<UpgradePrompt>` (pages). Plans come from Stripe webhooks; quotas are edited by Administrators (`ADMIN_EMAILS`) at `/admin/quotas`. Tests and e2e use the fake Stripe API in `apps/web/src/billing/fake-stripe.ts`. To set up Stripe (test mode) and the Administrators for local development, run `scripts/setup/issue-22.sh`.
- **Job discovery (ADR-0002)**: `createJobDiscovery({ ai, jobOffers }).discover(...)` (`apps/worker/src/job-discovery`) searches via `searchWeb`, fetches pages politely (`JobbboxBot`, robots.txt, no CAPTCHA/login/challenge bypass, no private addresses, Forbidden sites refused) and stores Job Offers through `apps/web/src/job-offers`. It reports found offers and skipped pages with reasons. The worker job `job-discovery.run` (`{ candidateId, profileId }`) uses the Profile's current Search Criteria; nothing schedules it yet. To set up the Perplexity and offer-analysis keys for local development, run `scripts/setup/issue-13.sh`.
- **Hosting**: EU only, see [`docs/ops/hosting.md`](docs/ops/hosting.md).
