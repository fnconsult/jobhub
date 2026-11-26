#!/usr/bin/env node
/**
 * Claude Code PreToolUse hook (.claude/settings.json): an agent never writes a secret's value where it would be kept or
 * shared (#1139, ADR-0118). Refuses a tool call whose input holds a value of a known secret, by its prefix:
 * - an Agent Key (`jbx_agent_…`, apps/web/src/agent-keys/values.ts): the key Signalement triage calls
 *   `/admin/api/signalements` with, shown once in Paramètres › « Clés d'agent »;
 * - a GitHub token (`ghp_…`, `gho_…`, `ghs_…`, `github_pat_…`), an Anthropic key (`sk-ant-…`), a Stripe live key
 *   (`sk_live_…`, `rk_live_…`).
 * Whatever the tool: a shell command (a `curl -H "Authorization: Bearer jbx_agent_…"`, an `echo` into a file, a
 * commit message), a file written or edited, an issue, a comment or a pull request sent to GitHub. An agent passes
 * the key by its environment variable (`"Authorization: Bearer $JOBBBOX_AGENT_KEY"`), which holds no value.
 * A defence for agents in Claude Code, not a lock: GitHub's secret scanning stays the last line. Reads the tool call on
 * stdin.
 */
import { pathToFileURL } from "node:url";

/** The secrets known by their prefix, each with what to call it; the value after the prefix long enough to be one. */
export const SECRET_PATTERNS = [
  // The prefix of AGENT_KEY_PREFIX, apps/web/src/agent-keys/values.ts: the test checks they agree.
  { name: "an Agent Key", pattern: /jbx_agent_[A-Za-z0-9_-]{20,}/ },
  { name: "a GitHub token", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/ },
  { name: "an Anthropic API key", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: "a Stripe live key", pattern: /\b[rs]k_live_[A-Za-z0-9]{20,}/ },
];

/** Every string a tool call's input holds, however deep. */
function stringsOf(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsOf);
  if (value && typeof value === "object") return Object.values(value).flatMap(stringsOf);
  return [];
}

/** The kind of secret a tool call holds a value of, or null. */
export function secretIn({ tool_input: input = {} }) {
  const texts = stringsOf(input);
  return SECRET_PATTERNS.find(({ pattern }) => texts.some((text) => pattern.test(text)))?.name ?? null;
}

/** The hook's answer to a tool call: a refusal, or null to let it through. */
export function decide(call) {
  const secret = secretIn(call);
  return secret
    ? {
        permissionDecision: "deny",
        permissionDecisionReason: `This call holds the value of ${secret}: never write a secret's value in a command, a file, git, an issue or a comment. Pass it by its environment variable (for an Agent Key, "Authorization: Bearer $JOBBBOX_AGENT_KEY") and say if it is missing (docs/agents/issue-tracker.md).`,
      }
    : null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const decision = decide(JSON.parse(input));
  if (decision) console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", ...decision } }));
}
