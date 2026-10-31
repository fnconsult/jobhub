#!/usr/bin/env node
/**
 * Claude Code PreToolUse hook (.claude/settings.json): an agent never merges a Legal Text Version (#507, ADR-0062).
 * Only the product owner signs a version's effective date, by merging its pull request. Refuses `gh pr merge`, a
 * `gh api -X PUT …/pulls/<n>/merge` and the GitHub MCP server's merge_pull_request of a pull request that changes
 * `packages/help/legal/`, and any such merge whose files cannot be read. Reads the tool call on stdin.
 */
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const LEGAL_PATH = "packages/help/legal/";
const PR_URL = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/;
const API_MERGE = /^\/?repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)\/merge$/;
/** The options of `gh pr merge` that take a value. */
const VALUED = new Set(["-A", "--author-email", "-b", "--body", "-F", "--body-file", "-t", "--subject", "--match-head-commit", "-R", "--repo"]);

/** A command's words, quotes removed, each run of `;`, `&&`, `||`, `|` or a new line ending a command. */
function commands(line) {
  const all = [[]];
  const pattern = /\s*(?:(;|&&|\|\||\||\n)|"((?:\\.|[^"\\])*)"|'([^']*)'|((?:\\.|[^\s;&|"'])+))/g;
  for (const [, separator, double, single, bare] of line.matchAll(pattern)) {
    if (separator) all.push([]);
    else all.at(-1).push(double ?? single ?? bare);
  }
  return all.filter((words) => words.length > 0);
}

/** The pull requests a tool call merges: `{ owner?, repo?, pr? , branch? }` each; none for a call that merges nothing. */
export function mergesIn({ tool_name: tool, tool_input: input }) {
  if (tool === "mcp__github__merge_pull_request") return [{ owner: input.owner, repo: input.repo, pr: String(input.pullNumber) }];
  if (tool !== "Bash" || typeof input?.command !== "string") return [];
  return commands(input.command).flatMap((words) => {
    const gh = words.indexOf("gh");
    if (gh < 0) return [];
    if (words[gh + 1] === "pr" && words[gh + 2] === "merge") return [prMerge(words.slice(gh + 3))];
    if (words[gh + 1] === "api" && words.some((word, at) => /^(-XPUT|--method=PUT)$/i.test(word) || (/^(-X|--method)$/.test(word) && /^put$/i.test(words[at + 1] ?? "")))) {
      const route = words.map((word) => API_MERGE.exec(word)).find(Boolean);
      return route ? [{ owner: route[1], repo: route[2], pr: route[3] }] : [];
    }
    return [];
  });
}

/** The pull request `gh pr merge <args>` names. */
function prMerge(args) {
  const merge = {};
  for (let at = 0; at < args.length; at++) {
    const word = args[at];
    if (word === "-R" || word === "--repo" || word.startsWith("--repo=")) {
      const [owner, repo] = (word.startsWith("--repo=") ? word.slice(7) : args[++at] ?? "").split("/");
      Object.assign(merge, { owner, repo });
    } else if (VALUED.has(word)) at++;
    else if (!word.startsWith("-")) {
      const url = PR_URL.exec(word);
      if (url) Object.assign(merge, { owner: url[1], repo: url[2], pr: url[3] });
      else if (/^#?\d+$/.test(word)) merge.pr = word.replace("#", "");
      else merge.branch = word;
    }
  }
  return merge;
}

/** The files a pull request changes, from GitHub's REST API (`gh` resolves `{owner}/{repo}` from the checkout). */
function filesOnGitHub({ owner, repo, pr, branch }) {
  const gh = (...args) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const where = owner && repo ? `${owner}/${repo}` : "{owner}/{repo}";
  const number = pr ?? gh("pr", "view", ...(branch ? [branch] : []), ...(owner && repo ? ["--repo", where] : []), "--json", "number", "--jq", ".number");
  return gh("api", "--paginate", `repos/${where}/pulls/${number}/files`, "--jq", ".[].filename").split("\n").filter(Boolean);
}

/** The hook's answer to a tool call: a refusal, or null to let it through. `filesOf` reads a pull request's files. */
export async function decide(call, filesOf = filesOnGitHub) {
  for (const merge of mergesIn(call)) {
    const named = merge.pr ?? merge.branch ?? "of this branch";
    let files;
    try {
      files = await filesOf(merge);
    } catch (error) {
      return refuse(`could not read the files of pull request ${named} (${error.message.split("\n")[0]}): an agent never merges a pull request that may change ${LEGAL_PATH}`);
    }
    if (files.some((file) => file.startsWith(LEGAL_PATH)))
      return refuse(`pull request ${named} changes ${LEGAL_PATH}: only the product owner merges a Legal Text Version, signing its effective date (#507)`);
  }
  return null;
}

const refuse = (reason) => ({ permissionDecision: "deny", permissionDecisionReason: reason });

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const decision = await decide(JSON.parse(input));
  if (decision) console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", ...decision } }));
}
