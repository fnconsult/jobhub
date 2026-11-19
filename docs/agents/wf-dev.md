# `/wf-dev`: its arguments

`/wf-dev` (`.claude/workflows/wf-dev.js`) delivers `ready-for-agent` issues end to end. What it delivers depends on its argument, read by `parseArgs` in the workflow (tested in `scripts/workflows/wf-dev-args.test.ts`).

| Argument | Issues delivered |
| --- | --- |
| nothing (or blank) | the frontier: `ready-for-agent`, unassigned, unblocked issues by priority, up to `maxIssues` (1000) |
| `1079` or `#1079` | #1079 only |
| `1079 1080`, `#1050, #1052` | exactly those issues, in that order, `maxParallel` at a time |
| `1079` followed by text (a paragraph of instructions) | #1079 only: the text is ignored, numbers included |
| `{issue: 1079, merge: false, …}` | #1079 only, with those options |
| `{maxParallel: 3, resume: […]}` | the `resume` issues, then the frontier |

Rules:

- The **first** issue number in the text starts the list. The numbers **right after it on the same line**, separated by spaces or commas, complete it. Put the numbers first and the instructions after a line break: `1079 2 points` reads as #1079 and #2.
- A number glued to a word, a hyphen or a dot (`issue-1079`, `ADR-0063`, `v1.2`) is not an issue number.
- When numbers are given, the run delivers **only** those issues and never falls back on the frontier. `maxIssues` defaults to their count.
- A non-empty argument without a valid issue number, an issue number of 0, or an object whose `issue` is not a positive integer **stops the run with an error** listing the accepted forms. It never picks an issue from the frontier instead.
- `merge` defaults to `true`: each PR is merged once green. The run's first log line says whether it will merge. Pass `{issue: 1079, merge: false}` to leave the PRs open for a human.
