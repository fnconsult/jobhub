#!/usr/bin/env node
/**
 * Claude Code PreToolUse hook (.claude/settings.json): no agent may Promote (ADR-0063, #560). Only the product owner
 * runs scripts/promote.ts, outside any agent. Refuses an agent:
 * - running scripts/promote.ts or its module (scripts/promotion/promotion.ts) with anything that runs a script;
 * - `git push` to the `prod` branch, of a tag `v*`, of a glob of branches or tags, or of every branch or tag at once
 *   (`--all`, `--mirror`, `--tags`, `--follow-tags`);
 * - deploying Production: `gh workflow run` with `production`, its REST dispatch, and the GitHub MCP server's run
 *   trigger with `production`;
 * - writing `prod` or a `v*` tag otherwise: the REST refs API, a pull request whose base is `prod`, and the GitHub
 *   MCP server's branch writes.
 * Re-running a Production deploy is not refused: it redeploys a tag the guard of deploy.yml already let through.
 * A defence for agents in Claude Code, not a lock: docs/ops/promotion.md recommends a GitHub rule on prod and v*.
 * Reads the tool call on stdin.
 */
import { pathToFileURL } from "node:url";
import { allCommands, callsOf } from "./shell-words.mjs";

/** git's own options that take a value, before its subcommand. */
const GIT_VALUED = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--config-env"]);
/** `git push` options that take a value as the next word. */
const PUSH_VALUED = new Set(["--receive-pack", "--exec", "-o", "--push-option"]);
const PUSH_EVERYTHING = new Set(["--all", "--mirror", "--tags", "--follow-tags", "--branches"]);

const isProd = (ref) => /^(refs\/heads\/)?prod$/.test(ref);
/** A Version's tag `vX.Y…`, bare or as `refs/tags/v…`. */
const isVersionTag = (ref) => /^refs\/tags\/v/.test(ref) || /^v\d+\.\d+/.test(ref);

/** Why `git push <args>` is refused, or null. */
function pushRefusal(args) {
  const positional = [];
  let remoteNamed = false;
  for (let at = 0; at < args.length; at++) {
    const word = args[at];
    if (PUSH_EVERYTHING.has(word)) return `git push ${word} pushes every branch or tag, prod and the Version tags included`;
    if (word === "--repo" || word.startsWith("--repo=")) {
      remoteNamed = true;
      if (word === "--repo") at++;
    } else if (PUSH_VALUED.has(word)) at++;
    else if (!word.startsWith("-")) positional.push(word);
  }
  // `git push [<remote>] [tag <name>] <refspec>…`: the remote first, unless --repo names it.
  const refspecs = remoteNamed ? positional : positional.slice(1);
  for (let at = 0; at < refspecs.length; at++) {
    const spec = refspecs[at].replace(/^\+/, "");
    if (spec === "tag" && refspecs[at + 1] && isVersionTag(refspecs[at + 1])) return `git push of the tag ${refspecs[at + 1]}`;
    const destination = spec.includes(":") ? spec.slice(spec.indexOf(":") + 1) : spec;
    if (isProd(destination)) return "git push to the prod branch";
    if (isVersionTag(destination)) return `git push of the tag ${destination}`;
    if (destination.includes("*")) return `git push of the glob ${destination}, which may hold prod or a Version tag`;
  }
  return null;
}

/** The Promotion's code: the script and its module. Reading, editing, testing or committing it stays allowed. */
const PROMOTION_CODE = /(^|[/'"(])(\.\/)?scripts\/promot(e(\.ts)?|ion\/promotion(\.ts)?)(['")]|$)|(^|\/)promote\.ts$/;
/** What runs a script named after it, as in `npx tsx scripts/promote.ts` or `node -e "import('…')"`. */
const RUNNERS = new Set(["node", "tsx", "ts-node", "vite-node", "bun", "deno", "sh", "bash", "zsh", "source", ".", "exec"]);
/** The workflow that deploys, by name, file or path. */
const DEPLOY_WORKFLOW = /^(Deploy|(.*\/)?deploy(\.ya?ml)?|\d+)$/;

/** Why `gh <args>` is refused, or null. */
function ghRefusal(args) {
  const production = args.some((word) => /production/i.test(word));
  const [group, command] = args;
  if (group === "workflow" && command === "run") {
    if (production) return "gh workflow run with production deploys Production";
    if (args.includes("--json") && args.slice(2).some((word) => DEPLOY_WORKFLOW.test(word))) return "gh workflow run deploy.yml --json may deploy Production (its inputs come from stdin)";
  }
  if (group === "api") {
    if (args.some((word) => /actions\/workflows\/[^/]+\/dispatches/.test(word)) && (production || args.includes("--input"))) return "dispatching a workflow with production deploys Production";
    if (args.some((word) => /git\/refs\/(heads\/prod$|tags\/v)/.test(word))) return "writing prod or a Version tag through the refs API";
    if (args.some((word) => /git\/(refs|tags)$/.test(word)) && args.some((word) => /refs\/(heads\/prod$|tags\/v)|^tag=v/.test(word))) return "creating prod or a Version tag through the API";
  }
  if (group === "pr" && (command === "create" || command === "edit")) {
    for (let at = 2; at < args.length; at++) {
      const base = args[at] === "--base" || args[at] === "-B" ? args[at + 1] : args[at].startsWith("--base=") ? args[at].slice(7) : null;
      if (base !== null && isProd(base ?? "")) return "a pull request into prod";
    }
  }
  return null;
}

/** Why one command's words are refused, or null. */
function wordsRefusal(words) {
  const script = words.findIndex((word) => PROMOTION_CODE.test(word));
  if (script === 0 || (script > 0 && words.slice(0, script).some((word) => RUNNERS.has(word.split("/").at(-1)))))
    return "scripts/promote.ts runs the Promotion";
  for (const git of callsOf(words, "git")) {
    let at = git + 1;
    while (at < words.length && words[at].startsWith("-")) at += GIT_VALUED.has(words[at]) ? 2 : 1;
    const refusal = words[at] === "push" ? pushRefusal(words.slice(at + 1)) : null;
    if (refusal) return refusal;
  }
  for (const gh of callsOf(words, "gh")) {
    const refusal = ghRefusal(words.slice(gh + 1));
    if (refusal) return refusal;
  }
  return null;
}

/** The GitHub MCP server's tools that write to a branch, and the argument naming it. */
const MCP_BRANCH_WRITES = {
  mcp__github__create_branch: "branch",
  mcp__github__push_files: "branch",
  mcp__github__create_or_update_file: "branch",
  mcp__github__delete_file: "branch",
  mcp__github__create_pull_request: "base",
  mcp__github__update_pull_request: "base",
};

/** Why a tool call Promotes, or null. */
export function promotionIn({ tool_name: tool, tool_input: input = {} }) {
  if (tool === "Bash" && typeof input.command === "string") {
    for (const words of allCommands(input.command)) {
      const refusal = wordsRefusal(words);
      if (refusal) return refusal;
    }
    return null;
  }
  if (tool === "mcp__github__actions_run_trigger" && /production/i.test(JSON.stringify(input.inputs ?? {}))) return "running a workflow with production deploys Production";
  if (tool in MCP_BRANCH_WRITES && isProd(String(input[MCP_BRANCH_WRITES[tool]] ?? ""))) return "writing to the prod branch";
  return null;
}

/** The hook's answer to a tool call: a refusal, or null to let it through. */
export function decide(call) {
  const refusal = promotionIn(call);
  return refusal
    ? {
        permissionDecision: "deny",
        permissionDecisionReason: `${refusal}: no agent may Promote or deploy Production (ADR-0063). The product owner runs scripts/promote.ts outside any agent (docs/ops/promotion.md).`,
      }
    : null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const decision = decide(JSON.parse(input));
  if (decision) console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", ...decision } }));
}
