import { parisDay, type LegalTextVersionRecord } from "@jobhub/help";
import { connectLegalRegistry } from "../coaching-connect/legal";
/** Coverage is declared by the current human-published texts; this module never supplies legal wording or approval. */
export function cancellationLegalReady(registry: readonly LegalTextVersionRecord[] = connectLegalRegistry(), now = new Date()) {
  return ["cgv", "contrat-coach", "confidentialite"].every(
    (text) =>
      registry
        .filter((v) => v.text === text && v.version <= parisDay(now))
        .sort((a, b) => b.version.localeCompare(a.version))[0]
        ?.coachingCapabilities?.includes("cancellations") === true,
  );
}
