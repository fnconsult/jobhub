/**
 * Delivery status (Back Office › Livraison): what is being built and where it runs, read live from GitHub's issues,
 * sub-issues, pull requests and deployments, and checked against what each environment's `/api/health` serves (#559).
 * Read-only: nothing here writes to GitHub.
 *
 * Hierarchy, as wayfinder and wf-dev write it (docs/agents/issue-tracker.md):
 *   Epic     an issue labelled `wayfinder:map` (« Carte : … »)
 *   Feature  a tracking issue titled « Suivi : … (#<epic>) », whose sub-issues are the tickets
 *   Ticket   a sub-issue of a Feature, or of the epic itself on older maps
 *
 * Every Stage is derived from evidence, never from a label alone: a ticket is « On <env> » when its merged pull
 * request's merge commit is an ancestor of the SHA of that environment's latest successful GitHub Deployment.
 */

/** How the status reads GitHub: REST paths (`repos/…`) and GraphQL queries, answered as parsed JSON. */
export interface GitHubReader {
  rest<T>(path: string): Promise<T>;
  graphql<T>(query: string, variables: Record<string, string>): Promise<T>;
}

export const ENVIRONMENTS = ["staging", "production"] as const;
export type EnvironmentName = (typeof ENVIRONMENTS)[number];

/** A ticket's Stage, from the earliest to the furthest. */
export const STAGES = [
  "triage",
  "readyHuman",
  "readyAgent",
  "blocked",
  "claimed",
  "implementing",
  "inReview",
  "merged",
  "onStaging",
  "onProduction",
  "closedNoPr",
  "dropped",
] as const;
export type Stage = (typeof STAGES)[number];

/** The Stages where someone is working on the ticket now. */
export const ACTIVE_STAGES: ReadonlySet<Stage> = new Set([
  "claimed",
  "implementing",
  "inReview",
]);
const DONE_STAGES: ReadonlySet<Stage> = new Set(["onProduction", "dropped"]);

export interface PullRequestRef {
  number: number;
  url: string;
}

/** What a Stage rests on, shown beside it. */
export interface Evidence {
  pullRequest?: PullRequestRef & {
    mergedAt?: string;
    mergeCommit?: string;
    checks?: string;
  };
  blockedBy?: number[];
  assignees?: string[];
  labels?: string[];
  /** The environments its merge commit could not be compared with. */
  uncompared?: EnvironmentName[];
}

export interface Ticket {
  number: number;
  title: string;
  url: string;
  stage: Stage;
  evidence: Evidence;
}

/** A Feature's one-line state: what is being built, or how far its tickets got. */
export type Headline =
  | { kind: "notSplit" }
  | { kind: "building"; tickets: number[] }
  | { kind: "shipped" }
  | { kind: "awaitingDeploy" }
  | { kind: "notInProduction" }
  | { kind: "idle" };

export interface Feature {
  number: number;
  title: string;
  url: string;
  /** Tickets hung straight off the epic (older maps), not under a « Suivi » issue. */
  direct: boolean;
  tickets: Ticket[];
  headline: Headline;
  /** How many tickets are at each Stage, in Stage order. */
  counts: { stage: Stage; count: number }[];
}

export interface Epic {
  number: number;
  title: string;
  url: string;
  closed: boolean;
  discovery: { closed: number; total: number };
  features: Feature[];
}

export interface EnvironmentStatus {
  name: EnvironmentName;
  /** No GitHub Environment by that name: the Deploy workflow never deployed there. */
  missing: boolean;
  deployment: {
    sha: string;
    ref: string;
    at: string;
    url: string | null;
    runUrl: string | null;
  } | null;
  live:
    | { checked: true; revision: string }
    | { checked: false; reason: LiveReason }
    | null;
}

export type LiveReason =
  | { kind: "noUrl" }
  | { kind: "status"; status: number }
  | { kind: "noCommit" }
  | { kind: "unreachable" };

/** What the status cannot vouch for. */
export type Caveat =
  | { kind: "branchDeployed"; environment: EnvironmentName; ref: string }
  | {
      kind: "liveDiffers";
      environment: EnvironmentName;
      live: string;
      deployed: string;
    }
  | { kind: "liveUnverified"; environment: EnvironmentName }
  | { kind: "openButMerged"; issue: number; pullRequest: number }
  | { kind: "subIssuesOnly" }
  | { kind: "closesOnly" };

export interface InFlight {
  /** A tracked ticket someone works on, with the Feature (or epic) it sits under. */
  tickets: { ticket: Ticket; under: number }[];
  /** Open pull requests that close no tracked ticket. */
  pullRequests: (PullRequestRef & {
    title: string;
    draft: boolean;
    closes: number[];
  })[];
}

export interface DeliveryStatus {
  repository: string;
  builtAt: string;
  closedDays: number;
  environments: EnvironmentStatus[];
  /** How far main is from what staging runs; null when staging has no deployment. */
  mainVersusStaging: { ahead: number; behind: number } | null;
  inFlight: InFlight;
  epics: Epic[];
  /** Features whose epic is closed for long, not a map, or missing. */
  orphans: { epic: number | null; features: Feature[] }[];
  caveats: Caveat[];
}

export interface DeliveryStatusOptions {
  /** `owner/name`. */
  repository: string;
  /** Closed issues older than this many days are left out. */
  closedDays?: number;
  now?: Date;
  /** Reads `<url>/api/health`; `fetch` by default. */
  fetchHealth?: (url: string) => Promise<Response>;
}

const TICKET_FIELDS = `number title url state stateReason closedAt
  assignees(first: 5) { nodes { login } }
  labels(first: 20) { nodes { name } }
  blockedBy(first: 20) { nodes { number state } }
  closedByPullRequestsReferences(first: 10, includeClosedPrs: true) {
    nodes { number url state isDraft mergedAt mergeCommit { oid }
      commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } }
  }`;

interface RawTicket {
  number: number;
  title: string;
  url: string;
  state: "OPEN" | "CLOSED";
  stateReason: string | null;
  closedAt: string | null;
  assignees: { nodes: { login: string }[] };
  labels: { nodes: { name: string }[] };
  blockedBy: { nodes: { number: number; state: string }[] };
  closedByPullRequestsReferences: {
    nodes: {
      number: number;
      url: string;
      state: "OPEN" | "CLOSED" | "MERGED";
      isDraft: boolean;
      mergedAt: string | null;
      mergeCommit: { oid: string } | null;
      commits: {
        nodes: { commit: { statusCheckRollup: { state: string } | null } }[];
      };
    }[];
  };
}

type RawParent = RawTicket & { subIssues: { nodes: RawTicket[] } };

interface RawListedIssue {
  number: number;
  title: string;
  state: "open" | "closed";
  closed_at: string | null;
  pull_request?: unknown;
}

const labelsOf = (t: RawTicket) => t.labels.nodes.map((l) => l.name);

/** Research, grilling and prototype tickets, and the wayfinder task that splits the map. */
export function isDiscovery(t: {
  labels: { nodes: { name: string }[] };
}): boolean {
  const labels = t.labels.nodes.map((l) => l.name);
  if (labels.some((l) => /^wayfinder:(research|grilling|prototype)$/.test(l)))
    return true;
  return (
    labels.includes("wayfinder:task") &&
    !labels.some((l) => l.startsWith("ready-for-"))
  );
}

/** A Feature's headline and Stage counts, from its tickets. */
export function rollUp(
  tickets: readonly Ticket[],
): Pick<Feature, "headline" | "counts"> {
  const counts = STAGES.map((stage) => ({
    stage,
    count: tickets.filter((t) => t.stage === stage).length,
  })).filter((c) => c.count > 0);
  const active = tickets.filter((t) => ACTIVE_STAGES.has(t.stage));
  const left = tickets.filter(
    (t) =>
      !DONE_STAGES.has(t.stage) &&
      t.stage !== "onStaging" &&
      t.stage !== "merged",
  );
  let headline: Headline;
  if (!tickets.length) headline = { kind: "notSplit" };
  else if (active.length)
    headline = { kind: "building", tickets: active.map((t) => t.number) };
  else if (!left.length)
    headline = tickets.every((t) => DONE_STAGES.has(t.stage))
      ? { kind: "shipped" }
      : tickets.some((t) => t.stage === "merged")
        ? { kind: "awaitingDeploy" }
        : { kind: "notInProduction" };
  else headline = { kind: "idle" };
  return { headline, counts };
}

/** The delivery status of `options.repository`, read live from GitHub through `github`. */
export async function deliveryStatus(
  github: GitHubReader,
  options: DeliveryStatusOptions,
): Promise<DeliveryStatus> {
  const { repository } = options;
  const [owner = "", name = ""] = repository.split("/");
  const closedDays = options.closedDays ?? 14;
  const now = options.now ?? new Date();
  const fetchHealth =
    options.fetchHealth ??
    ((url: string) => fetch(url, { signal: AbortSignal.timeout(10_000) }));
  const caveats: Caveat[] = [];
  const recent = (state: string, closedAt: string | null) =>
    state.toLowerCase() === "open" ||
    (closedAt !== null &&
      (now.getTime() - Date.parse(closedAt)) / 864e5 <= closedDays);

  // ---------- environments ----------
  const environmentNames = new Set(
    (
      await github.rest<{ environments: { name: string }[] }>(
        `repos/${repository}/environments`,
      )
    ).environments.map((e) => e.name),
  );
  const environments: EnvironmentStatus[] = [];
  for (const environment of ENVIRONMENTS) {
    if (!environmentNames.has(environment)) {
      environments.push({
        name: environment,
        missing: true,
        deployment: null,
        live: null,
      });
      continue;
    }
    const deployments = await github.rest<
      { id: number; sha: string; ref: string }[]
    >(`repos/${repository}/deployments?environment=${environment}&per_page=30`);
    let deployment: EnvironmentStatus["deployment"] = null;
    for (const d of deployments) {
      const statuses = await github.rest<
        {
          state: string;
          created_at: string;
          environment_url?: string;
          log_url?: string;
        }[]
      >(`repos/${repository}/deployments/${d.id}/statuses`);
      const ok = statuses.find((s) => s.state === "success");
      if (ok) {
        deployment = {
          sha: d.sha,
          ref: d.ref,
          at: ok.created_at,
          url: ok.environment_url || null,
          runUrl: ok.log_url || null,
        };
        break;
      }
    }
    let live: EnvironmentStatus["live"] = null;
    if (deployment) {
      if (deployment.ref !== "main" && !/^v\d+\.\d+\.\d+$/.test(deployment.ref))
        caveats.push({
          kind: "branchDeployed",
          environment,
          ref: deployment.ref,
        });
      live = await liveRevision(deployment.url, fetchHealth);
      if (live.checked && live.revision !== deployment.sha)
        caveats.push({
          kind: "liveDiffers",
          environment,
          live: live.revision,
          deployed: deployment.sha,
        });
      if (!live.checked) caveats.push({ kind: "liveUnverified", environment });
    }
    environments.push({ name: environment, missing: false, deployment, live });
  }

  // Is `sha` in `deployed`? Many tickets share a deployment, so each pair is asked once.
  const contained = new Map<string, Promise<boolean | null>>();
  const contains = (deployed: string, sha: string) => {
    const key = `${deployed}:${sha}`;
    if (!contained.has(key)) {
      contained.set(
        key,
        github
          .rest<{
            status: string;
          }>(`repos/${repository}/compare/${sha}...${deployed}`)
          .then(
            ({ status }) => status === "ahead" || status === "identical",
            () => null,
          ),
      );
    }
    return contained.get(key)!;
  };

  const stageOf = async (t: RawTicket): Promise<Ticket> => {
    const base = { number: t.number, title: t.title, url: t.url };
    const prs = t.closedByPullRequestsReferences.nodes;
    const merged = prs.find((p) => p.state === "MERGED" && p.mergeCommit);
    if (merged) {
      if (t.state === "OPEN")
        caveats.push({
          kind: "openButMerged",
          issue: t.number,
          pullRequest: merged.number,
        });
      const evidence: Evidence = {
        pullRequest: {
          number: merged.number,
          url: merged.url,
          mergedAt: merged.mergedAt ?? undefined,
          mergeCommit: merged.mergeCommit!.oid,
        },
      };
      let stage: Stage = "merged";
      for (const env of environments) {
        if (!env.deployment) continue;
        const inEnv = await contains(
          env.deployment.sha,
          merged.mergeCommit!.oid,
        );
        if (inEnv === null)
          evidence.uncompared = [...(evidence.uncompared ?? []), env.name];
        if (inEnv)
          stage =
            env.name === "production"
              ? "onProduction"
              : stage === "onProduction"
                ? stage
                : "onStaging";
      }
      return { ...base, stage, evidence };
    }
    if (t.state === "CLOSED")
      return {
        ...base,
        stage:
          t.stateReason === "NOT_PLANNED" || t.stateReason === "DUPLICATE"
            ? "dropped"
            : "closedNoPr",
        evidence: {},
      };
    const open = prs.find((p) => p.state === "OPEN");
    if (open) {
      const checks =
        open.commits.nodes[0]?.commit.statusCheckRollup?.state?.toLowerCase();
      return {
        ...base,
        stage: open.isDraft ? "implementing" : "inReview",
        evidence: {
          pullRequest: { number: open.number, url: open.url, checks },
        },
      };
    }
    const blockers = t.blockedBy.nodes
      .filter((b) => b.state === "OPEN")
      .map((b) => b.number);
    if (blockers.length)
      return { ...base, stage: "blocked", evidence: { blockedBy: blockers } };
    const assignees = t.assignees.nodes.map((a) => a.login);
    if (assignees.length)
      return { ...base, stage: "claimed", evidence: { assignees } };
    const labels = labelsOf(t);
    if (labels.includes("ready-for-agent"))
      return { ...base, stage: "readyAgent", evidence: {} };
    if (labels.includes("ready-for-human"))
      return { ...base, stage: "readyHuman", evidence: {} };
    return { ...base, stage: "triage", evidence: { labels } };
  };

  const withSubIssues = async (numbers: number[]): Promise<RawParent[]> => {
    if (!numbers.length) return [];
    const fields = numbers
      .map(
        (n) =>
          `i${n}: issue(number: ${n}) { ${TICKET_FIELDS} subIssues(first: 100) { nodes { ${TICKET_FIELDS} } } }`,
      )
      .join("\n");
    const data = await github.graphql<{
      repository: Record<string, RawParent | null>;
    }>(
      `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields} } }`,
      { owner, name },
    );
    return numbers
      .map((n) => data.repository[`i${n}`])
      .filter((i): i is RawParent => i !== null);
  };

  // ---------- epics, features, tickets ----------
  const epicList = (
    await github.rest<RawListedIssue[]>(
      `repos/${repository}/issues?labels=${encodeURIComponent("wayfinder:map")}&state=all&per_page=100`,
    )
  ).filter((i) => !i.pull_request && recent(i.state, i.closed_at));
  const featureSearch = await github.rest<{ items: RawListedIssue[] }>(
    `search/issues?q=${encodeURIComponent(`repo:${repository} is:issue in:title Suivi`)}&per_page=100`,
  );
  const featureList = featureSearch.items.filter(
    (i) => /^Suivi\s*:/.test(i.title) && recent(i.state, i.closed_at),
  );

  const featureOf = async (
    raw:
      | RawParent
      | {
          number: number;
          title: string;
          url: string;
          direct: true;
          tickets: RawTicket[];
        },
  ): Promise<Feature> => {
    const direct = "direct" in raw;
    const tickets = await Promise.all(
      (direct ? raw.tickets : raw.subIssues.nodes).map(stageOf),
    );
    return {
      number: raw.number,
      title: raw.title,
      url: raw.url,
      direct,
      tickets,
      ...rollUp(tickets),
    };
  };

  const rawFeatures = await withSubIssues(featureList.map((f) => f.number));
  const features = await Promise.all(
    rawFeatures.map(async (f) => ({
      epic: Number(/\(#(\d+)\)\s*$/.exec(f.title)?.[1]) || null,
      feature: await featureOf(f),
    })),
  );
  const featureNumbers = new Set(features.map((f) => f.feature.number));

  const rawEpics = await withSubIssues(epicList.map((e) => e.number));
  const byEpic = new Map<number | null, Feature[]>();
  for (const { epic, feature } of features)
    byEpic.set(epic, [...(byEpic.get(epic) ?? []), feature]);

  const epics: Epic[] = [];
  for (const e of rawEpics) {
    const children = e.subIssues.nodes.filter(
      (c) => !featureNumbers.has(c.number),
    );
    const discovery = children.filter(isDiscovery);
    const direct = children.filter((c) => !isDiscovery(c));
    const epicFeatures = [...(byEpic.get(e.number) ?? [])];
    byEpic.delete(e.number);
    if (direct.length)
      epicFeatures.push(
        await featureOf({
          number: e.number,
          title: e.title,
          url: e.url,
          direct: true,
          tickets: direct,
        }),
      );
    epics.push({
      number: e.number,
      title: e.title,
      url: e.url,
      closed: e.state === "CLOSED",
      discovery: {
        closed: discovery.filter((d) => d.state === "CLOSED").length,
        total: discovery.length,
      },
      features: epicFeatures,
    });
  }
  const orphans = [...byEpic].map(([epic, fs]) => ({ epic, features: fs }));

  // ---------- main versus staging, in flight ----------
  const staging = environments.find((e) => e.name === "staging")?.deployment;
  const mainVersusStaging = staging
    ? await github
        .rest<{
          ahead_by: number;
          behind_by: number;
        }>(`repos/${repository}/compare/${staging.sha}...main`)
        .then(
          (c) => ({ ahead: c.ahead_by, behind: c.behind_by }),
          () => null,
        )
    : null;

  const groups = [
    ...epics.flatMap((e) => e.features),
    ...orphans.flatMap((o) => o.features),
  ];
  const tracked = new Set(
    groups.flatMap((f) => f.tickets.map((t) => t.number)),
  );
  const openPrs = await github.graphql<{
    repository: {
      pullRequests: {
        nodes: {
          number: number;
          title: string;
          url: string;
          isDraft: boolean;
          closingIssuesReferences: { nodes: { number: number }[] };
        }[];
      };
    };
  }>(
    `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { pullRequests(states: OPEN, first: 100, orderBy: { field: CREATED_AT, direction: DESC }) { nodes { number title url isDraft closingIssuesReferences(first: 10) { nodes { number } } } } } }`,
    { owner, name },
  );
  const inFlight: InFlight = {
    tickets: groups.flatMap((f) =>
      f.tickets
        .filter((t) => ACTIVE_STAGES.has(t.stage))
        .map((ticket) => ({ ticket, under: f.number })),
    ),
    pullRequests: openPrs.repository.pullRequests.nodes
      .map((pr) => ({
        number: pr.number,
        title: pr.title,
        url: pr.url,
        draft: pr.isDraft,
        closes: pr.closingIssuesReferences.nodes.map((i) => i.number),
      }))
      .filter((pr) => !pr.closes.some((n) => tracked.has(n))),
  };

  caveats.push({ kind: "subIssuesOnly" }, { kind: "closesOnly" });
  const seen = new Set<string>();
  const uniqueCaveats = caveats.filter((c) => {
    const key = JSON.stringify(c);
    return seen.has(key) ? false : (seen.add(key), true);
  });

  return {
    repository,
    builtAt: now.toISOString(),
    closedDays,
    environments,
    mainVersusStaging,
    inFlight,
    epics,
    orphans,
    caveats: uniqueCaveats,
  };
}

async function liveRevision(
  baseUrl: string | null,
  fetchHealth: (url: string) => Promise<Response>,
): Promise<NonNullable<EnvironmentStatus["live"]>> {
  if (!baseUrl) return { checked: false, reason: { kind: "noUrl" } };
  try {
    const response = await fetchHealth(
      `${baseUrl.replace(/\/$/, "")}/api/health`,
    );
    if (!response.ok)
      return {
        checked: false,
        reason: { kind: "status", status: response.status },
      };
    const body = (await response.json()) as { commit?: string };
    return body.commit
      ? { checked: true, revision: body.commit }
      : { checked: false, reason: { kind: "noCommit" } };
  } catch {
    return { checked: false, reason: { kind: "unreachable" } };
  }
}

/** GitHub's API, read with `token` through `fetch` (a recording one in the app, so each call is traced under the Tool `github`). */
export function gitHubReader(
  token: string,
  fetchImpl: (url: string, init: RequestInit) => Promise<Response> = fetch,
): GitHubReader {
  const headers = {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "jobbbox-delivery-status",
  };
  const answer = async <T>(response: Response): Promise<T> => {
    if (!response.ok) throw new GitHubApiError(response.status);
    return (await response.json()) as T;
  };
  return {
    rest: async (path) =>
      answer(
        await fetchImpl(`https://api.github.com/${path}`, {
          headers,
          signal: AbortSignal.timeout(15_000),
        }),
      ),
    async graphql<T>(query: string, variables: Record<string, string>) {
      const body = await answer<{ data?: T; errors?: { message: string }[] }>(
        await fetchImpl("https://api.github.com/graphql", {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ query, variables }),
          signal: AbortSignal.timeout(30_000),
        }),
      );
      if (!body.data) throw new GitHubApiError(200, body.errors?.[0]?.message);
      return body.data;
    },
  };
}

/** An HTTP or GraphQL error from GitHub: a 401 is a refused token. Never carries the token or a payload. */
export class GitHubApiError extends Error {
  constructor(
    readonly status: number,
    detail?: string,
  ) {
    super(
      `GitHub API: HTTP ${status}${detail ? ` ${detail.slice(0, 200)}` : ""}`,
    );
    this.name = "GitHubApiError";
  }
}
