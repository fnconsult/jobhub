// Fails when apps/web or apps/worker carries another Version than the root package.json (#559, ADR-0063).
// Run by CI (`npm run check:versions`); takes the repo root as its argument, the working directory otherwise.
import { readFileSync } from "node:fs";
import path from "node:path";
import { VERSIONED_MANIFESTS, versionMismatches } from "../src/release/versions";

const root = path.resolve(process.argv[2] ?? ".");
const versions = Object.fromEntries(
  VERSIONED_MANIFESTS.map((file) => [file, (JSON.parse(readFileSync(path.join(root, file), "utf8")) as { version?: unknown }).version]),
) as Parameters<typeof versionMismatches>[0];
const problems = versionMismatches(versions);
if (problems.length > 0) {
  for (const problem of problems) console.error(`✗ ${problem}`);
  process.exit(1);
}
console.log(`✓ one Version: ${String(versions["package.json"])}`);
