import {migrateCoachingTaxes} from "./coaching-tax";
import {migrateCoachingNotifications} from "./coaching-notifications";
import { migrateCoachingCancellations } from "./coaching-cancellations";
import {migrateCoachingRefunds} from "./coaching-refunds";
import {migrateCoachingBooking} from "./coaching-booking";
import {migrateCoachingEarnings} from "./coaching-earnings";
import { migrateCoachingConnect } from "./coaching-connect";
import {migrateCoachPages} from "./coach-pages";
import {migrateCoachAssociations} from "./coach-associations";
import {migrateCoachContracts} from "./coach-contracts";
import {migrateCoachEnrolments} from "./coach-enrolments";
import { migrateCoachingOffers } from "./coaching-offers";
import { migrateSharedReading } from "./shared-reading";
import { migrateSessionReports } from "./coach-space/reports";
import { migrateCoachContacts } from "./coach-space/contacts";
import { migrateCoachWorkspace } from "./coach-space/workspace";
import { migrateCoachingTimeZones } from "./coaching-time";
/**
 * Every table of the web app, created or upgraded in dependency order. Safe to
 * run repeatedly. `npm run db:migrate` runs it; tests use it to check rules that
 * hold across all tables (e.g. what deleting a Candidate removes, ADR-0010).
 */
import { migrateAcceptances } from "./acceptances/index";
import { migrateActionCards, migrateActionCardsInThread } from "./action-cards/index";
import { migrateAdministratorRoles } from "./admin/administrators";
import { migrateBackOfficeAudit } from "./admin/back-office";
import { migrateAgentRunLog } from "./agent-runs/index";
import { migrateAiUsage } from "./ai-usage/index";
import { migrateApplications } from "./applications/index";
import { migrateAppointmentReminders } from "./appointment-reminders/index";
import { migratePushNotifications } from "./push-notifications/index";
import { migrateAtsScores } from "./ats-score/index";
import { migrateCandidateAccounts, type AuthConfig } from "./auth/index";
import { migrateIdentityNames } from "./candidate-identity/identity-names";
import { migrateAssistantConversations } from "./back-office-assistant/conversations";
import { migrateBilling } from "./billing/index";
import { migrateCoachConversations } from "./coach-conversations/index";
import { importedPlaybooks } from "./coaching-playbooks/import";
import { migrateCoachingPlaybooks } from "./coaching-playbooks/index";
import { migrateCoachMemory } from "./coach-memory/index";
import { migrateCoachProposalsDisplay } from "./coach-proposals-display/index";
import { migrateCompanyDossiers } from "./company-dossiers/index";
import { migrateConsumption } from "./consumption/index";
import { migrateDiscoveryRuns } from "./discovery-runs/index";
import { migrateEmailIntake } from "./email-intake/index";
import { migrateEmailReadings } from "./email-intake/reading";
import { migrateEnrichedContacts } from "./enriched-contacts/index";
import { migrateEuAiConsents } from "./eu-ai-consent/index";
import { migrateEvals } from "./evals/index";
import { migrateExtensionEvents } from "./extension-events/index";
import { migrateFollowUps } from "./follow-ups/index";
import { migrateGuardrails } from "./guardrails/store";
import { migrateHumanCoaches } from "./human-coaches/index";
import { migrateJobDigests } from "./job-digests/index";
import { migrateJobOffers } from "./job-offers/index";
import { migrateJobSearches } from "./job-searches/index";
import { migrateLegalTextNotices } from "./legal-text-notices/index";
import { migrateNouveautesEmails } from "./nouveautes-email/index";
import { backfillOfferBox, migrateOfferBox } from "./offer-box/index";
import { migrateOrders } from "./orders/index";
import { migratePlatformSettings } from "./platform-settings/index";
import { migrateProfiles } from "./profiles/index";
import { migrateProviderSecrets } from "./provider-secrets/index";
import { migrateQuotaReductions } from "./quota-reductions/index";
import { migrateRecipientList } from "./recipient-list/index";
import { migrateReferenceData } from "./reference-data/index";
import { migrateSearchSites } from "./search-sites/index";
import { migrateSignInProviders } from "./sign-in-providers/index";
import { migrateSignalements } from "./signalements/index";
import { migrateTailoredCvs } from "./tailored-cv/index";
import { migrateTailoredDocuments } from "./tailored-documents/index";
import { migrateTargetCompanies } from "./target-companies/index";
import { migrateUnansweredQuestions } from "./unanswered-questions/index";
import { migrateWebSearchAlerts } from "./web-search-alert/index";
import { migrateWithdrawals } from "./withdrawals/index";

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
    // After Profiles: the names of the accounts there are come from their name, else their latest Master CV (#918), once.
    ["Given Names, Family Names and Preferred Names are up to date", () => migrateIdentityNames(database)],
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
    ["Coach Enrolments are up to date",()=>migrateCoachEnrolments(database)],
    ["Coach Contracts are up to date",()=>migrateCoachContracts(database)],
    ["Coaching time zones are up to date", () => migrateCoachingTimeZones(database)],
    ["Coaching Session contacts are up to date", () => migrateCoachContacts(database)],
    ["Shared Reading is up to date", () => migrateSharedReading(database)],
    ["Private Coach Notes are up to date", () => migrateCoachWorkspace(database)],
    ["Withdrawals are up to date", () => migrateWithdrawals(database)],
    ["Appointment Reminders are up to date", () => migrateAppointmentReminders(database)],
    ["Push notifications' devices and switches are up to date", () => migratePushNotifications(database)],
    ["Coach Conversations are up to date", () => migrateCoachConversations(database)],
    ["Session Reports are up to date", () => migrateSessionReports(database)],
    ["Action Cards in Coach Conversations are up to date", () => migrateActionCardsInThread(database)],
    ["Job Sites, Job discovery sources and Job discovery sites are up to date", () => migrateSearchSites(database)],
    ["Coach Memory is up to date", () => migrateCoachMemory(database)],
    ["Back Office Audit is up to date", () => migrateBackOfficeAudit(database)],
    ["Quota Reductions are up to date", () => migrateQuotaReductions(database)],
    ["Acceptances of the CGU and CGV are up to date", () => migrateAcceptances(database)],
    ["Orders are up to date", () => migrateOrders(database)],
    ["Coaching Offers and Sellers are up to date", () => migrateCoachingOffers(database)],
    ["Coach Associations are up to date",()=>migrateCoachAssociations(database)],
    ["Coach Pages are up to date",()=>migrateCoachPages(database)],
    ["Coaching Connect is up to date",()=>migrateCoachingConnect(database)],
    ["Coaching Earnings are up to date",()=>migrateCoachingEarnings(database)],
    ["Coaching Bookings are up to date",()=>migrateCoachingBooking(database)],
    ["Coaching Refunds are up to date",()=>migrateCoachingRefunds(database)],
    ["Coaching Cancellations are up to date", () => migrateCoachingCancellations(database)],
    ["Coaching Notifications are up to date",()=>migrateCoachingNotifications(database)],
    ["Coaching fiscal identity is up to date",()=>migrateCoachingTaxes(database)],
    ["Back Office Roles are up to date", () => migrateAdministratorRoles(database)],
    ["Provider Secrets are up to date", () => migrateProviderSecrets(database)],
    ["Platform Settings are up to date", () => migratePlatformSettings(database)],
    ["Sign-in Providers are up to date", () => migrateSignInProviders(database, env)],
    ["Back Office Assistant conversations are up to date", () => migrateAssistantConversations(database)],
    ["AI Usage is up to date", () => migrateAiUsage(database)],
    ["Web search alerts are up to date", () => migrateWebSearchAlerts(database)],
    ["Coaching Playbooks, the Core Digest, the Sources list and the task Playbooks are up to date", () => migrateCoachingPlaybooks(database, () => importedPlaybooks(env)),
    ],
    ["Guardrails are up to date", () => migrateGuardrails(database)],
    ["Eval Cases and Eval Runs are up to date", () => migrateEvals(database)],
    ["Reference data is up to date", () => migrateReferenceData(database)],
    ["Unanswered Questions are up to date", () => migrateUnansweredQuestions(database)],
    ["Signalements are up to date", () => migrateSignalements(database)],
    ["Extension Events are up to date", () => migrateExtensionEvents(database)],
    ["Forwarding addresses are up to date", () => migrateEmailIntake(database)],
    ["Legal Text notices are up to date", () => migrateLegalTextNotices(database)],
    ["The Nouveautés email is up to date", () => migrateNouveautesEmails(database)],
    ["« Propositions du coach » is up to date", () => migrateCoachProposalsDisplay(database)],
    ["The offers of Received offer emails are up to date", () => migrateEmailReadings(database)],
    ["The Recipient list's changes are up to date", () => migrateRecipientList(database)],
    ["Consumption is up to date", () => migrateConsumption(database)],
    // After every door's table (Job Searches, Job Digests, Received offer emails, Coach Conversations): at the deployment
    // that brings it, the Offer box is filled from their last 30 days (ADR-0090); run again, it changes nothing.
    ["The Offer box is up to date", async () => {
      await migrateOfferBox(database);
      await backfillOfferBox(database, new Date());
    },
    ],
  ];
  for (const [done, migrate] of steps) {
    await migrate();
    onMigrated(done);
  }
}
