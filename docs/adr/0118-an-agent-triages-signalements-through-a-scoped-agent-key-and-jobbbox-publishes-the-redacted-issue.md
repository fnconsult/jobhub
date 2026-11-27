# An agent triages Signalements through a scoped Agent Key, and Jobbbox publishes the redacted issue

Status: proposed (2026-11-26, product owner; grilling #1138). Amends the *Signalement* entry of CONTEXT.md (« read by people only: never sent to an AI »). Follows the triage scheme of the Charabia project (`fnconsult/game-hub`, `docs/specs/triage-signalements-2026-10-01.md`). **Not used on Production data before the Legal Review** of its « Légal : » issue. Amended 2026-11-27 (#1173).

A Signalement (Bug, Idée, Question) stays in the Back Office. Support handles it by hand, and nothing brings it to the GitHub backlog. A confirmed bug reaches an issue only when the product owner copies it from a screenshot (#1128, #1130, #1131, #1133). The rule « read by people only » also keeps out the AI agents that deliver the backlog, so every Signalement waits for a person to read it, rewrite it and file it.

## Decision

### What the agent reads

- **An Agent Key.** A super-admin creates it in Paramètres › « Clés d'agent ». It has:
  - a name (`triage-beta`, `triage-prod`), one scope (`signalements`) and an expiry of 90 days at most;
  - a value shown once, after which only its SHA-256 fingerprint is kept;
  - a last use and a log of its latest 50 calls.

  Revocation and expiry are read again on every call. A key opens no Back Office page and no route outside its scope. It belongs to the environment, not to the person who created it. Creating or revoking one is recorded in the Back Office Audit, never its value. Its prefix is taught to the secret-blocking hook.
- **A minimal API**:
  - `GET /admin/api/signalements` (the queue) and `GET /admin/api/signalements/:id`;
  - `POST /admin/api/signalements/:id/statut` (« vu » only);
  - `POST /admin/api/signalements/:id/brouillon`;
  - `POST /admin/api/signalements/:id/issue`.

  The answer has a fixed set of keys, tested with `Object.keys`: type, message, date, status, environment, Version, browser or device, Interface Language and Text Size. Amended on 2026-11-27 (#1173): the keys also say what triage already did (the issue linked, the draft's signature and date), and an answer to a write holds none of the message; see the amendment below. A page path comes with each id replaced by its type (`/candidatures/:id`). A Question also carries its copy of the question and the AI Coach's reply, in full. Never the Candidate's email, name, Plan or id, and never an object of theirs (an Application, a Profile, a CV). When an object is needed to reproduce a bug, the issue asks Support, who reads it in the Back Office.
- **Redaction first.** Every text the API returns goes through Redaction, as an AI call does. A status set by the agent is signed `key:<name>`, and the Back Office shows « vu par *triage-beta* ».
- **Only Signalements sent with the AI notice.** The form says « Un outil d'IA peut lire votre message pour nous aider à le traiter. », and each Signalement keeps whether it was shown. The legal basis is legitimate interest. Signalements sent before the notice existed never reach the agent; Support keeps handling them by hand.
- **The provider is Anthropic.** The agent runs in Claude Code sessions. Anthropic is a recipient in the privacy register, under its DPA and standard contractual clauses.

### What the agent does

- **It marks « vu », and never « traité ».**
- **It reproduces a Bug on the Beta** before filing it, and says whether it could.
- **A Question becomes one of three things:**
  - a defect of the AI Coach: an issue, with an Eval Case built from the exchange, redacted;
  - a gap in the help: an issue to write or fix the Help Article;
  - a reply only: a draft reply, no issue.

  A Question is still never linked to an Unanswered Question.
- **Jobbbox publishes the issue, never the agent.** The agent proposes the issue's text with `POST …/issue`, in its own words, never quoting the Candidate's message. The text holds a summary, the steps to reproduce, the expected behaviour, the environment, Version and device, and the Signalement's id. Then the server:
  1. runs Redaction on it;
  2. runs the « Données du Candidate dans une issue » Guardrail (identity, email, phone, a verbatim quote of the message);
  3. publishes the issue on GitHub, labelled `needs-triage` and `signalement`, with a key that may only write issues.

  A blocked text goes back to the agent with the reason, and the agent writes it again, as with a Blocked message. When an issue already covers the same problem, the same route adds a comment with the new Signalement's id instead of opening a new issue.
- **A two-way link.** The Signalement keeps its issue number, shown to the team in the Back Office and never to the Candidate. The issue carries the Signalement's id, never its text. Deleting the Signalement removes the link and leaves the issue, which holds nothing of the Candidate.
- **A draft reply, never sent by the agent.**
  - It is written in the Candidate's Interface Language, with its French and English translations for Support.
  - It is kept on the Signalement: « Brouillon proposé par *triage-prod* ». Support edits it, sends it or deletes it.
  - The Candidate receives only the version in their language, signed « L'équipe Jobbbox », and only once Support sends it. The Back Office Audit records who sent it.

### When it is « traité »

- **« Prêt à clore » when the fix reaches the Signalement's environment.** On each deploy, the server checks the linked issues that a commit now deployed has closed. A Signalement sent from the Beta is ready once its fix is on the Beta. One sent from Production is ready once the Version that carries its fix is Promoted.
- **One notification.** « Prêt à clore » is a state only the team sees, holding its draft. When Support sends the reply, « traité » is set with it, and the Candidate gets one Signalement notification. The Signalements linked to the same issue become « Prêt à clore » together.
- An Idée refused, or a Question answered with no issue, has no deploy: Support sends its draft when it is ready.

### When the agent runs

- **On demand first, on the Beta.** A first pass with `triage-beta` lists, marks « vu » and proposes one issue. The product owner checks it, then creates `triage-prod`.
- **Then every day before the Livraison email.** A scheduled task runs the triage around 17 h (Paris), before the 18 h Livraison email. The email gains a « Signalements » section, computed by Jobbbox from its own data:
  - new Signalements by type and environment;
  - issues opened or completed with a duplicate;
  - those « Prêt à clore » with a draft waiting for Support;
  - whether the day's triage ran, or why it did not (for example an expired key).

  It carries counts and issue links only, never a Candidate's text.

## Considered Options

- **Copying each Signalement into an issue**: it would put the Candidate's words on GitHub, outside their deletion, the 12-month purge and the account's deletion.
- **A « Créer un ticket » button for Support**: it keeps a person rewriting every Signalement, which is the bottleneck the product owner wants gone.
- **The agent signing in as an Administrator**: an account sees far more than the queue, and its rights cannot be narrowed to one route.
- **The agent publishing the issue itself**: what reaches GitHub would rest on the agent following its procedure. Published by Jobbbox, the issue always passes Redaction and the Guardrail.
- **« Traité » at merge, or at the Beta, for every Signalement**: a Candidate on Production would read « traité » while the bug is still there.
- **« Traité » set alone, the reply later**: two notifications, the first one with no explanation.
- **A checkbox to refuse the AI, or an explicit consent**: the product owner chose the notice alone. The Legal Review decides whether a right to object must be offered on the form.
- **Bugs only**: the two latest bugs (#1131, #1133) came from Questions about the AI Coach.

## Consequences

- **Legal, blocking.** A « Légal : » issue covers:
  - the Signalements entry of the privacy register: a new purpose, Anthropic as recipient, legitimate interest;
  - the privacy policy (« À qui vos données sont transmises », « Ce que nous collectons »);
  - the form's notice;
  - whether `statutMajPar` and the key outlive the account's deletion.

  The Agent Key is not used on Production data before that Legal Review.
- **CONTEXT.md**: *Signalement*, *Back Office Roles*, *Back Office Audit* and *Guardrail* change. *Agent Key*, *Signalement triage* and « Prêt à clore » are new.
- **A new Provider Secret** that may only write issues on `fnconsult/jobhub`, next to the read-only `GITHUB_STATUS_TOKEN`.
- **A new fixed Guardrail**, « Données du Candidate dans une issue », that can never be switched off, with Eval Cases: an issue quoting the message word for word, an issue naming the Candidate, an email or phone in the steps.
- `docs/agents/issue-tracker.md` gains « Trier les signalements »: the calls, the rules (never a Candidate's text in `git`, never kept outside the session), and what to do with a refused key (stop and say so).
- The help article of the Signalement form, the Back Office's « Signalements » and « Livraison » articles, and a Release Note fragment.
- The Data export keeps a Signalement's status, reply and context. It gains the issue number, never which key or Administrator acted.

## Amendment: what triage already did, minimal write answers and a 404 that says why (issue #1173, 2026-11-27)

Two real triage passes on the Beta with `triage-beta` (2026-11-27) found three gaps. The writes repeated the Candidate's message in every answer, so each call added a copy of it to the agent's logs and transcripts. `GET` showed neither the issue already linked nor the draft already proposed, so a later pass could propose the issue again or replace the draft. And a 404 said nothing, so the agent could not tell a deleted Signalement from one out of scope. The product owner decided (comment of 2026-11-27 on #1173):

- **The fixed keys gain what triage already did.** The queue and `GET …/:id` answer exactly these keys, in this order, tested with `Object.keys` (`TRIAGE_KEYS`): `id`, `type`, `message`, `sentAt`, `status`, `environment`, `version`, `device`, `interfaceLanguage`, `textSize`, `path`, `attachedQuestion`, `attachedCoachReply`, `issue` and `brouillon`.
  - `issue` is `{ number, url }` of the issue linked (the first, when there are several), or `null`.
  - `brouillon` is `{ proposePar, date }` of the draft reply waiting for Support, or `null`: who proposed it (`key:triage-beta`, or `null` for Support) and when, never its text.
- **Minimal write answers.** No answer to a write repeats the message, its context or the draft: the agent reads them once, with `GET`.
  - `POST …/statut` answers `{ id, statut, statutMajPar }` (`SEEN_KEYS`).
  - `POST …/brouillon` answers `{ id, brouillon: { proposePar, date } }` (`PROPOSED_DRAFT_KEYS`).
- **One issue per Signalement.** `POST …/issue` on a Signalement already linked answers 409 `already_linked`, with `{ number, url }` of its issue. A duplicate goes through `commentOn` on the new Signalement.
- **A « traité » Signalement stays readable by the key, read-only, until its purge 12 months later.** `commentOn`, the link to the issue and « Prêt à clore » keep working after Support sends the reply. `POST …/issue` still links it; « vu » and a draft are refused (409 `already_handled`). The agent still sets « vu » only, never « traité ».
- **A 404 that says why, never anything of the Candidate:** `{ error: "not_found", reason }`, the reason one of `deleted` (the Candidate deleted it, alone or with their account), `treated` (marked « traité », then purged), `no_ai_notice` (sent before the AI notice: out of scope, read by people only) or `unknown` (no such id, or one sent without the notice and since deleted).
- **The trace of a Signalement gone.** So that `deleted` and `treated` can be told, a Signalement sent with the AI notice leaves, once gone, a row in `signalement_removed`: its id, when it went and why (`deleted`, written by a database trigger on every deletion, the account's included; `treated`, written by the nightly purge). Nothing of the Candidate, not even their id, nor any text. The trace is purged 12 months after it was written, by the same nightly job, and is not in the Data export, since it is linked to no Candidate. One sent without the notice leaves none. The Signalements entry of the privacy register says so.
- **A 503 says the text was checked.** When `POST …/issue` cannot reach GitHub for want of its token, it answers 503 `{ error: "github", reason: "missing_token", checked: true }`: the text passed Redaction and the Guardrail, and nothing was published.

`docs/agents/issue-tracker.md` (« Trier les signalements ») gives the agent these answers and what to do with each reason.
