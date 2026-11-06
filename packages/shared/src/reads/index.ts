/**
 * The reads of the Jobbbox app (ADR-0076, #684): what each GET of the web app's `/api/*` routes answers a signed-in
 * Candidate, the menus' cards and the objects they lead to, as the pages read them in React Server Components. The
 * routes build their answers to these types and the app reads them with the same schemas, so the two cannot drift
 * apart: a contract test parses every answer with its schema.
 *
 * Every answer is JSON: an instant is an ISO 8601 date and time in UTC (`2026-11-12T13:30:00.000Z`), a day an ISO
 * date in French time (`2026-11-12`, ADR-0028). An absent value is null, never left out. A Match Score is its figure,
 * null when it is not computable (never 0 / 100). Nothing here names another Candidate.
 */
import * as z from "zod";
import { APPLICATION_STATUSES, CONTRACT_TYPES, INTERVIEW_FORMATS, JOB_DIGEST_FREQUENCIES, REMOTE_WORK_OPTIONS, type MasterCvContent, type SearchCriteria } from "../domain";
import { DOCUMENT_LANGUAGES } from "../document-language";
import { provenanceSchema } from "../provenance";

const instant = z.iso.datetime();
const day = z.iso.date();
/** A Match Score's figure, 0–100; null when it is not computable. */
const matchScore = z.number().int().min(0).max(100).nullable();
const named = z.object({ id: z.string(), name: z.string() });

/** One entry of an Agenda Item's Reschedule history; `newAt` null for a Coaching Session's cancellation. */
export const rescheduleSchema = z.object({ previousAt: instant, newAt: instant.nullable(), by: z.enum(["candidate", "coach"]), at: instant });
export type RescheduleRead = z.infer<typeof rescheduleSchema>;

// --- Mes candidatures --------------------------------------------------------------------------------------------

/** What waits for the Candidate on an Application (à traiter): a Follow-up, or an « Abandonnée » suggestion. */
export const TO_HANDLE_KINDS = ["follow_up", "abandon_suggestion"] as const;

/**
 * One Application on Mes candidatures' card: its Job Offer, its status, its Match Score, what waits for the Candidate
 * there, and its next deadline (`nextDeadline`: the next Interview not cancelled, from now on; null when none).
 * `expired`: its Job Offer expired or the Candidate reported it unavailable (`reportedByYou`). `archived`: its Profile is
 * archived (an Archived Application, listed only when asked for).
 */
export const applicationRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  employer: z.string().nullable(),
  status: z.enum(APPLICATION_STATUSES),
  matchScore,
  toHandle: z.enum(TO_HANDLE_KINDS).nullable(),
  nextDeadline: instant.nullable(),
  expired: z.boolean(),
  reportedByYou: z.boolean(),
  archived: z.boolean(),
});
export type ApplicationRow = z.infer<typeof applicationRowSchema>;

/**
 * `GET /api/applications` (`?archivees=1`: the Archived Applications too): Mes candidatures' card, latest saved first,
 * how many are à traiter and how many Archived Applications are left out.
 */
export const applicationsResponseSchema = z.object({
  applications: z.array(applicationRowSchema),
  toHandle: z.number().int().min(0),
  archivedHidden: z.number().int().min(0),
});
export type ApplicationsResponse = z.infer<typeof applicationsResponseSchema>;

/** One Interview of an Application, a Cancelled one included (struck through, with its date of cancellation). */
export const interviewSchema = z.object({
  id: z.string(),
  scheduledAt: instant,
  durationMinutes: z.number().int().positive().nullable(),
  format: z.enum(INTERVIEW_FORMATS).nullable(),
  place: z.string(),
  note: z.string(),
  cancelledAt: instant.nullable(),
  reschedules: z.array(rescheduleSchema),
});
export type InterviewRead = z.infer<typeof interviewSchema>;

/** A Job Offer as a card names it: the full one is `GET /api/job-offers/:id`. */
export const jobOfferLineSchema = z.object({
  id: z.string(),
  title: z.string(),
  employer: z.string().nullable(),
  location: z.string().nullable(),
  url: z.string().nullable(),
  postedAt: instant.nullable(),
  expiredAt: instant.nullable(),
});
export type JobOfferLine = z.infer<typeof jobOfferLineSchema>;

/** `GET /api/applications/:id`: one of the Candidate's Applications with its Interviews, oldest first. 404 for anyone else's. */
export const applicationResponseSchema = z.object({
  id: z.string(),
  status: z.enum(APPLICATION_STATUSES),
  statusChangedAt: instant,
  createdAt: instant,
  jobOffer: jobOfferLineSchema,
  profile: named,
  matchScore,
  reportedUnavailableAt: instant.nullable(),
  interviews: z.array(interviewSchema),
});
export type ApplicationResponse = z.infer<typeof applicationResponseSchema>;

// --- Recherches d'offres -----------------------------------------------------------------------------------------

export const JOB_SEARCH_STATUSES = ["searching", "done", "failed", "stopped"] as const;
export const JOB_SEARCH_FAILURES = ["timeout", "queue_unavailable", "profile_unavailable", "unavailable", "discovery_failed", "other"] as const;

/** One Job Search on Recherches d'offres' card: how many Job Offers it shows, and whether its outcome is unseen (à traiter). */
export const jobSearchLineSchema = z.object({
  id: z.string(),
  status: z.enum(JOB_SEARCH_STATUSES),
  startedAt: instant,
  found: z.number().int().min(0),
  unseen: z.boolean(),
});
export type JobSearchLine = z.infer<typeof jobSearchLineSchema>;

/** `GET /api/job-searches`: each active Profile (an Archived Profile left out), in their order, with its Job Searches, most recent first. */
export const jobSearchesResponseSchema = z.object({
  profiles: z.array(z.object({ profile: named, searches: z.array(jobSearchLineSchema) })),
  unseen: z.number().int().min(0),
});
export type JobSearchesResponse = z.infer<typeof jobSearchesResponseSchema>;

/**
 * Where the Candidate stands with a Job Offer found for a Profile: « gardée » (`kept`: saved as an Application, with any
 * Profile), « écartée » (`dismissed`), or null while they have not decided. Dismissing comes with the app's « Écarter »
 * (#692): until then a Job Offer is kept or undecided.
 */
export const JOB_OFFER_DECISIONS = ["kept", "dismissed"] as const;

/** One Job Offer a Job Search or a Job Digest found, with its Match Score and the Candidate's decision. */
export const foundJobOfferSchema = z.object({
  jobOffer: jobOfferLineSchema,
  matchScore,
  decision: z.enum(JOB_OFFER_DECISIONS).nullable(),
  /** The Candidate's Application for it, when they kept it. */
  applicationId: z.string().nullable(),
});
export type FoundJobOffer = z.infer<typeof foundJobOfferSchema>;

/** `GET /api/job-searches/:id`: one of the Candidate's Job Searches and its Job Offers, best Match Score first (Expired ones left out). */
export const jobSearchResponseSchema = z.object({
  id: z.string(),
  profile: named,
  status: z.enum(JOB_SEARCH_STATUSES),
  failure: z.enum(JOB_SEARCH_FAILURES).nullable(),
  startedAt: instant,
  jobOffers: z.array(foundJobOfferSchema),
});
export type JobSearchResponse = z.infer<typeof jobSearchResponseSchema>;

// --- Offres à traiter (the Offer box, ADR-0090) ------------------------------------------------------------------

/**
 * Where an Arrival came from, its chip: « Recherche » (a Job Search), « Job Digest », « Email » (Email intake), « Lien du
 * coach » (a Job Offer link) and « Extension » (a Capture, once followed, #819).
 */
export const ARRIVAL_SOURCES = ["job_search", "job_digest", "email", "job_offer_link", "extension"] as const;
export type ArrivalSource = (typeof ARRIVAL_SOURCES)[number];

/** Where an Offer box entry stands: à traiter, or « Suivie » (its Application exists, whichever page made it). */
export const OFFER_BOX_ENTRY_STATES = ["to_handle", "followed"] as const;

/**
 * One Offer box entry: its Job Offer, its Profile (null: « Non classée »), the Profile its Match Score is against and
 * « Suivre » saves it with (`scoredWith`: the entry's, or for a « Non classée » one the active Profile it matches best;
 * null when the Candidate has no active Profile), its first Arrival (`arrivalDay`, in French time) and every Arrival
 * source with the date it first came by, oldest first; where it stands, and its Application once « Suivie ».
 */
export const offerBoxEntrySchema = z.object({
  id: z.string(),
  jobOffer: jobOfferLineSchema.extend({ contractType: z.enum(CONTRACT_TYPES).nullable() }),
  profile: named.nullable(),
  scoredWith: named.nullable(),
  matchScore,
  firstArrivalAt: instant,
  arrivalDay: day,
  sources: z.array(z.object({ source: z.enum(ARRIVAL_SOURCES), at: instant })),
  state: z.enum(OFFER_BOX_ENTRY_STATES),
  applicationId: z.string().nullable(),
  followedAt: instant.nullable(),
});
export type OfferBoxEntryRead = z.infer<typeof offerBoxEntrySchema>;

/**
 * `GET /api/offer-box`: the Candidate's Offer box (« Offres à traiter »), the most recent first Arrival first, with how
 * many entries are à traiter and today's day in French time, which « Aujourd'hui » and the posting ages are read against.
 * `offerBoxView` (`@jobhub/shared`) lays it out as the web and the app show it.
 */
export const offerBoxResponseSchema = z.object({
  today: day,
  toHandle: z.number().int().min(0),
  entries: z.array(offerBoxEntrySchema),
});
export type OfferBoxResponse = z.infer<typeof offerBoxResponseSchema>;

// --- Job Digests -------------------------------------------------------------------------------------------------

/**
 * `GET /api/job-digests`: each active Profile, in their order, how often its Job Digest is sent (`frequency`: "none"
 * when it is not; `chosenFrequency`: what the Candidate picked, null while not opted in; `planFrequency`: the most their
 * Plan allows), then every Job Digest sent for it, newest first, with how many Job Offers it lists.
 */
export const jobDigestsResponseSchema = z.object({
  profiles: z.array(
    z.object({
      profile: named,
      frequency: z.enum(JOB_DIGEST_FREQUENCIES),
      chosenFrequency: z.enum(JOB_DIGEST_FREQUENCIES).nullable(),
      planFrequency: z.enum(JOB_DIGEST_FREQUENCIES),
      digests: z.array(z.object({ id: z.string(), sentAt: instant, count: z.number().int().min(0) })),
    }),
  ),
});
export type JobDigestsResponse = z.infer<typeof jobDigestsResponseSchema>;

// --- Agenda ------------------------------------------------------------------------------------------------------

/** An Interview as the Agenda shows it: it leads to its Application's Interviews Section. */
export const interviewAgendaItemSchema = z.object({
  kind: z.literal("interview"),
  id: z.string(),
  applicationId: z.string(),
  jobTitle: z.string(),
  employer: z.string().nullable(),
  scheduledAt: instant,
  durationMinutes: z.number().int().positive().nullable(),
  format: z.enum(INTERVIEW_FORMATS).nullable(),
  place: z.string(),
  note: z.string().nullable(),
  cancelledAt: instant.nullable(),
  reschedules: z.array(rescheduleSchema),
});
export type InterviewAgendaItemRead = z.infer<typeof interviewAgendaItemSchema>;

/** A dated Coaching Session as the Agenda shows it: it leads to its Human Coach. `changedBy` "coach": « modifié par le coach ». */
export const coachingSessionAgendaItemSchema = z.object({
  kind: z.literal("coachingSession"),
  id: z.string(),
  coach: named,
  scheduledAt: instant,
  durationMinutes: z.number().int().positive().nullable(),
  videoLink: z.string().nullable(),
  note: z.string().nullable(),
  changedBy: z.enum(["candidate", "coach"]),
  reschedules: z.array(rescheduleSchema),
});
export type CoachingSessionAgendaItemRead = z.infer<typeof coachingSessionAgendaItemSchema>;

export const agendaItemSchema = z.discriminatedUnion("kind", [interviewAgendaItemSchema, coachingSessionAgendaItemSchema]);
export type AgendaItemRead = z.infer<typeof agendaItemSchema>;

/** A paid Coaching Session with no date yet, with its Human Coach's booking link. */
export const unscheduledCoachingSessionSchema = z.object({
  id: z.string(),
  coach: named.extend({ bookingUrl: z.string() }),
  paidAt: instant,
  reschedules: z.array(rescheduleSchema),
});
export type UnscheduledCoachingSessionRead = z.infer<typeof unscheduledCoachingSessionSchema>;

/**
 * `GET /api/agenda` (`?periode=passes`: the past ones instead): « À planifier » first (the Unscheduled Coaching
 * Sessions, oldest paid first), then the Agenda Items by day in French time: upcoming from the start of today, oldest
 * first; past, newest first.
 */
export const agendaResponseSchema = z.object({
  toSchedule: z.array(unscheduledCoachingSessionSchema),
  days: z.array(z.object({ day, items: z.array(agendaItemSchema) })),
});
export type AgendaResponse = z.infer<typeof agendaResponseSchema>;

// --- Mes coachs humains ------------------------------------------------------------------------------------------

/**
 * `GET /api/coaching`: the Human Coaches to book (`accessGranted`: the Candidate granted them Coach Access), the
 * Candidate's Coaching Sessions (`scheduledAt` null: to schedule on the Human Coach's booking page; `withdrawable`: still
 * in its Withdrawal period and not held under the Immediate Performance Request, so « Renoncer au contrat ici » leads to
 * its Withdrawal form), and the price of a Coaching Session for them, in the currency's smallest unit (`amount` below
 * `regularAmount` with their Plan's discount; null when it cannot be read). Never a Human Coach's email.
 */
export const coachingResponseSchema = z.object({
  coaches: z.array(named.extend({ bio: z.string(), accessGranted: z.boolean() })),
  sessions: z.array(
    z.object({
      id: z.string(),
      coach: named.extend({ bookingUrl: z.string() }),
      paidAt: instant,
      scheduledAt: instant.nullable(),
      durationMinutes: z.number().int().positive().nullable(),
      videoLink: z.string().nullable(),
      note: z.string().nullable(),
      changedBy: z.enum(["candidate", "coach"]).nullable(),
      reschedules: z.array(rescheduleSchema),
      withdrawable: z.boolean(),
    }),
  ),
  price: z.object({ amount: z.number().int().min(0), regularAmount: z.number().int().min(0), currency: z.string() }).nullable(),
});
export type CoachingResponse = z.infer<typeof coachingResponseSchema>;

/**
 * `GET /api/coaching/order?coach=<id>`: the Order page of a Coaching Session as the app shows it before Stripe Checkout
 * (#694, ADR-0074): the Human Coach, the Candidate's Coaching Session Price all taxes included (null when Stripe cannot
 * tell it), and the CGV version to accept, with its permanent address on the web app (null while none is in effect).
 * 404 when the Human Coach cannot be booked. `POST /api/coaching/order` places it.
 */
export const coachingOrderResponseSchema = z.object({
  coach: named,
  price: z.object({ amount: z.number().int().min(0), currency: z.string() }).nullable(),
  cgv: z.object({ version: day, url: z.string() }).nullable(),
});
export type CoachingOrderResponse = z.infer<typeof coachingOrderResponseSchema>;

// --- Profiles ----------------------------------------------------------------------------------------------------

/** `GET /api/profiles`: the Candidate's active Profiles (an Archived Profile left out), oldest first. */
export const profilesResponseSchema = z.array(named);
export type ProfilesResponse = z.infer<typeof profilesResponseSchema>;

const searchCriteriaSchema = z.object({
  targetRole: z.string(),
  locations: z.array(z.string()),
  minSalary: z.number().optional(),
  contractTypes: z.array(z.enum(CONTRACT_TYPES)),
  remoteWorkOptions: z.array(z.enum(REMOTE_WORK_OPTIONS)),
  sectors: z.array(z.string()),
  subsectors: z.array(z.string()),
  domains: z.array(z.string()),
}) satisfies z.ZodType<SearchCriteria>;

const masterCvContentSchema = z.object({
  fullName: z.string(),
  headline: z.string(),
  email: z.string(),
  phone: z.string(),
  location: z.string(),
  summary: z.string(),
  experience: z.array(z.object({ title: z.string(), employer: z.string(), location: z.string(), period: z.string(), description: z.string() })),
  education: z.array(z.object({ degree: z.string(), institution: z.string(), year: z.string() })),
  skills: z.array(z.string()),
  languages: z.array(z.object({ name: z.string(), level: z.string() })),
  photo: z.boolean().optional(),
}) satisfies z.ZodType<MasterCvContent>;

/**
 * `GET /api/profiles/:id`: one of the Candidate's Profiles to read, an archived one included (it says so): its Search
 * Criteria, its current Master CV (its headline is its positioning) and its ATS Score's figure (null before the first).
 */
export const profileResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  archived: z.boolean(),
  searchCriteria: searchCriteriaSchema,
  masterCv: z.object({ version: z.number().int().positive(), content: masterCvContentSchema }),
  atsScore: z.number().int().min(0).max(100).nullable(),
});
export type ProfileResponse = z.infer<typeof profileResponseSchema>;

// --- Tailored Documents ------------------------------------------------------------------------------------------

export const TAILORED_DOCUMENT_KINDS = ["tailored_cv", "cover_letter", "outreach_message"] as const;

/**
 * `GET /api/applications/:id/documents`: the Application's Tailored Documents the Candidate has (the saved Tailored CV,
 * the Cover Letter, the Outreach Message), each in its language, with when it last changed and the addresses to download
 * it (`downloads`: as a PDF, the form a phone shows, and as Word; null for one that is not a file, the Outreach Message).
 * `message`: the words of the one that is not a file, the Outreach Message, its subject (empty when it has none) and its
 * text, for the app to show and share as they are; null for a file.
 */
export const tailoredDocumentsResponseSchema = z.object({
  documentLanguage: z.enum(DOCUMENT_LANGUAGES),
  documents: z.array(
    z.object({
      kind: z.enum(TAILORED_DOCUMENT_KINDS),
      language: z.enum(DOCUMENT_LANGUAGES),
      updatedAt: instant,
      downloads: z.object({ pdf: z.string(), docx: z.string() }).nullable(),
      message: z.object({ subject: z.string(), text: z.string() }).nullable(),
    }),
  ),
});
export type TailoredDocumentsResponse = z.infer<typeof tailoredDocumentsResponseSchema>;

// --- Company Dossier and Enriched Contacts -----------------------------------------------------------------------

/** Job titles to look for at an employer, never a person: the Company Dossier's Suggested Contact Roles. */
export const SUGGESTED_CONTACT_ROLES = ["hiring_manager", "talent_acquisition", "hr_director", "hr_manager", "chief_executive"] as const;
export type SuggestedContactRole = (typeof SUGGESTED_CONTACT_ROLES)[number];

/** The contact-data providers an Enriched Contact can come from (ADR-0015). */
export const CONTACT_PROVIDERS = ["lusha", "kaspr", "apollo"] as const;
export type ContactProviderId = (typeof CONTACT_PROVIDERS)[number];

/** One of the employer's Company News: its title, outlet, day of publication and link, never its text. */
const companyNewsSchema = z.object({ title: z.string(), outlet: z.string(), publishedAt: day, url: z.string() });

const dossierBase = {
  /** The employer's name the dossier was built for. */
  employer: z.string(),
  builtAt: instant,
  suggestedContactRoles: z.array(z.enum(SUGGESTED_CONTACT_ROLES)),
  /** Newest first; `newsSearched` false for a dossier built before Company News. */
  news: z.array(companyNewsSchema),
  newsSearched: z.boolean(),
};

/**
 * A Company Dossier as built: from the French company register (official: the registered identity, its executives by
 * role only, its financials newest year first), or from web sources (less reliable, with the pages its facts come
 * from). No person is named.
 */
export const companyDossierSchema = z.discriminatedUnion("source", [
  z.object({
    ...dossierBase,
    source: z.literal("french_register"),
    reliability: z.literal("official"),
    siren: z.string(),
    name: z.string(),
    legalForm: z.string().nullable(),
    activity: z.string().nullable(),
    address: z.string().nullable(),
    headcount: z.object({ min: z.number(), max: z.number().nullable() }).nullable(),
    financials: z.array(z.object({ year: z.number().int(), revenue: z.number().nullable(), netIncome: z.number().nullable() })),
    executiveRoles: z.array(z.string()),
  }),
  z.object({
    ...dossierBase,
    source: z.literal("web"),
    reliability: z.literal("less_reliable"),
    country: z.string().nullable(),
    address: z.string().nullable(),
    industry: z.string().nullable(),
    headcount: z.string().nullable(),
    revenue: z.string().nullable(),
    website: z.string().nullable(),
    sources: z.array(z.string()),
  }),
]);
export type CompanyDossierRead = z.infer<typeof companyDossierSchema>;

/**
 * `GET /api/applications/:id/company-dossier`: the Application's Company Dossier as last built; before it is built,
 * whether its employer is still to be named (`employer_unknown`) or a Presumed Employer confirmed
 * (`awaiting_confirmation`, a recruiting agency's posting).
 */
export const companyDossierResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("not_built") }),
  z.object({ status: z.literal("employer_unknown") }),
  z.object({ status: z.literal("awaiting_confirmation"), presumedEmployer: z.string().nullable(), presumedEmployerDescription: z.string().nullable(), agency: z.string().nullable() }),
  z.object({ status: z.literal("built"), dossier: companyDossierSchema }),
]);
export type CompanyDossierResponse = z.infer<typeof companyDossierResponseSchema>;

/**
 * `GET /api/applications/:id/enriched-contacts`: whether a contact-data provider is on (`enabled`) and can find people
 * by job title (`searchable`), the people found at the employer (not revealed: a name and a position), and the
 * Enriched Contacts, with their work emails and phones and where and when those were obtained.
 */
export const enrichedContactsResponseSchema = z.object({
  enabled: z.boolean(),
  searchable: z.boolean(),
  found: z.array(z.object({ id: z.string(), name: z.string(), jobTitle: z.string().nullable() })),
  contacts: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      jobTitle: z.string().nullable(),
      emails: z.array(z.string()),
      phones: z.array(z.string()),
      source: z.object({ provider: z.enum(CONTACT_PROVIDERS), retrievedAt: instant }),
    }),
  ),
});
export type EnrichedContactsResponse = z.infer<typeof enrichedContactsResponseSchema>;

// --- Coach Conversations -----------------------------------------------------------------------------------------

/** What a Coach Conversation is about (ADR-0070): one of the Candidate's objects, or a Sidebar menu; null for a Free conversation. */
const subjectSchema = z.object({ kind: z.enum(["application", "profile", "job_search", "job_digest", "menu"]), id: z.string(), name: z.string() });

export const coachConversationSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  subject: subjectSchema.nullable(),
  profile: named.nullable(),
  lastMessageAt: instant,
});

/** `GET /api/coach/conversations` (`?free=1`: the Free conversations alone, the drawer's list): most recently active first. */
export const coachConversationsResponseSchema = z.object({ conversations: z.array(coachConversationSummarySchema) });
export type CoachConversationsResponse = z.infer<typeof coachConversationsResponseSchema>;

/** A Coach proposal's Action Card under a reply (#715): what changes on which object, and how it was decided. */
export const coachProposalCardSchema = z.object({
  id: z.string(),
  status: z.enum(["pending", "accepted", "dismissed", "undone"]),
  change: z.object({
    // The Coach Memory (#719) has no page: its `href` is empty.
    target: z.object({ kind: z.enum(["profile", "application", "job_offer", "job_search", "job_digest", "agenda", "coach_memory"]), id: z.string(), name: z.string(), href: z.string() }),
    what: z.string(),
    before: z.string(),
    after: z.string(),
    /** What else applying it changes on the same object (#718: an Interview added moves its Application to « Entretien »). */
    also: z.array(z.object({ what: z.string(), before: z.string(), after: z.string() })).optional(),
    value: z.record(z.string(), z.string()),
    fields: z.array(
      z.object({
        name: z.string(),
        label: z.string(),
        type: z.enum(["select", "text", "textarea", "datetime", "number"]),
        options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
      }),
    ),
    quota: z.object({ label: z.string(), prompt: z.any().optional() }).optional(),
    /** A Master CV change (#719, ADR-0006): its changes, reviewed one by one, and the edits they come from. */
    review: z
      .object({
        changes: z.array(
          z.object({
            id: z.string(),
            section: z.enum(["headline", "summary", "experience", "education", "skills", "languages"]),
            kind: z.enum(["rephrased", "reordered", "cut", "added"]),
            item: z.string().optional(),
            master: z.string().optional(),
            tailored: z.string().optional(),
            fromOffer: z.array(z.string()).optional(),
          }),
        ),
        edits: z.array(z.record(z.string(), z.unknown())),
      })
      .optional(),
  }),
  edited: z.record(z.string(), z.string()).optional(),
  /** A reviewed proposal's accepted changes (#719). */
  accepted: z.array(z.string()).optional(),
  decidedAt: instant.optional(),
  undoneAt: instant.optional(),
  undoable: z.boolean(),
});

/** One message of a Coach Conversation, as the web shows it. */
export const coachMessageSchema = z.object({
  from: z.enum(["candidate", "coach"]),
  text: z.string(),
  provenance: provenanceSchema.nullable().optional(),
  at: instant.optional(),
  blocked: z.literal(true).optional(),
  jobOffer: z.object({ id: z.string(), title: z.string(), employer: z.string().optional(), followed: z.boolean() }).optional(),
  cards: z.array(coachProposalCardSchema).optional(),
  /** What its Coach Actions saw, named by page as the objects are now (#788): « Le coach a consulté… ». */
  seenNames: z.record(z.string(), z.string().max(80)).optional(),
});

/** A Coach Conversation with its messages and its Context bar's figures. */
export const coachConversationSchema = coachConversationSummarySchema.extend({
  aiDisclosure: z.boolean(),
  messages: z.array(coachMessageSchema),
  context: z.object({
    messages: z.number().int().min(0),
    tokens: z.number().int().min(0),
    /** The Coach context limits of the Candidate's Plan (ADR-0078); null is unlimited. */
    limits: z.object({ coachContextMessages: z.number().int().min(0).nullable(), coachContextTokens: z.number().int().min(0).nullable() }).optional(),
    /** The latest reply's estimate by category, null when none was kept. */
    split: z.object({ messages: z.number().int().min(0), instructions: z.number().int().min(0), profile: z.number().int().min(0), advice: z.number().int().min(0), sources: z.number().int().min(0) }).nullable().optional(),
    /** Once nearly full, the next offered Plan whose Coach context limits allow more (#732); null when none does or below 80 %. */
    upgrade: z.object({ plan: z.string(), name: z.object({ fr: z.string(), en: z.string() }) }).nullable().optional(),
    /** What the latest reply sent in all its AI calls (#790), never the bar's figure; null for a reply saved before. */
    reply: z
      .object({
        calls: z.number().int().min(0),
        turns: z.number().int().min(0),
        rounds: z.number().int().min(0),
        tools: z.array(z.string()),
        inputTokens: z.number().int().min(0),
        cachedInputTokens: z.number().int().min(0),
        outputTokens: z.number().int().min(0),
      })
      .nullable()
      .optional(),
  }),
});
export type CoachConversationRead = z.infer<typeof coachConversationSchema>;

/**
 * `GET /api/coach/conversations?kind=…&id=…`: the conversation of a Subject with its messages, or null until its first
 * message; `GET /api/coach/conversations/:id`: one conversation.
 */
export const coachConversationResponseSchema = z.object({ conversation: coachConversationSchema.nullable() });
export type CoachConversationResponse = z.infer<typeof coachConversationResponseSchema>;

export * from "./legal-steps";
export * from "./coach-space";
