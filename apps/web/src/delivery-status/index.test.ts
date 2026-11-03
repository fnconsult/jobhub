import { describe, expect, it } from "vitest";
import {
  deliveryStatus,
  gitHubReader,
  GitHubApiError,
  rollUp,
  type GitHubReader,
  type Ticket,
} from "./index";

const REPO = "acme/app";
const NOW = new Date("2026-11-03T12:00:00Z");

type RawTicket = ReturnType<typeof ticket>;

function ticket(
  number: number,
  extra: Partial<{
    state: string;
    stateReason: string | null;
    closedAt: string | null;
    assignees: string[];
    labels: string[];
    blockedBy: { number: number; state: string }[];
    prs: object[];
  }> = {},
) {
  return {
    number,
    title: `Ticket ${number}`,
    url: `https://github.com/${REPO}/issues/${number}`,
    state: extra.state ?? "OPEN",
    stateReason: extra.stateReason ?? null,
    closedAt: extra.closedAt ?? null,
    assignees: { nodes: (extra.assignees ?? []).map((login) => ({ login })) },
    labels: { nodes: (extra.labels ?? []).map((name) => ({ name })) },
    blockedBy: { nodes: extra.blockedBy ?? [] },
    closedByPullRequestsReferences: { nodes: extra.prs ?? [] },
  };
}

const pr = (
  number: number,
  state: "OPEN" | "MERGED",
  extra: Partial<{ isDraft: boolean; oid: string; checks: string }> = {},
) => ({
  number,
  url: `https://github.com/${REPO}/pull/${number}`,
  state,
  isDraft: extra.isDraft ?? false,
  mergedAt: state === "MERGED" ? "2026-11-01T10:00:00Z" : null,
  mergeCommit: extra.oid ? { oid: extra.oid } : null,
  commits: {
    nodes: [
      {
        commit: {
          statusCheckRollup: extra.checks ? { state: extra.checks } : null,
        },
      },
    ],
  },
});

/** A fake GitHub: staging deployed at `stg`, holding commits `a` and `b`; production has no Environment. */
function fakeGitHub(
  parents: Record<number, RawTicket & { subIssues: { nodes: RawTicket[] } }>,
  options: {
    epics?: number[];
    features?: { number: number; title: string }[];
    openPrs?: object[];
  } = {},
): GitHubReader & { calls: string[] } {
  const calls: string[] = [];
  const inStaging = new Set(["a", "b"]);
  return {
    calls,
    async rest<T>(path: string) {
      calls.push(path);
      if (path.endsWith("/environments"))
        return { environments: [{ name: "staging" }] } as T;
      if (path.includes("/deployments?environment=staging"))
        return [{ id: 1, sha: "stg", ref: "main" }] as T;
      if (path.endsWith("/deployments/1/statuses"))
        return [
          {
            state: "success",
            created_at: "2026-11-02T09:00:00Z",
            environment_url: "https://staging.example",
            log_url: "https://github.com/run/1",
          },
        ] as T;
      const compare = /compare\/(\w+)\.\.\.(\w+)$/.exec(path);
      if (compare?.[2] === "main") return { ahead_by: 3, behind_by: 0 } as T;
      if (compare)
        return {
          status: inStaging.has(compare[1]!) ? "ahead" : "diverged",
        } as T;
      if (path.includes("/issues?labels="))
        return (options.epics ?? []).map((n) => ({
          number: n,
          title: `Carte ${n}`,
          state: "open",
          closed_at: null,
        })) as T;
      if (path.startsWith("search/issues"))
        return {
          items: (options.features ?? []).map((f) => ({
            ...f,
            state: "open",
            closed_at: null,
          })),
        } as T;
      throw new Error(`unexpected ${path}`);
    },
    async graphql<T>(query: string) {
      if (query.includes("pullRequests(states: OPEN"))
        return {
          repository: { pullRequests: { nodes: options.openPrs ?? [] } },
        } as T;
      const numbers = [...query.matchAll(/i(\d+): issue/g)].map((m) =>
        Number(m[1]),
      );
      return {
        repository: Object.fromEntries(
          numbers.map((n) => [`i${n}`, parents[n] ?? null]),
        ),
      } as T;
    },
  };
}

const healthy = (commit: string) => async () =>
  new Response(JSON.stringify({ commit }), { status: 200 });

describe("deliveryStatus", () => {
  it("puts each ticket at the Stage its evidence shows, under its Feature and epic", async () => {
    const tickets = [
      ticket(11, {
        state: "CLOSED",
        closedAt: "2026-11-01T10:00:00Z",
        prs: [pr(101, "MERGED", { oid: "a" })],
      }),
      ticket(12, {
        state: "CLOSED",
        closedAt: "2026-11-01T10:00:00Z",
        prs: [pr(102, "MERGED", { oid: "z" })],
      }),
      ticket(13, { prs: [pr(103, "OPEN", { checks: "SUCCESS" })] }),
      ticket(14, { prs: [pr(104, "OPEN", { isDraft: true })] }),
      ticket(15, { blockedBy: [{ number: 13, state: "OPEN" }] }),
      ticket(16, { assignees: ["octo"] }),
      ticket(17, { labels: ["ready-for-agent"] }),
      ticket(18, { labels: ["needs-triage"] }),
      ticket(19, {
        state: "CLOSED",
        stateReason: "NOT_PLANNED",
        closedAt: "2026-11-01T10:00:00Z",
      }),
    ];
    const github = fakeGitHub(
      {
        10: {
          ...ticket(10),
          title: "Suivi : Livraison (#1)",
          subIssues: { nodes: tickets },
        },
        1: {
          ...ticket(1, { labels: ["wayfinder:map"] }),
          title: "Carte 1",
          subIssues: {
            nodes: [
              ticket(10),
              ticket(2, {
                state: "CLOSED",
                closedAt: "2026-10-01T00:00:00Z",
                labels: ["wayfinder:research"],
              }),
            ],
          },
        },
      },
      {
        epics: [1],
        features: [{ number: 10, title: "Suivi : Livraison (#1)" }],
      },
    );

    const status = await deliveryStatus(github, {
      repository: REPO,
      now: NOW,
      fetchHealth: healthy("stg"),
    });

    const feature = status.epics[0]!.features[0]!;
    expect(
      Object.fromEntries(feature.tickets.map((t) => [t.number, t.stage])),
    ).toEqual({
      11: "onStaging",
      12: "merged",
      13: "inReview",
      14: "implementing",
      15: "blocked",
      16: "claimed",
      17: "readyAgent",
      18: "triage",
      19: "dropped",
    });
    expect(
      feature.tickets.find((t) => t.number === 13)!.evidence.pullRequest,
    ).toMatchObject({ number: 103, checks: "success" });
    expect(feature.headline).toEqual({
      kind: "building",
      tickets: [13, 14, 16],
    });
    expect(status.epics[0]!.discovery).toEqual({ closed: 1, total: 1 });
    expect(
      status.inFlight.tickets.map((t) => [t.ticket.number, t.under]),
    ).toEqual([
      [13, 10],
      [14, 10],
      [16, 10],
    ]);
  });

  it("checks each environment against its live /api/health, and says what it cannot vouch for", async () => {
    const github = fakeGitHub({});
    const differs = await deliveryStatus(github, {
      repository: REPO,
      now: NOW,
      fetchHealth: healthy("other"),
    });
    expect(differs.environments).toEqual([
      expect.objectContaining({
        name: "staging",
        missing: false,
        deployment: expect.objectContaining({ sha: "stg" }),
        live: { checked: true, revision: "other" },
      }),
      { name: "production", missing: true, deployment: null, live: null },
    ]);
    expect(differs.caveats).toContainEqual({
      kind: "liveDiffers",
      environment: "staging",
      live: "other",
      deployed: "stg",
    });
    expect(differs.mainVersusStaging).toEqual({ ahead: 3, behind: 0 });

    const down = await deliveryStatus(github, {
      repository: REPO,
      now: NOW,
      fetchHealth: async () => Promise.reject(new Error("down")),
    });
    expect(down.environments[0]!.live).toEqual({
      checked: false,
      reason: { kind: "unreachable" },
    });
    expect(down.caveats).toContainEqual({
      kind: "liveUnverified",
      environment: "staging",
    });
  });

  it("lists open pull requests that close no tracked ticket, and an open issue whose pull request is merged", async () => {
    const github = fakeGitHub(
      {
        10: {
          ...ticket(10),
          title: "Suivi : X (#99)",
          subIssues: {
            nodes: [ticket(11, { prs: [pr(101, "MERGED", { oid: "b" })] })],
          },
        },
      },
      {
        features: [{ number: 10, title: "Suivi : X (#99)" }],
        openPrs: [
          {
            number: 200,
            title: "Chore",
            url: "u",
            isDraft: false,
            closingIssuesReferences: { nodes: [] },
          },
          {
            number: 201,
            title: "Tracked",
            url: "u",
            isDraft: false,
            closingIssuesReferences: { nodes: [{ number: 11 }] },
          },
        ],
      },
    );
    const status = await deliveryStatus(github, {
      repository: REPO,
      now: NOW,
      fetchHealth: healthy("stg"),
    });
    expect(status.inFlight.pullRequests.map((p) => p.number)).toEqual([200]);
    expect(status.caveats).toContainEqual({
      kind: "openButMerged",
      issue: 11,
      pullRequest: 101,
    });
    expect(status.orphans).toEqual([
      { epic: 99, features: [expect.objectContaining({ number: 10 })] },
    ]);
  });

  it("asks GitHub once per merge commit and deployment", async () => {
    const shared = () =>
      ticket(0, {
        state: "CLOSED",
        closedAt: "2026-11-01T00:00:00Z",
        prs: [pr(1, "MERGED", { oid: "a" })],
      });
    const github = fakeGitHub(
      {
        10: {
          ...ticket(10),
          title: "Suivi : X",
          subIssues: { nodes: [shared(), shared(), shared()] },
        },
      },
      { features: [{ number: 10, title: "Suivi : X" }] },
    );
    await deliveryStatus(github, {
      repository: REPO,
      now: NOW,
      fetchHealth: healthy("stg"),
    });
    expect(
      github.calls.filter((c) => c.includes("compare/a...stg")),
    ).toHaveLength(1);
  });
});

describe("rollUp", () => {
  const t = (stage: Ticket["stage"]): Ticket => ({
    number: 1,
    title: "",
    url: "",
    stage,
    evidence: {},
  });
  it("says how far a Feature got", () => {
    expect(rollUp([]).headline).toEqual({ kind: "notSplit" });
    expect(rollUp([t("onProduction"), t("dropped")]).headline).toEqual({
      kind: "shipped",
    });
    expect(rollUp([t("onProduction"), t("merged")]).headline).toEqual({
      kind: "awaitingDeploy",
    });
    expect(rollUp([t("onStaging")]).headline).toEqual({
      kind: "notInProduction",
    });
    expect(rollUp([t("readyAgent"), t("onStaging")]).headline).toEqual({
      kind: "idle",
    });
    expect(
      rollUp([t("readyAgent"), t("readyAgent"), t("merged")]).counts,
    ).toEqual([
      { stage: "readyAgent", count: 2 },
      { stage: "merged", count: 1 },
    ]);
  });
});

describe("gitHubReader", () => {
  it("sends the token, and fails with the status but never the token", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const reader = gitHubReader("ghp_secret", async (url, init) => {
      seen.push({ url, init });
      return new Response("{}", { status: 401 });
    });
    const error = await reader.rest("repos/acme/app").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitHubApiError);
    expect((error as GitHubApiError).status).toBe(401);
    expect(String(error)).not.toContain("ghp_secret");
    expect(seen[0]!.url).toBe("https://api.github.com/repos/acme/app");
    expect(
      (seen[0]!.init.headers as Record<string, string>).authorization,
    ).toBe("Bearer ghp_secret");
  });
});
