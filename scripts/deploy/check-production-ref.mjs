#!/usr/bin/env node
/**
 * .github/workflows/deploy.yml's guard on Production (ADR-0063, #560): Production runs only a Version, the tag
 * `vX.Y.Z` the Promotion (scripts/promote.ts) pushed with `prod`, or an earlier one of prod's history to roll back.
 * Refuses a branch, `main` included, a tag that is not on `prod`, and a tag whose root package.json carries another
 * Version. Reads GITHUB_REF, GITHUB_SHA and PROD_COMPARE from the environment: GitHub's comparison of the tag with
 * `prod` (`repos/…/compare/<sha>...prod`, `.status`), empty when `prod` does not exist. Reads package.json from the
 * working directory; prints each problem as a workflow error and exits 1.
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const TAG = /^refs\/tags\/v(\d+\.\d+\.\d+)$/;

/** Why `ref` at `sha` may not be deployed to Production; empty when it may. */
export function productionRefProblems({ ref, compare, version }) {
  const tag = TAG.exec(ref ?? "");
  if (!tag) return [`Production deploys only a Version's tag vX.Y.Z, pushed with prod by the Promotion (scripts/promote.ts), not ${ref || "an unnamed ref"}.`];
  const problems = [];
  // "identical": prod is at the tag; "ahead": prod is past it (a rollback to an earlier Version).
  if (!compare) problems.push(`There is no prod branch: tag v${tag[1]} was not Promoted.`);
  else if (compare !== "identical" && compare !== "ahead") problems.push(`Tag v${tag[1]} is not on prod (${compare}): Production runs only a Version the Promotion pushed with prod.`);
  if (version !== tag[1]) problems.push(`The root package.json of v${tag[1]} carries the Version ${version}, not ${tag[1]}.`);
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let version;
  try {
    version = JSON.parse(readFileSync("package.json", "utf8")).version;
  } catch {
    version = undefined;
  }
  const problems = productionRefProblems({ ref: process.env.GITHUB_REF, compare: process.env.PROD_COMPARE?.trim() || null, version });
  for (const problem of problems) console.log(`::error::${problem}`);
  if (problems.length) process.exit(1);
  console.log(`✓ ${process.env.GITHUB_REF} is a Version on prod`);
}
