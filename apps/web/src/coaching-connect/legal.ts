import { legalTextRegistry, parisDay, type LegalTextVersionRecord } from "@jobhub/help";
/** The explicit E2E preload is absent from the shipped application; a target flag alone never creates approval. */
export function connectLegalRegistry(env: Record<string, string | undefined> = process.env, globals: object = globalThis): readonly LegalTextVersionRecord[] {
  if (env.JOBHUB_TARGET === "e2e") {
    const fixture = (globals as { [key: symbol]: readonly LegalTextVersionRecord[] | undefined })[Symbol.for("jobbbox.e2e.coaching-legal")];
    if (fixture) return fixture;
  }
  return legalTextRegistry();
}
/** Only the current human-authored version of EACH text can declare coverage; a newer omission closes the gate. */
export function connectLegalReady(registry: readonly LegalTextVersionRecord[] = connectLegalRegistry(), now = new Date()): boolean {
  const day = parisDay(now);
  return ["cgv", "confidentialite", "contrat-coach"].every((text) => {
    const current = registry.filter((v) => v.text === text && v.version <= day).sort((a, b) => b.version.localeCompare(a.version))[0];
    return (
      !!current &&
      ["stripe-connect", "marketplace"].every((capability) => current.coachingCapabilities?.includes(capability as "stripe-connect" | "marketplace"))
    );
  });
}
