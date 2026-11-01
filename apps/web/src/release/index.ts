// The root package.json, bundled into the build like any module: its Version reaches the page with no environment
// variable to set at build or run time (next.config.ts's `env` only inlines `process.env.X` read by name, #470).
import rootManifest from "../../../../package.json";

type Env = Record<string, string | undefined>;

/**
 * The Version this build serves (ADR-0063): the root package.json's, which apps/web and apps/worker repeat
 * (versions.ts, checked in CI); on `main` the next one, the Beta's; on Production the one Promoted. Null when it
 * carries none.
 */
export const builtVersion: string | null = typeof rootManifest.version === "string" ? rootManifest.version : null;

/** What a deployment serves (#559): its Version, its commit, where it runs, and whether that is the Beta. */
export type Release = {
  version: string | null;
  /** The full commit SHA, or null on a developer's machine and in the e2e suite. */
  commit: string | null;
  /** JOBHUB_TARGET: production, staging, e2e or development. */
  environment: string;
  /** Anything but Production runs what `main` carries, not yet Promoted. */
  beta: boolean;
};

/**
 * The Release this process serves, the one source the Back Office, Mon compte, /api/health and Nouveautés read.
 * The commit is the one .github/workflows/deploy.yml bakes into the image (JOBHUB_COMMIT), else the revision
 * deploy/compose.yml names (JOBHUB_REVISION). Production is JOBHUB_TARGET=production, or a production build that
 * names no target (like the Playbooks' serving, ADR-0021), so a deployment that forgets to say where it runs never
 * shows itself as the Beta.
 */
export function currentRelease(env: Env = process.env, version: string | null = builtVersion): Release {
  const target = env.JOBHUB_TARGET?.trim();
  const environment = target || (env.NODE_ENV === "production" ? "production" : "development");
  return {
    version: version?.trim() || null,
    commit: env.JOBHUB_COMMIT?.trim() || env.JOBHUB_REVISION?.trim() || null,
    environment,
    beta: environment !== "production",
  };
}

/** A commit shortened as git does. */
export function shortCommit(commit: string | null): string | null {
  return commit ? commit.slice(0, 7) : null;
}

/** The Version as shown (CONTEXT.md, Version): « X.Y.Z (main·sha) » on the Beta, « X.Y.Z » in Production. */
export function releaseLabel(release: Release): string {
  const version = release.version ?? "0.0.0";
  return release.beta ? `${version} (main·${shortCommit(release.commit) ?? "dev"})` : version;
}
