/**
 * GitHub's issues, as Signalement triage needs them (#1141, ADR-0118), on Jobbbox's public repository:
 *  - `open` and `comment`, with GITHUB_ISSUES_TOKEN, a Provider Secret that may only write issues: what Jobbbox publishes
 *    once the text passed Redaction and the « Données du Candidate dans une issue » Guardrail. The agent never writes to
 *    GitHub itself;
 *  - `closingCommit` and `contains`, with the read-only GITHUB_STATUS_TOKEN (Livraison's): which commit closed an issue,
 *    and whether it is part of a deployed one, for « Prêt à clore ».
 * A failure throws an IssuesError saying why (`missing_token`, `not_found`, `refused`, `failed`), never GitHub's answer.
 */

/** Why GitHub could not be written or read. */
export type IssuesErrorReason = "missing_token" | "not_found" | "refused" | "failed";

export class IssuesError extends Error {
  constructor(readonly reason: IssuesErrorReason) {
    super(`GitHub's issues: ${reason}`);
    this.name = "IssuesError";
  }
}

export interface GitHubIssues {
  /** Opens an issue; its number and page. */
  open(issue: { title: string; body: string; labels: readonly string[] }): Promise<{ number: number; url: string }>;
  /** Comments on the issue `number`; its number and the comment's page. */
  comment(number: number, body: string): Promise<{ number: number; url: string }>;
  /**
   * The commit that closed the issue `number`: its latest « closed » event's, or, when a pull request's merge closed it
   * (GitHub's event then has no commit), that pull request's merge commit. Null when it is open, not completed, or
   * closed by hand.
   */
  closingCommit(number: number): Promise<string | null>;
  /** Whether `commit` is part of `deployed` (the same commit, or an ancestor). */
  contains(deployed: string, commit: string): Promise<boolean>;
}

export interface GitHubIssuesDeps {
  /** GITHUB_ISSUES_TOKEN, read on each call (Provider Secrets over env). */
  writeToken: () => string | undefined;
  /** GITHUB_STATUS_TOKEN, read on each call. */
  readToken: () => string | undefined;
  /** `owner/name`. */
  repository: string;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  /** GITHUB_API_URL; GitHub's own by default. */
  apiUrl?: string;
}

/** An event of an issue's timeline, as far as `closingCommit` reads it. */
interface TimelineEvent {
  event: string;
  created_at?: string;
  commit_id?: string | null;
  /** A « cross-referenced » event's: the issue or pull request that mentioned this one. */
  source?: { issue?: { number: number; pull_request?: { merged_at: string | null } | null; repository?: { full_name: string } } };
}

/** The timeline's pages read at most (100 events each). */
const TIMELINE_PAGES = 10;
/** GitHub closes the issues a pull request closes within seconds of its merge; a close later than this is by hand. */
const CLOSED_BY_MERGE_WITHIN_MS = 10 * 60_000;

export function gitHubIssues(deps: GitHubIssuesDeps): GitHubIssues {
  const fetch = deps.fetch ?? globalThis.fetch;
  const base = (deps.apiUrl || "https://api.github.com").replace(/\/$/, "");

  async function call<T>(token: string | undefined, path: string, body?: unknown): Promise<T> {
    const bearer = token?.trim();
    if (!bearer) throw new IssuesError("missing_token");
    let response: Response;
    try {
      response = await fetch(`${base}/repos/${deps.repository}/${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${bearer}`,
          "X-GitHub-Api-Version": "2022-11-28",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new IssuesError("failed");
    }
    if (response.status === 404 || response.status === 410) throw new IssuesError("not_found");
    if (response.status === 401 || response.status === 403) throw new IssuesError("refused");
    if (!response.ok) throw new IssuesError("failed");
    return (await response.json()) as T;
  }

  return {
    async open({ title, body, labels }) {
      const issue = await call<{ number: number; html_url: string }>(deps.writeToken(), "issues", { title, body, labels: [...labels] });
      return { number: issue.number, url: issue.html_url };
    },

    async comment(number, body) {
      const comment = await call<{ html_url: string }>(deps.writeToken(), `issues/${number}/comments`, { body });
      return { number, url: comment.html_url };
    },

    async closingCommit(number) {
      const issue = await call<{ state: string; state_reason?: string | null }>(deps.readToken(), `issues/${number}`);
      if (issue.state !== "closed" || (issue.state_reason && issue.state_reason !== "completed")) return null;
      const timeline: TimelineEvent[] = [];
      for (let page = 1; page <= TIMELINE_PAGES; page++) {
        const events = await call<TimelineEvent[]>(deps.readToken(), `issues/${number}/timeline?per_page=100&page=${page}`);
        timeline.push(...events);
        if (events.length < 100) break;
      }
      const closed = timeline.filter((event) => event.event === "closed").at(-1);
      if (!closed) return null;
      // Closed by a commit pushed to the default branch.
      if (closed.commit_id) return closed.commit_id;
      // Closed by a pull request's merge: GitHub's « closed » event has no commit then, and does not name the pull
      // request. It is the one of this repository, mentioning the issue, merged just before it was closed.
      const closedAt = Date.parse(closed.created_at ?? "");
      if (Number.isNaN(closedAt)) return null;
      const closer = timeline
        .flatMap((event) => {
          const source = event.event === "cross-referenced" ? event.source?.issue : undefined;
          const mergedAt = Date.parse(source?.pull_request?.merged_at ?? "");
          if (!source || source.repository?.full_name !== deps.repository || Number.isNaN(mergedAt)) return [];
          return mergedAt <= closedAt && closedAt - mergedAt <= CLOSED_BY_MERGE_WITHIN_MS ? [{ number: source.number, mergedAt }] : [];
        })
        .sort((a, b) => b.mergedAt - a.mergedAt)[0];
      if (!closer) return null;
      const pull = await call<{ merge_commit_sha: string | null }>(deps.readToken(), `pulls/${closer.number}`);
      return pull.merge_commit_sha ?? null;
    },

    async contains(deployed, commit) {
      const compared = await call<{ status: string; behind_by: number }>(deps.readToken(), `compare/${commit}...${deployed}`);
      return compared.status === "identical" || (compared.status === "ahead" && compared.behind_by === 0);
    },
  };
}
