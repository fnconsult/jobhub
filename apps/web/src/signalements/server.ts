import { recordingFetch } from "@jobhub/shared";
import { getExternalApiLog } from "@/ai-usage/external-api-log";
import { sharedPool } from "@/database/pool";
import { DEFAULT_DELIVERY_REPOSITORY } from "@/delivery-status/email";
import { getGuardrailStore } from "@/guardrails/server";
import { getSecretResolver } from "@/provider-secrets/server";
import { currentRelease, shortCommit } from "@/release";
import { candidateIdentityOf } from "@/candidate-identity";
import { gitHubIssues, type GitHubIssues } from "./github-issues";
import { createSignalements, type Signalements } from "./index";
import { createSignalementTriage, type SignalementTriage } from "./triage";

let instance: Signalements | undefined;
let triage: SignalementTriage | undefined;
let issues: GitHubIssues | undefined;

/**
 * The Jobbbox version a Signalement keeps and its dialog shows (#374, #375): the deployed commit (`@/release`, #559),
 * shortened as git does; « dev » when it is not known.
 */
export function jobbboxVersion(): string {
  return shortCommit(currentRelease().commit) ?? "dev";
}

/** The app's Signalements (#374), on the database named by DATABASE_URL, keeping jobbboxVersion(). */
export function getSignalements(): Signalements {
  instance ??= createSignalements(sharedPool(), { version: jobbboxVersion() });
  return instance;
}

/**
 * GitHub's issues on Jobbbox's repository (GITHUB_STATUS_REPOSITORY, fnconsult/jobhub by default), written with
 * GITHUB_ISSUES_TOKEN and read with GITHUB_STATUS_TOKEN (Provider Secrets over env, read on each call), each call traced
 * under the Tool `github` without its numbers (#1141).
 */
export function getGitHubIssues(): GitHubIssues {
  issues ??= gitHubIssues({
    writeToken: () => getSecretResolver().current().env.GITHUB_ISSUES_TOKEN,
    readToken: () => getSecretResolver().current().env.GITHUB_STATUS_TOKEN,
    repository: process.env.GITHUB_STATUS_REPOSITORY?.trim() || DEFAULT_DELIVERY_REPOSITORY,
    apiUrl: process.env.GITHUB_API_URL || undefined,
    fetch: recordingFetch(globalThis.fetch, getExternalApiLog(), {
      provider: "github",
      costEur: () => 0,
      operation: (method, url) => `${method} ${url.pathname.replace(/\/compare\/.*$/, "/compare").replace(/\/\d+(?=\/|$)/g, "/:id").replace(/^\/repos\/[^/]+\/[^/]+/, "/repos/:repo")}`,
    }),
  });
  return issues;
}

/** The page of the issue `number` on Jobbbox's repository, for the Back Office (#1141). */
export function issueUrl(number: number): string {
  return `https://github.com/${process.env.GITHUB_STATUS_REPOSITORY?.trim() || DEFAULT_DELIVERY_REPOSITORY}/issues/${number}`;
}

/**
 * Signalement triage (#1139, #1141, ADR-0118): the Signalements sent with the AI notice, redacted with each Candidate's
 * identity; the issues it proposes, published by Jobbbox once checked, their blocks recorded as Guardrail Triggers.
 */
export function getSignalementTriage(): SignalementTriage {
  triage ??= createSignalementTriage({
    signalements: getSignalements(),
    identityOf: candidateIdentityOf(sharedPool()),
    environment: currentRelease().environment,
    issues: getGitHubIssues(),
    triggers: getGuardrailStore().triggers,
  });
  return triage;
}
