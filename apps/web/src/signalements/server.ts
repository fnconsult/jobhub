import { sharedPool } from "@/database/pool";
import { currentRelease, shortCommit } from "@/release";
import { createSignalements, type Signalements } from "./index";

let instance: Signalements | undefined;

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
