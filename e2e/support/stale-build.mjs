// The e2e suite runs `next start` on the build already in apps/web/.next: it does
// not build. A build left from before a rebase, a merge of main or an edit serves
// the old code, and the suite's verdict covers a commit nobody is looking at.
// staleBuild tells, from modification times, whether any source the build reads
// changed after it (git rewrites the files a rebase or a merge changes, so they
// come out newer than the build).
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const BUILD_ID = "apps/web/.next/BUILD_ID";
const SOURCE_ROOTS = ["apps/web", "packages"];
// What the build writes or does not read.
const SKIPPED_DIRECTORIES = new Set([".next", "node_modules", "dist", "coverage", ".turbo"]);
const SKIPPED_FILES = [/\.test\.tsx?$/, /\.tsbuildinfo$/, /^next-env\.d\.ts$/, /^\.DS_Store$/];

/**
 * `{ missing: true }` when there is no build; otherwise the sources (relative to
 * `repoRoot`) modified after it, none when the build is fresh.
 */
export function staleBuild(repoRoot) {
  const buildId = path.join(repoRoot, BUILD_ID);
  if (!existsSync(buildId)) return { missing: true, newer: [] };
  const builtAt = statSync(buildId).mtimeMs;
  const newer = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) walk(full);
      } else if (entry.isFile() && !SKIPPED_FILES.some((pattern) => pattern.test(entry.name))) {
        if (statSync(full).mtimeMs > builtAt) newer.push(path.relative(repoRoot, full));
      }
    }
  };
  for (const root of SOURCE_ROOTS) {
    const full = path.join(repoRoot, root);
    if (existsSync(full)) walk(full);
  }
  return { missing: false, newer };
}

/** Why the suite will not start on this build, or null when it is fresh. */
export function staleBuildMessage(repoRoot) {
  const { missing, newer } = staleBuild(repoRoot);
  if (missing) return "[web-server] No web app build in apps/web/.next. Run `npm run build` first.";
  if (newer.length === 0) return null;
  const shown = newer.slice(0, 5).map((file) => `  ${file}`);
  if (newer.length > shown.length) shown.push(`  … and ${newer.length - shown.length} more`);
  return [
    `[web-server] The web app build in apps/web/.next is older than ${newer.length} of its sources:`,
    ...shown,
    "The suite would test the old code. Run `npm run build` first.",
  ].join("\n");
}
