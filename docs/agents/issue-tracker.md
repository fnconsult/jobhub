# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v`; `gh` does this automatically when run inside a clone.

## Documentation

Every `ready-for-agent` ticket a skill creates carries a **Documentation** section, after its acceptance criteria and before **Effort**: one line per impact, from the rules in `documentation.md` (Help Article, Release Note fragment, privacy register, « Légal : » issue, motion), or « Aucune » when the ticket changes nothing a user sees and nothing in the privacy register.

```
## Documentation

- Help Article `page-account` : rubrique « Rappels ».
- Fragment de Release Note.
- Registre : nouveau sous-traitant Brevo → issue « Légal : politique de confidentialité, Brevo ».
```

## Effort

Every ticket a skill creates (`/to-tickets`, `/triage`, `/wayfinder`…) carries an **Effort** section, after its acceptance criteria and before **Blocked by**: a size and the work that drives it, in one line.

| Size | Agent working time |
| ---- | ------------------ |
| XS   | ¼ day or less      |
| S    | ½ day              |
| M    | 1–1.5 days         |
| L    | 2–3 days           |
| XL   | more than 3 days: split it before publishing |

```
## Effort

**M (1–1,5 j)** — form, « Rétablir », Journal entries, worker reads the resolver.
```

When a skill publishes several tickets, it also publishes a tracking issue (label `enhancement`, never `ready-for-agent`) whose body tables each ticket's blockers and effort, the total and the critical path, with the tickets attached as sub-issues.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents:

- **Read a PR**: `gh pr view <number> --comments` and `gh pr diff <number>` for the diff.
- **List external PRs for triage**: `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments` then keep only `authorAssociation` of `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, or `NONE` (drop `OWNER`/`MEMBER`/`COLLABORATOR`).
- **Comment / label / close**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either: resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. `gh issue create --label wayfinder:map`.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue (`gh api` on the sub-issues endpoint). Where sub-issues aren't enabled, add the child to a task list in the map body and put `Part of #<map>` at the top of the child body. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving dev.
- **Blocking**: GitHub's **native issue dependencies**, the canonical, UI-visible representation. Add an edge with `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric **database id** (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, _not_ the `#number` or `node_id`). GitHub reports `issue_dependencies_summary.blocked_by` (open blockers only, the live gate). Where dependencies aren't available, fall back to a `Blocked by: #<n>, #<n>` line at the top of the child body. A ticket is unblocked when every blocker is closed.
- **Frontier query**: list the map's open children (`gh issue list --state open`, scoped to the map's sub-issues / task list), drop any with an open blocker (`issue_dependencies_summary.blocked_by > 0`, or an open issue in the `Blocked by` line) or an assignee; first in map order wins.
- **Claim**: `gh issue edit <n> --add-assignee @me`, the session's first write.
- **Resolve**: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`, then append a context pointer (gist + link) to the map's Decisions-so-far.

## Trier les signalements

Signalement triage (ADR-0118, #1139, #1141) reads the Signalements through an Agent Key, never a session. The key is in
the environment variable `JOBBBOX_AGENT_KEY`; the product owner creates it in Paramètres › « Clés d'agent »
(`triage-beta` on the Beta first, `triage-prod` only after the Legal Review of #1140). An agent never creates one, never
runs a triage on real data and never schedules one unless the product owner asks.

- `GET /admin/api/signalements` (`?statut=nouveau`, `?statut=nouveau,vu`): the queue, only those sent with the AI
  notice, redacted, each page path without its ids.
- `GET /admin/api/signalements/:id`: one of them.
- `POST /admin/api/signalements/:id/statut` with `{ "statut": "vu" }`: the only status an agent sets; the Back Office
  shows « vu par <key> ».
- `POST /admin/api/signalements/:id/issue`: the issue Jobbbox publishes, never the agent (see below).
- `POST /admin/api/signalements/:id/brouillon` with `{ "fr": "…", "en": "…" }`: the draft reply (below).

The procedure, one Signalement at a time:

1. **List the queue**, then mark each one you take up « vu » (`POST …/statut`). Never « traité »: Support sets it when
   it sends the reply.
2. **A Bug**: reproduce it on the Beta (staging.jobbbox.ai), with your own fictional account and data, never the
   Candidate's: the page path, the Version, the device. Say in the issue whether you could reproduce it. When an object of
   the Candidate's is needed (an Application, a CV), the issue asks Support, who reads it in the Back Office.
3. **A Question** becomes one of three things:
   - a defect of the AI Coach: an issue, and an Eval Case written from the exchange once nothing of the Candidate is left
     (fictional names, places and data);
   - a gap in the help: an issue to write or fix the Help Article;
   - a reply only: no issue, a draft reply.

   A Question is never linked to an Unanswered Question.
4. **Propose the issue**, in your own words: `POST …/issue` with `{ "title", "summary", "steps", "expected",
   "environment", "version", "device" }` (title and summary required). When an open issue already covers the problem,
   `{ "commentOn": <its number> }` (with an optional `summary`) adds a comment carrying the new Signalement's id instead.
   Jobbbox runs Redaction, then the « Données du Candidate dans une issue » Guardrail (always on: the Candidate's name,
   email or phone, any email or phone, or six words in a row of their message), then publishes the issue on
   `fnconsult/jobhub` labelled `needs-triage` and `signalement`, with the Signalement's id, and links it. A **422**
   `{ "error": "blocked", "reasons", "fields" }` publishes nothing: write the fields named again, in other words, and
   propose again. 201 answers `{ "issue": { "number", "url", "kind" } }`.
5. **Propose the draft reply** (`POST …/brouillon`): in the Candidate's Interface Language (the queue's
   `interfaceLanguage`) and its translation, both given as `fr` and `en`, at most 2,000 characters each. Support reads it,
   edits it and sends it, signed « L'équipe Jobbbox ». For a Bug or an Idée with an issue, the reply goes once the fix is
   deployed (« Prêt à clore », set by Jobbbox); for an Idée refused, or a Question answered without an issue, as soon as
   Support has read it.

Each call sends `Authorization: Bearer $JOBBBOX_AGENT_KEY`: never the key's value in a command, a file, `git`, an issue
or a comment (`scripts/hooks/no-secrets.mjs` refuses it). Never a Signalement's text in `git`, an issue, a comment or a
test, and never kept outside the session: an issue is written in the agent's own words and carries the Signalement's
id, never its message. A 401 (no key, or one revoked or expired) or 429 (rate limit) stops the triage: say so, and do
not try another way in. A 503 on `…/issue` means Jobbbox has no token to write issues (GITHUB_ISSUES_TOKEN): say so and
stop proposing issues; the drafts still go.

Outside `/admin/api/signalements/*` the key is ignored, never refused (#1172): a request that carries it is answered as
if it carried none, anonymous or with the session of its cookie. So the network proxy of the Claude Code sessions can
send it with every request to `staging.jobbbox.ai`: `/api/health` (the last check of `/deploy-staging`) and the Beta's
public pages answer as usual, and a Bug is reproduced (step 2) in the same session, signed in with your own test account.
The key opens nothing there: a Back Office page answers as to an anonymous visitor (sent to sign in), a protected route
401, whatever the key's state, revoked or expired included. Only the calls in its scope are counted, in its last use and
in the journal of its 50 latest calls.
