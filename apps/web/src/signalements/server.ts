import { sharedPool } from "@/database/pool";
import { createSignalements, type Signalements } from "./index";

let instance: Signalements | undefined;

/**
 * The Jobbbox version a Signalement keeps and its dialog shows (#374, #375): the deployed revision (JOBHUB_REVISION, set
 * by deploy/compose.yml), shortened as git does; « dev » when it is not set.
 */
export function jobbboxVersion(): string {
  return process.env.JOBHUB_REVISION?.trim().slice(0, 7) || "dev";
}

/** The app's Signalements (#374), on the database named by DATABASE_URL, keeping jobbboxVersion(). */
export function getSignalements(): Signalements {
  instance ??= createSignalements(sharedPool(), { version: jobbboxVersion() });
  return instance;
}
