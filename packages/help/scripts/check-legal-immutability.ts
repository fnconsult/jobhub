/**
 * Fails when the change since `<base ref>` edits a Legal Text Version in effect (ADR-0062), or adds a substantial one
 * effective less than 30 days from today (#547). CI runs it on each pull request, against its base, and on each push to
 * main, against main before that squashed merge: there today is the day of the merge, so a pull request merged too late
 * turns main red and cannot be deployed.
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
  console.error(["A Legal Text Version in effect is never edited, and a substantial one is merged 30 days before it takes effect:", ...violations.map((line) => `- ${line}`)].join("\n"));
  process.exit(1);
}
console.log("Legal Text Versions: none in effect is edited, every substantial one has its 30 days of notice.");
