import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decide, mergesIn } from "./no-legal-merge.mjs";

const bash = (command: string) => ({ tool_name: "Bash", tool_input: { command } });
const legal = ["packages/help/legal/cgu/2026-12-01.fr.md", "packages/help/legal/cgu/2026-12-01.en.md"];
const code = ["apps/web/src/routes.ts"];

describe("mergesIn — the pull request merges a tool call asks for", () => {
  it("reads gh pr merge, by number, URL, branch or none (the current branch's)", () => {
    expect(mergesIn(bash("gh pr merge 612 --squash --delete-branch --author-email dev@jobbbox.ai"))).toEqual([{ pr: "612" }]);
    expect(mergesIn(bash("git fetch && gh pr merge https://github.com/fnconsult/jobhub/pull/612 --merge"))).toEqual([{ owner: "fnconsult", repo: "jobhub", pr: "612" }]);
    expect(mergesIn(bash("gh pr merge -R fnconsult/jobhub --squash 612"))).toEqual([{ owner: "fnconsult", repo: "jobhub", pr: "612" }]);
    expect(mergesIn(bash('gh pr merge --squash --subject "Légal : CGU" issue-571-cgu'))).toEqual([{ branch: "issue-571-cgu" }]);
    expect(mergesIn(bash("gh pr merge --auto --squash"))).toEqual([{}]);
  });

  it("reads a merge through the REST API and through the GitHub MCP server", () => {
    expect(mergesIn(bash("gh api -X PUT repos/fnconsult/jobhub/pulls/612/merge -f merge_method=squash"))).toEqual([{ owner: "fnconsult", repo: "jobhub", pr: "612" }]);
    expect(mergesIn({ tool_name: "mcp__github__merge_pull_request", tool_input: { owner: "fnconsult", repo: "jobhub", pullNumber: 612 } })).toEqual([
      { owner: "fnconsult", repo: "jobhub", pr: "612" },
    ]);
  });

  it("finds none in other commands", () => {
    expect(mergesIn(bash("gh pr view 612 && git merge origin/main"))).toEqual([]);
    expect(mergesIn(bash('echo "gh pr list"'))).toEqual([]);
    expect(mergesIn({ tool_name: "Read", tool_input: { file_path: "README.md" } })).toEqual([]);
  });
});

describe("decide — an agent never merges a Legal Text Version (#507)", () => {
  it("refuses gh pr merge of a pull request that touches packages/help/legal/", async () => {
    const decision = await decide(bash("gh pr merge 612 --squash"), async () => [...code, ...legal]);
    expect(decision).toMatchObject({ permissionDecision: "deny" });
    expect(decision?.permissionDecisionReason).toMatch(/pull request 612 changes packages\/help\/legal\/: only the product owner merges a Legal Text Version/);
  });

  it("refuses it through the MCP server too", async () => {
    const decision = await decide({ tool_name: "mcp__github__merge_pull_request", tool_input: { owner: "fnconsult", repo: "jobhub", pullNumber: 612 } }, async () => legal);
    expect(decision).toMatchObject({ permissionDecision: "deny" });
  });

  it("lets through the merge of a pull request that does not touch it, and any other command", async () => {
    expect(await decide(bash("gh pr merge 612 --squash"), async () => code)).toBeNull();
    expect(await decide(bash("npm test"), async () => legal)).toBeNull();
  });

  it("refuses when it cannot tell which files the pull request changes", async () => {
    const decision = await decide(bash("gh pr merge 612"), async () => {
      throw new Error("HTTP 404");
    });
    expect(decision).toMatchObject({ permissionDecision: "deny" });
    expect(decision?.permissionDecisionReason).toMatch(/could not read the files of pull request 612/);
  });

  it("asks the files of the pull request it merges", async () => {
    const asked: unknown[] = [];
    await decide(bash("gh pr merge https://github.com/fnconsult/jobhub/pull/612"), async (merge) => {
      asked.push(merge);
      return code;
    });
    expect(asked).toEqual([{ owner: "fnconsult", repo: "jobhub", pr: "612" }]);
  });
});

describe("the hook, as Claude Code runs it", () => {
  it("is declared for Bash and the MCP server's merge in .claude/settings.json", () => {
    const settings = JSON.parse(readFileSync(".claude/settings.json", "utf8"));
    expect(settings.hooks.PreToolUse).toContainEqual({
      matcher: "Bash|mcp__github__merge_pull_request",
      hooks: [{ type: "command", command: 'node "$CLAUDE_PROJECT_DIR/scripts/hooks/no-legal-merge.mjs"' }],
    });
  });

  it("reads the tool call on stdin and says nothing for a call that merges nothing", () => {
    expect(execFileSync("node", ["scripts/hooks/no-legal-merge.mjs"], { input: JSON.stringify(bash("npm test")), encoding: "utf8" })).toBe("");
  });
});
