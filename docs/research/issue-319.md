# Research for issue #319: what each result, run and Coach reply stores, and how steps reach the page live

Checked 2026-10-23 on branch `ai-provenance-map` (`084fbf61`). Repo paths are relative to the root. Claims about third-party libraries that could not be checked here (no `node_modules` in this worktree) are marked **Unverified**.

## 0. Corrections to the map (#314) and #316

- **The ATS Fixes are not AI.** `proposeAtsFixes` and `scoreAts` are rules in `packages/shared/src/ats-score/fixes.ts:149` and `score.ts:95`. The card text comes from i18n (`apps/web/src/ats-score/card-text.ts:5`). Nothing in `apps/web/src/ats-score` or `action-cards` calls the AI layer. No call site uses the `scoring` task (`git grep 'task: "scoring"'` only matches the doc comment `packages/ai/src/index.ts:6`). So an `ats_fix` Action Card is **compute** only. The only Action Card an AI writes is the Follow-up (`follow-ups/index.ts:183`, text from `follow-ups/draft.ts:76`, `writing`).
- **`coach_message` does not store the focus.** Its columns are `coach-conversations/index.ts:384-408`: there is no focus and no page object. The focus reaches the reply (`:160`), but only `coach_conversation.profile_id` is kept (`:174-177`, `:374-381`). #316 answer 8 ("replies given while the page's object was in view") therefore needs a new `focus_kind`, `focus_id` pair on the coach row.
- **The Coach makes no web search during a reply.** Its calls are: the Playbook Agent choice (`coach/playbook-agents.ts:58`), up to two consultations (`:119`), the reply (`coach/index.ts:256`) and the Guardrail checks (`guardrails/index.ts:294`). When the latest message holds a link, the reply is replaced by a **page read** of that link (`coach/index.ts:268-276`, which goes through `job-offer-links/index.ts:84-90`: polite fetch, then `readJobPage` `offer_analysis`). The prototype's « Recherche web » step in a Coach reply has no counterpart in the code.
- **CONTEXT.md conflict.** **Coach Message Cost** is « Seen by Administrators only … never by Candidates », and it includes the tokens (`CONTEXT.md:101-103`). The pane shows tokens to the Candidate (#314 Decisions). The glossary entry needs amending to say the Candidate sees model, tokens and time, and never euros.
- **Glossary clash.** "Source" is the coaching `[S12]` (`CONTEXT.md:135`). The pane's « Sources » must have a different name in code and in the glossary. This doc calls them **Provenance sites**.
- Stale wording: the Bedrock Tool's note says « eu-west-3 par défaut » (`packages/shared/src/tools.ts:150`), but the code default is `eu-north-1` (`packages/ai/src/env.ts:40`).

## 1. Call sites, by task, and what each result keeps

| Feature (live action?) | Calls (task / Tool) | File:line | Result row | Keeps of {provider, model, usage} |
|---|---|---|---|---|
| Job Search (yes) | `job_titles` via `planJobSearch` | `worker/src/job-discovery/index.ts:492`, `packages/ai/src/ai-layer.ts:644` | `job_search` (`job-searches/index.ts:158-172`) | `metrics.costEur` only (`worker/src/jobs.ts:158`). The `costing` wrapper drops the rest (`job-discovery/index.ts:557-585`). |
| | `web_search` ×≤6+sites (`searchWeb`) | `job-discovery/index.ts:513` | same | same |
| | France Travail, Fantastic.jobs (`searchJobApi`) | `:533-537`, `:466-484` | same | `metrics.franceTravail` / `fantasticJobs` counts and cost (`jobs.ts:159-160`) |
| | ATS APIs Greenhouse/Lever/Ashby | `:412` (`ats.ts`) | `job_offer` | nothing |
| | page read (`job_site`, `apec`) + `offer_analysis` (`readJobPage`) | `:423`, `:453` | `job_offer` (summary, sector) | nothing (`job-offers/index.ts:437-472`) |
| Job Digest (worker cron, not live) | same discovery run, no `job_search` row | `worker/src/jobs.ts:299-318`, `job-digests/index.ts:560` | `job_digest` (`job-digests/index.ts:249-255`) | nothing. Run metrics only go to the log (`jobs.ts:324`). |
| Job Offer Summary (`/offres/[id]`, application) | `offer_analysis` (`readOfferFields`) | `app/api/applications/[id]/job-offer-summary/route.ts:30-32`, `job-offers/server.ts:22` | `job_offer.summary`, `summary_read_at` | nothing |
| Match Score, AI read | `offer_analysis` only when fields are missing | `match-score/index.ts:157-158`, `match-score/server.ts:22-24` | no row: the score is computed per request. The fields go to `job_offer` (`text_read_at`). | nothing |
| Match Score, ATS Score | rules (compute) | `packages/shared/src/ats-score/*` | `ats_score` (`ats-score/index.ts:181-186`) | none needed |
| Tailored CV (yes) | `writing` (translate words), `writing` (proposal, retried once) | `tailored-cv/index.ts:337`, `:419` → `reply.ts:69` | `tailored_cv.proposal` / `saved` jsonb (`tailored-cv/index.ts:492-498`, `:435`, `:482`) | nothing |
| Cover Letter / Outreach Message (yes) | `writing` | `tailored-documents/index.ts:313` | `tailored_document` (`:393-407`, insert `:353`) | nothing |
| Company Dossier (yes) | Recherche d'entreprises (register), `offer_analysis` (agency check), `web_search` facts, `web_search` news | `company-dossiers/index.ts:457-459`, `:477`, `:462`, `:442` | `company_dossier.dossier` jsonb (`:552-561`) | `source` ("french_register" / "web"), web `sources[]` (`:101`, `:297`), `news[].url` |
| Master CV from upload (yes) | `cv_parsing` | `cv/ai-reading.ts:75` (from `cv/index.ts:55`) | `master_cv_version.content` (`profiles/index.ts:522-529`) | nothing |
| Follow-up Action Card (worker cron) | `writing` | `follow-ups/draft.ts:76` | `action_card` (`action-cards/index.ts:169-181`) | nothing |
| Coach reply (yes) | `coaching` (choice, ≤2 agents, reply), `guardrail` checks, or a link read | see §0 | `coach_message` | `provider`, `model` of the answering call, tokens and cost **summed over all calls**, `consultations` [{playbookId, version, provider, model, tokens, eur}], `playbooks`, `job_offer_id` (`coach/index.ts:286-307`, `coach-conversations/index.ts:183-198`) |
| Coach Memory proposal | `coaching` | `coach-memory/index.ts:179` | coach memory proposal | nothing |
| Back Office Assistant (out of the pane) | `back_office_assistant` | `back-office-assistant/index.ts:451` | its own message table | provider, model, cost |

## 2. What the AI layer returns and what it records

- **Returned per text call:** `{text, provider, model, usage}` (`ai-layer.ts:87-92`, `:631`).
- **Returned per search:** `{answer, sources, sourceDates?, provider, model, usage}` (`:166-174`, `:572-579`).
- **Not returned at all:**
  - `searchCompanyNews` returns only the articles (`:189-190`, `:683-702`), so its provider, model and tokens are lost to the caller.
  - `planJobSearch` returns its call as `call: GenerateResult | null` (`:147`).
- **Known inside the layer but not returned:**
  - `endpoint`: `provider.endpoint` (`:420`). It is `"api.anthropic.com"`, `"bedrock eu-north-1"`, `"vertex <region>"` (`providers/anthropic.ts:121`), `"api.mistral.ai"`, the OpenAI host (`chat-completions.ts:101`, `:125`), `"api.perplexity.ai"` and so on. **The region is knowable per call**: one provider instance is one endpoint and one region.
  - `durationMs` (`ai-layer.ts:427`, `:450`).
  - `tools` (web searches counted, `:451`).
  - `outcome` and `warnings`.
- **The model that served** is the provider's answer, not the route: `message.model` (`anthropic.ts:149`), `completion.model` (`chat-completions.ts:107`), `response.model ?? "unknown"` (`perplexity.ts:131`). On Bedrock the id is named `anthropic.<model>` (`anthropic.ts:111`).
- **`UsageEntry`** has everything: provider, endpoint, model, tokens, outcome, reason, sent, `durationMs`, cost, tools, at (`types.ts:178-217`). The entry goes to `UsageLog.record`, fire-and-forget (`ai-layer.ts:400`).
- **Tables** (`apps/web/src/ai-usage/index.ts:378-467`):
  - `ai_usage(id uuid DEFAULT gen_random_uuid(), at, task, provider, endpoint, model, tokens, cost_eur, ok, duration_ms, outcome, reason, warnings)`;
  - `ai_tool_usage(usage_id → ai_usage)`;
  - `external_api_usage(at, provider, operation, ok, http_status, duration_ms, cost_eur)`;
  - `ai_message_log(usage_id, candidate_id ON DELETE CASCADE, system, messages, reply, …)`.

  Retention is 24 months for usage (`:23`, `:373-374`) and 30 days for the log (`:25`, `:368`).
- **Recording does not expose ids.** The insert runs after `nextTurn()` (`:85`), and the id is generated by the database (`:95`). The caller never learns a usage id, and the layer must not wait for it (ADR-0007 #218, `docs/adr/0007-eu-hosting-provider-agnostic-ai.md:59`).
- **External tools** go through `recordingFetch`. It times each call (`packages/shared/src/external-api-usage.ts:96-126`) but returns nothing of that to the caller. A page read is recorded as `page_read <domain>` (`page-reading/polite-fetch.ts:311-320`). So **per-run tool time has to be measured by the caller**, around `searchJobApi`, `readAtsPosting`, `fetcher.page` and `register.search`.

## 3. Storage options

**(a) A Provenance value object on each result (jsonb)**, written by the caller from what the layer returns.
- Pros:
  - It lives and dies with the result (ADR-0010 cascade), which matches #316's "whatever its date".
  - It joins nothing.
  - It is in the Candidate's export with the result.
  - It works for steps with no AI (rules, register, France Travail).
- Cons:
  - Every call site must pass it through.
  - The layer must return `endpoint` and `ms`.
- `job_offer` is shared and has no Candidate (`deletion-reach.test.ts:113-115`), so the provenance of its page read and summary must carry no Candidate id, which it does not need.

**(b) A `usage_id` link to `ai_usage`.**
- ADR-0007 #218 and the register say `ai_usage` names no one, and that a row can be joined to a Candidate only « for the 30 days its AI Message Log is kept … after that it is not » (`docs/privacy/register.md:58`, `:65`). A `usage_id` on `tailored_cv` or `coach_message` (each tied to a Candidate) would make every `ai_usage` row joinable to a Candidate for the result's whole life. That breaks the register's claim and the reason `ai_usage` is outside the export and survives account deletion. The test `candidate-data/deletion-reach.test.ts:98-111` guards the column side only, so a link would not fail it but would void its premise.
- **Retention mismatch.** `ai_usage` is purged at 24 months (`ai-usage/index.ts:373`), while results are kept as long as the account. Older elements would turn into « modèle non enregistré » by themselves.
- **Mechanics.** The id is created by the database after the call returns, asynchronously (`:85`, `:95`). Getting it back would mean awaiting the insert, which #218 forbids, or generating the uuid in the layer.
- Tools outside the layer (France Travail, ATS, register) have no `ai_usage` row, so (b) cannot cover them.

**(c) A hybrid** (a jsonb snapshot plus a `usage_id` for drill-down) inherits all of (b)'s privacy problem for a drill-down the Candidate never gets. Cost and prompts are out of scope (#314).

**Recommend (a).** The `ai_usage` boundary stays as it is. The Back Office keeps its own view through `ai_usage`.

### Proposed shape (`@jobhub/shared`, e.g. `provenance.ts`)

```ts
type Activity = "think" | "think_write" | "write" | "search" | "web_search" | "read" | "compute";
interface ProvenanceStep {
  activity: Activity;
  // An AI task, e.g. "writing"; or a Tool id from TOOLS (packages/shared/src/tools.ts), e.g. "france-travail".
  kind: "ai" | "tool" | "rules";
  task?: AiTask;
  tool?: string;
  // AI only. provider: ProviderId; endpoint: e.g. "bedrock eu-north-1"; model: the id that served.
  provider?: string;
  endpoint?: string;
  model?: string;
  // inputTokens = uncached + cached input.
  tokens?: { input: number; output: number };
  ms: number;        // this call's duration
  at: string;        // ISO start time
  outcome: "ok" | "warning" | "failed" | "stopped";
  count?: number;    // repeated calls folded into one step (e.g. 14 page reads of one site)
}
interface ProvenanceSite { label: string; links: string[] } // e.g. { label: "apec.fr", links: [offer page] }
interface Provenance { v: 1; steps: ProvenanceStep[]; sites: ProvenanceSite[]; startedAt: string; wallMs: number }
```

Columns: `provenance jsonb` (nullable, null meaning « non enregistré ») on:
- `job_search` (the run);
- `job_offer` (its read and summary);
- `tailored_cv`: one for the proposal and one for the save, since `saved` comes from the proposal, so the provenance is copied;
- `tailored_document`;
- `company_dossier`;
- `master_cv_version`: only the version created by a reading;
- `action_card`: the Follow-up, and `ats_fix` as `rules`;
- `coach_message`, with `focus_kind`, `focus_id`;
- `job_digest`, for its top-up run.

`ats_score` gets a fixed `rules` step and needs no column, but one is cheap for symmetry.

**Size.** A Job Search can make about 6 searches, up to 30 offers and many page reads (`job-discovery/index.ts:52-55`). Fold steps per (activity, task or tool, provider, model) with `count`, `tokens` and `ms` summed, and keep the per-offer detail on each `job_offer`. That keeps the row to a few dozen steps.

**AI layer change.** Add `endpoint` and `durationMs` (and `outcome`) to `GenerateResult` and `SearchResult`, and give `searchCompanyNews` a variant that returns the search's call. All of it is already computed in `recorded` (`ai-layer.ts:420-466`). The optional `onStep` sink of §4 then hands the step to the caller.

## 4. Live steps

**Today:**
- Job Search progress is polling only:
  - `JobSearchNotifications` fetches `/api/job-searches/notifications` every 5 s while `searching` (`components/JobSearchNotifications.tsx:26`, `:39-59`);
  - the Job Search page calls `router.refresh()` every 3 s (`components/JobSearchControls.tsx:160-166`).
- The worker writes `job_search` once, at the end (`job-searches/index.ts:203-221`, `worker/src/jobs.ts:226`).
- There is no SSE, WebSocket or `ReadableStream` route in `apps` (`git grep EventSource|text/event-stream|WebSocket` gives nothing).
- **What exists:**
  - pg `LISTEN/NOTIFY` with a reconnecting listener on one pooled connection per process (`apps/web/src/database/listen.ts:12-87`). It is used for Provider Secrets and Platform Settings (`platform-settings/index.ts:120`, `pg_notify`). Its `onChange` drops the payload (`:28-30`).
  - pg-boss 12 queues on the same database (`worker/src/job-runner.ts:28-40`, `apps/worker/package.json:16`).
  - Traefik in front of the containers (`docs/ops/hosting.md`).

**Options:**

| | How | For | Against |
|---|---|---|---|
| Poll a run row | The worker appends steps to `job_search.provenance` and a `progress` jsonb. The pane polls a small `/api/runs/:id` every 1–2 s. | Infra exists (the same pattern as the notifications). Works across the worker/web boundary. Survives reloads and page changes (« En cours ailleurs »). | 1–2 s lag. One query per tab per poll. |
| SSE from web, fed by NOTIFY | The worker appends a step, then `pg_notify('run_progress', runId)`. Web keeps **one** listener per process (a `listen.ts` with payload) and fans out to SSE streams per Candidate. | Instant, cheap per event. | New infra: streaming route handlers in Next 16 (read `node_modules/next/dist/docs` first, per `apps/web/AGENTS.md`), Traefik buffering and timeouts, reconnection. NOTIFY payloads are capped at 8000 bytes (https://www.postgresql.org/docs/current/sql-notify.html), so send ids only. |
| AI layer emits step events | An `onStep(started/ended)` callback in `GenerateRequest`/`SearchRequest`. | Exact times and models, in one place. | It is only the source of events, not a transport. Tools outside the layer still need the caller. |

**Recommend:**
- **The source.** The caller's own step recorder, a `ProvenanceRecorder` that wraps the AI layer the way `costing` already does (`job-discovery/index.ts:557`), plus `step(tool, activity, fn)` for the Tools. It both builds the stored Provenance and emits events.
- **Synchronous web actions** (Tailored Documents, Tailored CV, Company Dossier, CV reading, Coach): **stream the response itself**, as NDJSON or SSE on the same POST. The events go to the page that started the action, with no shared infra. The final event carries the result, and the client's abort is the Stop (§10).
- **Worker runs** (Job Search): **the worker writes `job_search.progress`** (the steps so far, the current step), and the pane **polls** it every 1.5 s while one is `searching`. This reuses the existing notifications poll, which becomes the « En cours ailleurs » feed.
- **Later.** If the lag matters, add NOTIFY plus SSE behind the same event shape without changing producers.

Event shape (both transports):
```json
{"type":"step_started","action":"job_search","id":"<runId>","step":{"activity":"web_search","task":"web_search","provider":"perplexity","at":"…"}}
{"type":"step_ended","action":"job_search","id":"<runId>","step":{…ProvenanceStep…},"result":{"found":3}}
{"type":"done"|"failed"|"stopped","id":"<runId>","wallMs":16200,"reason?":"discovery_failed"}
```
`step_started` carries no model for AI steps until the layer picks the route. Either the layer reports the route it chose before sending (from `routeForCall` and `providerFor`, `ai-layer.ts:596-597`), or the glyph shows the activity alone.

## 5. Activity mapping and logos

**The mapping is fixed in code**, keyed by AI task and Tool id, not per Playbook. A Playbook picks the model (ADR-0026 `docs/adr/0026-ai-task-instructions-live-in-task-playbooks.md:3`, `:31`; ADR-0021), not what kind of work the step is, and ADR-0026 keeps "what must not be editable" in code (`:9`). One exception: `writing` is a write, except that translating words for a Tailored CV (`tailored-cv/index.ts:337`) is a think. So map per **call site** (a feature step name), with the task as the default.

| Step | Activity |
|---|---|
| `job_titles` | think |
| `web_search` (searchWeb, searchCompany, news) | web_search |
| `cv_parsing` | read |
| `offer_analysis` in readJobPage (page → offer) | read |
| `offer_analysis` in readOfferFields (summary), Company Dossier agency check | think_write / think |
| `writing` (Tailored CV, Cover Letter, Outreach, Follow-up) | write |
| `coaching` choice, Playbook Agent | think |
| `coaching` reply | think_write |
| `guardrail` | compute (check) |
| France Travail, Fantastic.jobs, Recherche d'entreprises, ATS APIs (Greenhouse/Lever/Ashby) | search |
| job_site, apec page read | read |
| Match Score, ATS Score, ATS Fixes, freshness and dedup | compute |

**Logos.**
- The Tools catalog `TOOLS` (`packages/shared/src/tools.ts:122-530`) already names each external service with a stable `id`, one per endpoint for Claude (`anthropic`, `anthropic-bedrock`, `anthropic-vertex`).
- `toolOfUsage` maps (provider, endpoint) to a Tool (`:574-581`).
- Add an optional `logo` (an asset path under the web app) to `Tool`. Model logos are per provider (Claude, Mistral, OpenAI), with AWS's for Bedrock, a pair the catalog's ids already give.
- Site favicons (apec.fr, a career page) are not Tools. Use a small fixed set of known sites (`search_site` in `apps/web/src/search-sites`, `FORBIDDEN_SITES`), else a generic globe. There is no `public/` asset folder today.

## 6. Coach

- The Coach uses no tools today other than the AI calls and a link read (§0).
- `coach_message` keeps the answering model and the summed tokens (`coach-conversations/index.ts:183-198`). It has no endpoint, no time, no per-call split beyond `consultations`, no focus, and no link list.
- Store `provenance` (the steps: choice, agents, reply, guardrails, link read; sites: the link read, as `{label: domain, links:[url]}`) and `focus_kind`, `focus_id` on the coach row.
- Keep the existing cost columns, which the Admin aggregates read (`:293-348`).
- Time: the row's `created_at` is the time of day. `wallMs` goes in the provenance.
- The coaching `[Sn]` Sources stay a separate thing, already in `playbooks`.

## 7. Time

- Per call, `ms` is the layer's `durationMs` (`ai-layer.ts:450`), or the caller's timer for Tools.
- Per run, `wallMs` runs from start to the end of the run. The existing `job_search.metrics` already stores "the time since the Job Search started" (`job-searches/index.ts:187`), which can feed `wallMs`.
- As #316 decided: per model or tool, sum `ms`; for the Total and each action, use `wallMs`. With parallel calls (the Coach's two agents, `coach/index.ts:228`) the sum exceeds the wall-clock, which is expected.

## 8. Existing rows

**No faithful backfill:**
- results have no call id;
- `ai_usage` has no Candidate or result link (by design);
- `ai_message_log` is 30 days old at most and holds Candidate and time only.

Matching on time windows would be an estimate, which #316 answer 4 forbids. Show « modèle non enregistré » for `provenance IS NULL`. Two exceptions:
- `coach_message`: provider, model and tokens are exact, so build a partial provenance (one `coaching` step, no endpoint or time) at read time;
- `company_dossier`: `source` and web `sources[]` give the sites, without the model.

## 9. Links

**Where URLs exist today:**
- `job_offer.source_url` and `source_name` (`job-offers/index.ts:441-442`);
- web dossier `sources[]`, filtered to public pages, never a person's profile, at most 10 (`company-dossiers/index.ts:275-297`);
- `news[].url` with no social networks (`packages/ai/src/company-news.ts:86-93`);
- France Travail offers at their page URL (`job-discovery/index.ts:38`);
- ATS postings at their ATS page (`:39-44`).

The register dossier keeps no link. Its stable public page could be derived from the SIREN; the address form is **Unverified**.

**Risks:**
- **Tokenised or tracking URLs.** Search providers and job boards may return URLs with session or tracking parameters. `isPublicPage` checks only the scheme and host. Strip the query string, or keep only known-safe parameters.
- **Person pages.** Apply the same `PROFILE_HOSTS` filter (`company-dossiers/index.ts:273`) to every provenance link, not only to dossiers.
- **LinkedIn** (ADR-0001, `docs/adr/0001-no-linkedin-integration.md:3`). Job Offers from LinkedIn exist only when captured by the extension. A link back to that offer is the Candidate's own page and is acceptable, but never a `/in/` page.
- **`FORBIDDEN_SITES`** (`job-discovery/index.ts:242`): never shown as a site Jobbbox read.
- **Privacy.** Links are stored with the Candidate's result, so they are fine there. They must never go to `external_api_usage`, which stores domain only (`polite-fetch.ts:311`, `CONTEXT.md:602-604`).

## 10. Stop: the existing comment checked, and the design

The comment on #319 is **correct**. Each point was rechecked:
- no `AbortSignal` in `packages/ai/src` (grep);
- `TextInput` and `SearchOptions` have no signal (`types.ts:70-77`, `:126-131`);
- `requestJson` passes none (`providers/http.ts:28-32`), nor does `messages.create` (`anthropic.ts:127-133`);
- the Coach route ignores `request.signal` and saves after the reply (`app/api/coach/route.ts:17-26`, `coach-conversations/index.ts:155-201`);
- `job_search.status` takes `searching | done | failed` (`job-searches/index.ts:162`), and the offers are linked at the end only (`:203-221`, `worker/src/jobs.ts:226`);
- Tailored Documents and the Company Dossier run in the request;
- `billing.use` and `release` are at `billing/index.ts:857`, `:910`.

Additions:
- A **failed** Job Search drops its partial offers: `record` writes `job_offer_ids = []` when failed (`job-searches/index.ts:214`), although `JobDiscoveryError.partial` holds them (`job-discovery/index.ts:218-226`).
- The `WHERE status = 'searching'` guard (`:209`) means a `stopped` status written by the web makes the worker's later `record` a no-op. The worker must therefore write the stopped outcome itself.
- The Anthropic TS SDK accepts a per-request `signal` (`client.messages.create(body, { signal })`). This is **Unverified** here: SDK `^0.131.0`, see https://github.com/anthropics/anthropic-sdk-typescript. `fetch` accepts `signal` (https://developer.mozilla.org/en-US/docs/Web/API/RequestInit#signal).
- Whether pg-boss 12 hands the handler an AbortSignal on `cancel` is **Unverified**. Do not rely on it.
- The ATS Score and the Match Score never release (as the comment says). That is moot for Stop, since they are sub-second rules.

Minimal design per action:
1. **The AI layer.**
   - Add `signal?: AbortSignal` to `GenerateRequest`, `SearchRequest` and `CompanySearchRequest`, passed into `TextInput` and `SearchOptions`, then to `fetch` and the SDK.
   - An aborted call is recorded with outcome `failed`, a new Failure Reason `stopped` (ADR-0030 catalog), its `durationMs`, and no tokens. Providers do not report partial usage on abort, so this is an under-count; say so in the pane.
   - Since recording (#218) must never fail a call, keep the record non-blocking.
2. **The Coach.**
   - Turn the POST into a streamed response (§4). Pass `request.signal` to `coach.reply`, and from there to every `generate`.
   - On abort, save **neither** message: #316 says « nothing is saved as a reply ». Either keep the question client-side, or save the Candidate's message with no reply. Decide in #320. Today both are saved in one transaction (`coach-conversations/index.ts:169-201`), so skipping the transaction is enough.
   - There is no quota to release (the Coach has no Plan Quota).
3. **Tailored Documents, Tailored CV, CV reading, Company Dossier.**
   - Pass `request.signal` through. On abort, write nothing: a half document is discarded.
   - For the Company Dossier, the finished parts could be kept (#316 answer 10). Its build is a few calls in sequence (`company-dossiers/index.ts:437-469`), so for v1 discard and say « Arrêtée ».
   - None of these is quota-counted today.
4. **Job Search.**
   - `POST /api/job-searches/:id/stop` sets `stop_requested_at` (not the status).
   - The worker checks it between steps, inside `budgetSpent()` (`job-discovery/index.ts:342-345`), which is already polled between every search and page. On a stop it ends the run and calls `record(id, { stopped: true, jobOfferIds, metrics, provenance })`.
   - Add `'stopped'` to the CHECK (`job-searches/index.ts:162`).
   - Quota: `release` when `jobOfferIds` is empty (#316 answer 12).
   - `expireTimedOut` (`:236`) must leave a stop request alone, or treat it as stopped.
   - A notification is still shown: « Recherche arrêtée ».
   - Later, the same path lets a failed run keep its partial offers.

## Recommendation

1. **Storage.**
   - Add a shared **Provenance** value object (`{v, steps[], sites[], startedAt, wallMs}`, §3) as a nullable `provenance jsonb` on `job_search`, `job_offer`, `tailored_cv` (proposal and saved), `tailored_document`, `company_dossier`, `master_cv_version`, `action_card`, `job_digest` and `coach_message`.
   - Null means « modèle non enregistré ».
   - It holds no Candidate id, cost or text.
   - It goes in the Candidate export with its row: update `EXPORTED_TABLES` descriptions in `candidate-data/index.ts:287-290`.
2. **No `usage_id` link to `ai_usage`.** It would tie AI Usage to Candidates beyond 30 days, against ADR-0007 #218 and `register.md:58`, and it would dangle after 24 months.
3. **The AI layer** returns `endpoint`, `durationMs` and `outcome` with every result. `searchCompanyNews` exposes its call. Requests accept `signal`.
4. **A `ProvenanceRecorder`** (in `@jobhub/shared` or `@jobhub/ai`) wraps the layer like `costing`, and times Tools with `step(toolId, activity, fn)`. It builds the stored object and emits `step_started` / `step_ended`.
5. **The activity mapping is fixed in code**, per feature step and defaulting to the AI task (§5), never per Playbook. Add `logo` to `Tool` in `packages/shared/src/tools.ts`.
6. **Live.**
   - Web actions stream NDJSON or SSE on their own POST.
   - The worker's Job Search writes `job_search.progress`, and the pane polls it (1.5 s) while searching. This also feeds « En cours ailleurs ».
   - NOTIFY plus SSE stays an upgrade path behind the same event shape.
7. **`coach_message`** gains `provenance`, `focus_kind` and `focus_id`. Its old rows get a partial provenance from the existing columns.
8. **Stop:**
   - `signal` end to end;
   - a Failure Reason `stopped`;
   - a `stopped` Job Search via `stop_requested_at`, checked in `budgetSpent`;
   - quota released when nothing is kept;
   - the Coach saves nothing on abort.
9. **Docs.**
   - Amend **Coach Message Cost** (Candidate sees model, tokens and time).
   - Add **Provenance** and **Provenance site** to CONTEXT.md, and fix the ATS Fixes claim in #314.
   - Add an ADR: provenance on results, not a link to AI Usage.
   - Fix the stale `eu-west-3` note in `tools.ts:150`.

## Proposed implementation slices

| # | Slice | Effort | Depends on |
|---|---|---|---|
| 1 | ADR and CONTEXT: Provenance, Provenance site, Coach Message Cost amended, Failure Reason `stopped` | XS | – |
| 2 | AI layer returns `endpoint`, `durationMs`, `outcome`; `searchCompanyNews` exposes its call; `signal` threaded into the providers (Anthropic SDK, `requestJson`) with `stopped` recorded | S | 1 |
| 3 | `Provenance` type, `ProvenanceRecorder` (AI wrapper and Tool timer, folding), activity map, `Tool.logo` | S | 2 |
| 4 | Coach: provenance, `focus_kind` and `focus_id` stored; reply line under each reply; partial provenance for old rows | S | 3 |
| 5 | Coach live and Stop: streamed reply events, « Arrêter », nothing saved on abort | M | 4 |
| 6 | Tailored Documents and Tailored CV: provenance stored, streamed steps, Stop | M | 3 |
| 7 | Company Dossier and CV reading (Master CV version): provenance and sites, streamed steps, Stop | M | 3 |
| 8 | Job Offer provenance (page read, ATS, France Travail and Fantastic.jobs, summary) from the worker and the web's link read and summary | S | 3 |
| 9 | Job Search: run provenance, `job_search.progress` written per step, polled endpoint | M | 8 |
| 10 | Job Search Stop: `stop_requested_at`, `stopped` status, partial offers linked, quota release, notification | S | 9 |
| 11 | Pane « Cette page »: reads the stored provenance per page (Modèles, Sites, Outils, Par élément, Total), « non enregistré » | M | 4, 6–9 (each page as its slice lands) |
| 12 | Pane live: glyph, current step, « En cours ailleurs », Stop icons | M | 5, 6, 9, 10, 11 |
| 13 | Job Digest and Follow-up Action Card provenance | XS | 8 |
| 14 | Optional: NOTIFY plus SSE transport for worker runs | M | 9 |
