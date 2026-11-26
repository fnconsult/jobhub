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
      ["https://api.github.com/repos/fnconsult/jobhub/issues/1201/timeline?per_page=100&page=1", "Bearer github_pat_read"],
    ]);
  });

  /** A pull request of `repository` mentioning the issue, as the timeline's « cross-referenced » event has it. */
  const crossReferenced = (number: number, mergedAt: string | null, at: string, repository = "fnconsult/jobhub") => ({
    event: "cross-referenced",
    created_at: at,
    source: { type: "issue", issue: { number, pull_request: { merged_at: mergedAt }, repository: { full_name: repository } } },
  });

  it("finds the merge commit of the pull request that closed an issue: GitHub's « closed » event then has no commit (#1139, closed by #1143)", async () => {
    const github = fakeGitHub(
      { status: 200, body: { state: "closed", state_reason: "completed" } },
      {
        status: 200,
        body: [
          // Mentioned, merged before, but it did not close the issue.
          crossReferenced(1142, "2026-11-26T09:45:37Z", "2026-11-26T08:00:00Z"),
          // From another repository, merged the same second.
          crossReferenced(12, "2026-11-26T15:59:06Z", "2026-11-26T10:00:00Z", "someone/fork"),
          crossReferenced(1143, "2026-11-26T15:59:06Z", "2026-11-26T14:00:00Z"),
          // Still open.
          crossReferenced(1144, null, "2026-11-26T15:00:00Z"),
          { event: "referenced", commit_id: "20616b6bfa853005b6903a5dfdbef8f4d73fd842", created_at: "2026-11-26T15:59:07Z" },
          { event: "closed", commit_id: null, created_at: "2026-11-26T15:59:08Z", state_reason: null },
        ],
      },
      { status: 200, body: { number: 1143, merged_at: "2026-11-26T15:59:06Z", merge_commit_sha: "20616b6bfa853005b6903a5dfdbef8f4d73fd842" } },
    );
    const issues = gitHubIssues({ writeToken: () => undefined, readToken: () => "github_pat_read", repository: "fnconsult/jobhub", fetch: github.fetch });

    expect(await issues.closingCommit(1139)).toBe("20616b6bfa853005b6903a5dfdbef8f4d73fd842");
    expect(github.requests.map((request) => [request.url, request.authorization])).toEqual([
      ["https://api.github.com/repos/fnconsult/jobhub/issues/1139", "Bearer github_pat_read"],
      ["https://api.github.com/repos/fnconsult/jobhub/issues/1139/timeline?per_page=100&page=1", "Bearer github_pat_read"],
      ["https://api.github.com/repos/fnconsult/jobhub/pulls/1143", "Bearer github_pat_read"],
    ]);
  });

  it("does not take a pull request merged after the issue was closed, nor one merged long before (#1128: closed by #1129, mentioned by #1132 and #1136 merged later)", async () => {
    const issues = (timeline: unknown[]) =>
      gitHubIssues({
        writeToken: () => undefined,
        readToken: () => "r",
        repository: "fnconsult/jobhub",
        fetch: fakeGitHub(
          { status: 200, body: { state: "closed", state_reason: "completed" } },
          { status: 200, body: timeline },
          { status: 200, body: { number: 1129, merged_at: "2026-11-26T08:44:00Z", merge_commit_sha: "3ef257c9" } },
        ).fetch,
      });
    const closed = { event: "closed", commit_id: null, created_at: "2026-11-26T08:44:03Z" };

    expect(
      await issues([crossReferenced(1129, "2026-11-26T08:44:00Z", "2026-11-25T19:00:00Z"), crossReferenced(1132, "2026-11-26T11:03:25Z", "2026-11-25T19:49:22Z"), crossReferenced(1136, "2026-11-26T14:48:13Z", "2026-11-26T00:18:37Z"), closed]).closingCommit(1128),
    ).toBe("3ef257c9");
    // Closed by hand a day after a pull request that only mentioned it.
    expect(await issues([crossReferenced(1129, "2026-11-25T08:44:00Z", "2026-11-25T07:00:00Z"), closed]).closingCommit(1128)).toBeNull();
    // Only pull requests merged after it was closed.
    expect(await issues([crossReferenced(1132, "2026-11-26T11:03:25Z", "2026-11-25T19:49:22Z"), closed]).closingCommit(1128)).toBeNull();
  });

  it("reads the whole timeline, page after page, for the latest « closed » event", async () => {
    const page = (from: number) => Array.from({ length: 100 }, (_, index) => ({ event: "referenced", commit_id: `c${from + index}`, created_at: "2026-11-01T00:00:00Z" }));
    const github = fakeGitHub(
      { status: 200, body: { state: "closed", state_reason: "completed" } },
      { status: 200, body: [{ event: "closed", commit_id: "first", created_at: "2026-10-01T00:00:00Z" }, ...page(0).slice(1)] },
      { status: 200, body: page(100) },
      { status: 200, body: [{ event: "reopened", commit_id: null }, { event: "closed", commit_id: "latest", created_at: "2026-11-02T00:00:00Z" }] },
    );
    const issues = gitHubIssues({ writeToken: () => undefined, readToken: () => "r", repository: "fnconsult/jobhub", fetch: github.fetch });

    expect(await issues.closingCommit(1)).toBe("latest");
    expect(github.requests.map((request) => request.url.split("timeline")[1])).toEqual([undefined, "?per_page=100&page=1", "?per_page=100&page=2", "?per_page=100&page=3"]);
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
