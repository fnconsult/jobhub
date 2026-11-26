import { describe, expect, it } from "vitest";
import { gitHubIssues, IssuesError } from "./github-issues";

/** A fake GitHub answering each request in turn, recording them. */
function fakeGitHub(...answers: { status: number; body?: unknown }[]) {
  const requests: { url: string; method: string; authorization: string | null; body: unknown }[] = [];
  const fetch = async (url: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    requests.push({ url, method: init.method ?? "GET", authorization: headers.get("authorization"), body: init.body ? JSON.parse(String(init.body)) : undefined });
    const answer = answers.shift() ?? { status: 500 };
    return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), { status: answer.status });
  };
  return { fetch, requests };
}

describe("GitHub's issues, as Jobbbox writes and reads them for Signalement triage (#1141, ADR-0118)", () => {
  it("opens an issue with its labels, with the token that may only write issues", async () => {
    const github = fakeGitHub({ status: 201, body: { number: 1201, html_url: "https://github.com/fnconsult/jobhub/issues/1201" } });
    const issues = gitHubIssues({ writeToken: () => "github_pat_issues", readToken: () => "github_pat_read", repository: "fnconsult/jobhub", fetch: github.fetch });

    expect(await issues.open({ title: "Un titre", body: "Un corps", labels: ["needs-triage", "signalement"] })).toEqual({ number: 1201, url: "https://github.com/fnconsult/jobhub/issues/1201" });
    expect(github.requests).toEqual([
      { url: "https://api.github.com/repos/fnconsult/jobhub/issues", method: "POST", authorization: "Bearer github_pat_issues", body: { title: "Un titre", body: "Un corps", labels: ["needs-triage", "signalement"] } },
    ]);
  });

  it("comments on an issue", async () => {
    const github = fakeGitHub({ status: 201, body: { id: 9, html_url: "https://github.com/fnconsult/jobhub/issues/1188#issuecomment-9" } });
    const issues = gitHubIssues({ writeToken: () => "github_pat_issues", readToken: () => undefined, repository: "fnconsult/jobhub", fetch: github.fetch });

    expect(await issues.comment(1188, "Un autre signalement")).toEqual({ number: 1188, url: "https://github.com/fnconsult/jobhub/issues/1188#issuecomment-9" });
    expect(github.requests[0]).toMatchObject({ url: "https://api.github.com/repos/fnconsult/jobhub/issues/1188/comments", method: "POST", body: { body: "Un autre signalement" } });
  });

  it("says why it could not write: no token, the issue not found, the token refused, GitHub failing", async () => {
    const without = gitHubIssues({ writeToken: () => " ", readToken: () => undefined, repository: "fnconsult/jobhub", fetch: fakeGitHub().fetch });
    await expect(without.open({ title: "t", body: "b", labels: [] })).rejects.toMatchObject({ reason: "missing_token" });

    for (const [status, reason] of [
      [404, "not_found"],
      [401, "refused"],
      [403, "refused"],
      [502, "failed"],
    ] as const) {
      const issues = gitHubIssues({ writeToken: () => "t", readToken: () => undefined, repository: "fnconsult/jobhub", fetch: fakeGitHub({ status }).fetch });
      const error = await issues.comment(1, "b").catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(IssuesError);
      expect(error).toMatchObject({ reason });
    }
  });

  it("finds the commit that closed an issue, with the read-only token: the latest « closed » event's", async () => {
    const github = fakeGitHub(
      { status: 200, body: { state: "closed", state_reason: "completed" } },
      {
        status: 200,
        body: [
          { event: "closed", commit_id: "1111111" },
          { event: "reopened", commit_id: null },
          { event: "closed", commit_id: "abcdef0" },
        ],
      },
    );
    const issues = gitHubIssues({ writeToken: () => undefined, readToken: () => "github_pat_read", repository: "fnconsult/jobhub", fetch: github.fetch });

    expect(await issues.closingCommit(1201)).toBe("abcdef0");
    expect(github.requests.map((request) => [request.url, request.authorization])).toEqual([
      ["https://api.github.com/repos/fnconsult/jobhub/issues/1201", "Bearer github_pat_read"],
      ["https://api.github.com/repos/fnconsult/jobhub/issues/1201/events?per_page=100", "Bearer github_pat_read"],
    ]);
  });

  it("finds no closing commit for an issue still open, closed by hand or as not planned", async () => {
    const open = gitHubIssues({ writeToken: () => undefined, readToken: () => "r", repository: "fnconsult/jobhub", fetch: fakeGitHub({ status: 200, body: { state: "open" } }).fetch });
    const notPlanned = gitHubIssues({ writeToken: () => undefined, readToken: () => "r", repository: "fnconsult/jobhub", fetch: fakeGitHub({ status: 200, body: { state: "closed", state_reason: "not_planned" } }).fetch });
    const byHand = gitHubIssues({
      writeToken: () => undefined,
      readToken: () => "r",
      repository: "fnconsult/jobhub",
      fetch: fakeGitHub({ status: 200, body: { state: "closed", state_reason: "completed" } }, { status: 200, body: [{ event: "closed", commit_id: null }] }).fetch,
    });

    expect(await open.closingCommit(1)).toBeNull();
    expect(await notPlanned.closingCommit(1)).toBeNull();
    expect(await byHand.closingCommit(1)).toBeNull();
  });

  it("says whether a commit is part of the deployed one", async () => {
    const github = fakeGitHub({ status: 200, body: { status: "ahead", behind_by: 0 } }, { status: 200, body: { status: "identical", behind_by: 0 } }, { status: 200, body: { status: "diverged", behind_by: 2 } });
    const issues = gitHubIssues({ writeToken: () => undefined, readToken: () => "r", repository: "fnconsult/jobhub", fetch: github.fetch });

    expect(await issues.contains("deployed", "fix")).toBe(true);
    expect(await issues.contains("deployed", "deployed")).toBe(true);
    expect(await issues.contains("deployed", "later")).toBe(false);
    expect(github.requests[0]!.url).toBe("https://api.github.com/repos/fnconsult/jobhub/compare/fix...deployed");
  });
});
