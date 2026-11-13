import { legalTextVersions, type HelpLocale } from "@jobhub/help";
import { sharedPool } from "@/database/pool";
import { getAuth } from "@/auth/server";
import { coachContracts } from "./index";
import { contractFixture } from "./fixture";
export function getCoachContractWritten(locale: HelpLocale) {
  return contractFixture(process.env)?.written[locale] ?? legalTextVersions(locale);
}
export function getCoachContracts() {
  const secret = getAuth().options.secret;
  if (typeof secret !== "string") throw new Error("Auth secret required");
  const fixture = contractFixture(process.env);
  return coachContracts(sharedPool(), { secret, ...(fixture ? { registry: () => fixture.registry, written: () => fixture.written.fr } : {}) });
}
