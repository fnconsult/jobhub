/**
 * A Candidate's own data, as a whole (ADR-0010): exported for them to keep, and
 * deleted with their account.
 *
 * One deep module. Callers get `createCandidateData(database, deps)`:
 *  - `export` all the Candidate's personal data (GDPR art. 15 / 20, #171): what they made and
 *    what the app worked out or obtained about them. Their account (sign-in methods and
 *    sessions), Plan and Plan Quota use, EU AI consent, Follow-up Delays, Appointment Reminder setting and the
 *    Appointment Reminders sent; their Profiles
 *    (Search Criteria, every Master CV Version, ATS Score, Job Searches, Job Digest settings and
 *    Job Digests sent); their Applications (Job Offer, Interviews, Match Score, Tailored
 *    Documents, Follow-ups sent, Coach Reviews, Enriched Contacts, Company Dossier); their Coach
 *    Conversations, Coach Memory, Coach Access, Coaching Sessions and Action Cards; as an Administrator,
 *    their Back Office Assistant conversations; the AI Message Log of their own AI calls. Profiles and Applications
 *    are read through the modules that own them, so they show what the app shows; the rest is
 *    read as stored. Secrets (sign-in tokens, the unsubscribe link), Stripe's and the contact
 *    data providers' identifiers, and what each AI reply cost are left out. EXPORTED_TABLES
 *    says where each table lands.
 *  - `delete` the Candidate's account at once and for good: their billing is
 *    closed first (no paid Plan outlives the account), then the Candidate goes,
 *    and with them everything tied to them (every table holding their data
 *    hangs off theirs with ON DELETE CASCADE: Profiles, CVs, Applications,
 *    Tailored Documents, sessions...). Job Offers are not personal data and may
 *    be referenced by other Candidates: they are kept.
 */
import { failureReasonWording } from "@jobhub/shared/i18n";
import { isFailureReason, readProvenance, type FailureReason, type Outcome, type Plan, type Provenance, type SearchCriteria } from "@jobhub/shared";
import type { Pool } from "pg";
import type { ActionCard } from "../action-cards";
import type { Application, Applications } from "../applications";
import type { KeptAtsScore } from "../ats-score";
import type { AssistantMessage } from "../back-office-assistant";
import { SAVED_ASSISTANT_REPLY_COLUMNS, savedAssistantReplyProvenance, type SavedAssistantReply } from "../back-office-assistant/conversations";
import type { CoachMessage } from "../coach";
import { SAVED_REPLY_COLUMNS, savedReplyProvenance, type SavedReply } from "../coach-conversations";
import type { CompanyDossier } from "../company-dossiers";
import type { ContactProviderId } from "../enriched-contacts";
import type { FollowUpDelays } from "../follow-ups";
import type { CoachingSession, CoachReview } from "../human-coaches";
import type { ChosenFrequency } from "../job-digests";
import type { JobSearchFailure, JobSearchStatus } from "../job-searches";
import type { MasterCvVersion, Profiles } from "../profiles";
import { rescheduleHistories } from "../reschedules";
import type { ApplicationTailoredCv, TailoredCvs } from "../tailored-cv";
import type { ApplicationDrafts, TailoredDocuments } from "../tailored-documents";

export interface ExportedProfile {
  id: string;
  name: string;
  archived: boolean;
  searchCriteria: SearchCriteria;
  /** Newest first. */
  masterCvVersions: MasterCvVersion[];
  /** The ATS Score of the Master CV version last scored, or null when it never was. */
  atsScore: KeptAtsScore | null;
  /** Newest first. */
  jobSearches: ExportedJobSearch[];
  /** The Candidate's Job Digest settings for the Profile, or null when they never opted in. */
  jobDigest: ExportedJobDigestSettings | null;
  /** The Job Digests sent for the Profile, newest first. */
  jobDigests: { id: string; sentAt: Date; jobOfferIds: string[] }[];
}

/** What the Candidate chose for a Profile's Job Digest (its unsubscribe link is a secret, left out). */
export interface ExportedJobDigestSettings {
  /** What the Candidate picked; their Plan may cap it. */
  frequency: ChosenFrequency;
  subscribedAt: Date;
  /** Set while opted out. */
  unsubscribedAt: Date | null;
  /** When a Job Digest was last worked out for the Profile. */
  lastRunAt: Date | null;
}

/** A Job Search the Candidate started for a Profile, and the Job Offers it found. */
export interface ExportedJobSearch {
  id: string;
  status: JobSearchStatus;
  failure: JobSearchFailure | null;
  startedAt: Date;
  /** Null while it is searching. */
  finishedAt: Date | null;
  /** When the Candidate asked to stop it (#331); absent unless they did. */
  stopRequestedAt?: Date;
  /** The Job Offers it found, in the order Job discovery found them. */
  jobOfferIds: string[];
  /** What served it (ADR-0034), when it was kept. */
  provenance?: Provenance;
}

/** The Candidate's account itself (its secrets, such as sign-in tokens, are left out). */
export interface ExportedAccount {
  email: string;
  name: string;
  interfaceLanguage: string;
  createdAt: Date;
  /** The sign-in providers linked to the account (e.g. Google), besides the magic link; oldest first. */
  signInMethods: { provider: string; linkedAt: Date }[];
  /** Where the Candidate is signed in, newest first. */
  sessions: { createdAt: Date; expiresAt: Date; ipAddress: string | null; userAgent: string | null }[];
  /** The Back Office Roles they hold, as an Administrator (not who granted them); oldest first. */
  backOfficeRoles: { role: string; grantedAt: Date }[];
}

/**
 * An Application as the Candidate keeps it: its Job Offer, Interviews (date and time, duration, format,
 * place or link, note), Match Score (worked out from
 * their Profile, as the app shows it), Tailored Documents, and what the app and Human Coaches added to it.
 */
export interface ExportedApplication extends Application {
  tailoredDocuments: {
    documentLanguage: ApplicationDrafts["documentLanguage"];
    /** The Tailored CV saved on the Application, or null. */
    tailoredCv: ApplicationTailoredCv["saved"];
    /** A Tailored CV still under the Candidate's review, or null. */
    tailoredCvProposal: ApplicationTailoredCv["proposal"];
    coverLetter: ApplicationDrafts["coverLetter"];
    outreachMessage: ApplicationDrafts["outreachMessage"];
  };
  /** Follow-ups sent (a Follow-up card accepted, or "Relancée" set), oldest first. */
  followUps: { sentAt: Date }[];
  /** Human Coaches' feedback on its Tailored Documents, oldest first. */
  coachReviews: CoachReview[];
  /** The people at the employer the Candidate obtained from a contact data provider (ADR-0015), in the order found. */
  enrichedContacts: ExportedEnrichedContact[];
  /** What the app found about the employer, or null when nothing was looked up. */
  companyDossier: ExportedCompanyDossier | null;
}

/** The Company Dossier of an Application, as kept. */
export interface ExportedCompanyDossier {
  /** The AI Coach's guess at the employer behind a recruiting agency's posting. */
  presumedEmployer: string | null;
  presumedEmployerDescription: string | null;
  agency: string | null;
  /** The employer the Candidate named. */
  confirmedEmployer: string | null;
  /** Null until it is built. */
  dossier: CompanyDossier | null;
  updatedAt: Date;
}

/** A person found at the employer: contact details once the Candidate revealed them, empty before. */
export interface ExportedEnrichedContact {
  id: string;
  name: string;
  jobTitle: string | null;
  emails: string[];
  phones: string[];
  /** The contact data provider the details come from. */
  provider: ContactProviderId;
  foundAt: Date;
  /** When the contact details were retrieved; null while the person is only found. */
  retrievedAt: Date | null;
}

/** A Coach Conversation with the AI Coach, every message included (what each reply cost is internal, left out). */
export interface ExportedCoachConversation {
  id: string;
  title: string;
  /** The Profile in view when it started, if any. */
  profile: { id: string; name: string } | null;
  createdAt: Date;
  lastMessageAt: Date;
  /** Oldest first. */
  /**
   * `jobOfferId`: the Job Offer of a reply's Job Offer card. `provenance`: what served a reply (#327), when it is known.
   * `focus`: the page's object in view when a reply was asked (an Application, a Job Offer or a Profile).
   */
  messages: (Omit<CoachMessage, "jobOffer" | "at" | "provenance"> & {
    jobOfferId?: string;
    sentAt: Date;
    provenance?: Provenance;
    focus?: { kind: "application" | "job_offer" | "profile"; id: string };
  })[];
}

/** A conversation an Administrator had with the Back Office Assistant, every message included (what each reply cost is internal, left out). */
export interface ExportedAssistantConversation {
  id: string;
  title: string;
  createdAt: Date;
  lastMessageAt: Date;
  /** Oldest first. `provenance`: what served a reply (#327), when it is known. */
  messages: (Omit<AssistantMessage, "provenance" | "at"> & { sentAt: Date; provenance?: Provenance })[];
}

/** A Human Coach as the export names them: their email and booking link are theirs, left out. */
export type CoachNamed = { id: string; name: string };

export interface ExportedActionCard extends ActionCard {
  /** When the Candidate accepted or dismissed it; null while pending. */
  decidedAt: Date | null;
}

/** Everything the Candidate made in Jobbbox, ready to be written out as JSON. */
export interface CandidateDataExport {
  exportedAt: Date;
  /** Null once the account is deleted. */
  account: ExportedAccount | null;
  /** The Candidate's Plan, from Stripe (its identifiers there are left out), or null on the Free Plan from the start. */
  plan: { plan: Plan; subscriptionStatus: string | null; endsAt: Date | null } | null;
  /**
   * How much of each weekly Plan Quota the Candidate used, newest first: `week` is the Monday
   * it starts on ("2026-10-12"), or the month ("2026-10") for uses counted monthly before ADR-0032.
   */
  quotaUsage: { quota: string; week: string; used: number }[];
  /** The Candidate's EU AI consent (ADR-0007), or null when they have not given it (or withdrew it). */
  euAiConsent: { givenAt: Date } | null;
  /** The Follow-up Delays the Candidate set, or null while they keep the defaults. */
  followUpDelays: FollowUpDelays | null;
  /** The Candidate's Appointment Reminder setting and the Appointment Reminders sent. */
  appointmentReminders: ExportedAppointmentReminders;
  /** Every Coach Conversation, most recently active first. */
  coachConversations: ExportedCoachConversation[];
  /** As an Administrator: every Back Office Assistant conversation, most recently active first. */
  backOfficeAssistantConversations: ExportedAssistantConversation[];
  /** The Human Coaches the Candidate granted Coach Access to, oldest first. */
  coachAccess: { coach: CoachNamed; grantedAt: Date }[];
  /**
   * The Coaching Sessions the Candidate paid for, newest first, with the date, duration, video link and note entered, who last changed the date,
   * and their Reschedule history (cancellations included); never the Human Coach's booking link.
   */
  coachingSessions: (Omit<CoachingSession, "coach"> & { coach: CoachNamed })[];
  /** Every Action Card the AI Coach proposed, pending or decided, newest first. */
  actionCards: ExportedActionCard[];
  /**
   * What the Candidate's own AI calls said in the last 30 days (the AI Message Log), newest first:
   * prompt and reply, secrets scrubbed, without what each cost; how each ended, with a failed call's
   * Failure Reason code and French wording, never its technical reason (ADR-0030), and its warnings' (#260).
   */
  aiMessageLog: ExportedAiMessageLog[];
  /** What the Candidate confirmed the AI Coach should remember, oldest first. */
  coachMemory: { id: string; kind: string; text: string; createdAt: Date; updatedAt: Date }[];
  /** Oldest first, archived ones included. */
  profiles: ExportedProfile[];
  /** Newest first. */
  applications: ExportedApplication[];
}

/** A Failure Reason as the Data export holds it: its code and French wording. */
const worded = (code: FailureReason) => ({ code, wording: failureReasonWording(code) });

/** The Candidate's Appointment Reminders, as their Data export holds them. */
export interface ExportedAppointmentReminders {
  /** Whether they receive them: on until they switch them off. */
  enabled: boolean;
  /** When they last switched them on or off; null while never. */
  changedAt: Date | null;
  /** The Appointment Reminders sent, newest first: for which Agenda Item, at which of its dates. */
  sent: { agendaItem: { kind: "interview" | "coachingSession"; id: string }; scheduledAt: Date; sentAt: Date }[];
}

/** One AI Message Log entry, as the Candidate's Data export holds it. */
export interface ExportedAiMessageLog {
  id: string;
  at: Date;
  task: string;
  /** Null for a call stopped before any provider was chosen. */
  provider: string | null;
  model: string | null;
  outcome: Outcome;
  /** Why it failed or warned; null when ok (and for a failure recorded before reasons were). */
  reason: { code: FailureReason; wording: string } | null;
  /** What its feature did instead (#260), each code with its wording; never what happened, which is technical. */
  warnings: { code: FailureReason; wording: string }[];
  system: string | null;
  messages: { role: string; content: string }[];
  reply: string | null;
}

/**
 * Where each table holding a Candidate's data lands in their export. A test checks every table tied
 * to a Candidate is listed (as it checks they are all deleted with them, ADR-0010): a new table
 * must be added to the export, and here, or the test fails.
 */
export const EXPORTED_TABLES: Readonly<Record<string, string>> = {
  candidate: "account",
  account: "account.signInMethods (no tokens or password)",
  session: "account.sessions (no tokens)",
  administrator_role: "account.backOfficeRoles (not who granted them)",
  candidate_plan: "plan (no Stripe identifiers)",
  quota_usage: "quotaUsage",
  eu_ai_consent: "euAiConsent",
  follow_up_delay: "followUpDelays",
  appointment_reminder_setting: "appointmentReminders.enabled and changedAt",
  appointment_reminder: "appointmentReminders.sent",
  profile: "profiles",
  master_cv_version: "profiles[].masterCvVersions",
  ats_score: "profiles[].atsScore",
  job_search: "profiles[].jobSearches (each one's Provenance, not its live steps)",
  job_digest_subscription: "profiles[].jobDigest (no unsubscribe token)",
  job_digest: "profiles[].jobDigests",
  application: "applications",
  interview: "applications[].interviews (with their duration, format, place and date of cancellation)",
  interview_reschedule: "applications[].interviews[].reschedules (their Reschedule history)",
  tailored_cv: "applications[].tailoredDocuments",
  tailored_document: "applications[].tailoredDocuments",
  follow_up_sent: "applications[].followUps",
  coach_review: "applications[].coachReviews",
  enriched_contact: "applications[].enrichedContacts (no provider identifiers)",
  company_dossier: "applications[].companyDossier",
  coach_conversation: "coachConversations",
  coach_message: "coachConversations[].messages (blocked ones marked, a Job Offer card's Job Offer named, each reply's Provenance and focus; no AI costs)",
  coach_access: "coachAccess",
  coaching_session: "coachingSessions, with their date, duration, video link, note and who last changed the date (no Stripe identifiers, no booking link)",
  coaching_session_reschedule: "coachingSessions[].reschedules (their Reschedule history, cancellations included)",
  action_card: "actionCards",
  coach_memory_item: "coachMemory",
  back_office_assistant_conversation: "backOfficeAssistantConversations",
  back_office_assistant_message: "backOfficeAssistantConversations[].messages (blocked ones marked, each reply's Provenance; no AI costs)",
  ai_message_log: "aiMessageLog (no AI costs, a Failure Reason's and warnings' code and wording but not their technical detail)",
};

/**
 * Tables naming a Candidate that are Jobbbox's own operations record, not the Candidate's data:
 * left out of their export and kept when their account is deleted, the Candidate's id set to
 * null. Each says what it keeps and for how long. The same test checks every other table tied
 * to a Candidate is exported and deleted with them.
 */
export const OPERATIONS_RECORD_TABLES: Readonly<Record<string, string>> = {
  back_office_audit: "Back Office Audit (#203): the changes an Administrator made, with the email they had then; purged after 3 years",
};

export interface CandidateData {
  /** All the Candidate's data. */
  export(candidateId: string): Promise<CandidateDataExport>;
  /**
   * Deletes the Candidate's account and everything tied to it, signing them out
   * everywhere. Throws, deleting nothing, if their billing could not be closed.
   * Deleting an account that no longer exists does nothing.
   */
  delete(candidateId: string): Promise<void>;
}

export interface CandidateDataDeps {
  profiles: Pick<Profiles, "list" | "get" | "masterCvVersions">;
  applications: Pick<Applications, "list" | "get">;
  tailoredCvs: Pick<TailoredCvs, "get">;
  tailoredDocuments: Pick<TailoredDocuments, "get">;
  /** Ends the Candidate's paid Plan, if any, before the account goes. Without it, there is nothing to close. */
  billing?: { closeAccount(candidateId: string): Promise<void> };
}

export function createCandidateData(database: Pool, deps: CandidateDataDeps): CandidateData {
  async function exportProfiles(candidateId: string): Promise<ExportedProfile[]> {
    const [summaries, atsScoresOf, jobSearchesOf, jobDigestSettingsOf, jobDigestsOf] = await Promise.all([
      deps.profiles.list(candidateId),
      grouped<KeptAtsScore>(
      `SELECT s.profile_id AS key, s.version, s.score, s.computed_at AS "computedAt" FROM ats_score s JOIN profile p ON p.id = s.profile_id
        WHERE p.candidate_id = $1`,
        candidateId,
      ),
      grouped<ExportedJobSearch>(
      `SELECT profile_id AS key, id, status, failure, started_at AS "startedAt", finished_at AS "finishedAt", job_offer_ids::text[] AS "jobOfferIds", provenance,
              stop_requested_at AS "stopRequestedAt"
         FROM job_search WHERE candidate_id = $1 ORDER BY started_at DESC, id`,
        candidateId,
      ),
      grouped<ExportedJobDigestSettings>(
      `SELECT profile_id AS key, frequency, subscribed_at AS "subscribedAt", unsubscribed_at AS "unsubscribedAt", last_run_at AS "lastRunAt"
         FROM job_digest_subscription WHERE candidate_id = $1`,
        candidateId,
      ),
      grouped<ExportedProfile["jobDigests"][number]>(
      `SELECT profile_id AS key, id, sent_at AS "sentAt", job_offer_ids::text[] AS "jobOfferIds" FROM job_digest WHERE candidate_id = $1 ORDER BY sent_at DESC, id`,
        candidateId,
      ),
    ]);
    const exported = await Promise.all(
      summaries.map(async ({ id }) => {
        const [profile, versions] = await Promise.all([deps.profiles.get(candidateId, id), deps.profiles.masterCvVersions(candidateId, id)]);
        if (!profile || !versions) return null;
        return {
          id,
          name: profile.name,
          archived: profile.archived,
          searchCriteria: profile.searchCriteria,
          masterCvVersions: versions,
          atsScore: atsScoresOf(id)[0] ?? null,
          jobSearches: jobSearchesOf(id).map(({ provenance, stopRequestedAt, ...jobSearch }) => {
            const kept = readProvenance(provenance);
            return { ...jobSearch, ...(stopRequestedAt && { stopRequestedAt }), ...(kept && { provenance: kept }) };
          }),
          jobDigest: jobDigestSettingsOf(id)[0] ?? null,
          jobDigests: jobDigestsOf(id),
        };
      }),
    );
    return exported.filter((profile) => profile !== null);
  }

  /** Rows of one of the Candidate's tables, as `{ key, ...item }`, grouped by key (e.g. the Application they belong to). */
  async function grouped<T extends object>(sql: string, candidateId: string): Promise<(key: string) => T[]> {
    const rows = await rowsOf<T & { key: string }>(sql, candidateId);
    const groups = new Map<string, T[]>();
    for (const { key, ...item } of rows) groups.set(key, [...(groups.get(key) ?? []), item as unknown as T]);
    return (key) => groups.get(key) ?? [];
  }

  async function exportApplications(candidateId: string): Promise<ExportedApplication[]> {
    const [summaries, followUpsOf, coachReviewsOf, enrichedContactsOf, companyDossiersOf] = await Promise.all([
      deps.applications.list(candidateId),
      grouped<{ sentAt: Date }>(
      `SELECT s.application_id AS key, s.sent_at AS "sentAt" FROM follow_up_sent s JOIN application a ON a.id = s.application_id
        WHERE a.candidate_id = $1 ORDER BY s.sent_at`,
        candidateId,
      ),
      grouped<CoachReview>(
      `SELECT r.application_id AS key, r.id, json_build_object('id', h.id, 'name', h.name) AS coach, r.document, r.text, r.created_at AS "createdAt"
         FROM coach_review r JOIN human_coach h ON h.id = r.coach_id WHERE r.candidate_id = $1 ORDER BY r.created_at, r.id`,
        candidateId,
      ),
      grouped<ExportedEnrichedContact>(
      `SELECT e.application_id AS key, e.id, e.name, e.job_title AS "jobTitle", e.emails, e.phones, e.provider, e.found_at AS "foundAt", e.retrieved_at AS "retrievedAt"
         FROM enriched_contact e JOIN application a ON a.id = e.application_id WHERE a.candidate_id = $1 ORDER BY e.found_at, e.id`,
        candidateId,
      ),
      grouped<ExportedCompanyDossier>(
      `SELECT d.application_id AS key, d.presumed_employer AS "presumedEmployer", d.presumed_employer_description AS "presumedEmployerDescription",
              d.agency, d.confirmed_employer AS "confirmedEmployer", d.dossier, d.updated_at AS "updatedAt"
         FROM company_dossier d JOIN application a ON a.id = d.application_id WHERE a.candidate_id = $1`,
        candidateId,
      ),
    ]);
    const exported = await Promise.all(
      summaries.map(async ({ id }): Promise<ExportedApplication | null> => {
        const [application, tailoredCv, drafts] = await Promise.all([
          deps.applications.get(candidateId, id),
          deps.tailoredCvs.get(candidateId, id),
          deps.tailoredDocuments.get(candidateId, id),
        ]);
        if (!application || !tailoredCv || !drafts) return null;
        return {
          ...application,
          tailoredDocuments: {
            documentLanguage: drafts.documentLanguage,
            tailoredCv: tailoredCv.saved,
            tailoredCvProposal: tailoredCv.proposal,
            coverLetter: drafts.coverLetter,
            outreachMessage: drafts.outreachMessage,
          },
          followUps: followUpsOf(id),
          coachReviews: coachReviewsOf(id),
          enrichedContacts: enrichedContactsOf(id),
          companyDossier: companyDossiersOf(id)[0] ?? null,
        };
      }),
    );
    return exported.filter((application) => application !== null);
  }

  async function exportAccount(candidateId: string): Promise<ExportedAccount | null> {
    const [account, signInMethods, sessions, backOfficeRoles] = await Promise.all([
      rowOf<Omit<ExportedAccount, "signInMethods" | "sessions" | "backOfficeRoles">>(`SELECT email, name, "interfaceLanguage", "createdAt" FROM candidate WHERE id = $1`, candidateId),
      rowsOf<ExportedAccount["signInMethods"][number]>(
        `SELECT "providerId" AS provider, "createdAt" AS "linkedAt" FROM account WHERE "userId" = $1 ORDER BY "createdAt", id`,
        candidateId,
      ),
      rowsOf<ExportedAccount["sessions"][number]>(
        `SELECT "createdAt", "expiresAt", "ipAddress", "userAgent" FROM session WHERE "userId" = $1 ORDER BY "createdAt" DESC, id`,
        candidateId,
      ),
      rowsOf<ExportedAccount["backOfficeRoles"][number]>(
        `SELECT role, granted_at AS "grantedAt" FROM administrator_role WHERE candidate_id = $1 ORDER BY granted_at, role`,
        candidateId,
      ),
    ]);
    return account && { ...account, signInMethods, sessions, backOfficeRoles };
  }

  /** Rows of one of the Candidate's tables (`$1` is their id). */
  async function rowsOf<T extends object>(sql: string, candidateId: string): Promise<T[]> {
    return (await database.query<T>(sql, [candidateId])).rows;
  }

  /** The Candidate's row of a table holding one per Candidate, or null. */
  async function rowOf<T extends object>(sql: string, candidateId: string): Promise<T | null> {
    return (await rowsOf<T>(sql, candidateId))[0] ?? null;
  }

  async function exportAppointmentReminders(candidateId: string): Promise<ExportedAppointmentReminders> {
    const [setting, sent] = await Promise.all([
      rowOf<{ enabled: boolean; changedAt: Date }>(`SELECT enabled, changed_at AS "changedAt" FROM appointment_reminder_setting WHERE candidate_id = $1`, candidateId),
      rowsOf<ExportedAppointmentReminders["sent"][number]>(
        `SELECT json_build_object('kind', CASE WHEN interview_id IS NOT NULL THEN 'interview' ELSE 'coachingSession' END, 'id', coalesce(interview_id, coaching_session_id)) AS "agendaItem",
                scheduled_at AS "scheduledAt", sent_at AS "sentAt"
           FROM appointment_reminder WHERE candidate_id = $1 ORDER BY sent_at DESC, scheduled_at DESC, id`,
        candidateId,
      ),
    ]);
    return { enabled: setting?.enabled ?? true, changedAt: setting?.changedAt ?? null, sent };
  }

  async function exportCoachConversations(candidateId: string): Promise<ExportedCoachConversation[]> {
    const [conversations, messagesOf] = await Promise.all([
      rowsOf<Omit<ExportedCoachConversation, "messages">>(
        `SELECT c.id, c.title, CASE WHEN p.id IS NULL THEN NULL ELSE json_build_object('id', p.id, 'name', p.name) END AS profile,
                c.created_at AS "createdAt", c.last_message_at AS "lastMessageAt"
           FROM coach_conversation c LEFT JOIN profile p ON p.id = c.profile_id
          WHERE c.candidate_id = $1 ORDER BY c.last_message_at DESC, c.id`,
        candidateId,
      ),
      grouped<
        Pick<ExportedCoachConversation["messages"][number], "from" | "text" | "sentAt"> &
          SavedReply & { blocked: true | null; jobOfferId: string | null; focusKind: "application" | "job_offer" | "profile" | null; focusId: string | null }
      >(
        `SELECT m.conversation_id AS key, m.author AS "from", m.text, CASE WHEN m.blocked THEN true END AS blocked, m.job_offer_id AS "jobOfferId", m.created_at AS "sentAt",
                m.focus_kind AS "focusKind", m.focus_id AS "focusId", ${SAVED_REPLY_COLUMNS}
           FROM coach_message m JOIN coach_conversation c ON c.id = m.conversation_id
          WHERE c.candidate_id = $1 ORDER BY m.seq`,
        candidateId,
      ),
    ]);
    // A Blocked message (#228) says so, a reply with a Job Offer card names its Job Offer, a reply says what served it (#327)
    // and what was in view; the others carry no mark. Never what a reply cost.
    return conversations.map((conversation) => ({
      ...conversation,
      messages: messagesOf(conversation.id).map((message) => {
        const provenance = message.from === "coach" ? savedReplyProvenance(message) : null;
        return {
          from: message.from,
          text: message.text,
          sentAt: message.sentAt,
          ...(message.blocked ? { blocked: message.blocked } : {}),
          ...(message.jobOfferId ? { jobOfferId: message.jobOfferId } : {}),
          ...(provenance ? { provenance } : {}),
          ...(message.focusKind && message.focusId ? { focus: { kind: message.focusKind, id: message.focusId } } : {}),
        };
      }),
    }));
  }

  async function exportCoachingSessions(candidateId: string): Promise<CandidateDataExport["coachingSessions"]> {
    const sessions = await rowsOf<Omit<CandidateDataExport["coachingSessions"][number], "reschedules">>(
      `SELECT s.id, json_build_object('id', h.id, 'name', h.name) AS coach, s.amount, s.currency, s.paid_at AS "paidAt",
              s.scheduled_at AS "scheduledAt", s.duration_minutes AS "durationMinutes", s.video_link AS "videoLink", s.note, s.changed_by AS "changedBy"
         FROM coaching_session s JOIN human_coach h ON h.id = s.coach_id WHERE s.candidate_id = $1 ORDER BY s.paid_at DESC, s.id`,
      candidateId,
    );
    const histories = await rescheduleHistories(
      database,
      "coaching_session",
      sessions.map((session) => session.id),
    );
    return sessions.map((session) => ({ ...session, reschedules: histories.get(session.id)! }));
  }

  async function exportAssistantConversations(candidateId: string): Promise<ExportedAssistantConversation[]> {
    const [conversations, messagesOf] = await Promise.all([
      rowsOf<Omit<ExportedAssistantConversation, "messages">>(
        `SELECT id, title, created_at AS "createdAt", last_message_at AS "lastMessageAt"
           FROM back_office_assistant_conversation WHERE candidate_id = $1 ORDER BY last_message_at DESC, id`,
        candidateId,
      ),
      grouped<Pick<ExportedAssistantConversation["messages"][number], "from" | "text" | "sentAt"> & SavedAssistantReply & { blocked: true | null }>(
        `SELECT m.conversation_id AS key, m.author AS "from", m.text, CASE WHEN m.blocked THEN true END AS blocked, m.created_at AS "sentAt", ${SAVED_ASSISTANT_REPLY_COLUMNS}
           FROM back_office_assistant_message m JOIN back_office_assistant_conversation c ON c.id = m.conversation_id
          WHERE c.candidate_id = $1 ORDER BY m.seq`,
        candidateId,
      ),
    ]);
    return conversations.map((conversation) => ({
      ...conversation,
      messages: messagesOf(conversation.id).map((message) => {
        const provenance = message.from === "assistant" ? savedAssistantReplyProvenance(message) : null;
        return { from: message.from, text: message.text, sentAt: message.sentAt, ...(message.blocked ? { blocked: message.blocked } : {}), ...(provenance ? { provenance } : {}) };
      }),
    }));
  }

  return {
    async export(candidateId) {
      const [account, plan, quotaUsage, euAiConsent, followUpDelays, appointmentReminders, coachConversations, backOfficeAssistantConversations, coachAccess, coachingSessions, actionCards, coachMemory, aiMessageLog, profiles, applications] = await Promise.all([
        exportAccount(candidateId),
        rowOf<NonNullable<CandidateDataExport["plan"]>>(
          `SELECT plan, stripe_status AS "subscriptionStatus", ends_at AS "endsAt" FROM candidate_plan WHERE candidate_id = $1`,
          candidateId,
        ),
        rowsOf<CandidateDataExport["quotaUsage"][number]>(`SELECT quota, week, used FROM quota_usage WHERE candidate_id = $1 ORDER BY week DESC, quota`, candidateId),
        rowOf<{ givenAt: Date }>(`SELECT given_at AS "givenAt" FROM eu_ai_consent WHERE candidate_id = $1`, candidateId),
        rowOf<FollowUpDelays>(`SELECT after_applied AS "afterApplied", after_follow_up AS "afterFollowUp" FROM follow_up_delay WHERE candidate_id = $1`, candidateId),
        exportAppointmentReminders(candidateId),
        exportCoachConversations(candidateId),
        exportAssistantConversations(candidateId),
        rowsOf<CandidateDataExport["coachAccess"][number]>(
          `SELECT json_build_object('id', h.id, 'name', h.name) AS coach, a.granted_at AS "grantedAt"
             FROM coach_access a JOIN human_coach h ON h.id = a.coach_id WHERE a.candidate_id = $1 ORDER BY a.granted_at, h.id`,
          candidateId,
        ),
        exportCoachingSessions(candidateId),
        rowsOf<ExportedActionCard>(
          `SELECT id, kind, title, body, json_build_object('kind', focus_kind, 'id', focus_id) AS focus, payload, status, created_at AS "createdAt", decided_at AS "decidedAt"
             FROM action_card WHERE candidate_id = $1 ORDER BY created_at DESC, id`,
          candidateId,
        ),
        rowsOf<CandidateDataExport["coachMemory"][number]>(
          `SELECT id, kind, text, created_at AS "createdAt", updated_at AS "updatedAt" FROM coach_memory_item WHERE candidate_id = $1 ORDER BY created_at, id`,
          candidateId,
        ),
        rowsOf<Omit<ExportedAiMessageLog, "reason" | "warnings"> & { reason: string | null; warnings: string[] }>(
          `SELECT m.id, m.at, u.task, u.provider, u.model, u.outcome, u.reason, u.warnings, m.system, m.messages, m.reply
             FROM ai_message_log m JOIN ai_usage u ON u.id = m.usage_id WHERE m.candidate_id = $1 ORDER BY m.at DESC, m.id`,
          candidateId,
        ).then((logs) =>
          logs.map(({ reason, warnings, ...log }): ExportedAiMessageLog => ({
            ...log,
            reason: isFailureReason(reason) ? worded(reason) : null,
            warnings: warnings.filter(isFailureReason).map(worded),
          })),
        ),
        exportProfiles(candidateId),
        exportApplications(candidateId),
      ]);
      return { exportedAt: new Date(), account, plan, quotaUsage, euAiConsent, followUpDelays, appointmentReminders, profiles, applications, coachConversations, backOfficeAssistantConversations, coachAccess, coachingSessions, actionCards, coachMemory, aiMessageLog };
    },

    async delete(candidateId) {
      await deps.billing?.closeAccount(candidateId);
      await database.query(`DELETE FROM candidate WHERE id = $1`, [candidateId]);
    },
  };
}
