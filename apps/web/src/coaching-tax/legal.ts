import { parisDay, type LegalTextVersionRecord } from "@jobhub/help";
import { connectLegalRegistry } from "../coaching-connect/legal";
export function taxLegalReady(registry: readonly LegalTextVersionRecord[] = connectLegalRegistry(), now = new Date()) {
  const day = parisDay(now);
  return ["confidentialite", "contrat-coach", "cgv"].every((text) => {
    const current = registry.filter((v) => v.text === text && v.version <= day).sort((a, b) => b.version.localeCompare(a.version))[0];
    return Boolean(current?.coachingCapabilities?.includes("dac7"));
  });
}
