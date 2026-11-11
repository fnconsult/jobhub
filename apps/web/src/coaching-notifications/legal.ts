import { parisDay, type LegalTextVersionRecord } from "@jobhub/help";
import { connectLegalRegistry } from "../coaching-connect/legal";
/** New coaching delivery stays closed until current human texts cover Coach-space processing. */
export function coachingNoticesLegalReady(registry: readonly LegalTextVersionRecord[] = connectLegalRegistry(), now = new Date()) {
  return ["cgv", "contrat-coach", "confidentialite"].every(
    (text) =>
      registry
        .filter((v) => v.text === text && v.version <= parisDay(now))
        .sort((a, b) => b.version.localeCompare(a.version))[0]
        ?.coachingCapabilities?.includes("coach-space") === true,
  );
}
export function coachingNoticesEnabled(
  spaceEnabled: boolean,
  calRemindersDisabled: boolean,
  registry: readonly LegalTextVersionRecord[] = connectLegalRegistry(),
  now = new Date(),
) {
  return spaceEnabled && calRemindersDisabled && coachingNoticesLegalReady(registry, now);
}
