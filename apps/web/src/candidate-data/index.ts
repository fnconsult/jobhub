import { cancellationsOf, preserveCancellationRefunds } from "../coaching-cancellations";
import {coachingRefundsOf} from "../coaching-refunds";
import {bookingDataOf} from "../coaching-booking";
import {archiveEarningsService} from "../coaching-earnings";
import {connectDataOf,deleteConnectDataOf} from "../coaching-connect";
import {coachPagesOf,deleteCoachPagesOf} from "../coach-pages";
import {associationDataOf} from "../coach-associations";
import {coachContractAcceptancesOf,coachContractNoticesOf} from "../coach-contracts";
import {inTransaction} from "../database/pool";
import {coachEnrolmentsOf,associationsManagedBy} from "../coach-enrolments";
import type {CoachingSale} from "@jobhub/shared/coaching-offers";
import type { Meeting } from "../coach-space/meeting";
/**
 * A Candidate's own data, as a whole (ADR-0010): exported for them to keep, and
 * deleted with their account.
 *
 * One deep module. Callers get `createCandidateData(database, deps)`:
 *  - `export` all the Candidate's personal data (GDPR art. 15 / 20, #171): what they made and
 *    what the app worked out or obtained about them. Their account (its Given Name, Family Name and Preferred Name, #918; sign-in methods and
  *    sessions), the CGU and CGV versions they accepted, Plan (with its Coach context limits) and Plan Quota use, EU AI consent, Two-step verification (its factors and dates, never a secret), the Legal Text notices emailed and privacy changes closed (#547), the « Propositions du coach » setting (#717), their Consumption (#799: a count per day and Tool), Email intake (Forwarding addresses, sending addresses and Received offer emails), Follow-up Delays, Appointment Reminder setting and the
  *    Appointment Reminders sent, the app's devices for Push notifications (never their token) and their switches; their Profiles
 *    (Search Criteria, every Master CV Version, ATS Score, Job Searches, Job Digest settings and
 *    Job Digests sent); their Applications (Job Offer, Interviews, Match Score, Tailored
 *    Documents, Follow-ups sent, Coach Reviews, Enriched Contacts, Company Dossier); their Coach
 *    Conversations, Coach Memory, Coach Access, Coaching Sessions and Action Cards; as an Administrator,
 *    their Back Office Assistant conversations; the AI Message Log of their own AI calls; the Signalements they sent; their Extension Events (#924)
 *    (never which Administrator handled them); their Orders (#512) and their Withdrawals and refunds (#511); the Job Offers private to them (ADR-0049); their Offer box (ADR-0090). Profiles and Applications
 *    are read through the modules that own them, so they show what the app shows; the rest is
 *    read as stored. Secrets (sign-in tokens, the unsubscribe link), Stripe's and the contact
 *    data providers' identifiers, and what each AI reply cost are left out. EXPORTED_TABLES
 *    says where each table lands.
 *  - `delete` the Candidate's account at once and for good: their billing is
 *    closed first (no paid Plan outlives the account), then the Candidate goes,
 *    and with them everything tied to them (every table holding their data
 *    hangs off theirs with ON DELETE CASCADE: Profiles, CVs, Applications,
 *    Tailored Documents, sessions...). Shared Job Offers are not personal data and may
 *    be referenced by other Candidates: they are kept. A Job Offer private to the
 *    Candidate (ADR-0049) is theirs alone: it goes with them.
 */
import { failureReasonWording } from "@jobhub/shared/i18n";
import {
  DEFAULT_COACH_CONTEXT_LIMITS,
  FREE_PLAN,
  isFailureReason,
  readProvenance,
  type CoachContextLimits,
  type FailureReason,
  type Outcome,
  type Plan,
  type Provenance,
  type SearchCriteria,
} from "@jobhub/shared";
import type { Pool } from "pg";
import { acceptancesOf, type ExportedAcceptance } from "../acceptances";
import type { ActionCard } from "../action-cards";
import type { Application, Applications } from "../applications";
import type { KeptAtsScore } from "../ats-score";
import type { AssistantMessage, ExplainedItem } from "../back-office-assistant";
import { SAVED_ASSISTANT_REPLY_COLUMNS, savedAssistantReplyProvenance, type SavedAssistantReply } from "../back-office-assistant/conversations";
import type { CoachMessage } from "../coach";
import { attachedProfileFrom, SAVED_REPLY_COLUMNS, savedReplyProvenance, SUBJECT_COLUMNS, SUBJECT_JOINS, subjectFrom, type FocusKind, type SavedReply, type Subject, type SubjectRow,
} from "../coach-conversations";
import type { CompanyDossier } from "../company-dossiers";
import { discoveryRunsOf, type ExportedDiscoveryRun } from "../discovery-runs";
import { emailIntakeOf, type ExportedEmailIntake } from "../email-intake";
import type { ContactProviderId } from "../enriched-contacts";
import type { FollowUpDelays } from "../follow-ups";
import type { CoachingSession, CoachReview } from "../human-coaches";
import type { ChosenFrequency } from "../job-digests";
import { privateJobOffersOf, type ExportedPrivateJobOffer } from "../job-offers";
import { offerBoxOf, type ExportedOfferBoxEntry } from "../offer-box";
import { pushNotificationsOf, type ExportedPushNotifications } from "../push-notifications";
import { legalTextNoticesOf, type ExportedLegalTextNotices } from "../legal-text-notices";
import { nouveautesEmailOf, type ExportedNouveautesEmail } from "../nouveautes-email";
import { coachProposalsDisplayOf, type ExportedCoachProposalsDisplay } from "../coach-proposals-display";
import { consumptionOf, type ConsumptionDay } from "../consumption";
import type { JobSearchFailure, JobSearchStatus } from "../job-searches";
import type { MasterCvVersion, Profiles } from "../profiles";
import { rescheduleHistories } from "../reschedules";
import { signalementsOf, type Signalement } from "../signalements";
import { extensionEventsOf, type ExportedExtensionEvent } from "../extension-events";
import { ordersOf, type ExportedOrder } from "../orders";
import { withdrawalsOf, type ExportedWithdrawal } from "../withdrawals";
import { twoStepStatusOf, type TwoStepStatus } from "../two-step-verification";
import type { ApplicationTailoredCv, TailoredCvs } from "../tailored-cv";
import type { Origin } from "../origin";
import type { Surface } from "../request-surface";
import type { ApplicationDrafts, TailoredDocuments } from "../tailored-documents";

export interface ExportedProfile {
  id: string;
  name: string;
  archived: boolean;
  searchCriteria: SearchCriteria;
  /** The Search Criteria came from a Coach proposal the Candidate applied (#719): its Origin. */
  searchCriteriaOrigin?: Origin;
  /** Newest first, each with its Origin when it came from a Coach proposal (#719). */
  masterCvVersions: MasterCvVersion[];
  /** The ATS Score of the Master CV version last scored, or null when it never was. Its Provenance is fixed (rules), so not exported. */
  atsScore: Omit<KeptAtsScore, "provenance"> | null;
  /** Newest first. */
  jobSearches: ExportedJobSearch[];
  /**
   * The runs of Job discovery for the Profile of the last 30 days (#404), newest first: when, what started them, the Search
   * Criteria and each search's query texts. Older ones keep only figures of no one, outside the export.
   */
  jobDiscoveryRuns: Omit<ExportedDiscoveryRun, "profileId">[];
  /** The Candidate's Job Digest settings for the Profile, or null when they never opted in. */
  jobDigest: ExportedJobDigestSettings | null;
  /** The Job Digests sent for the Profile, newest first, each with what made it (ADR-0034, #336) when it was kept. */
  jobDigests: { id: string; sentAt: Date; jobOfferIds: string[]; provenance?: Provenance }[];
  /** The Profile's Target Companies (#406), set aside ones included, oldest first. */
  targetCompanies: ExportedTargetCompany[];
  /** When La Bonne Boite's companies were last fetched for the Profile, or null when they never were. */
  targetCompaniesRefreshedAt: Date | null;
}

/** A Target Company of a Profile: La Bonne Boite's or the Candidate's own, and what Job discovery did with it. */
export interface ExportedTargetCompany {
  name: string;
  origin: "la_bonne_boite" | "candidate";
  hiringScore: number | null;
  city: string | null;
  activity: string | null;
  /** La Bonne Boite's headcount band (#409); `max` null for « `min` and more ». */
  headcount: { min: number; max: number | null } | null;
  addedAt: Date;
  lastVisitedAt: Date | null;
  /** When the company register said it is not a company, so Job discovery no longer visits it. */
  notACompanyAt: Date | null;
  /** Set when the Candidate set it aside, for good. */
  setAsideAt: Date | null;
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
  /** « Prénom Nom », kept from the Given Name and Family Name (#918). */
  name: string;
  /** The Given Name, Family Name and Preferred Name entered in Mon compte › Identité (#918); null each that is empty. */
  givenName: string | null;
  familyName: string | null;
  preferredName: string | null;
  interfaceLanguage: string;
  coachingTimeZone: string | null;
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
  /** What served its last build (ADR-0034, #335), when it was kept. */
  provenance?: Provenance;
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
  /** What it is about (#600): an object or a Sidebar menu, by its kind, id and name; null for a Free conversation. */
  subject: Subject | null;
  /** The Profile it is attached to, if any. */
  profile: { id: string; name: string } | null;
  createdAt: Date;
  lastMessageAt: Date;
  /** Oldest first. */
  /**
   * `jobOfferId`: the Job Offer of a reply's Job Offer card. `provenance`: what served a reply (#327), when it is known.
   * `focus`: what a reply was about: the Subject's object or what was In view (one of six kinds, #600; the Agenda has no id).
   */
  messages: (Omit<CoachMessage, "jobOffer" | "at" | "provenance"> & {
    jobOfferId?: string;
    sentAt: Date;
    provenance?: Provenance;
    focus?: { kind: FocusKind; id?: string };
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

export interface ExportedActionCard extends Pick<ActionCard, "id" | "kind" | "title" | "body" | "focus" | "payload" | "status" | "createdAt"> {
  /** When the Candidate accepted or dismissed it; null while pending. */
  decidedAt: Date | null;
  /** What made it (ADR-0034, #336), when it was kept. */
  provenance?: Provenance;
  /**
   * A Coach proposal's card in a Coach Conversation's thread (#715): the conversation it is in; its payload holds what it
   * proposed, before and after. `edited`: what the Candidate changed before applying it; `undoneAt`: when « Annuler » put
   * the state before back; `undoNote`: what it left as it was (#770, `status_kept`).
   */
  conversationId?: string;
  edited?: unknown;
  undoneAt?: Date;
  undoNote?: string;
}

/** Everything the Candidate made in Jobbbox, ready to be written out as JSON. */
export interface CandidateDataExport {
  exportedAt: Date;
  /** Null once the account is deleted. */
  account: ExportedAccount | null;
  /** Every CGU and CGV version the Candidate accepted (#510), oldest first: its permanent URL and fingerprint, when and how. */
  acceptances: ExportedAcceptance[];
  /** The Candidate's Plan, from Stripe (its identifiers there are left out), or null on the Free Plan from the start. */
  plan: { plan: Plan; subscriptionStatus: string | null; endsAt: Date | null } | null;
  /** The Coach context limits of the Candidate's Plan (ADR-0078), with that Plan (Free when they never paid); null is unlimited. */
  coachContextLimits: { plan: Plan } & CoachContextLimits;
  /**
   * How much of each weekly Plan Quota the Candidate used, newest first: `week` is the Monday
   * it starts on ("2026-10-12"), or the month ("2026-10") for uses counted monthly before ADR-0032.
   */
  quotaUsage: { quota: string; week: string; used: number }[];
  /** Each Quota Reduction they were told of (#514), and whether they cancelled over it, refunded how much (in cents). */
  quotaReductionNotices: {
    plan: string;
    quotas: unknown;
    removedFeatures: string[];
    reason: string;
    effectiveOn: string;
    sentAt: Date | null;
    resolvedAt: Date | null;
    /**
     * The prorata refund when they cancelled over it (null when they did not): made by Stripe (`refunded`), refused by
     * Stripe and still to make (`pending`), made in Stripe by the Jobbbox team afterwards (`settled_by_support`), or
     * `none` when nothing was left to refund. The amount is in the currency's smallest unit (cents).
     */
    refund: { status: "refunded" | "pending" | "settled_by_support" | "none"; amount: number | null; currency: string | null } | null;
  }[];
  /** The Candidate's EU AI consent (ADR-0007), or null when they have not given it (or withdrew it). */
  euAiConsent: { givenAt: Date } | null;
  /**
   * The Candidate's Two-step verification (#663, #664, ADR-0075): when it was turned on (null while off) and its factors, by
   * kind, with when each was added and last used, each passkey's name and device (when known), and how many backup codes
   * are left; never the app's secret, a code nor a passkey's public key.
   */
  twoStepVerification: TwoStepStatus;
  /** The notice emails of substantial Legal Text Versions sent to the Candidate, and the privacy policy changes they closed (#547). */
  legalTextNotices: ExportedLegalTextNotices;
  /** The Candidate's Nouveautés email (#566): whether they ticked it, since when, and the Versions it told them of. */
  nouveautesEmail: ExportedNouveautesEmail;
  /** The Candidate's « Propositions du coach » setting (#717): « card » (the default) or « form », and since when (null: never chosen). */
  coachProposalsDisplay: ExportedCoachProposalsDisplay;
  /**
   * The Candidate's Consumption (#799, ADR-0091): how many times they used each Tool, per French day, for the 12 months
   * kept, newest day first. A count only: no result, model or provider.
   */
  consumption: ConsumptionDay[];
  /** The Candidate's Email intake (ADR-0051, #441): every Forwarding address given to them, with its activation date, and the sending addresses they added. */
  emailIntake: ExportedEmailIntake;
  /** The Follow-up Delays the Candidate set, or null while they keep the defaults. */
  followUpDelays: FollowUpDelays | null;
  /** The Candidate's Appointment Reminder setting and the Appointment Reminders sent. */
  appointmentReminders: ExportedAppointmentReminders;
  /** The devices the Jobbbox app registered for Push notifications (#698: platform, language, dates; never their token), and the switches changed in Rappels. */
  pushNotifications: ExportedPushNotifications;
  /** Every Coach Conversation, most recently active first. */
  coachConversations: ExportedCoachConversation[];
  /** When the Candidate closed the conversations' welcome panel for good, or null while it still shows. */
  coachWelcome: { closedAt: Date | null };
  /** As an Administrator: every Back Office Assistant conversation, most recently active first. */
  backOfficeAssistantConversations: ExportedAssistantConversation[];
  /** The Human Coaches the Candidate granted Coach Access to, oldest first. */
  coachAccess: { coach: CoachNamed; grantedAt: Date }[];
  /**
   * The Coaching Sessions the Candidate paid for, newest first, with the date, duration, video link and note entered, who last changed the date,
   * and their Reschedule history (cancellations included); never the Human Coach's booking link.
   */
  coachingSessions: (Omit<CoachingSession, "coach"> & { coach: CoachNamed; meeting: Meeting | null })[];
  coachingCancellations: Awaited<ReturnType<typeof cancellationsOf>>;
  coachingRefunds:Awaited<ReturnType<typeof coachingRefundsOf>>;
  calBookings:Awaited<ReturnType<typeof bookingDataOf>>;
  connectMoney:Awaited<ReturnType<typeof connectDataOf>>;
  coachPages:Awaited<ReturnType<typeof coachPagesOf>>;
  associationActivity:Awaited<ReturnType<typeof associationDataOf>>;
  coachContractAcceptances:Awaited<ReturnType<typeof coachContractAcceptancesOf>>;
  coachContractNotices:Awaited<ReturnType<typeof coachContractNoticesOf>>;
  coachEnrolments:Awaited<ReturnType<typeof coachEnrolmentsOf>>;
  managedAssociations:Awaited<ReturnType<typeof associationsManagedBy>>;
  coachingSales: {sessionId:string;sale:CoachingSale}[];
  coachingQuotes:{sale:CoachingSale;createdAt:Date}[];
  sharedReading: { sessionId: string; presenter: string; document: unknown; source: unknown; page: number; scroll: number; startedAt: Date }[];
  sessionReports: { id:string;sessionId:string;covered:string;nextSteps:string;resources:string;publishedAt:Date|null }[];
  privateCoachNotes: { coachName: string; sessionId: string | null; text: string; updatedAt: Date }[];
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
  /**
   * Every Signalement the Candidate sent (#374), newest first: type, message, a Question's question and coach reply,
   * context, status and the team's reply, with their dates; never which Administrator changed it or replied.
   */
  signalements: Signalement[];
  /**
   * What the Candidate did from the browser extension (#924), newest first, for the 12 months kept: each Extension Event's
   * kind, date, Extension Version and object, and an error's code, route, HTTP status, place, browser and page's domain.
   */
  extensionEvents: ExportedExtensionEvent[];
  /**
   * Every Order the Candidate placed on the page before Stripe Checkout (#512), oldest first: what it was for, the CGV
   * version accepted with it, the Immediate Performance Request, and when its confirmation went; no Stripe identifiers.
   */
  orders: ExportedOrder[];
  /**
   * Every Withdrawal the Candidate made (#511), newest first: the contract, when it was concluded and withdrawn from, the
   * name and address given, when the acknowledgement went, and each refund with its status; no Stripe identifiers.
   */
  withdrawals: ExportedWithdrawal[];
  /** The Job Offers private to the Candidate (ADR-0049: a role a recruiter's message offered them), newest first. */
  privateJobOffers: ExportedPrivateJobOffer[];
  /**
   * Their Offer box (« Offres à traiter », ADR-0090), oldest first Arrival first: each entry's Job Offer and Profile (null:
   * « Non classée »), its first Arrival and each Arrival source with its date, where it stands and when it was decided.
   */
  offerBox: ExportedOfferBoxEntry[];
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
  /** Where the call was asked from (#919): `web`, `extension`, `app`, `worker`; null when not known. */
  surface: Surface | null;
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
  candidate: "account (with the Given Name, Family Name and Preferred Name)",
  account: "account.signInMethods (no tokens or password)",
  session: "account.sessions (no tokens)",
  administrator_role: "account.backOfficeRoles (not who granted them)",
  candidate_plan: "plan (no Stripe identifiers)",
  quota_usage: "quotaUsage",
  plan_quota_reduction_notice: "quotaReductionNotices (each Quota Reduction they were told of: its Plan, what it lowers, reason and date; when the e-mail went, and their cancellation and refund over it, with whether the refund was made, waits or was made by the team; no Stripe identifiers or error codes)",
  eu_ai_consent: "euAiConsent",
  two_step_verification: "twoStepVerification (when it was turned on, each factor's kind and dates, how many backup codes are left; never the authenticator app's secret nor a backup code)",
  passkey: "twoStepVerification.factors (each passkey's name, the device it was made with when known, when it was added and last used; never its public key nor its credential id)",
  forwarding_address: "emailIntake.forwardingAddresses (replaced and switched off ones included, with their dates)",
  sending_address: "emailIntake.sendingAddresses (those the Candidate added; their account's is account.email)",
  received_offer_email: "emailIntake.receivedOfferEmails (outcome, kind, sender's domain and dates; never the text)",
  received_offer_email_offer: "emailIntake.receivedOfferEmails[].offers (each offer: new with its Profile and Match Score, déjà vue, À capturer or too old)",
  candidate_recognised_sender: "emailIntake.recognisedSenders (those the Candidate added for themselves, with their label and date)",
  candidate_switched_off_sender: "emailIntake.switchedOffSenders (the platform's Recognised senders they switched off for themselves, with the date)",
  follow_up_delay: "followUpDelays",
  appointment_reminder_setting: "appointmentReminders.enabled and changedAt",
  appointment_reminder: "appointmentReminders.sent",
  push_device: "pushNotifications.devices (platform, language, when registered and last seen; never the token nor the session)",
  push_notification_setting: "pushNotifications.switches (each event switched in Rappels, on or off, and when)",
  push_notification_sent: "pushNotifications.sent (each notification queued under its event's key: the event and when, never the key nor the text)",
  coach_welcome_closed: "coachWelcome.closedAt",
  legal_text_notice: "legalTextNotices.emailed (the text and version each notice email told of, #547)",
  privacy_change_seen: "legalTextNotices.privacyChangesSeen (the privacy policy changes closed, #547)",
  nouveautes_email_subscription: "nouveautesEmail.subscribed and subscribedAt (no unsubscribe token, #566)",
  nouveautes_email_sent: "nouveautesEmail.sent (the Version each Nouveautés email told of, #566)",
  coach_proposals_display: "coachProposalsDisplay (« Propositions du coach » in Mon compte, #717)",
  consumption_day: "consumption (each day's count per Tool, the 12 months kept, #799)",
  profile: "profiles (the Search Criteria's Origin, #719)",
  master_cv_version: "profiles[].masterCvVersions (a version read from a file with what read it; its Origin, #719)",
  ats_score: "profiles[].atsScore",
  job_search: "profiles[].jobSearches (each one's Provenance, not its live steps)",
  discovery_run_detail: "profiles[].jobDiscoveryRuns (the last 30 days' runs: criteria and each search's query texts; their figures are of no one)",
  job_digest_subscription: "profiles[].jobDigest (no unsubscribe token)",
  job_digest: "profiles[].jobDigests",
  target_company: "profiles[].targetCompanies (set aside ones included)",
  target_company_refresh: "profiles[].targetCompaniesRefreshedAt (not what La Bonne Boite was asked)",
  application: "applications (each status's Origin, when a Coach proposal the Candidate applied gave it, #715, and each Profile's Origin, #716)",
  interview: "applications[].interviews (with their duration, format, place, date of cancellation and Origin, when a Coach proposal the Candidate applied left it so, #718)",
  interview_reschedule: "applications[].interviews[].reschedules (their Reschedule history)",
  tailored_cv: "applications[].tailoredDocuments (the proposal and the saved one, each with its Provenance)",
  tailored_document: "applications[].tailoredDocuments (each with its Provenance)",
  follow_up_sent: "applications[].followUps",
  coach_review: "applications[].coachReviews",
  enriched_contact: "applications[].enrichedContacts (no provider identifiers)",
  company_dossier: "applications[].companyDossier (with what served its last build)",
  coach_conversation: "coachConversations (each with its Subject: kind, id and name)",
  coach_message: "coachConversations[].messages (blocked ones marked, a Job Offer card's Job Offer named, each reply's Provenance and focus; no AI costs)",
  coach_access: "coachAccess",
  candidate_coaching_time_zone: "account.coachingTimeZone",
  coaching_session_contact: "coachingSessions[].meeting (session contact)",
  coaching_service_refund:"coachingRefunds.refunds (owned refund entitlement, no processor routing)",
  coaching_cancellation: "coachingCancellations.cancellations",
  coaching_cancellation_event: "coachingCancellations.events",
  coaching_cancellation_delivery:"coachingCancellations.deliveries (own recipient/channel delivery facts only)",
  coaching_cancellation_notice: "coachingCancellations.notices",
  coaching_service_refund_attempt:"coachingRefunds.attempts",
  coaching_service_refund_resource:"coachingRefunds.resources",
  coaching_cal_pending:"calBookings.pending (authenticated minimal routing/date facts awaiting a predecessor)",
  coaching_cal_booking:"calBookings.bookings (owned session routing facts, no token)",
  coaching_cal_delivery:"calBookings.deliveries (owned session receipt/rejection facts, no raw payload)",
  coaching_cal_notice:"calBookings.notices (owned change notifications)",
  coaching_cal_cancellation:"calBookings (pending provider cancellation; session detached on erasure)",
  coaching_connect_account:"connectMoney (owned Seller summaries, no Stripe credentials)",
  coaching_connect_payment:"connectMoney.purchases and earnings (pseudonymous accounting)",
  coaching_connect_earning:"connectMoney.earnings",
  coaching_connect_batch:"connectMoney.payouts",
  coaching_connect_allocation:"connectMoney.payouts and earnings",
  coach_page_version:"coachPages (owned professional profile versions and normalized portraits)",
  coach_association_invitation:"associationActivity.invitationsReceived / invitationsSent (no recipient data for sent invitations)",
  coach_association_activity:"associationActivity.activity",
  coach_contract_acceptance:"coachContractAcceptances (pseudonymous proof retained after deletion)",
  coach_contract_notice:"coachContractNotices",
  coach_enrolment:"coachEnrolments (including original professional proof and refusal reason)",
  coach_association_manager:"managedAssociations (business identity and manager role)",
  coaching_offer_quote:"coachingQuotes (immutable prepayment offer snapshot)",
  coaching_session_sale:"coachingSales (paid Seller and Commission snapshot)",
  shared_reading: "sharedReading (active temporary document, excluding coach PDF bytes)",
  session_report: "sessionReports (drafts marked unpublished; published reports also in coachConversations)",
  private_coach_note: "privateCoachNotes (author’s given name, date and text; per Candidate or session)",
  coaching_session: "coachingSessions, with their date, duration, video link, note and who last changed the date (no Stripe identifiers, no booking link)",
  coaching_session_reschedule: "coachingSessions[].reschedules (their Reschedule history, cancellations included)",
  action_card: "actionCards (a Coach proposal's in a thread with its conversation, what it proposed before and after, what was edited, its decision and « Annuler », #715)",
  coach_memory_item: "coachMemory",
  back_office_assistant_conversation: "backOfficeAssistantConversations",
  back_office_assistant_message: "backOfficeAssistantConversations[].messages (blocked ones marked, each reply's Provenance, the item an Explainable label asked about; no AI costs)",
  ai_message_log: "aiMessageLog (no AI costs, a Failure Reason's and warnings' code and wording but not their technical detail)",
  signalement: "signalements (with their context, status and the team's reply; never which Administrator handled them)",
  extension_event: "extensionEvents (what they did from the extension and its errors, the 12 months kept: kind, date, Extension Version, object; an error's code, route, status, place, browser and page's domain, #924)",
  checkout_order: "orders (what was ordered, the CGV version accepted, the Immediate Performance Request, when it was ordered and confirmed; no Stripe identifiers)",
  withdrawal: "withdrawals (the contract, its dates, the name and address given, when the acknowledgement went; no Stripe identifiers)",
  withdrawal_refund: "withdrawals[].refunds (amount, currency and status; no Stripe identifiers)",
  job_offer: "privateJobOffers (only the Job Offers private to the Candidate, ADR-0049; shared ones are no one's and are kept)",
  offer_box_entry: "offerBox (each entry's Job Offer, Profile, first Arrival, Arrival sources with their dates, where it stands and its decision, ADR-0090)",
  legal_acceptance: "acceptances (each CGU and CGV version accepted, when and how; never the pseudonym kept after deletion, nor Stripe's Checkout session id)",
};

/**
 * Tables naming a Candidate that are Jobbbox's own operations record, not only the Candidate's data:
 * kept when their account is deleted, the Candidate's id set to null. Each says what it keeps, for how
 * long, and whether it is in the export while the account lives (then EXPORTED_TABLES lists it too, ADR-0010's
 * amendment and ADR-0073).
 * The same test checks every other table tied to a Candidate is exported and deleted with them.
 */
export const OPERATIONS_RECORD_TABLES: Readonly<Record<string, string>> = {
  coach_contract_acceptance:"Private B2B proof (#880): pseudonymous, detached after account deletion; purged five years afterwards; exported while owned",
  coach_association_activity:"Association business audit (#876): actor detached on deletion, retained two years and exported while owned",
  back_office_audit: "Back Office Audit (#203): the changes an Administrator made, with the email they had then; not exported; purged after 3 years",
  legal_acceptance:
    "Acceptances (#510, ADR-0062, ADR-0073): proof of each CGU and CGV version accepted, kept by a pseudonym (no email, no name); exported while the account lives; purged 5 years after the deletion (CGU), 10 years (CGV)",
};

/** Business obligations survive one user's departure. Explicit erasure removes contact payloads and detaches account FKs. */
export const RETAINED_BUSINESS_TABLES:Readonly<Record<string,string>>={
  coaching_service_refund:"#883: financial refund entitlement, Candidate/session detached on erasure, resolved records purged after ten years",
  coaching_service_refund_attempt:"#883: financial refund attempts, retained through their entitlement until reconciled",
  coaching_service_refund_resource:"#883: observed processor refund identities, retained through their entitlement for bank-failure reconciliation",
  coaching_cal_cancellation:"#881: detach erased sessions, retain unresolved cancellation routing until reconciliation, purge resolved after 30 days",
 coach_association_invitation:"Association invitations (#876): owned contacts explicitly erased at account deletion; seven-day validity, purge thirty days after expiry",
 coaching_connect_account:"Seller Stripe routing (#878): owner detached on deletion; contains no KYC or bank details",
 coaching_connect_payment:"Pseudonymous money owed to the Seller (#878): purchaser/quote detached, Checkout email erased; ten-year proposed accounting retention, human #890",
 coaching_connect_earning:"Seller amounts, refunds and allocations (#878), same financial retention; no Candidate identity",
 coaching_connect_allocation:"Reconciles money already paid to a Seller (#878), same financial retention; no Candidate identity",
 coaching_connect_batch:"Seller monthly bank payouts (#878), same financial retention; no Candidate identity",
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
  coachingCancellationOn?: () => Promise<boolean>;
  profiles: Pick<Profiles, "list" | "get" | "masterCvVersions">;
  applications: Pick<Applications, "list" | "get">;
  tailoredCvs: Pick<TailoredCvs, "get">;
  tailoredDocuments: Pick<TailoredDocuments, "get">;
  /** Ends the Candidate's paid Plan, if any, before the account goes. Without it, there is nothing to close. */
  billing?: { closeAccount(candidateId: string): Promise<void> };
}

/** A Company Dossier as exported: its Provenance only when one was kept. */
function exportedDossier(row: (Omit<ExportedCompanyDossier, "provenance"> & { provenance: unknown }) | undefined): ExportedCompanyDossier | null {
  if (!row) return null;
  const { provenance, ...dossier } = row;
  const kept = readProvenance(provenance);
  return { ...dossier, ...(kept && { provenance: kept }) };
}

export function createCandidateData(database: Pool, deps: CandidateDataDeps): CandidateData {
  async function exportProfiles(candidateId: string): Promise<ExportedProfile[]> {
    const [summaries, atsScoresOf, jobSearchesOf, jobDigestSettingsOf, jobDigestsOf, discoveryRuns, targetCompaniesOf, refreshesOf] = await Promise.all([
      deps.profiles.list(candidateId),
      grouped<Omit<KeptAtsScore, "provenance">>(
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
      grouped<Omit<ExportedProfile["jobDigests"][number], "provenance"> & { provenance: unknown }>(
      `SELECT profile_id AS key, id, sent_at AS "sentAt", job_offer_ids::text[] AS "jobOfferIds", provenance FROM job_digest WHERE candidate_id = $1 ORDER BY sent_at DESC, id`,
        candidateId,
      ),
      discoveryRunsOf(database, candidateId),
      grouped<Omit<ExportedTargetCompany, "headcount"> & { headcountMin: number | null; headcountMax: number | null }>(
      `SELECT profile_id AS key, name, origin, hiring_score AS "hiringScore", city, activity, headcount_min AS "headcountMin", headcount_max AS "headcountMax",
              added_at AS "addedAt", last_visited_at AS "lastVisitedAt",
              not_a_company_at AS "notACompanyAt", set_aside_at AS "setAsideAt"
         FROM target_company WHERE candidate_id = $1 ORDER BY added_at, id`,
        candidateId,
      ),
      grouped<{ refreshedAt: Date }>(
      `SELECT r.profile_id AS key, r.refreshed_at AS "refreshedAt" FROM target_company_refresh r JOIN profile p ON p.id = r.profile_id WHERE p.candidate_id = $1`,
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
          ...(profile.searchCriteriaOrigin ? { searchCriteriaOrigin: profile.searchCriteriaOrigin } : {}),
          masterCvVersions: versions,
          atsScore: atsScoresOf(id)[0] ?? null,
          jobSearches: jobSearchesOf(id).map(({ provenance, stopRequestedAt, ...jobSearch }) => {
            const kept = readProvenance(provenance);
            return { ...jobSearch, ...(stopRequestedAt && { stopRequestedAt }), ...(kept && { provenance: kept }) };
          }),
          jobDiscoveryRuns: discoveryRuns.flatMap(({ profileId, ...run }) => (profileId === id ? [run] : [])),
          jobDigest: jobDigestSettingsOf(id)[0] ?? null,
          jobDigests: jobDigestsOf(id).map(({ provenance, ...jobDigest }) => {
            const kept = readProvenance(provenance);
            return { ...jobDigest, ...(kept && { provenance: kept }) };
          }),
          targetCompanies: targetCompaniesOf(id).map(({ headcountMin, headcountMax, ...company }) => ({
            ...company,
            hiringScore: company.hiringScore === null ? null : Number(company.hiringScore),
            headcount: headcountMin === null ? null : { min: headcountMin, max: headcountMax },
          })),
          targetCompaniesRefreshedAt: refreshesOf(id)[0]?.refreshedAt ?? null,
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
      grouped<Omit<ExportedCompanyDossier, "provenance"> & { provenance: unknown }>(
      `SELECT d.application_id AS key, d.presumed_employer AS "presumedEmployer", d.presumed_employer_description AS "presumedEmployerDescription",
              d.agency, d.confirmed_employer AS "confirmedEmployer", d.dossier, d.updated_at AS "updatedAt", d.provenance
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
          companyDossier: exportedDossier(companyDossiersOf(id)[0]),
        };
      }),
    );
    return exported.filter((application) => application !== null);
  }

  async function exportAccount(candidateId: string): Promise<ExportedAccount | null> {
    const [account, signInMethods, sessions, backOfficeRoles] = await Promise.all([
      rowOf<Omit<ExportedAccount, "signInMethods" | "sessions" | "backOfficeRoles">>(`SELECT email, name, given_name AS "givenName", family_name AS "familyName", preferred_name AS "preferredName", "interfaceLanguage", "createdAt", (SELECT time_zone FROM candidate_coaching_time_zone WHERE candidate_id = candidate.id) AS "coachingTimeZone" FROM candidate WHERE id = $1`, candidateId,
      ),
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
  /** The Coach context limits of the Candidate's Plan: those stored for it, else a Plan's with none stored (ADR-0078). */
  async function coachContextLimitsOf(candidateId: string): Promise<CandidateDataExport["coachContextLimits"]> {
    const { rows } = await database.query<{ plan: Plan; stored: boolean; coachContextMessages: number | null; coachContextTokens: number | null }>(
      `SELECT coalesce(p.plan, $2) AS plan, c.plan IS NOT NULL AS stored,
              c.coach_context_messages AS "coachContextMessages", c.coach_context_tokens AS "coachContextTokens"
         FROM (SELECT $1::text AS candidate_id) me
         LEFT JOIN candidate_plan p ON p.candidate_id = me.candidate_id
         LEFT JOIN plan_coach_context c ON c.plan = coalesce(p.plan, $2)`,
      [candidateId, FREE_PLAN],
    );
    const { plan, stored, coachContextMessages, coachContextTokens } = rows[0]!;
    return stored ? { plan, coachContextMessages, coachContextTokens } : { plan, ...DEFAULT_COACH_CONTEXT_LIMITS };
  }

  async function rowOf<T extends object>(sql: string, candidateId: string): Promise<T | null> {
    return (await rowsOf<T>(sql, candidateId))[0] ?? null;
  }

  async function exportAppointmentReminders(candidateId: string): Promise<ExportedAppointmentReminders> {
    const [setting, sent] = await Promise.all([
      rowOf<{ enabled: boolean; changedAt: Date }>(`SELECT enabled, changed_at AS "changedAt" FROM appointment_reminder_setting WHERE candidate_id = $1`, candidateId,
      ),
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
      rowsOf<Pick<ExportedCoachConversation, "id" | "title" | "createdAt" | "lastMessageAt"> & SubjectRow>(
        `SELECT c.id, c.title, c.created_at AS "createdAt", c.last_message_at AS "lastMessageAt", ${SUBJECT_COLUMNS}
           FROM coach_conversation c ${SUBJECT_JOINS}
          WHERE c.candidate_id = $1 ORDER BY c.last_message_at DESC, c.id`,
        candidateId,
      ),
      grouped<
        Pick<ExportedCoachConversation["messages"][number], "from" | "text" | "sentAt"> &
          SavedReply & {
            humanCoach: CoachMessage["humanCoach"];
            blocked: true | null;
            jobOfferId: string | null;
            focusKind: FocusKind | null;
            focusId: string | null;
          }
      >(
        `SELECT m.human_coach AS "humanCoach", m.conversation_id AS key, m.author AS "from", m.text, CASE WHEN m.blocked THEN true END AS blocked, m.job_offer_id AS "jobOfferId", m.created_at AS "sentAt",
                m.focus_kind AS "focusKind", m.focus_id AS "focusId", ${SAVED_REPLY_COLUMNS}
           FROM coach_message m JOIN coach_conversation c ON c.id = m.conversation_id
          WHERE c.candidate_id = $1 ORDER BY m.seq`,
        candidateId,
      ),
    ]);
    // A Blocked message (#228) says so, a reply with a Job Offer card names its Job Offer, a reply says what served it (#327)
    // and what was in view; the others carry no mark. Never what a reply cost.
    return conversations.map(({ id, title, createdAt, lastMessageAt, ...row }) => ({
      id,
      title,
      subject: subjectFrom(row),
      profile: attachedProfileFrom(row),
      createdAt,
      lastMessageAt,
      messages: messagesOf(id).map((message) => {
        const provenance = message.from === "coach" ? savedReplyProvenance(message) : null;
        return {
          from: message.from,
          text: message.text,
          sentAt: message.sentAt,
          ...(message.humanCoach ? { humanCoach: message.humanCoach } : {}),
          ...(message.blocked ? { blocked: message.blocked } : {}),
          ...(message.jobOfferId ? { jobOfferId: message.jobOfferId } : {}),
          ...(provenance ? { provenance } : {}),
          ...(message.focusKind ? { focus: { kind: message.focusKind, ...(message.focusId ? { id: message.focusId } : {}) } } : {}),
        };
      }),
    }));
  }

  async function exportCoachingSessions(candidateId: string): Promise<CandidateDataExport["coachingSessions"]> {
    const sessions = await rowsOf<Omit<CandidateDataExport["coachingSessions"][number], "reschedules">>(
      `SELECT s.id, json_build_object('id', h.id, 'name', h.name) AS coach, s.amount, s.currency, s.paid_at AS "paidAt",
              s.scheduled_at AS "scheduledAt", s.duration_minutes AS "durationMinutes", s.video_link AS "videoLink", s.note, s.changed_by AS "changedBy", (SELECT contact FROM coaching_session_contact WHERE session_id=s.id) AS meeting
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
      grouped<
        Pick<ExportedAssistantConversation["messages"][number], "from" | "text" | "sentAt"> &
          SavedAssistantReply & { blocked: true | null; explained: ExplainedItem | null }
      >(
        `SELECT m.conversation_id AS key, m.author AS "from", m.text, CASE WHEN m.blocked THEN true END AS blocked, m.explained, m.created_at AS "sentAt", ${SAVED_ASSISTANT_REPLY_COLUMNS}
           FROM back_office_assistant_message m JOIN back_office_assistant_conversation c ON c.id = m.conversation_id
          WHERE c.candidate_id = $1 ORDER BY m.seq`,
        candidateId,
      ),
    ]);
    return conversations.map((conversation) => ({
      ...conversation,
      messages: messagesOf(conversation.id).map((message) => {
        const provenance = message.from === "assistant" ? savedAssistantReplyProvenance(message) : null;
        return {
          from: message.from,
          text: message.text,
          sentAt: message.sentAt,
          ...(message.blocked ? { blocked: message.blocked } : {}),
          ...(message.explained ? { explained: message.explained } : {}),
          ...(provenance ? { provenance } : {}),
        };
      }),
    }));
  }

  return {
    async export(candidateId) {
      const [
        account,
        acceptances,
        plan,
        coachContextLimits,
        quotaUsage,
        quotaReductionNotices,
        euAiConsent,
        twoStepVerification,
        legalTextNotices,
        nouveautesEmail,
        coachProposalsDisplay,
        consumption,
        emailIntake,
        followUpDelays,
        appointmentReminders,
        pushNotifications,
        welcomeClosed,
        coachConversations,
        backOfficeAssistantConversations,
        coachAccess,
        coachingSessions,
        actionCards,
        coachMemory,
        aiMessageLog,
        signalements,
        extensionEvents,
        orders,
        withdrawals,
        privateJobOffers,
        offerBox,
        profiles,
        applications,
      ] = await Promise.all([
        exportAccount(candidateId),
        acceptancesOf(database, candidateId),
        rowOf<NonNullable<CandidateDataExport["plan"]>>(
          `SELECT plan, stripe_status AS "subscriptionStatus", ends_at AS "endsAt" FROM candidate_plan WHERE candidate_id = $1`,
          candidateId,
        ),
        coachContextLimitsOf(candidateId),
        rowsOf<CandidateDataExport["quotaUsage"][number]>(
          `SELECT quota, week, used FROM quota_usage WHERE candidate_id = $1 ORDER BY week DESC, quota`,
          candidateId,
        ),
        rowsOf<CandidateDataExport["quotaReductionNotices"][number]>(
          `SELECT r.plan, r.quotas, r.removed_features AS "removedFeatures", r.reason, to_char(r.effective_on, 'YYYY-MM-DD') AS "effectiveOn",
                  n.sent_at AS "sentAt", n.resolved_at AS "resolvedAt",
                  CASE WHEN n.resolved_at IS NULL THEN NULL ELSE json_build_object(
                    'status', CASE WHEN n.refund_failure IS NOT NULL THEN 'pending'
                                   WHEN n.refund_settled_at IS NOT NULL THEN 'settled_by_support'
                                   WHEN n.refund_id IS NOT NULL THEN 'refunded'
                                   ELSE 'none' END,
                    'amount', NULLIF(n.refund_amount, 0), 'currency', n.refund_currency) END AS refund
             FROM plan_quota_reduction_notice n JOIN plan_quota_reduction r ON r.id = n.reduction_id
            WHERE n.candidate_id = $1 ORDER BY r.effective_on DESC, r.id DESC`,
          candidateId,
        ),
        rowOf<{ givenAt: Date }>(`SELECT given_at AS "givenAt" FROM eu_ai_consent WHERE candidate_id = $1`, candidateId),
        twoStepStatusOf(database, candidateId),
        legalTextNoticesOf(database, candidateId),
        nouveautesEmailOf(database, candidateId),
        coachProposalsDisplayOf(database, candidateId),
        consumptionOf(database, candidateId),
        emailIntakeOf(database, candidateId),
        rowOf<FollowUpDelays>(
          `SELECT after_applied AS "afterApplied", after_follow_up AS "afterFollowUp" FROM follow_up_delay WHERE candidate_id = $1`,
          candidateId,
        ),
        exportAppointmentReminders(candidateId),
        pushNotificationsOf(database, candidateId),
        rowOf<{ closedAt: Date }>(`SELECT closed_at AS "closedAt" FROM coach_welcome_closed WHERE candidate_id = $1`, candidateId),
        exportCoachConversations(candidateId),
        exportAssistantConversations(candidateId),
        rowsOf<CandidateDataExport["coachAccess"][number]>(
          `SELECT json_build_object('id', h.id, 'name', h.name) AS coach, a.granted_at AS "grantedAt"
             FROM coach_access a JOIN human_coach h ON h.id = a.coach_id WHERE a.candidate_id = $1 ORDER BY a.granted_at, h.id`,
          candidateId,
        ),
        exportCoachingSessions(candidateId),
        rowsOf<
          Omit<ExportedActionCard, "provenance" | "conversationId" | "edited" | "undoneAt" | "undoNote"> & {
            provenance: unknown;
            conversationId: string | null;
            edited: unknown;
            undoneAt: Date | null;
            undoNote: string | null;
          }
        >(
          `SELECT c.id, c.kind, c.title, c.body, json_build_object('kind', c.focus_kind, 'id', c.focus_id) AS focus, c.payload, c.status, c.created_at AS "createdAt",
                  c.decided_at AS "decidedAt", c.provenance, m.conversation_id AS "conversationId", c.edited, c.undone_at AS "undoneAt", c.undo_note AS "undoNote"
             FROM action_card c LEFT JOIN coach_message m ON m.seq = c.reply_seq
            WHERE c.candidate_id = $1 ORDER BY c.created_at DESC, c.id`,
          candidateId,
        ).then((cards) =>
          cards.map(({ provenance, conversationId, edited, undoneAt, undoNote, ...card }): ExportedActionCard => {
            const kept = readProvenance(provenance);
            return {
              ...card,
              ...(kept && { provenance: kept }),
              ...(conversationId ? { conversationId } : {}),
              ...(edited !== null ? { edited } : {}),
              ...(undoneAt ? { undoneAt } : {}),
              ...(undoNote ? { undoNote } : {}),
            };
          }),
        ),
        rowsOf<CandidateDataExport["coachMemory"][number]>(
          `SELECT id, kind, text, created_at AS "createdAt", updated_at AS "updatedAt" FROM coach_memory_item WHERE candidate_id = $1 ORDER BY created_at, id`,
          candidateId,
        ),
        rowsOf<Omit<ExportedAiMessageLog, "reason" | "warnings"> & { reason: string | null; warnings: string[] }>(
          `SELECT m.id, m.at, u.task, u.provider, u.model, u.outcome, u.reason, u.warnings, m.surface, m.system, m.messages, m.reply
             FROM ai_message_log m JOIN ai_usage u ON u.id = m.usage_id WHERE m.candidate_id = $1 ORDER BY m.at DESC, m.id`,
          candidateId,
        ).then((logs) =>
          logs.map(
            ({ reason, warnings, ...log }): ExportedAiMessageLog => ({
              ...log,
              reason: isFailureReason(reason) ? worded(reason) : null,
              warnings: warnings.filter(isFailureReason).map(worded),
            }),
          ),
        ),
        signalementsOf(database, candidateId),
        extensionEventsOf(database, candidateId),
        ordersOf(database, candidateId),
        withdrawalsOf(database, candidateId),
        privateJobOffersOf(database, candidateId),
        offerBoxOf(database, candidateId),
        exportProfiles(candidateId),
        exportApplications(candidateId),
      ]);
      return {
        coachingCancellations: await cancellationsOf(database, candidateId),
        coachingRefunds: await coachingRefundsOf(database, candidateId),
        calBookings: await bookingDataOf(database, candidateId),
        connectMoney: await connectDataOf(database, candidateId),
        coachPages: await coachPagesOf(database, candidateId),
        associationActivity: await associationDataOf(database, candidateId),
        coachContractAcceptances: await coachContractAcceptancesOf(database, candidateId),
        coachContractNotices: await coachContractNoticesOf(database, candidateId),
        coachEnrolments: await coachEnrolmentsOf(database, candidateId),
        managedAssociations: await associationsManagedBy(database, candidateId),
        coachingSales: await rowsOf<CandidateDataExport["coachingSales"][number]>(
          `SELECT x.session_id AS "sessionId",x.snapshot AS sale FROM coaching_session_sale x JOIN coaching_session s ON s.id=x.session_id WHERE s.candidate_id=$1 ORDER BY s.paid_at,s.id`,
          candidateId,
        ),
        coachingQuotes: await rowsOf<CandidateDataExport["coachingQuotes"][number]>(
          `SELECT snapshot AS sale,created_at AS "createdAt" FROM coaching_offer_quote WHERE candidate_id=$1 ORDER BY created_at,id`,
          candidateId,
        ),
        sharedReading: await rowsOf<CandidateDataExport["sharedReading"][number]>(
          `SELECT r.session_id AS "sessionId",r.presenter,r.payload AS document,r.source,r.page,r.scroll,r.started_at AS "startedAt" FROM shared_reading r JOIN coaching_session s ON s.id=r.session_id WHERE s.candidate_id=$1 ORDER BY r.started_at`,
          candidateId,
        ),
        sessionReports: await rowsOf<CandidateDataExport["sessionReports"][number]>(
          `SELECT id,session_id AS "sessionId",covered,next_steps AS "nextSteps",resources,published_at AS "publishedAt" FROM session_report WHERE candidate_id=$1 ORDER BY created_at,id`,
          candidateId,
        ),
        privateCoachNotes: await rowsOf<{ coachName: string; sessionId: string | null; text: string; updatedAt: Date }>(
          `SELECT split_part(h.name, ' ', 1) AS "coachName", n.session_id AS "sessionId", n.text, n.updated_at AS "updatedAt" FROM private_coach_note n JOIN human_coach h ON h.id=n.coach_id WHERE n.candidate_id=$1 ORDER BY n.updated_at,n.id`,
          candidateId,
        ),
        exportedAt: new Date(),
        account,
        acceptances,
        plan,
        coachContextLimits,
        quotaUsage,
        quotaReductionNotices,
        euAiConsent,
        twoStepVerification,
        legalTextNotices,
        nouveautesEmail,
        coachProposalsDisplay,
        consumption,
        emailIntake,
        followUpDelays,
        appointmentReminders,
        pushNotifications,
        profiles,
        applications,
        coachConversations,
        coachWelcome: { closedAt: welcomeClosed?.closedAt ?? null },
        backOfficeAssistantConversations,
        coachAccess,
        coachingSessions,
        actionCards,
        coachMemory,
        aiMessageLog,
        signalements,
        extensionEvents,
        orders,
        withdrawals,
        privateJobOffers,
        offerBox,
      };
    },

    async delete(candidateId) {
      await deps.billing?.closeAccount(candidateId);
      await inTransaction(database, async (within) => {
        await preserveCancellationRefunds(database, within, candidateId, (await deps.coachingCancellationOn?.()) ?? false);
        await archiveEarningsService(within, candidateId);
        await deleteConnectDataOf(within, candidateId);
        await deleteCoachPagesOf(within, candidateId);
        await within.query(
          "DELETE FROM coach_association_invitation i USING candidate c WHERE c.id=$1 AND (i.email=lower(c.email) OR i.recipient_id=c.id OR i.invited_by=c.id)",
          [candidateId],
        );
        await within.query(
          "UPDATE human_coach h SET retired_at=clock_timestamp() FROM candidate c WHERE c.id=$1 AND h.email=lower(c.email) AND h.contract_pending AND h.retired_at IS NULL",
          [candidateId],
        );
        await within.query(
          "UPDATE coach_association a SET retired_at=clock_timestamp() WHERE a.contract_pending AND a.retired_at IS NULL AND EXISTS(SELECT 1 FROM coach_association_manager m WHERE m.association_id=a.id AND m.candidate_id=$1) AND NOT EXISTS(SELECT 1 FROM coach_association_manager m WHERE m.association_id=a.id AND m.candidate_id<>$1)",
          [candidateId],
        );
        await within.query("DELETE FROM coach_enrolment e USING candidate c WHERE c.id=$1 AND e.state='awaiting_email' AND e.email=c.email", [candidateId]);
        await within.query(`DELETE FROM candidate WHERE id = $1`, [candidateId]);
      });
    },
  };
}
