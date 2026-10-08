/**
 * Every table of the web app, created or upgraded in dependency order. Safe to
 * run repeatedly. `npm run db:migrate` runs it; tests use it to check rules that
 * hold across all tables (e.g. what deleting a Candidate removes, ADR-0010).
 */
import { migrateActionCards } from "./action-cards/index";
import { migrateAgentRunLog } from "./agent-runs/index";
import { migrateApplications } from "./applications/index";
import { migrateAtsScores } from "./ats-score/index";
import { migrateCandidateAccounts, type AuthConfig } from "./auth/index";
import { migrateBilling } from "./billing/index";
import { migrateCompanyDossiers } from "./company-dossiers/index";
import { migrateEnrichedContacts } from "./enriched-contacts/index";
import { migrateFollowUps } from "./follow-ups/index";
import { migrateHumanCoaches } from "./human-coaches/index";
import { migrateJobOffers } from "./job-offers/index";
import { migrateJobSearches } from "./job-searches/index";
import { migrateProfiles } from "./profiles/index";
import { migrateTailoredCvs } from "./tailored-cv/index";
import { migrateTailoredDocuments } from "./tailored-documents/index";

/** Migrates every table; `onMigrated` hears what is up to date after each step ("Profiles are up to date"). */
export async function migrateDatabase(config: AuthConfig, onMigrated: (done: string) => void = () => {}): Promise<void> {
  const { database } = config;
  const steps: [string, () => Promise<void>][] = [
    ["Candidate accounts are up to date", () => migrateCandidateAccounts(config)],
    ["Agent Run log is up to date", () => migrateAgentRunLog(database)],
    ["Profiles are up to date", () => migrateProfiles(database)],
    ["Job Offers are up to date", () => migrateJobOffers(database)],
    ["Applications are up to date", () => migrateApplications(database)],
    ["Company Dossiers are up to date", () => migrateCompanyDossiers(database)],
    ["Enriched Contacts are up to date", () => migrateEnrichedContacts(database)],
    ["Cover Letters and Outreach Messages are up to date", () => migrateTailoredDocuments(database)],
    ["Tailored CVs are up to date", () => migrateTailoredCvs(database)],
    ["Action Cards are up to date", () => migrateActionCards(database)],
    ["ATS Scores are up to date", () => migrateAtsScores(database)],
    ["Follow-ups are up to date", () => migrateFollowUps(database)],
    ["Plans and Plan Quotas are up to date", () => migrateBilling(database)],
    ["Job Searches are up to date", () => migrateJobSearches(database)],
    ["Human Coaches, Coach Access and Coaching Sessions are up to date", () => migrateHumanCoaches(database)],
  ];
  for (const [done, migrate] of steps) {
    await migrate();
    onMigrated(done);
  }
}
