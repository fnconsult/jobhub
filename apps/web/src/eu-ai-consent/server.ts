import { sharedPool } from "@/database/pool";
import { createEuAiConsents, type EuAiConsents } from "./index";

let instance: EuAiConsents | undefined;

/** The app's EU AI consents, on the database named by DATABASE_URL. */
export function getEuAiConsents(): EuAiConsents {
  instance ??= createEuAiConsents(sharedPool());
  return instance;
}
