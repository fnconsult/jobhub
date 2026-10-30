/**
 * Fails when this pull request edits a Legal Text Version in effect (ADR-0062): CI runs it on each pull request,
 * with the base it is compared to.
 *
 *   npx tsx packages/help/scripts/check-legal-immutability.ts HEAD^1
 */
import { legalChangesSince, legalImmutabilityViolations } from "../src/legal-immutability";
import { parisDay } from "../src/legal-texts";

const base = process.argv[2];
if (!base) {
  console.error("Usage: check-legal-immutability.ts <base ref>");
  process.exit(2);
}
const violations = legalImmutabilityViolations(legalChangesSince(base), parisDay());
if (violations.length > 0) {
  console.error(["A Legal Text Version in effect is never edited:", ...violations.map((line) => `- ${line}`)].join("\n"));
  process.exit(1);
}
console.log("Legal Text Versions: none in effect is edited.");
