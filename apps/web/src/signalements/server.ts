import { sharedPool } from "@/database/pool";
import { createSignalements, type Signalements } from "./index";

let instance: Signalements | undefined;

/**
 * The app's Signalements (#374), on the database named by DATABASE_URL. The Jobbbox version is the deployed revision
 * (JOBHUB_REVISION, set by deploy/compose.yml), shortened as git does; « dev » when it is not set.
 */
export function getSignalements(): Signalements {
  instance ??= createSignalements(sharedPool(), { version: process.env.JOBHUB_REVISION?.trim().slice(0, 7) || "dev" });
  return instance;
}
