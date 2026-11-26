import { sharedPool } from "@/database/pool";
import { currentRelease, shortCommit } from "@/release";
import { candidateIdentityOf } from "@/candidate-identity";
import { createSignalements, type Signalements } from "./index";
import { createSignalementTriage, type SignalementTriage } from "./triage";

let instance: Signalements | undefined;
let triage: SignalementTriage | undefined;

/**
 * The Jobbbox version a Signalement keeps and its dialog shows (#374, #375): the deployed commit (`@/release`, #559),
 * shortened as git does; « dev » when it is not known.
 */
export function jobbboxVersion(): string {
  return shortCommit(currentRelease().commit) ?? "dev";
}

/** The app's Signalements (#374), on the database named by DATABASE_URL, keeping jobbboxVersion(). */
export function getSignalements(): Signalements {
  instance ??= createSignalements(sharedPool(), { version: jobbboxVersion() });
  return instance;
}

/** Signalement triage's view (#1139, ADR-0118): the Signalements sent with the AI notice, redacted with each Candidate's identity. */
export function getSignalementTriage(): SignalementTriage {
  triage ??= createSignalementTriage({ signalements: getSignalements(), identityOf: candidateIdentityOf(sharedPool()), environment: currentRelease().environment });
  return triage;
}
