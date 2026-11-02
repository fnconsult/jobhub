// The Promotion (ADR-0063, #560), run by the product owner alone, outside any agent (scripts/hooks/no-promotion.mjs
// refuses it to one): `npx tsx scripts/promote.ts [--rien-de-visible] [--minor | --major] [--yes]`.
// Checks every precondition, says in plain words which one is missing and then pushes nothing; otherwise tags the
// Version, pushes `prod` and the tag atomically, deploys Production and opens the pull request of the next Version.
// See docs/ops/promotion.md.
import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { newTempDir, parseArguments, promote } from "./promotion/promotion";

const repo = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();

let options;
try {
  options = parseArguments(process.argv.slice(2));
} catch (error) {
  console.error(`✗ ${(error as Error).message}`);
  process.exit(2);
}

const outcome = await promote(
  {
    run: (command, args, cwd = repo) => execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 }),
    fetch: (url) => fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) }),
    log: (line) => console.log(line),
    ask: async (question) => {
      const prompt = createInterface({ input: process.stdin, output: process.stdout });
      try {
        return await prompt.question(question);
      } finally {
        prompt.close();
      }
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => new Date(),
    tempDir: newTempDir,
  },
  options,
);
process.exit(outcome.problems.length ? 1 : 0);
