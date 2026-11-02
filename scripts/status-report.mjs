#!/usr/bin/env node
// Delivery status report, built only from GitHub facts (issues, PRs, deployments).
//
//   node scripts/status-report.mjs [--out status-report.md] [--closed-days 14]
//
// Hierarchy, as wayfinder and wf-dev write it (docs/agents/issue-tracker.md):
//   Epic     an issue labelled `wayfinder:map` ("Carte : …")
//   Feature  a tracking issue titled "Suivi : … (#<epic>)", whose sub-issues are the tickets
//   Ticket   a sub-issue of a Feature; wf-dev opens a draft PR "Closes #n" before any code
//
// Every stage is derived from evidence the report links to, never from a label alone:
//   On <env>  the ticket's merged PR's merge commit is an ancestor of the SHA of that
//             environment's latest successful GitHub Deployment (compare API)
//   Merged    merged PR, not in any deployed SHA yet
//   In review open PR, ready for review;  Implementing  open draft PR
//   Claimed   open, assigned, no PR;  Blocked  an open native blocker
//   Ready / Triage  from the triage labels, only when nothing above applies
// The live site is checked too: /api/health returns the commit it serves (#559), which must
// match the deployment record, or the report says it cannot vouch for that environment.
// Requires an authenticated `gh`.

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const OUT = opt("out", null);
const CLOSED_DAYS = Number(opt("closed-days", 14));

const gh = (...a) => execFileSync("gh", a, { encoding: "utf8", maxBuffer: 64 << 20 });
const ghJson = (...a) => JSON.parse(gh(...a));
const REPO = ghJson("repo", "view", "--json", "nameWithOwner").nameWithOwner;
const [OWNER, NAME] = REPO.split("/");
const graphql = (query, vars = {}) =>
  ghJson("api", "graphql", "-f", `query=${query}`,
    ...Object.entries(vars).flatMap(([k, v]) => ["-F", `${k}=${v}`])).data;

const warnings = [];
const short = (sha) => sha?.slice(0, 8);
const ghUrl = (path) => `https://github.com/${REPO}/${path}`;

// ---------- environments ----------

async function environments() {
  const names = ghJson("api", `repos/${REPO}/environments`).environments.map((e) => e.name);
  const envs = [];
  for (const name of ["staging", "production"]) {
    if (!names.includes(name)) {
      envs.push({ name, missing: true });
      continue;
    }
    const deployments = ghJson("api", `repos/${REPO}/deployments?environment=${name}&per_page=30`);
    let found = null;
    for (const d of deployments) {
      const statuses = ghJson("api", `repos/${REPO}/deployments/${d.id}/statuses`);
      const ok = statuses.find((s) => s.state === "success");
      if (ok) {
        found = { sha: d.sha, ref: d.ref, at: ok.created_at, url: ok.environment_url, log: ok.log_url };
        break;
      }
    }
    const env = { name, deployment: found };
    if (found) {
      if (found.ref !== "main") {
        warnings.push(`${name} runs branch \`${found.ref}\`, not main: it may hold code main does not.`);
      }
      env.live = await liveRevision(found.url);
      if (env.live.revision && env.live.revision !== found.sha) {
        warnings.push(`${name} serves ${short(env.live.revision)} but GitHub's last successful deployment is ${short(found.sha)}: a deploy happened outside the Deploy workflow, or one is half done.`);
      }
    }
    envs.push(env);
  }
  return envs;
}

async function liveRevision(baseUrl) {
  if (!baseUrl) return { checked: false, reason: "no environment URL" };
  try {
    const res = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { checked: false, reason: `/api/health answered ${res.status}` };
    const body = await res.json();
    if (!body.commit) return { checked: false, reason: "/api/health does not report its commit yet" };
    return { checked: true, revision: body.commit };
  } catch (e) {
    return { checked: false, reason: `/api/health unreachable (${e.message})` };
  }
}

// Is `sha` contained in `deployedSha`? Cached: many tickets share a deployment.
const containsCache = new Map();
function contains(deployedSha, sha) {
  const key = `${deployedSha}:${sha}`;
  if (!containsCache.has(key)) {
    let status;
    try {
      status = ghJson("api", `repos/${REPO}/compare/${sha}...${deployedSha}`, "--jq", "{status}").status;
    } catch {
      status = "unknown";
    }
    containsCache.set(key, status === "ahead" || status === "identical" ? true : status === "unknown" ? null : false);
  }
  return containsCache.get(key);
}

// ---------- issues ----------

const TICKET = `number title url state stateReason closedAt
  assignees(first: 5) { nodes { login } }
  labels(first: 20) { nodes { name } }
  blockedBy(first: 20) { nodes { number state } }
  closedByPullRequestsReferences(first: 10, includeClosedPrs: true) {
    nodes { number url state isDraft mergedAt mergeCommit { oid } headRefName
      commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } }
  }`;

function issuesWithSubIssues(numbers) {
  if (!numbers.length) return [];
  const fields = numbers.map((n) => `i${n}: issue(number: ${n}) { ${TICKET} subIssues(first: 100) { nodes { ${TICKET} } } }`).join("\n");
  const repo = graphql(`query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields} } }`, { owner: OWNER, name: NAME }).repository;
  return numbers.map((n) => repo[`i${n}`]);
}

function search(q) {
  return ghJson("issue", "list", "--state", "all", "--limit", "200", "--search", q, "--json", "number,title,state,closedAt");
}

const recent = (i) => i.state === "OPEN" || (Date.now() - Date.parse(i.closedAt)) / 864e5 <= CLOSED_DAYS;

// ---------- stage ----------

const ORDER = ["Triage", "Ready (human)", "Ready (agent)", "Blocked", "Claimed", "Implementing", "In review", "Merged", "On staging", "On production", "Closed, no PR", "Dropped"];

function stage(t, envs) {
  const labels = t.labels.nodes.map((l) => l.name);
  const prs = t.closedByPullRequestsReferences.nodes;
  const merged = prs.find((p) => p.state === "MERGED");
  const open = prs.find((p) => p.state === "OPEN");
  const evidence = [];

  if (merged) {
    evidence.push(`[PR #${merged.number}](${merged.url}) merged ${merged.mergedAt.slice(0, 10)} as \`${short(merged.mergeCommit.oid)}\``);
    if (t.state === "OPEN") warnings.push(`#${t.number} is still open although PR #${merged.number} is merged.`);
    let at = "Merged";
    for (const env of envs) {
      if (!env.deployment) continue;
      const inEnv = contains(env.deployment.sha, merged.mergeCommit.oid);
      if (inEnv === null) evidence.push(`could not compare with ${env.name}`);
      if (inEnv) at = env.name === "production" ? "On production" : at === "On production" ? at : "On staging";
    }
    return { stage: at, evidence };
  }
  if (t.state === "CLOSED") {
    if (t.stateReason === "NOT_PLANNED" || t.stateReason === "DUPLICATE") return { stage: "Dropped", evidence: [t.stateReason.toLowerCase()] };
    return { stage: "Closed, no PR", evidence: ["closed without a merged PR that closes it"] };
  }
  if (open) {
    const checks = open.commits.nodes[0]?.commit.statusCheckRollup?.state;
    evidence.push(`[PR #${open.number}](${open.url})${checks ? ` checks ${checks.toLowerCase()}` : ""}`);
    return { stage: open.isDraft ? "Implementing" : "In review", evidence };
  }
  const blockers = t.blockedBy.nodes.filter((b) => b.state === "OPEN");
  if (blockers.length) return { stage: "Blocked", evidence: [`blocked by ${blockers.map((b) => `#${b.number}`).join(", ")}`] };
  if (t.assignees.nodes.length) return { stage: "Claimed", evidence: [`assigned to ${t.assignees.nodes.map((a) => a.login).join(", ")}, no PR`] };
  if (labels.includes("ready-for-agent")) return { stage: "Ready (agent)", evidence: [] };
  if (labels.includes("ready-for-human")) return { stage: "Ready (human)", evidence: [] };
  return { stage: "Triage", evidence: labels.length ? [labels.join(", ")] : ["no triage label"] };
}

const DONE = new Set(["On production", "Dropped"]);
const ACTIVE = new Set(["Claimed", "Implementing", "In review"]);

function rollup(tickets) {
  const counts = {};
  for (const t of tickets) counts[t.s.stage] = (counts[t.s.stage] ?? 0) + 1;
  const parts = ORDER.filter((s) => counts[s]).map((s) => `${counts[s]} ${s.toLowerCase()}`);
  const active = tickets.filter((t) => ACTIVE.has(t.s.stage));
  const left = tickets.filter((t) => !DONE.has(t.s.stage) && t.s.stage !== "On staging" && t.s.stage !== "Merged");
  let headline;
  if (!tickets.length) headline = "Not split into tickets yet";
  else if (active.length) headline = `Building: ${active.map((t) => `#${t.number}`).join(", ")}`;
  else if (!left.length) headline = tickets.every((t) => DONE.has(t.s.stage)) ? "Shipped" : tickets.some((t) => t.s.stage === "Merged") ? "Merged, awaiting deploy" : "On staging, not in production";
  else headline = "Idle: nothing in progress";
  return { headline, parts: parts.join(" · ") };
}

// ---------- report ----------

const envs = await environments();

const epicList = ghJson("issue", "list", "--label", "wayfinder:map", "--state", "all", "--limit", "100", "--json", "number,title,state,closedAt").filter(recent);
const featureList = search("in:title Suivi").filter((i) => /^Suivi\s*:/.test(i.title)).filter(recent);
const features = issuesWithSubIssues(featureList.map((f) => f.number)).map((f) => {
  const epic = Number(f.title.match(/\(#(\d+)\)\s*$/)?.[1]) || null;
  const tickets = f.subIssues.nodes.map((t) => ({ ...t, s: stage(t, envs) }));
  return { ...f, epic, tickets, roll: rollup(tickets) };
});
const epics = issuesWithSubIssues(epicList.map((e) => e.number));
const featureNumbers = new Set(features.map((f) => f.number));
for (const e of epics) {
  const direct = e.subIssues.nodes.filter((c) => !featureNumbers.has(c.number) && !isDiscovery(c));
  if (direct.length) e.directTickets = direct.map((t) => ({ ...t, s: stage(t, envs) }));
}

const lines = [];
const now = new Date().toISOString().replace("T", " ").slice(0, 16);
lines.push(`# Delivery status — ${REPO}`, "", `Generated ${now} UTC from GitHub (issues, sub-issues, PRs, deployments). Closed items older than ${CLOSED_DAYS} days are left out.`, "");

lines.push("## Environments", "", "| Env | Deployed commit | When | From | Live check |", "|---|---|---|---|---|");
for (const env of envs) {
  if (env.missing) { lines.push(`| ${env.name} | — | — | — | no GitHub Environment: never deployed by the Deploy workflow |`); continue; }
  const d = env.deployment;
  if (!d) { lines.push(`| ${env.name} | — | — | — | no successful deployment |`); continue; }
  const live = env.live.checked ? (env.live.revision === d.sha ? "✅ live site serves this commit" : `❌ live site serves \`${short(env.live.revision)}\``) : `⚠️ unverified: ${env.live.reason}`;
  lines.push(`| ${env.name} | [\`${short(d.sha)}\`](${ghUrl(`commit/${d.sha}`)}) | ${d.at.slice(0, 16).replace("T", " ")} | \`${d.ref}\` ([run](${d.log})) | ${live} |`);
}
const ahead = envs.find((e) => e.name === "staging")?.deployment;
if (ahead) {
  const cmp = ghJson("api", `repos/${REPO}/compare/${ahead.sha}...main`, "--jq", "{ahead_by, behind_by}");
  lines.push("", `main is ${cmp.ahead_by} commit(s) ahead of staging${cmp.behind_by ? ` and ${cmp.behind_by} behind it` : ""}.`);
}
lines.push("");

lines.push("## In flight now", "", "| Ticket | Stage | Under | Evidence |", "|---|---|---|---|");
const groups = [...features, ...epics.filter((e) => e.directTickets).map((e) => ({ number: e.number, tickets: e.directTickets }))];
const inFlight = groups.flatMap((f) => f.tickets.filter((t) => ACTIVE.has(t.s.stage)).map((t) => ({ t, f })));
const tracked = new Set(groups.flatMap((f) => f.tickets.map((t) => t.number)));
const openPrs = ghJson("pr", "list", "--state", "open", "--json", "number,title,url,isDraft,closingIssuesReferences");
for (const { t, f } of inFlight) lines.push(`| [#${t.number}](${t.url}) ${t.title} | ${t.s.stage} | #${f.number} | ${t.s.evidence.join("; ")} |`);
for (const pr of openPrs) {
  const closes = pr.closingIssuesReferences.map((i) => i.number);
  if (closes.some((n) => tracked.has(n))) continue;
  lines.push(`| [PR #${pr.number}](${pr.url}) ${pr.title} | ${pr.isDraft ? "Implementing" : "In review"} | — | ${closes.length ? `closes ${closes.map((n) => `#${n}`).join(", ")} (not under a Suivi)` : "closes no issue"} |`);
}
lines.push("");

lines.push("## Epics and features", "");
const byEpic = new Map();
for (const f of features) byEpic.set(f.epic, [...(byEpic.get(f.epic) ?? []), f]);
for (const e of epics) {
  const fs = byEpic.get(e.number) ?? [];
  byEpic.delete(e.number);
  const children = e.subIssues.nodes.filter((c) => !features.some((f) => f.number === c.number));
  const discovery = children.filter(isDiscovery);
  const openDisc = discovery.filter((d) => d.state === "OPEN").length;
  lines.push(`### [#${e.number}](${e.url}) ${e.title}${e.state === "CLOSED" ? " — closed" : ""}`, "");
  lines.push(`Discovery: ${discovery.length ? `${discovery.length - openDisc}/${discovery.length} wayfinder tickets closed` : "no wayfinder tickets"}.`, "");
  for (const f of fs) featureSection(f);
  // Older maps hang their build tickets straight off the map, with no Suivi in between.
  const direct = e.directTickets ?? [];
  if (direct.length) featureSection({ direct: true, number: e.number, url: e.url, tickets: direct, roll: rollup(direct) });
  else if (!fs.length) lines.push("No build tickets yet.", "");
}
for (const [epic, fs] of byEpic) {
  lines.push(`### ${epic ? `#${epic} (epic not open or not a map)` : "Features without an epic"}`, "");
  for (const f of fs) featureSection(f);
}

// Research, grilling and prototype tickets, and the wayfinder task that splits the map.
function isDiscovery(t) {
  const labels = t.labels.nodes.map((l) => l.name);
  if (labels.some((l) => /^wayfinder:(research|grilling|prototype)$/.test(l))) return true;
  return labels.includes("wayfinder:task") && !labels.some((l) => l.startsWith("ready-for-"));
}

function featureSection(f) {
  const heading = f.direct ? `Build tickets directly under the epic` : `[#${f.number}](${f.url}) ${f.title}`;
  lines.push(`#### ${heading} — ${f.roll.headline}`, "", f.roll.parts || "_no sub-issues_", "");
  if (!f.tickets.length) return;
  lines.push("| Ticket | Stage | Evidence |", "|---|---|---|");
  for (const t of f.tickets) lines.push(`| [#${t.number}](${t.url}) ${t.title} | ${t.s.stage} | ${t.s.evidence.join("; ")} |`);
  lines.push("");
}

lines.push("## What this report cannot vouch for", "");
const caveats = [...new Set(warnings)];
for (const env of envs) if (env.deployment && !env.live.checked) caveats.push(`${env.name}: ${env.live.reason}, so "On ${env.name}" rests on GitHub's deployment record only.`);
caveats.push("Tickets only count when they are GitHub sub-issues of a Suivi issue or of an epic; a ticket listed only in a body table is not seen.");
caveats.push("A ticket's code is matched through PRs that say `Closes #n`; work merged under another PR is not seen.");
for (const c of caveats) lines.push(`- ${c}`);
lines.push("");

const md = lines.join("\n");
if (OUT) writeFileSync(OUT, md);
else process.stdout.write(md);
