/** The package.json files that carry the Version (ADR-0063): the root's, which decides, and the two apps it ships. */
export const VERSIONED_MANIFESTS = ["package.json", "apps/web/package.json", "apps/worker/package.json"] as const;

type Manifest = (typeof VERSIONED_MANIFESTS)[number];

const SEMVER = /^\d+\.\d+\.\d+$/;

/**
 * What stands between the repo and one Version (#559): a root Version that is not `X.Y.Z` (no `-beta` suffix), or an
 * app whose package.json says another. Empty when they agree. The extension keeps its own Extension Version.
 */
export function versionMismatches(versions: Record<Manifest, unknown>): string[] {
  const root = versions["package.json"];
  const problems: string[] = [];
  if (typeof root !== "string" || !SEMVER.test(root)) problems.push(`the root package.json's Version is ${String(root)}, not X.Y.Z`);
  for (const file of VERSIONED_MANIFESTS) {
    if (file !== "package.json" && versions[file] !== root) problems.push(`${file} is at ${String(versions[file])}, not the root package.json's ${String(root)}`);
  }
  return problems;
}
