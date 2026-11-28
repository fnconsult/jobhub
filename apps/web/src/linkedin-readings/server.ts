import { sharedPool } from "@/database/pool";
import { createLinkedInReadings, type LinkedInReadings } from "./index";

let instance: LinkedInReadings | undefined;

/**
 * The app's LinkedIn Readings (ADR-0119, #1164), on the database named by DATABASE_URL: what the extension read on the
 * Candidate's click, behind LINKEDIN_READING_ENABLED (see `linkedInReadingOn`).
 */
export function getLinkedInReadings(): LinkedInReadings {
  instance ??= createLinkedInReadings(sharedPool());
  return instance;
}
