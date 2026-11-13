import type { HelpLocale, LegalTextVersion, LegalTextVersionRecord } from "@jobhub/help";
/** Only a deliberately preloaded E2E harness can provide synthetic legal data. No fixture content ships in the app. */
export interface ContractFixture {
  registry: readonly LegalTextVersionRecord[];
  written: Record<HelpLocale, readonly LegalTextVersion[]>;
}
export function contractFixture(env: Record<string, string | undefined>, globals: object = globalThis): ContractFixture | undefined {
  if (env.JOBHUB_TARGET !== "e2e") return undefined;
  return (globals as { [key: symbol]: ContractFixture | undefined })[Symbol.for("jobbbox.e2e.coach-contract")];
}
