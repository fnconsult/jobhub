export const meta = {
  name: 'wf-dev',
  description: 'Loop over ready GitHub issues (priority + dependency aware), in parallel: implement → E2E ∥ QA ∥ code review → fix → ship, using the mattpocock skills',
  whenToUse: 'Deliver ready-for-agent issues end to end. args: an issue number to start with, or nothing to pick from the frontier; or {issue, maxParallel, maxIssues, merge, resume: [{issue, from: implement|verify|ship, worktree, branch, baseRef, prNumber, prUrl}]} to continue issues an interrupted run left in flight.',
  phases: [
    { title: 'Select', detail: 'frontier: ready-for-agent, unassigned, no open blockers, by priority' },
    { title: 'Open PR', detail: 'claim, worktree, draft PR (Closes #n) before any code' },
    { title: 'Research', detail: 'research skill on third-party APIs/facts the issue depends on' },
    { title: 'Implement', detail: 'tdd + codebase-design + domain-modeling, pushed to the PR' },
    { title: 'Verify', detail: 'E2E ∥ QA ∥ code-review on the PR (review posted to the PR)' },
    { title: 'Fix', detail: 'diagnosing-bugs on every failure and blocking review finding' },
    { title: 'Docs', detail: 'CONTEXT.md, ADRs, README on Sonnet (domain-modeling, writing-for-agents)' },
    { title: 'Ship', detail: 'rebase, wizard for human-only steps, ready, merge (serialized)' },
  ],
}

// ---------- options ----------
const opts = (args && typeof args === 'object') ? args : { issue: args }
const START = opts.issue != null && String(opts.issue).trim() !== ''
  ? Number(String(opts.issue).replace('#', ''))
  : null
const MAX_PARALLEL = opts.maxParallel ?? 2
const MAX_ISSUES = opts.maxIssues ?? 1000
const MERGE = opts.merge ?? true
const MAX_FIX_LOOPS = opts.maxFixLoops ?? 3
const DOC_MODEL = opts.docModel ?? 'sonnet' // document-writing agents use the latest Sonnet
// Token budget (2026-10-10): mechanical steps on Haiku, checks on Sonnet, judgement on Opus.
const CHEAP = { model: 'haiku', effort: 'low' }
const CHECKER = { model: 'sonnet', effort: 'medium' }
const BUILDER = { model: 'opus', effort: 'high' }
const RESUME = opts.resume ?? []

// ---------- schemas ----------
const PICK = {
  type: 'object',
  properties: {
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: { number: { type: 'number' }, title: { type: 'string' }, why: { type: 'string' } },
        required: ['number', 'title'],
      },
    },
    blocked: { type: 'string', description: 'one line: how many ready issues are still blocked, and by what' },
  },
  required: ['issues', 'blocked'],
}

const SETUP = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    worktree: { type: 'string', description: 'absolute path of the git worktree' },
    branch: { type: 'string' },
    baseRef: { type: 'string', description: 'commit SHA the branch started from' },
    prNumber: { type: 'number' },
    prUrl: { type: 'string' },
  },
  required: ['ok', 'worktree', 'branch', 'baseRef', 'prNumber', 'prUrl'],
}

const RESEARCH = {
  type: 'object',
  properties: {
    needed: { type: 'boolean' },
    file: { type: 'string', description: 'repo-relative path of the findings file, if written' },
    summary: { type: 'string' },
  },
  required: ['needed', 'summary'],
}

const IMPL = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    summary: { type: 'string' },
    acceptanceCriteria: { type: 'array', items: { type: 'string' } },
    howToRun: { type: 'string', description: 'commands to install, start the app, run unit and e2e tests' },
  },
  required: ['ok', 'summary', 'acceptanceCriteria', 'howToRun'],
}

const CHECK = {
  type: 'object',
  properties: {
    pass: { type: 'boolean' },
    failures: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          evidence: { type: 'string', description: 'command output, repro steps, screenshot path' },
        },
        required: ['title', 'evidence'],
      },
    },
    notes: { type: 'string' },
  },
  required: ['pass', 'failures', 'notes'],
}

const SHIP = {
  type: 'object',
  properties: {
    merged: { type: 'boolean' },
    prUrl: { type: 'string' },
    humanSteps: { type: 'string', description: 'path of the wizard script for human-only steps, or empty' },
    notes: { type: 'string' },
  },
  required: ['merged', 'prUrl', 'notes'],
}

// ---------- helpers ----------
const FOOT = '🤖 Generated with [Claude Code](https://claude.com/claude-code)'
const spec = n => `GitHub issue #${n} (read it with \`gh issue view ${n} --comments\`)`
const criteria = impl => impl.acceptanceCriteria.map(c => `- ${c}`).join('\n')
const where = impl => `Work ONLY inside the git worktree \`${impl.worktree}\` (branch \`${impl.branch}\`, PR #${impl.prNumber}). Push every commit to that branch so it shows in the PR. Other issues are being built in parallel in sibling worktrees; never touch them or the main checkout. Pushing: run \`cd ${impl.worktree}\` as its own Bash call first, then the push command alone, ALWAYS naming the branch: \`git push origin ${impl.branch}\`, or \`git push --force-with-lease origin ${impl.branch}\` after a rebase — never a bare \`git push\`: the shell can be back in the main checkout, where a bare push rewrites \`main\`. Never prefix it with \`cd … &&\` or \`git -C\`, which the permission rules don't match. If you start servers, use ports offset by the issue number to avoid collisions, and stop them before returning.`

const issueAgent = (n, id, prompt, o) => agent(prompt, { ...o, label: id })

// Merges are serialized so parallel issues rebase onto each other cleanly.
let shipChain = Promise.resolve()
const serially = fn => {
  const p = shipChain.then(fn)
  shipChain = p.catch(() => {})
  return p
}

const pickNext = (count, exclude) => agent(
  `Pick the next ${count} GitHub issue(s) to work on in this repo. Follow docs/agents/issue-tracker.md.

1. List open issues: \`gh issue list --state open --limit 200 --json number,title,labels,assignees,body\`.
2. Keep only issues labelled \`ready-for-agent\`, with no assignee, and not in this list: [${exclude.join(', ')}].
3. Drop any issue with an open blocker: check \`gh api repos/{owner}/{repo}/issues/<n> --jq .issue_dependencies_summary.blocked_by\` (must be 0), and also any \`Blocked by: #x\` line in the body whose issue is still open.
4. Order the rest by priority: an explicit priority label first (\`priority:critical|high|medium|low\`, \`P0\`–\`P3\`), then the issue that unblocks the most other issues (\`issue_dependencies_summary.blocking\`), then the lowest issue number.
5. Avoid merge conflicts with work already in progress. List every open PR (\`gh pr list --state open --json number,headRefName,title\`, including ones not made by this workflow, e.g. hand-backs and independent fixes) and the files each changes (\`gh pr diff <n> --name-only\`), plus local worktrees (\`git worktree list\`). Skip, or rank last, an issue whose likely changes (modules, pages, migrations, shared i18n sections) overlap heavily with one of them; mention it in \`blocked\`. Shared files every feature touches (README.md, CONTEXT.md, en/fr.json, playwright.config.ts, migrate.ts) are not a reason to skip.
6. Prefer issues that don't obviously touch the same area as each other, so they can be built in parallel without conflicts.

Return at most ${count}. Read only — change nothing.`,
  { label: 'select', phase: 'Select', schema: PICK, ...CHEAP },
)

const INTERRUPTED = '\nA previous run was interrupted mid-task in this worktree: inspect `git status` / `git log` first and continue from any uncommitted or in-progress work (including an unfinished rebase) instead of starting over.'

// Rebuilds the implementation summary for an issue resumed past Implement.
const recover = (n, pr) => issueAgent(n, `wf-dev/#${n}/recover`,
  `An interrupted run already implemented ${spec(n)} in PR #${pr.prNumber} (worktree \`${pr.worktree}\`, branch \`${pr.branch}\`, since \`${pr.baseRef}\`). Read the issue, the PR body and \`git log ${pr.baseRef}..HEAD\` and return: a summary of what was built (including new domain terms/decisions), the acceptance criteria verbatim from the issue, and howToRun (install, start the app, unit and e2e test commands, from README/package.json). Read only — change nothing. ok=true.`,
  { phase: 'Implement', schema: IMPL, ...BUILDER },
)

// ---------- one issue, end to end ----------
const runIssue = async (n, resumed) => {
  const from = resumed?.from
  const pr = resumed ? { ok: true, ...resumed } : await issueAgent(n, `wf-dev/#${n}/open-pr`,
    `Open the pull request for ${spec(n)} BEFORE any implementation, so all work happens in the PR.

1. Claim it: \`gh issue edit ${n} --add-assignee @me\`.
2. \`git fetch origin\`, record \`origin/main\`'s SHA as baseRef, then \`git worktree add ../jobhub-worktrees/issue-${n} -b issue-${n}-<short-slug> origin/main\`. Every issue gets its own worktree; never reuse or modify another worktree (other issues, hand-backs and independent fixes live in sibling worktrees). If \`../jobhub-worktrees/issue-${n}\` already exists, stop with ok=false and say why.
3. In the worktree: \`git commit --allow-empty -m "Start #${n}: <issue title>"\`, then \`git push -u origin <branch>\`.
4. \`gh pr create --draft --base main --head <branch>\` with the issue title, a body that has "Closes #${n}", the acceptance criteria as a task list (\`- [ ]\`), and ends with:\n${FOOT}
Write no code. Return the worktree path, branch, baseRef and the PR number/url.`,
    { phase: 'Open PR', schema: SETUP, ...CHEAP },
  )
  if (!pr || !pr.ok) return { issue: n, status: 'failed-open-pr', pr }

  const research = from ? null : await issueAgent(n, `wf-dev/#${n}/research`,
    `Decide whether ${spec(n)} depends on facts outside this repo: third-party APIs, SDKs, providers, protocols, regulations (e.g. Stripe, Perplexity, Google OAuth, data providers, robots.txt, GDPR). If not, return needed=false immediately.
If it does, use the Skill tool to load \`mattpocock-skills:research\` and follow it: check only what implementing this issue needs against primary sources, and write the findings to \`docs/research/issue-${n}.md\` in the worktree \`${pr.worktree}\`. Commit and push it to branch \`${pr.branch}\` (PR #${pr.prNumber}). Write no product code.`,
    { phase: 'Research', schema: RESEARCH, effort: 'low', model: DOC_MODEL },
  )

  const built = from && from !== 'implement' ? await recover(n, pr) : await issueAgent(n, `wf-dev/#${n}/implement`,
    `Implement ${spec(n)} in its pull request #${pr.prNumber} (${pr.prUrl}).
${where(pr)}${from === 'implement' ? INTERRUPTED : ''}
${research?.needed && research.file ? `\nRead the research findings first: \`${research.file}\`.\n` : ''}
Use the Skill tool to load and follow:
- \`mattpocock-skills:domain-modeling\` — use CONTEXT.md and docs/adr/ vocabulary. Don't edit those docs yourself; list new terms or decisions in your summary (a docs agent writes them).
- \`mattpocock-skills:codebase-design\` — deep modules, small interfaces.
- \`mattpocock-skills:tdd\` — test-first, red-green-refactor.

Commit in small steps (messages reference #${n}) and push to the branch as you go. Tick the acceptance-criteria task list in the PR body (\`gh pr edit ${pr.prNumber} --body ...\`) as items are done. Use the issue's acceptance criteria verbatim. Return ok=false only if you could not produce a working implementation.`,
    { phase: 'Implement', schema: IMPL, ...BUILDER },
  )
  if (!built || !built.ok) return { issue: n, status: 'failed-implement', pr: pr.prUrl, impl: built }
  const impl = { ...pr, ...built }

  let failures = []
  for (let loop = 0; loop <= MAX_FIX_LOOPS && from !== 'ship'; loop++) {
    // Verify against today's main: other issues and independent PRs merge meanwhile.
    await issueAgent(n, `wf-dev/#${n}/sync${loop ? `-r${loop}` : ''}`,
      `Bring the branch of ${spec(n)} up to date with main before it is verified.
${where(impl)}
\`git fetch origin\`. If \`origin/main\` is not an ancestor of HEAD, rebase onto it (finish any rebase already in progress first). On conflicts, load \`mattpocock-skills:resolving-merge-conflicts\` via the Skill tool and follow it, keeping the intent of both sides; renumber this branch's ADR if its number is now taken on main. Run \`npm ci\` if package-lock.json changed, then typecheck and lint. Push: \`git push --force-with-lease origin ${impl.branch}\` if you rebased, else \`git push origin ${impl.branch}\`, following the pushing rule above. Change nothing else; never touch other worktrees. Return a one-line summary (up to date / rebased, conflicts resolved).`,
      { phase: 'Verify', ...CHEAP },
    )
    const retest = loop > 0 ? `\nThis is re-verification round ${loop} after fixes; re-check these earlier failures first:\n${JSON.stringify(failures, null, 2)}` : ''

    const [e2e, qa, review] = await parallel([
      () => issueAgent(n, `wf-dev/#${n}/e2e${loop ? `-r${loop}` : ''}`,
        `You own end-to-end tests for ${spec(n)}
${where(impl)}

How to run: ${impl.howToRun}
Acceptance criteria:
${criteria(impl)}

Use the Skill tool to load \`mattpocock-skills:tdd\` (integration-test guidance).${from === 'verify' && loop === 0 ? INTERRUPTED : ''}${loop === 0
          ? ' Write e2e tests covering every acceptance criterion through the public entry point (UI, HTTP API, extension or CLI); set up e2e tooling if the repo has none. Commit them.'
          : ' The e2e tests exist; never weaken or delete them to get green.'}
Run the e2e suite and the full existing test suite. pass=true only if everything is green. Every failure needs real output as evidence.${retest}`,
        { phase: 'Verify', schema: CHECK, ...CHECKER },
      ),
      () => issueAgent(n, `wf-dev/#${n}/qa${loop ? `-r${loop}` : ''}`,
        `You are QA for ${spec(n)}
${where(impl)}

How to run: ${impl.howToRun}
Acceptance criteria:
${criteria(impl)}

Use the Skill tool to load the \`run\` skill and launch the real app. Exercise it like a user: every acceptance criterion, then edge cases (empty/invalid input, errors, permissions, repeated actions, FR/EN i18n where relevant), then regressions in nearby features. Do NOT edit or commit anything. pass=true (go) only if every criterion holds and no significant defect exists; each failure needs repro steps and evidence.${retest}`,
        { phase: 'Verify', schema: CHECK, ...CHECKER },
      ),
      () => issueAgent(n, `wf-dev/#${n}/review${loop ? `-r${loop}` : ''}`,
        `Use the Skill tool to load \`mattpocock-skills:code-review\` and follow it: review pull request #${impl.prNumber} (branch \`${impl.branch}\` since \`${impl.baseRef}\`) against ${spec(n)}
${where(impl)}

Do NOT edit code. pass=true only if there are no blocking (must-fix-before-merge) findings on either axis (Standards, Spec). List each blocking finding as a failure with file and evidence; put non-blocking remarks in notes.
Before returning, record the review on the PR: \`gh pr review ${impl.prNumber} --comment --body "<verdict: no blocking findings | N blocking findings>, then the Standards and Spec results, blocking findings with file:line, non-blocking remarks>"\`. Start the body with "Code review (round ${loop}):".${retest}`,
        { phase: 'Verify', schema: CHECK, ...BUILDER },
      ),
    ])

    const missing = [['e2e', e2e], ['qa', qa], ['review', review]].filter(([, r]) => !r).map(([k]) => k)
    failures = [
      ...missing.map(k => ({ title: `${k} agent did not return`, evidence: 'skipped or crashed' })),
      ...[e2e, qa, review].filter(Boolean).flatMap(r => r.failures),
    ]
    log(`#${n}: round ${loop} — e2e ${e2e?.pass ? '✓' : '✗'} qa ${qa?.pass ? '✓' : '✗'} review ${review?.pass ? '✓' : '✗'}`)
    if (!failures.length) break
    if (loop === MAX_FIX_LOOPS) break

    await issueAgent(n, `wf-dev/#${n}/fix-${loop + 1}`,
      `Use the Skill tool to load \`mattpocock-skills:diagnosing-bugs\` and follow it.
${where(impl)}
Implementing ${spec(n)}

Fix every one of these (E2E failures, QA defects, blocking review findings):
${JSON.stringify(failures, null, 2)}

Find root causes, not symptoms. Add a regression test per \`mattpocock-skills:tdd\` where it makes sense. Never weaken tests. Commit and push to the PR branch. Return a short summary.`,
      { phase: 'Fix', ...BUILDER },
    )
  }

  const ready = failures.length === 0
  if (ready && from !== 'ship') await issueAgent(n, `wf-dev/#${n}/docs`,
    `You write the documentation for ${spec(n)}, PR #${impl.prNumber}. The code is done and verified; do NOT change code or tests.
${where(impl)}

Implementation summary (including new terms/decisions):
${impl.summary}

1. Use the Skill tool to load \`mattpocock-skills:domain-modeling\` and follow it: add new terms to CONTEXT.md and record any new decision as an ADR in docs/adr/. Number a new ADR after the highest number on \`origin/main\` AND in every open PR (\`gh pr list --state open\`, then \`gh pr diff <n> --name-only | grep docs/adr\`), so parallel branches don't claim the same number.
2. Update README.md (setup, env vars, scripts, conventions) and .env.example comments if this change affects them.
3. If you edit AGENTS.md, CLAUDE.md or anything under docs/agents/, load \`mattpocock-skills:writing-for-agents\` first.
Keep docs short and in the existing style. Commit ("Docs for #${n}") and push to the PR branch. If nothing needs documenting, change nothing. Return a one-line summary.`,
    { phase: 'Docs', model: DOC_MODEL },
  )
  const ship = await serially(() => issueAgent(n, `wf-dev/#${n}/${ready ? 'ship' : 'hand-back'}`,
    ready
      ? `Ship ${spec(n)}, PR #${impl.prNumber} (${impl.prUrl}). E2E, QA and code review all passed; the review is recorded on the PR.
${where(impl)}${from === 'ship' ? INTERRUPTED : ''}

1. \`git fetch origin\` and rebase the branch onto \`origin/main\` (other issues may have merged meanwhile). If there are conflicts, load \`mattpocock-skills:resolving-merge-conflicts\` via the Skill tool and follow it, keeping the intent of both sides; if this branch's ADR number is now taken on main, renumber it and its references.
2. Re-run the full unit + e2e suite after the rebase. If anything fails, fix it or stop with merged=false. Then push with \`git push --force-with-lease origin ${impl.branch}\`, following the pushing rule above.
3. Human-only steps: if this issue needs anything an agent cannot do (provision accounts or API keys, set secrets, configure a third-party dashboard, OAuth apps, webhooks, DNS), use the Skill tool to load \`mattpocock-skills:wizard\` and follow it to write the wizard script in the worktree (e.g. \`scripts/setup/issue-${n}.sh\`); commit and push it, return its path as humanSteps, and add a "Human steps" section to the PR body pointing to it. Otherwise skip.
4. Update the PR body: summary, "Closes #${n}", verification results (e2e, QA, review rounds), ticked acceptance criteria, ending with:\n${FOOT}
   Then mark it ready: \`gh pr ready ${impl.prNumber}\`.
${MERGE
    ? `5. Wait for CI (\`gh pr checks ${impl.prNumber} --watch\`); if it fails, fix, push, and wait again (or stop with merged=false).
6. Merge it. Run each command below as a separate Bash call, never chained with \`&&\`, \`;\` or pipes: each one is pre-approved by its own permission rule, and a chained command is not.
   a. \`gh pr view ${impl.prNumber} --json mergeable --jq .mergeable\`. If it is CONFLICTING (main moved while CI ran), go back to step 1.
   b. \`git worktree remove --force ${impl.worktree}\` (the local branch can't be deleted while checked out there).
   c. \`gh pr merge ${impl.prNumber} --squash --delete-branch --author-email dev@jobbbox.ai\`. If it fails, recreate the worktree (\`git worktree add ${impl.worktree} ${impl.branch}\`) before going back to step 1 or stopping with merged=false.
   d. Confirm issue #${n} is closed (\`gh issue close ${n}\` if not).`
    : '5. Do not merge; leave the PR open for a human.'}`
      : `Hand ${spec(n)} back to a human: it still fails after ${MAX_FIX_LOOPS} fix rounds.
${where(impl)}

Remaining failures:
${JSON.stringify(failures, null, 2)}

Push the branch. Keep PR #${impl.prNumber} as a draft; add a PR comment (\`gh pr comment ${impl.prNumber}\`) with the remaining failures and what was tried. Swap the issue's labels (\`--remove-label ready-for-agent --add-label ready-for-human\`) and unassign yourself. Keep the worktree. merged=false.`,
    { phase: 'Ship', schema: SHIP, ...CHEAP },
  ))

  return {
    issue: n,
    status: ship?.merged ? 'merged' : ready ? (MERGE ? 'merge-failed' : 'pr-open') : 'handed-back',
    branch: impl.branch,
    pr: ship?.prUrl ?? impl.prUrl,
    humanSteps: ship?.humanSteps,
    remaining: failures,
    notes: ship?.notes,
  }
}

// ---------- rolling scheduler ----------
// Keeps up to MAX_PARALLEL issues in flight; whenever one finishes (and
// possibly unblocks dependents), the frontier is re-queried for the next.
const active = new Map()
const seen = new Set()
const results = []
let launched = 0

const launch = (n, resumed) => {
  seen.add(n)
  launched++
  active.set(n, runIssue(n, resumed)
    .catch(e => ({ issue: n, status: 'error', error: String(e) }))
    .then(r => ({ n, r })))
}

RESUME.forEach(r => launch(Number(r.issue), r))
if (START && !seen.has(START)) launch(START)

while (true) {
  const slots = Math.min(MAX_PARALLEL - active.size, MAX_ISSUES - launched)
  // resumed issues may exceed MAX_PARALLEL; no new picks until below it
  if (slots > 0) {
    const pick = await pickNext(slots, [...seen])
    const fresh = (pick?.issues ?? []).map(i => i.number).filter(x => !seen.has(x)).slice(0, slots)
    fresh.forEach(launch)
    log(fresh.length
      ? `Started ${fresh.map(x => `#${x}`).join(', ')} — ${active.size} in flight`
      : `Nothing new ready. ${pick?.blocked ?? ''}`)
  }
  if (active.size === 0) break
  const { n, r } = await Promise.race(active.values())
  active.delete(n)
  results.push(r)
  log(`#${n}: ${r.status}${r.pr ? ` ${r.pr}` : ''}`)
}

if (launched >= MAX_ISSUES) log(`Stopped at maxIssues=${MAX_ISSUES}; more issues may be ready.`)

return {
  merged: results.filter(r => r.status === 'merged').map(r => r.issue),
  needsHuman: results.filter(r => r.status !== 'merged'),
  results,
}
