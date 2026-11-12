import { legalTextVersions, parisDay, type LegalTextVersionRecord } from "@jobhub/help";
import type { Queryable } from "../database/pool";
import { connectLegalRegistry } from "../coaching-connect/legal";
/** Observation starts no later than the first runtime seeing the published version; missing evidence delays activation. */
export async function calLegalReady(
  database: Queryable,
  input: { registry?: readonly LegalTextVersionRecord[]; now?: Date; env?: Record<string, string | undefined>; globals?: object } = {},
) {
  const registry = input.registry ?? connectLegalRegistry(),
    now = input.now ?? new Date(),
    day = parisDay(now),
    env = input.env ?? process.env,
    globals = input.globals ?? globalThis;
  const fixture =
    env.JOBHUB_TARGET === "e2e"
      ? (globals as { [key: symbol]: { recipients: string[]; firstSeen: string } | undefined })[Symbol.for("jobbbox.e2e.cal-legal")]
      : undefined;
  const covered = (record: LegalTextVersionRecord) =>
    fixture?.recipients.includes("cal-com") ??
    legalTextVersions("fr").some((v) => v.text === "confidentialite" && v.effective === record.version && v.recipientsOutsideEu?.includes("cal-com"));
  const privacy = registry
    .filter((v) => v.text === "confidentialite" && v.coachingCapabilities?.includes("cal-com"))
    .sort((a, b) => b.version.localeCompare(a.version))[0];
  if (privacy) {
    if (covered(privacy))
      await database.query("INSERT INTO coaching_cal_legal_observation(sha256,first_seen) VALUES($1,$2) ON CONFLICT DO NOTHING", [
        privacy.sha256,
        fixture ? new Date(fixture.firstSeen) : now,
      ]);
  }
  const current = (text: string) => registry.filter((v) => v.text === text && v.version <= day).sort((a, b) => b.version.localeCompare(a.version))[0];
  const policy = current("confidentialite"),
    contract = current("contrat-coach");
  if (!policy || !covered(policy) || !policy.coachingCapabilities?.includes("cal-com") || !contract?.coachingCapabilities?.includes("cal-com")) return false;
  const observation = (
    await database.query<{ firstSeen: Date }>('SELECT first_seen AS "firstSeen" FROM coaching_cal_legal_observation WHERE sha256=$1', [policy.sha256])
  ).rows[0];
  return !!observation && now.getTime() - observation.firstSeen.getTime() >= 30 * 24 * 3600000;
}
