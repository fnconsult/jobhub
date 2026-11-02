import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decide, promotionIn } from "./no-promotion.mjs";

const bash = (command: string) => ({ tool_name: "Bash", tool_input: { command } });
const refused = (command: string) => decide(bash(command))?.permissionDecision === "deny";

describe("no-promotion — an agent never Promotes (#560, ADR-0063)", () => {
  it("refuses scripts/promote.ts, however it is launched", () => {
    for (const command of [
      "npx tsx scripts/promote.ts",
      "tsx scripts/promote.ts --rien-de-visible --yes",
      "node --experimental-strip-types ./scripts/promote.ts",
      "cd /home/user/jobhub && ./scripts/promote.ts --minor",
      "npx tsx /home/user/jobhub/scripts/promote.ts",
      'bash -c "npx tsx scripts/promote.ts --yes"',
      "npx tsx -e \"import('./scripts/promotion/promotion.ts')\"",
    ])
      expect(refused(command), command).toBe(true);
  });

  it("refuses git push to prod", () => {
    for (const command of [
      "git push origin prod",
      "git push origin HEAD:prod",
      "git push origin a1b2c3d:refs/heads/prod",
      "git push -f origin +main:prod",
      "git push --atomic origin main:prod refs/tags/v0.2.0",
      "git -C /home/user/jobhub push origin :prod",
      "git push --delete origin prod",
      "git fetch && git push -u origin prod",
      "git status\ngit push origin prod",
      "/usr/bin/git push origin prod",
      "git push --repo origin prod",
      "git push --repo=origin HEAD:prod",
      "git push --signed origin prod",
      "git push origin 'refs/heads/*:refs/heads/*'",
      "gh api -X PATCH repos/fnconsult/jobhub/git/refs/heads/prod -f sha=abc",
      "gh pr create --base prod --title x --body y",
      "gh pr edit 12 -B prod",
    ])
      expect(refused(command), command).toBe(true);
  });

  it("refuses git push of a tag v*, or of every tag or branch at once", () => {
    for (const command of [
      "git push origin v0.2.0",
      "git push origin refs/tags/v0.2.0",
      "git push origin tag v0.2.0",
      "git push origin HEAD:refs/tags/v1.0.0",
      "git push --tags",
      "git push origin --follow-tags",
      "git push --all origin",
      "git push --mirror",
      "git push origin 'refs/tags/*:refs/tags/*'",
      "gh api repos/fnconsult/jobhub/git/refs -f ref=refs/tags/v1.0.0 -f sha=abc",
    ])
      expect(refused(command), command).toBe(true);
  });

  it("refuses gh workflow run deploy.yml … production, its REST dispatch and the MCP run trigger", () => {
    for (const command of [
      "gh workflow run deploy.yml -f target=production -f confirm=jobbbox.ai",
      "gh workflow run deploy.yml --ref v0.2.0 --field target=production",
      'gh workflow run Deploy -f "target=production"',
      "echo '{\"target\":\"production\"}' | gh workflow run deploy.yml --json",
      "gh api -X POST repos/fnconsult/jobhub/actions/workflows/deploy.yml/dispatches -f ref=v0.2.0 -f inputs[target]=production",
      "/opt/homebrew/bin/gh workflow run deploy.yml -f target=production",
      "echo '{}' | gh workflow run .github/workflows/deploy.yml --json",
      "npx tsx scripts/promote --yes",
    ])
      expect(refused(command), command).toBe(true);
    expect(
      decide({ tool_name: "mcp__github__actions_run_trigger", tool_input: { method: "run_workflow", owner: "fnconsult", repo: "jobhub", workflow_id: "deploy.yml", ref: "v0.2.0", inputs: { target: "production" } } }),
    ).toMatchObject({ permissionDecision: "deny" });
    expect(decide({ tool_name: "mcp__github__actions_run_trigger", tool_input: { method: "run_workflow", workflow_id: 123456, inputs: { target: "production" } } })).toMatchObject({
      permissionDecision: "deny",
    });
    expect(decide({ tool_name: "mcp__github__create_pull_request", tool_input: { base: "prod", head: "main" } })).toMatchObject({ permissionDecision: "deny" });
  });

  it("refuses writing to prod through the GitHub MCP server", () => {
    expect(promotionIn({ tool_name: "mcp__github__create_branch", tool_input: { owner: "fnconsult", repo: "jobhub", branch: "prod", from_branch: "main" } })).toMatch(/prod branch/);
    expect(promotionIn({ tool_name: "mcp__github__push_files", tool_input: { branch: "prod", files: [] } })).toMatch(/prod branch/);
  });

  it("lets through what agents do every day", () => {
    for (const command of [
      "git push -u origin issue-560-promotion-prod",
      "git push origin HEAD",
      "git push",
      "git push origin production-notes",
      "git push origin v2-redesign",
      "gh workflow run deploy.yml -f target=staging",
      "gh workflow run ci.yml",
      "npx vitest run scripts/promotion",
      "cat scripts/promote.ts",
      "git add scripts/promote.ts scripts/promotion/promotion.ts",
      "npx eslint scripts/promote.ts",
      "grep -n nothingVisible scripts/promotion/promotion.ts",
      "git log --oneline origin/prod",
      "cat docs/ops/promotion.md",
      "gh api repos/fnconsult/jobhub/actions/runs",
    ])
      expect(refused(command), command).toBe(false);
    expect(decide({ tool_name: "Read", tool_input: { file_path: "scripts/promote.ts" } })).toBeNull();
    expect(decide({ tool_name: "mcp__github__push_files", tool_input: { branch: "issue-560-promotion-prod", files: [] } })).toBeNull();
    expect(decide({ tool_name: "mcp__github__actions_run_trigger", tool_input: { workflow_id: "deploy.yml", inputs: { target: "staging" } } })).toBeNull();
  });

  it("says why, and that the product owner runs the script outside any agent", () => {
    expect(decide(bash("git push origin prod"))?.permissionDecisionReason).toMatch(/git push to the prod branch: no agent may Promote .* The product owner runs scripts\/promote\.ts outside any agent/);
  });
});

describe("the hook, as Claude Code runs it", () => {
  it("is declared in .claude/settings.json for Bash and the MCP tools it watches", () => {
    const settings = JSON.parse(readFileSync(".claude/settings.json", "utf8"));
    expect(settings.hooks.PreToolUse).toContainEqual({
      matcher: "Bash|mcp__github__actions_run_trigger|mcp__github__create_branch|mcp__github__push_files|mcp__github__create_or_update_file|mcp__github__delete_file|mcp__github__create_pull_request|mcp__github__update_pull_request",
      hooks: [{ type: "command", command: 'node "$CLAUDE_PROJECT_DIR/scripts/hooks/no-promotion.mjs"' }],
    });
  });

  it("reads the tool call on stdin and answers a refusal Claude Code understands", () => {
    const run = (call: unknown) => execFileSync("node", ["scripts/hooks/no-promotion.mjs"], { input: JSON.stringify(call), encoding: "utf8" });
    expect(run(bash("npm test"))).toBe("");
    expect(JSON.parse(run(bash("npx tsx scripts/promote.ts")))).toMatchObject({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny" } });
  });
});
