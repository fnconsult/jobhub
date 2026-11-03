// Publishes the GitHub Release of every Version tag (ADR-0063, #561), as `.github/workflows/publier-releases.yml` runs
// it: `npx tsx scripts/publish-releases.ts [--dry-run]`, with `gh` signed in and GITHUB_REPOSITORY set (`owner/name`).
// Fails, and publishes nothing, when a tagged Version's Release Note was changed. See scripts/releases/publish-releases.ts.
import { execFileSync } from "node:child_process";
import { publishReleases } from "./releases/publish-releases";

const args = process.argv.slice(2);
const unknown = args.filter((arg) => arg !== "--dry-run");
const repo = process.env.GITHUB_REPOSITORY;
if (unknown.length || !repo) {
  console.error(unknown.length ? `✗ option inconnue : ${unknown.join(" ")} (option : --dry-run)` : "✗ GITHUB_REPOSITORY (owner/name) manque");
  process.exit(2);
}

const outcome = publishReleases(
  {
    run: (command, commandArgs, input) =>
      execFileSync(command, commandArgs, { encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 }),
    log: (line) => console.log(line),
  },
  { repo, dryRun: args.includes("--dry-run") },
);
for (const problem of outcome.problems) console.log(`::error::${problem}`);
process.exit(outcome.problems.length ? 1 : 0);
