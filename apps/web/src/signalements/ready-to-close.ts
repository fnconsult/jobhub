/**
 * « Prêt à clore » at each deploy (#1141, ADR-0118). Run by the worker when it starts (each deploy starts it) and hourly
 * after, with the environment and the commit it serves (Release): for each issue linked to a Signalement not yet
 * « traité » nor « Prêt à clore », the commit that closed it (GitHub's latest « closed » event, read with the read-only
 * GITHUB_STATUS_TOKEN); when the deployed commit carries it, every Signalement linked to that issue becomes « Prêt à
 * clore » together.
 *
 * A server holds the Signalements sent to its own environment: those of the Beta are ready once the fix is deployed to
 * the Beta; those of Production once the Promoted Version carrying it is deployed there. A deploy to another environment
 * changes nothing. Each issue is read once per deployed commit; one GitHub could not answer is read again next run.
 * « Prêt à clore » is the team's alone: the Candidate's status does not change, and nothing notifies them.
 */
import { IssuesError, type GitHubIssues } from "./github-issues";
import type { Signalements } from "./index";

export type ReadyToCloseOutcome = { skipped: "other_environment" | "no_commit" | "missing_token" } | { checked: number; ready: string[]; failed: number };

export interface ReadyToClose {
  /** Checks the linked issues against the commit `deploy` serves. */
  afterDeploy(deploy: { environment: string; commit: string | null }): Promise<ReadyToCloseOutcome>;
}

export interface ReadyToCloseDeps {
  signalements: Pick<Signalements, "issuesToCheck" | "markIssuesChecked" | "markReadyToClose">;
  github: Pick<GitHubIssues, "closingCommit" | "contains">;
  /** Where this server runs (Release.environment): its Signalements were sent there. */
  environment: string;
}

export function createReadyToClose({ signalements, github, environment }: ReadyToCloseDeps): ReadyToClose {
  return {
    async afterDeploy(deploy) {
      if (deploy.environment !== environment) return { skipped: "other_environment" };
      if (!deploy.commit) return { skipped: "no_commit" };
      const fixed: number[] = [];
      const checked: number[] = [];
      let failed = 0;
      for (const issue of await signalements.issuesToCheck(deploy.commit)) {
        try {
          const closing = await github.closingCommit(issue);
          if (closing && (await github.contains(deploy.commit, closing))) fixed.push(issue);
          checked.push(issue);
        } catch (error) {
          if (!(error instanceof IssuesError)) throw error;
          if (error.reason === "missing_token") return { skipped: "missing_token" };
          failed += 1;
        }
      }
      const ready = await signalements.markReadyToClose(fixed);
      await signalements.markIssuesChecked(checked, deploy.commit);
      return { checked: checked.length, ready, failed };
    },
  };
}
