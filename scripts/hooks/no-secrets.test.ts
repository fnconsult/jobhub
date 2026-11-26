import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AGENT_KEY_PREFIX } from "../../apps/web/src/agent-keys/values";
import { decide, SECRET_PATTERNS, secretIn } from "./no-secrets.mjs";

// Built at run time: no secret's value is ever written in git, not even a fake one.
const AGENT_KEY = `${AGENT_KEY_PREFIX}${"Ab3_-".repeat(9)}`;
const GITHUB_TOKEN = `ghp_${"a1B2".repeat(9)}`;
const bash = (command: string) => ({ tool_name: "Bash", tool_input: { command } });

describe("no-secrets — an agent never writes a secret's value (#1139, ADR-0118)", () => {
  it("knows the Agent Key's prefix as the app makes it", () => {
    expect(SECRET_PATTERNS[0]!.pattern.source.startsWith(AGENT_KEY_PREFIX)).toBe(true);
    expect(secretIn(bash(`echo ${AGENT_KEY}`))).toBe("an Agent Key");
  });

  it("refuses an Agent Key's value in a command, a file, a commit, an issue or a comment", () => {
    for (const call of [
      bash(`curl -H "Authorization: Bearer ${AGENT_KEY}" https://staging.jobbbox.ai/admin/api/signalements`),
      bash(`git commit -m "clé ${AGENT_KEY}"`),
      { tool_name: "Write", tool_input: { file_path: "/tmp/.env", content: `JOBBBOX_AGENT_KEY=${AGENT_KEY}\n` } },
      { tool_name: "Edit", tool_input: { file_path: "docs/agents/issue-tracker.md", old_string: "a", new_string: AGENT_KEY } },
      { tool_name: "mcp__github__add_issue_comment", tool_input: { owner: "fnconsult", repo: "jobhub", issue_number: 1, body: `voici la clé : ${AGENT_KEY}` } },
      { tool_name: "mcp__github__push_files", tool_input: { files: [{ path: "a.txt", content: AGENT_KEY }] } },
    ])
      expect(decide(call)?.permissionDecision, JSON.stringify(call)).toBe("deny");
  });

  it("refuses the other secrets it knows by their prefix", () => {
    expect(secretIn(bash(`gh auth login --with-token <<< ${GITHUB_TOKEN}`))).toBe("a GitHub token");
    expect(secretIn(bash(`export ANTHROPIC_API_KEY=sk-ant-${"x".repeat(30)}`))).toBe("an Anthropic API key");
    expect(secretIn(bash(`export STRIPE_SECRET_KEY=sk_live_${"x".repeat(30)}`))).toBe("a Stripe live key");
  });

  it("lets through the key passed by its variable, the prefix alone, and anything else", () => {
    for (const command of [
      'curl -H "Authorization: Bearer $JOBBBOX_AGENT_KEY" https://staging.jobbbox.ai/admin/api/signalements',
      `grep -rn "${AGENT_KEY_PREFIX}" apps/web/src`,
      "npm test",
      "sk_test_ is a test key prefix",
    ])
      expect(decide(bash(command)), command).toBeNull();
    expect(decide({ tool_name: "Read", tool_input: { file_path: "apps/web/src/agent-keys/values.ts" } })).toBeNull();
  });

  it("says why, and how to pass the key instead", () => {
    expect(decide(bash(`echo ${AGENT_KEY}`))?.permissionDecisionReason).toMatch(/value of an Agent Key.*\$JOBBBOX_AGENT_KEY/);
  });
});

describe("the hook, as Claude Code runs it", () => {
  it("is declared in .claude/settings.json for every tool that writes or sends", () => {
    const settings = JSON.parse(readFileSync(".claude/settings.json", "utf8"));
    expect(settings.hooks.PreToolUse).toContainEqual({
      matcher: "Bash|Write|Edit|MultiEdit|NotebookEdit|mcp__github__.*",
      hooks: [{ type: "command", command: 'node "$CLAUDE_PROJECT_DIR/scripts/hooks/no-secrets.mjs"' }],
    });
  });

  it("reads the tool call on stdin and answers a refusal Claude Code understands", () => {
    const run = (call: unknown) => execFileSync("node", ["scripts/hooks/no-secrets.mjs"], { input: JSON.stringify(call), encoding: "utf8" });
    expect(run(bash("npm test"))).toBe("");
    expect(JSON.parse(run(bash(`echo ${AGENT_KEY}`)))).toMatchObject({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny" } });
  });
});
