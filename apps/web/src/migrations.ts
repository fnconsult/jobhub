/**
 * Every table of the web app, created or upgraded in dependency order. Safe to
 * run repeatedly. `npm run db:migrate` runs it; tests use it to check rules that
 * hold across all tables (e.g. what deleting a Candidate removes, ADR-0010).
 */
import { migrateActionCards } from "./action-cards/index";
import { migrateAdministratorRoles } from "./admin/administrators";
import { migrateBackOfficeAudit } from "./admin/back-office";
import { migrateAgentRunLog } from "./agent-runs/index";
import { migrateAiUsage } from "./ai-usage/index";
import { migrateApplications } from "./applications/index";
import { migrateAppointmentReminders } from "./appointment-reminders/index";
import { migrateAtsScores } from "./ats-score/index";
import { migrateCandidateAccounts, type AuthConfig } from "./auth/index";
import { migrateAssistantConversations } from "./back-office-assistant/conversations";
import { migrateBilling } from "./billing/index";
import { migrateCoachConversations } from "./coach-conversations/index";
import { importedPlaybooks } from "./coaching-playbooks/import";
import { migrateCoachingPlaybooks } from "./coaching-playbooks/index";
import { migrateCoachMemory } from "./coach-memory/index";
import { migrateCompanyDossiers } from "./company-dossiers/index";
import { migrateDiscoveryRuns } from "./discovery-runs/index";
import { migrateEmailIntake } from "./email-intake/index";
import { migrateEnrichedContacts } from "./enriched-contacts/index";
import { migrateEuAiConsents } from "./eu-ai-consent/index";
import { migrateEvals } from "./evals/index";
import { migrateFollowUps } from "./follow-ups/index";
import { migrateGuardrails } from "./guardrails/store";
import { migrateHumanCoaches } from "./human-coaches/index";
import { migrateJobDigests } from "./job-digests/index";
import { migrateJobOffers } from "./job-offers/index";
import { migrateJobSearches } from "./job-searches/index";
import { migratePlatformSettings } from "./platform-settings/index";
import { migrateProfiles } from "./profiles/index";
import { migrateProviderSecrets } from "./provider-secrets/index";
import { migrateReferenceData } from "./reference-data/index";
import { migrateSearchSites } from "./search-sites/index";
import { migrateSignInProviders } from "./sign-in-providers/index";
import { migrateSignalements } from "./signalements/index";
import { migrateTailoredCvs } from "./tailored-cv/index";
import { migrateTailoredDocuments } from "./tailored-documents/index";
import { migrateTargetCompanies } from "./target-companies/index";
import { migrateUnansweredQuestions } from "./unanswered-questions/index";
import { migrateWebSearchAlerts } from "./web-search-alert/index";

/**
 * Migrates every table; `onMigrated` hears what is up to date after each step ("Profiles are up to date").
 * `env` holds the Google client the Sign-in Providers are seeded with (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET),
 * and the AI Coach's route the imported Playbook Agents start from (AI_COACHING_PROVIDER, AI_COACHING_MODEL).
 */
export async function migrateDatabase(
  config: AuthConfig,
  onMigrated: (done: string) => void = () => {},
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  const { database } = config;
  const steps: [string, () => Promise<void>][] = [
    ["Candidate accounts are up to date", () => migrateCandidateAccounts(config)],
    ["Agent Run log is up to date", () => migrateAgentRunLog(database)],
    ["EU AI consents are up to date", () => migrateEuAiConsents(database)],
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
    ["Job Digests are up to date", () => migrateJobDigests(database)],
    ["Job discovery runs are up to date", () => migrateDiscoveryRuns(database)],
    ["Target Companies and careers sites are up to date", () => migrateTargetCompanies(database)],
    ["Human Coaches, Coach Access and Coaching Sessions are up to date", () => migrateHumanCoaches(database)],
    ["Appointment Reminders are up to date", () => migrateAppointmentReminders(database)],
    ["Coach Conversations are up to date", () => migrateCoachConversations(database)],
    ["Job Sites, Job discovery sources and Job discovery sites are up to date", () => migrateSearchSites(database)],
    ["Coach Memory is up to date", () => migrateCoachMemory(database)],
    ["Back Office Audit is up to date", () => migrateBackOfficeAudit(database)],
    ["Back Office Roles are up to date", () => migrateAdministratorRoles(database)],
    ["Provider Secrets are up to date", () => migrateProviderSecrets(database)],
    ["Platform Settings are up to date", () => migratePlatformSettings(database)],
    ["Sign-in Providers are up to date", () => migrateSignInProviders(database, env)],
    ["Back Office Assistant conversations are up to date", () => migrateAssistantConversations(database)],
    ["AI Usage is up to date", () => migrateAiUsage(database)],
    ["Web search alerts are up to date", () => migrateWebSearchAlerts(database)],
    ["Coaching Playbooks, the Core Digest, the Sources list and the task Playbooks are up to date", () => migrateCoachingPlaybooks(database, () => importedPlaybooks(env))],
    ["Guardrails are up to date", () => migrateGuardrails(database)],
    ["Eval Cases and Eval Runs are up to date", () => migrateEvals(database)],
    ["Reference data is up to date", () => migrateReferenceData(database)],
    ["Unanswered Questions are up to date", () => migrateUnansweredQuestions(database)],
    ["Signalements are up to date", () => migrateSignalements(database)],
    ["Forwarding addresses are up to date", () => migrateEmailIntake(database)],
  ];
  for (const [done, migrate] of steps) {
    await migrate();
    onMigrated(done);
  }
}
