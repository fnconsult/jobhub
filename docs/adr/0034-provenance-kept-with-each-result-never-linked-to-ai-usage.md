# Provenance is kept with each result, never linked to AI Usage

AI Activity (#314) shows the Candidate which models, Tools and sites really produced what a page shows, and the steps of an action as they run. Today only `coach_message` keeps the provider and model; `ai.generate` returns them and every other caller drops them, and AI Usage deliberately names no one (ADR-0007, #218). We decided that each result keeps its own **Provenance**: a versioned value object, stored as a nullable `provenance` jsonb on the result's row (`job_search`, `job_offer`, `tailored_cv`, `tailored_document`, `company_dossier`, `master_cv_version`, `action_card`, `job_digest`, `coach_message`), written by the caller from what the AI layer and the Tools return. It holds steps (Activity, AI task or Tool, provider, endpoint and region, model that served, tokens, duration, start, Outcome), Provenance sites with their links, and the action's start and wall-clock time; never a Candidate id, a cost or any text. Research: `docs/research/issue-319.md`.

## Considered Options

- **A `usage_id` from each result to its AI Usage rows**: would make every AI Usage row joinable to a Candidate for the life of the result, against ADR-0007 #218 and the privacy register's "joinable only for the 30 days of the AI Message Log"; the rows are purged at 24 months while results live as long as the account, so old content would lose its provenance by itself; the id is created asynchronously after the call; and Tools outside the AI layer (France Travail, the register, ATS APIs, rules) have no AI Usage row at all.
- **A snapshot plus a `usage_id` for drill-down**: keeps the privacy problem for a drill-down the Candidate never gets.
- **Show the configured route**: shows what should have served, not what did (a Playbook Agent, Platform Settings or the EU AI Consent route can change it per call).

## Consequences

- The AI layer returns, with every result, the endpoint (with its region), the duration and the Outcome it already computes, and accepts an `AbortSignal`; one recorder wraps the layer and times the Tools, folding repeated calls into one step with a count so a Job Search stays a few dozen steps.
- The Activity of each step is fixed in code, per feature step and by default per AI task or Tool, never per Playbook.
- Live steps: an action that runs inside a web request (an AI Coach reply, Tailored Documents, Company Dossier, reading a CV) streams its step events on its own POST as NDJSON when the client asks for it with `Accept: application/x-ndjson` (JSON otherwise), aborting the request being the Stop (first built for the AI Coach, #328); a Job Search, which runs in the worker, writes its progress on its row after each step and the page polls it while it searches, with the notifications poll that already exists. `NOTIFY` and server-sent events can replace the poll later behind the same event shape.
- Stop: the signal is passed end to end, a stopped call or action records the Failure Reason `stopped`, a stopped AI Coach reply saves nothing, and a stopped or failed Job Search keeps and links the Job Offers already found; its Plan Quota use is given back when it kept none.
- Provenance is in the Candidate's Data export with its row and is deleted with it (ADR-0010). Rows made before it show « modèle non enregistré »; only AI Coach replies get a partial Provenance from the columns they already have.
- Per model and per Tool, times are the sum of their calls; per action and for the page's total, the wall-clock time (#316).
